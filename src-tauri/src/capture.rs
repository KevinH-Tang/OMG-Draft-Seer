use serde::Serialize;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CapturedScreenshot {
    pub data: String,
    pub mime_type: &'static str,
    pub file_name: &'static str,
    pub width: u32,
    pub height: u32,
}

#[cfg(target_os = "windows")]
mod windows_capture {
    use super::CapturedScreenshot;
    use base64::{engine::general_purpose::STANDARD, Engine as _};
    use std::{
        path::Path,
        thread,
        time::{Duration, Instant},
    };
    use windows::{
        core::{factory, Interface, BOOL},
        Graphics::{
            Capture::{Direct3D11CaptureFramePool, GraphicsCaptureItem},
            DirectX::{Direct3D11::IDirect3DDevice, DirectXPixelFormat},
            Imaging::{BitmapEncoder, SoftwareBitmap},
            SizeInt32,
        },
        Storage::Streams::{DataReader, InMemoryRandomAccessStream},
        Win32::{
            Foundation::{HMODULE, HWND, LPARAM},
            Graphics::{
                Direct3D::D3D_DRIVER_TYPE_HARDWARE,
                Direct3D11::{
                    D3D11CreateDevice, ID3D11Device, ID3D11DeviceContext,
                    D3D11_CREATE_DEVICE_BGRA_SUPPORT, D3D11_SDK_VERSION,
                },
                Dxgi::IDXGIDevice,
            },
            System::WinRT::{
                Direct3D11::CreateDirect3D11DeviceFromDXGIDevice,
                Graphics::Capture::IGraphicsCaptureItemInterop, RoInitialize, RoUninitialize,
                RO_INIT_MULTITHREADED,
            },
            UI::WindowsAndMessaging::{
                EnumWindows, GetForegroundWindow, GetWindowModuleFileNameW, IsIconic,
                IsWindowVisible,
            },
        },
    };

    const DOTA2_EXECUTABLE: &str = "dota2.exe";
    const FRAME_TIMEOUT: Duration = Duration::from_secs(3);

    struct WinRtGuard;

    impl WinRtGuard {
        fn new() -> Result<Self, String> {
            unsafe { RoInitialize(RO_INIT_MULTITHREADED) }
                .map_err(|error| format!("failed to initialize Windows Runtime: {error}"))?;
            Ok(Self)
        }
    }

    impl Drop for WinRtGuard {
        fn drop(&mut self) {
            unsafe { RoUninitialize() }
        }
    }

    pub fn capture() -> Result<CapturedScreenshot, String> {
        let _runtime = WinRtGuard::new()?;
        let window = find_dota2_window()?;
        let (bytes, width, height) = capture_window(window)?;
        Ok(CapturedScreenshot {
            data: STANDARD.encode(bytes),
            mime_type: "image/png",
            file_name: "dota2-capture.png",
            width,
            height,
        })
    }

    fn find_dota2_window() -> Result<HWND, String> {
        let mut windows = Vec::new();

        unsafe extern "system" fn collect_window(hwnd: HWND, lparam: LPARAM) -> BOOL {
            if !IsWindowVisible(hwnd).as_bool() || IsIconic(hwnd).as_bool() {
                return true.into();
            }

            let mut path = [0u16; 512];
            let length = GetWindowModuleFileNameW(hwnd, &mut path);
            if length == 0 {
                return true.into();
            }
            let executable = String::from_utf16_lossy(&path[..length as usize]);
            let is_dota2 = Path::new(&executable)
                .file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.eq_ignore_ascii_case(DOTA2_EXECUTABLE));
            if is_dota2 {
                let windows = &mut *(lparam.0 as *mut Vec<HWND>);
                windows.push(hwnd);
            }
            true.into()
        }

        unsafe {
            EnumWindows(
                Some(collect_window),
                LPARAM(&mut windows as *mut Vec<HWND> as isize),
            )
            .map_err(|error| format!("failed to enumerate windows: {error}"))?;
        }

        if windows.is_empty() {
            return Err("Dota 2 is not running with a visible, non-minimized window.".to_owned());
        }
        let foreground = unsafe { GetForegroundWindow() };
        Ok(windows
            .iter()
            .copied()
            .find(|window| *window == foreground)
            .unwrap_or(windows[0]))
    }

    fn create_graphics_device() -> Result<IDirect3DDevice, String> {
        let mut device: Option<ID3D11Device> = None;
        let mut context: Option<ID3D11DeviceContext> = None;
        unsafe {
            D3D11CreateDevice(
                None,
                D3D_DRIVER_TYPE_HARDWARE,
                HMODULE::default(),
                D3D11_CREATE_DEVICE_BGRA_SUPPORT,
                None,
                D3D11_SDK_VERSION,
                Some(&mut device as *mut Option<ID3D11Device>),
                None,
                Some(&mut context as *mut Option<ID3D11DeviceContext>),
            )
            .map_err(|error| format!("failed to create a Direct3D 11 device: {error}"))?;
        }
        let device = device.ok_or_else(|| "Direct3D 11 returned no device.".to_owned())?;
        let dxgi_device: IDXGIDevice = device
            .cast()
            .map_err(|error| format!("failed to access the DXGI device: {error}"))?;
        let graphics_device = unsafe { CreateDirect3D11DeviceFromDXGIDevice(&dxgi_device) }
            .map_err(|error| format!("failed to create the Windows Graphics device: {error}"))?;
        graphics_device
            .cast()
            .map_err(|error| format!("failed to cast the Windows Graphics device: {error}"))
    }

    fn capture_window(window: HWND) -> Result<(Vec<u8>, u32, u32), String> {
        let interop: IGraphicsCaptureItemInterop = factory::<GraphicsCaptureItem, _>()
            .map_err(|error| format!("failed to access the capture item factory: {error}"))?;
        let item: GraphicsCaptureItem = unsafe { interop.CreateForWindow(window) }
            .map_err(|error| format!("failed to create a capture item for Dota 2: {error}"))?;
        let item_size = item
            .Size()
            .map_err(|error| format!("failed to read the Dota 2 window size: {error}"))?;
        let width = u32::try_from(item_size.Width)
            .ok()
            .filter(|value| *value > 0)
            .ok_or_else(|| "Dota 2 returned an invalid window width.".to_owned())?;
        let height = u32::try_from(item_size.Height)
            .ok()
            .filter(|value| *value > 0)
            .ok_or_else(|| "Dota 2 returned an invalid window height.".to_owned())?;
        let device = create_graphics_device()?;
        let pool = Direct3D11CaptureFramePool::CreateFreeThreaded(
            &device,
            DirectXPixelFormat::B8G8R8A8UIntNormalized,
            2,
            SizeInt32 {
                Width: width as i32,
                Height: height as i32,
            },
        )
        .map_err(|error| format!("failed to create the capture frame pool: {error}"))?;
        let session = pool
            .CreateCaptureSession(&item)
            .map_err(|error| format!("failed to create the capture session: {error}"))?;
        let _ = session.SetIsCursorCaptureEnabled(false);
        session
            .StartCapture()
            .map_err(|error| format!("failed to start Dota 2 capture: {error}"))?;

        let deadline = Instant::now() + FRAME_TIMEOUT;
        let frame = loop {
            match pool.TryGetNextFrame() {
                Ok(frame) => break frame,
                Err(error) if Instant::now() >= deadline => {
                    return Err(format!("timed out waiting for the Dota 2 frame: {error}"));
                }
                Err(_) => {}
            }
            thread::sleep(Duration::from_millis(10));
        };
        let surface = frame
            .Surface()
            .map_err(|error| format!("failed to read the captured surface: {error}"))?;
        let bitmap = SoftwareBitmap::CreateCopyFromSurfaceAsync(&surface)
            .map_err(|error| format!("failed to prepare the captured bitmap: {error}"))?
            .get()
            .map_err(|error| format!("failed to convert the captured bitmap: {error}"))?;
        let bytes = encode_png(&bitmap)?;
        let _ = frame.Close();
        let _ = session.Close();
        let _ = pool.Close();
        Ok((bytes, width, height))
    }

    fn encode_png(bitmap: &SoftwareBitmap) -> Result<Vec<u8>, String> {
        let stream = InMemoryRandomAccessStream::new()
            .map_err(|error| format!("failed to create an in-memory stream: {error}"))?;
        let encoder = BitmapEncoder::CreateAsync(
            BitmapEncoder::PngEncoderId()
                .map_err(|error| format!("failed to get the PNG encoder: {error}"))?,
            &stream,
        )
        .map_err(|error| format!("failed to create the PNG encoder: {error}"))?
        .get()
        .map_err(|error| format!("failed to initialize the PNG encoder: {error}"))?;
        encoder
            .SetSoftwareBitmap(bitmap)
            .map_err(|error| format!("failed to assign the captured bitmap: {error}"))?;
        encoder
            .FlushAsync()
            .map_err(|error| format!("failed to encode the captured bitmap: {error}"))?
            .get()
            .map_err(|error| format!("failed to finish the PNG encoding: {error}"))?;

        let length = usize::try_from(
            stream
                .Size()
                .map_err(|error| format!("failed to read the PNG stream size: {error}"))?,
        )
        .map_err(|_| "the encoded PNG is too large to transfer.".to_owned())?;
        let length_u32 = u32::try_from(length)
            .map_err(|_| "the encoded PNG is too large to transfer.".to_owned())?;
        let input = stream
            .GetInputStreamAt(0)
            .map_err(|error| format!("failed to open the PNG stream: {error}"))?;
        let reader = DataReader::CreateDataReader(&input)
            .map_err(|error| format!("failed to create the PNG reader: {error}"))?;
        reader
            .LoadAsync(length_u32)
            .map_err(|error| format!("failed to load the PNG bytes: {error}"))?
            .get()
            .map_err(|error| format!("failed to read the PNG bytes: {error}"))?;
        let mut bytes = vec![0u8; length];
        reader
            .ReadBytes(&mut bytes)
            .map_err(|error| format!("failed to copy the PNG bytes: {error}"))?;
        Ok(bytes)
    }
}

#[cfg(target_os = "windows")]
#[tauri::command]
pub async fn capture_dota2_screenshot() -> Result<CapturedScreenshot, String> {
    tauri::async_runtime::spawn_blocking(windows_capture::capture)
        .await
        .map_err(|error| error.to_string())?
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
pub async fn capture_dota2_screenshot() -> Result<CapturedScreenshot, String> {
    Err("Dota 2 window capture is only available on Windows desktop.".to_owned())
}
