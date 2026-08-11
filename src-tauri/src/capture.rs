const CAPTURE_PAYLOAD_MAGIC: &[u8; 4] = b"ODS1";
const CAPTURE_PAYLOAD_HEADER_LEN: usize = 36;

#[derive(Clone, Debug, Default)]
struct CaptureTimings {
    total_us: u32,
    window_scan_us: u32,
    setup_us: u32,
    frame_wait_us: u32,
    surface_copy_us: u32,
    png_encode_us: u32,
}

#[derive(Clone, Debug)]
pub struct CapturedScreenshot {
    pub png: Vec<u8>,
    pub width: u32,
    pub height: u32,
    timings: CaptureTimings,
}

impl CapturedScreenshot {
    fn into_payload(self) -> Vec<u8> {
        let mut payload = Vec::with_capacity(CAPTURE_PAYLOAD_HEADER_LEN + self.png.len());
        payload.extend_from_slice(CAPTURE_PAYLOAD_MAGIC);
        for value in [
            self.width,
            self.height,
            self.timings.total_us,
            self.timings.window_scan_us,
            self.timings.setup_us,
            self.timings.frame_wait_us,
            self.timings.surface_copy_us,
            self.timings.png_encode_us,
        ] {
            payload.extend_from_slice(&value.to_le_bytes());
        }
        payload.extend_from_slice(&self.png);
        payload
    }
}

#[cfg(target_os = "windows")]
mod windows_capture {
    use super::{CaptureTimings, CapturedScreenshot};
    use std::{
        collections::HashMap,
        mem::size_of,
        path::Path,
        sync::{mpsc, OnceLock},
        thread,
        time::{Duration, Instant},
    };
    use windows::{
        core::{factory, Interface, BOOL, PWSTR},
        Graphics::{
            Capture::{Direct3D11CaptureFramePool, GraphicsCaptureItem, GraphicsCaptureSession},
            DirectX::{Direct3D11::IDirect3DDevice, DirectXPixelFormat},
            Imaging::{BitmapEncoder, SoftwareBitmap},
            SizeInt32,
        },
        Storage::Streams::{DataReader, InMemoryRandomAccessStream},
        Win32::{
            Foundation::{
                CloseHandle, FILETIME, HANDLE, HMODULE, HWND, LPARAM, RECT, RPC_E_CHANGED_MODE,
            },
            Graphics::{
                Direct3D::{D3D_DRIVER_TYPE, D3D_DRIVER_TYPE_HARDWARE, D3D_DRIVER_TYPE_WARP},
                Direct3D11::{
                    D3D11CreateDevice, ID3D11Device, ID3D11DeviceContext,
                    D3D11_CREATE_DEVICE_BGRA_SUPPORT, D3D11_SDK_VERSION,
                },
                Dwm::{DwmGetWindowAttribute, DWMWA_CLOAKED},
                Dxgi::IDXGIDevice,
            },
            System::Threading::{
                GetProcessTimes, OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
                PROCESS_QUERY_LIMITED_INFORMATION,
            },
            System::WinRT::{
                Direct3D11::CreateDirect3D11DeviceFromDXGIDevice,
                Graphics::Capture::IGraphicsCaptureItemInterop, RoInitialize, RoUninitialize,
                RO_INIT_MULTITHREADED,
            },
            UI::WindowsAndMessaging::{
                EnumWindows, GetClientRect, GetForegroundWindow, GetWindow, GetWindowLongPtrW,
                GetWindowModuleFileNameW, GetWindowThreadProcessId, IsIconic, IsWindowVisible,
                GWL_EXSTYLE, GW_OWNER, WS_EX_TOOLWINDOW,
            },
        },
    };

    const DOTA2_EXECUTABLE: &str = "dota2.exe";
    const FRAME_TIMEOUT: Duration = Duration::from_secs(3);
    const MIN_WINDOW_WIDTH: u32 = 320;
    const MIN_WINDOW_HEIGHT: u32 = 200;
    const SESSION_IDLE_TIMEOUT: Duration = Duration::from_secs(2);

    struct CaptureRequest {
        response: mpsc::SyncSender<Result<CapturedScreenshot, String>>,
    }

    struct ActiveCapture {
        hwnd: HWND,
        process_identity: ProcessIdentity,
        window_width: u32,
        window_height: u32,
        width: u32,
        height: u32,
        pool: Direct3D11CaptureFramePool,
        session: GraphicsCaptureSession,
    }

    struct CaptureManager {
        device: IDirect3DDevice,
        active: Option<ActiveCapture>,
    }

    static CAPTURE_WORKER: OnceLock<mpsc::Sender<CaptureRequest>> = OnceLock::new();

    struct WinRtGuard {
        initialized: bool,
    }

    impl WinRtGuard {
        fn new() -> Result<Self, String> {
            match unsafe { RoInitialize(RO_INIT_MULTITHREADED) } {
                Ok(()) => Ok(Self { initialized: true }),
                Err(error) if error.code() == RPC_E_CHANGED_MODE => Ok(Self { initialized: false }),
                Err(error) => Err(format!("failed to initialize Windows Runtime: {error}")),
            }
        }
    }

    impl Drop for WinRtGuard {
        fn drop(&mut self) {
            if self.initialized {
                unsafe { RoUninitialize() }
            }
        }
    }

    pub fn capture() -> Result<CapturedScreenshot, String> {
        let sender = CAPTURE_WORKER.get_or_init(|| {
            let (sender, receiver) = mpsc::channel::<CaptureRequest>();
            thread::Builder::new()
                .name("omg-capture".to_owned())
                .spawn(move || capture_worker(receiver))
                .expect("failed to start screenshot capture worker");
            sender
        });
        let (response, receiver) = mpsc::sync_channel(1);
        sender
            .send(CaptureRequest { response })
            .map_err(|_| "the screenshot capture worker stopped".to_owned())?;
        receiver
            .recv()
            .map_err(|_| "the screenshot capture worker stopped".to_owned())?
    }

    fn capture_worker(receiver: mpsc::Receiver<CaptureRequest>) {
        let runtime = match WinRtGuard::new() {
            Ok(runtime) => runtime,
            Err(error) => {
                while let Ok(request) = receiver.recv() {
                    let _ = request.response.send(Err(error.clone()));
                }
                return;
            }
        };
        let mut manager = match CaptureManager::new() {
            Ok(manager) => manager,
            Err(error) => {
                while let Ok(request) = receiver.recv() {
                    let _ = request.response.send(Err(error.clone()));
                }
                drop(runtime);
                return;
            }
        };
        loop {
            let request = if manager.active.is_some() {
                match receiver.recv_timeout(SESSION_IDLE_TIMEOUT) {
                    Ok(request) => request,
                    Err(mpsc::RecvTimeoutError::Timeout) => {
                        manager.close_active();
                        continue;
                    }
                    Err(mpsc::RecvTimeoutError::Disconnected) => break,
                }
            } else {
                match receiver.recv() {
                    Ok(request) => request,
                    Err(_) => break,
                }
            };
            let result = manager.capture();
            let _ = request.response.send(result);
        }
    }

    impl CaptureManager {
        fn new() -> Result<Self, String> {
            Ok(Self {
                device: create_graphics_device()?,
                active: None,
            })
        }

        fn close_active(&mut self) {
            if let Some(active) = self.active.take() {
                let _ = active.session.Close();
                let _ = active.pool.Close();
            }
        }

        fn capture(&mut self) -> Result<CapturedScreenshot, String> {
            let started_at = Instant::now();
            let window_scan_started_at = Instant::now();
            let window = find_dota2_window()?;
            let window_scan_us = elapsed_us(window_scan_started_at);
            if !is_current_dota_window(&window) {
                return Err(
                    "The Dota 2 window changed while it was being selected. Try again.".to_owned(),
                );
            }
            let mut screenshot = self.capture_window(&window)?;
            screenshot.timings.window_scan_us = window_scan_us;
            screenshot.timings.total_us = elapsed_us(started_at);
            Ok(screenshot)
        }

        fn capture_window(
            &mut self,
            window: &WindowCandidate,
        ) -> Result<CapturedScreenshot, String> {
            let setup_started_at = Instant::now();
            let reuse = self.active.as_ref().is_some_and(|active| {
                active.hwnd == window.hwnd
                    && active.process_identity.matches(&window.process_identity)
                    && active.window_width == window.width
                    && active.window_height == window.height
            });
            if !reuse {
                self.close_active();
                let interop: IGraphicsCaptureItemInterop = factory::<GraphicsCaptureItem, _>()
                    .map_err(|error| {
                        format!("failed to access the capture item factory: {error}")
                    })?;
                let item: GraphicsCaptureItem = unsafe { interop.CreateForWindow(window.hwnd) }
                    .map_err(|error| {
                        format!("failed to create a capture item for Dota 2: {error}")
                    })?;
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
                let pool = Direct3D11CaptureFramePool::CreateFreeThreaded(
                    &self.device,
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
                self.active = Some(ActiveCapture {
                    hwnd: window.hwnd,
                    process_identity: window.process_identity.clone(),
                    window_width: window.width,
                    window_height: window.height,
                    width,
                    height,
                    pool,
                    session,
                });
            }
            let setup_us = elapsed_us(setup_started_at);
            let frame_wait_started_at = Instant::now();
            let deadline = Instant::now() + FRAME_TIMEOUT;
            let frame = loop {
                let active = self.active.as_ref().expect("active capture should exist");
                match active.pool.TryGetNextFrame() {
                    Ok(frame) => break frame,
                    Err(error) if Instant::now() >= deadline => {
                        self.close_active();
                        return Err(format!("timed out waiting for the Dota 2 frame: {error}"));
                    }
                    Err(_) => {}
                }
                thread::sleep(Duration::from_millis(10));
            };
            let frame_wait_us = elapsed_us(frame_wait_started_at);
            let surface = frame
                .Surface()
                .map_err(|error| format!("failed to read the captured surface: {error}"))?;
            let surface_copy_started_at = Instant::now();
            let bitmap = SoftwareBitmap::CreateCopyFromSurfaceAsync(&surface)
                .map_err(|error| format!("failed to prepare the captured bitmap: {error}"))?
                .get()
                .map_err(|error| format!("failed to convert the captured bitmap: {error}"))?;
            let surface_copy_us = elapsed_us(surface_copy_started_at);
            let png_encode_started_at = Instant::now();
            let png = encode_png(&bitmap)?;
            let png_encode_us = elapsed_us(png_encode_started_at);
            let _ = frame.Close();
            Ok(CapturedScreenshot {
                png,
                width: self
                    .active
                    .as_ref()
                    .expect("active capture should exist")
                    .width,
                height: self
                    .active
                    .as_ref()
                    .expect("active capture should exist")
                    .height,
                timings: CaptureTimings {
                    setup_us,
                    frame_wait_us,
                    surface_copy_us,
                    png_encode_us,
                    ..CaptureTimings::default()
                },
            })
        }
    }

    fn elapsed_us(started_at: Instant) -> u32 {
        u32::try_from(started_at.elapsed().as_micros()).unwrap_or(u32::MAX)
    }

    #[derive(Clone, Debug, PartialEq, Eq)]
    struct ProcessIdentity {
        executable_path: String,
        creation_time: u64,
    }

    impl ProcessIdentity {
        fn matches(&self, other: &Self) -> bool {
            self.creation_time == other.creation_time
                && self
                    .executable_path
                    .eq_ignore_ascii_case(&other.executable_path)
        }
    }

    #[derive(Clone, Debug)]
    struct WindowCandidate {
        hwnd: HWND,
        process_id: u32,
        process_identity: ProcessIdentity,
        width: u32,
        height: u32,
    }

    impl WindowCandidate {
        fn area(&self) -> u64 {
            u64::from(self.width) * u64::from(self.height)
        }
    }

    #[derive(Default)]
    struct WindowScan {
        eligible: Vec<WindowCandidate>,
        matched_processes: HashMap<u32, Option<ProcessIdentity>>,
        matched_windows: usize,
    }

    fn find_dota2_window() -> Result<WindowCandidate, String> {
        let mut scan = WindowScan::default();

        unsafe extern "system" fn collect_window(hwnd: HWND, lparam: LPARAM) -> BOOL {
            let scan = &mut *(lparam.0 as *mut WindowScan);
            let mut process_id = 0;
            if GetWindowThreadProcessId(hwnd, Some(&mut process_id)) == 0 || process_id == 0 {
                return true.into();
            }

            let Some(process_identity) = scan
                .matched_processes
                .entry(process_id)
                .or_insert_with(|| process_identity_for_window(hwnd))
                .clone()
            else {
                return true.into();
            };
            if !is_dota2_executable(&process_identity.executable_path) {
                return true.into();
            }

            scan.matched_windows += 1;
            let Some((width, height)) = eligible_client_size(hwnd) else {
                return true.into();
            };
            scan.eligible.push(WindowCandidate {
                hwnd,
                process_id,
                process_identity,
                width,
                height,
            });
            true.into()
        }

        unsafe {
            EnumWindows(
                Some(collect_window),
                LPARAM(&mut scan as *mut WindowScan as isize),
            )
            .map_err(|error| format!("failed to enumerate windows: {error}"))?;
        }

        if scan.eligible.is_empty() {
            return if scan.matched_windows == 0 {
                Err(
                    "No visible Dota 2 game window was found. Start Dota 2 and restore its window."
                        .to_owned(),
                )
            } else {
                Err("Dota 2 is running, but its window is hidden, minimized, cloaked, or too small to capture. Restore the game and use windowed or borderless mode.".to_owned())
            };
        }

        let foreground = unsafe { GetForegroundWindow() };
        choose_window(&scan.eligible, foreground).map_err(str::to_owned)
    }

    fn choose_window(
        candidates: &[WindowCandidate],
        foreground: HWND,
    ) -> Result<WindowCandidate, &'static str> {
        if let Some(candidate) = candidates
            .iter()
            .find(|candidate| candidate.hwnd == foreground)
        {
            return Ok(candidate.clone());
        }

        let Some(largest) = candidates.iter().max_by_key(|candidate| candidate.area()) else {
            return Err("No eligible Dota 2 window was found.");
        };
        let largest_area = largest.area();
        if candidates
            .iter()
            .filter(|candidate| candidate.area() == largest_area)
            .nth(1)
            .is_some()
        {
            return Err(
                "Multiple eligible Dota 2 windows were found. Close extra Dota 2 windows and try again.",
            );
        }
        Ok(largest.clone())
    }

    fn is_current_dota_window(candidate: &WindowCandidate) -> bool {
        let mut process_id = 0;
        let belongs_to_process =
            unsafe { GetWindowThreadProcessId(candidate.hwnd, Some(&mut process_id)) } != 0;
        belongs_to_process
            && process_id == candidate.process_id
            && eligible_client_size(candidate.hwnd).is_some()
            && process_identity_for_window(candidate.hwnd)
                .is_some_and(|identity| candidate.process_identity.matches(&identity))
    }

    fn is_dota2_executable(path: &str) -> bool {
        Path::new(path)
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| name.eq_ignore_ascii_case(DOTA2_EXECUTABLE))
    }

    fn process_identity_for_window(hwnd: HWND) -> Option<ProcessIdentity> {
        let mut process_id = 0;
        if unsafe { GetWindowThreadProcessId(hwnd, Some(&mut process_id)) } == 0 || process_id == 0
        {
            return None;
        }

        let process =
            unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, process_id).ok()? };
        let creation_time = process_creation_time(process);
        let executable_path = process_executable_path(process).or_else(|| window_module_path(hwnd));
        let identity = match (creation_time, executable_path) {
            (Some(creation_time), Some(executable_path)) => Some(ProcessIdentity {
                executable_path,
                creation_time,
            }),
            _ => None,
        };
        let _ = unsafe { CloseHandle(process) };
        identity
    }

    fn process_creation_time(process: HANDLE) -> Option<u64> {
        let mut creation_time = FILETIME::default();
        let mut exit_time = FILETIME::default();
        let mut kernel_time = FILETIME::default();
        let mut user_time = FILETIME::default();
        unsafe {
            GetProcessTimes(
                process,
                &mut creation_time,
                &mut exit_time,
                &mut kernel_time,
                &mut user_time,
            )
            .ok()?;
        };
        Some(
            (u64::from(creation_time.dwHighDateTime) << 32)
                | u64::from(creation_time.dwLowDateTime),
        )
    }

    fn process_executable_path(process: HANDLE) -> Option<String> {
        let mut path = vec![0u16; 32_768];
        let mut length = u32::try_from(path.len()).ok()?;
        unsafe {
            QueryFullProcessImageNameW(
                process,
                PROCESS_NAME_WIN32,
                PWSTR(path.as_mut_ptr()),
                &mut length,
            )
            .ok()?;
        }
        let length = usize::try_from(length).ok()?;
        if length > path.len() {
            return None;
        }
        Some(String::from_utf16_lossy(&path[..length]))
    }

    fn window_module_path(hwnd: HWND) -> Option<String> {
        let mut path = [0u16; 1024];
        let length = unsafe { GetWindowModuleFileNameW(hwnd, &mut path) };
        (length > 0).then(|| String::from_utf16_lossy(&path[..length as usize]))
    }

    fn eligible_client_size(hwnd: HWND) -> Option<(u32, u32)> {
        if !unsafe { IsWindowVisible(hwnd) }.as_bool()
            || unsafe { IsIconic(hwnd) }.as_bool()
            || is_window_cloaked(hwnd)
            || unsafe { GetWindow(hwnd, GW_OWNER).is_ok() }
        {
            return None;
        }

        let ex_style = unsafe { GetWindowLongPtrW(hwnd, GWL_EXSTYLE) as u32 };
        if ex_style & WS_EX_TOOLWINDOW.0 != 0 {
            return None;
        }

        let mut rect = RECT::default();
        unsafe { GetClientRect(hwnd, &mut rect).ok()? };
        let width = u32::try_from(rect.right - rect.left).ok()?;
        let height = u32::try_from(rect.bottom - rect.top).ok()?;
        (width >= MIN_WINDOW_WIDTH && height >= MIN_WINDOW_HEIGHT).then_some((width, height))
    }

    fn is_window_cloaked(hwnd: HWND) -> bool {
        let mut cloaked = 0u32;
        unsafe {
            DwmGetWindowAttribute(
                hwnd,
                DWMWA_CLOAKED,
                &mut cloaked as *mut u32 as *mut _,
                size_of::<u32>() as u32,
            )
            .is_ok()
                && cloaked != 0
        }
    }

    fn create_graphics_device() -> Result<IDirect3DDevice, String> {
        match create_graphics_device_with_driver(D3D_DRIVER_TYPE_HARDWARE) {
            Ok(device) => Ok(device),
            Err(hardware_error) => create_graphics_device_with_driver(D3D_DRIVER_TYPE_WARP)
                .map_err(|warp_error| {
                    format!(
                        "failed to create a Direct3D 11 device with hardware ({hardware_error}) or software fallback ({warp_error})"
                    )
                }),
        }
    }

    fn create_graphics_device_with_driver(
        driver_type: D3D_DRIVER_TYPE,
    ) -> Result<IDirect3DDevice, String> {
        let mut device: Option<ID3D11Device> = None;
        let mut context: Option<ID3D11DeviceContext> = None;
        unsafe {
            D3D11CreateDevice(
                None,
                driver_type,
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

    #[cfg(test)]
    mod tests {
        use super::{choose_window, is_dota2_executable, ProcessIdentity, WindowCandidate};
        use windows::Win32::Foundation::HWND;

        fn hwnd(value: usize) -> HWND {
            HWND(value as *mut _)
        }

        fn candidate(hwnd: HWND, width: u32, height: u32) -> WindowCandidate {
            WindowCandidate {
                hwnd,
                process_id: 10,
                process_identity: ProcessIdentity {
                    executable_path: String::from(r"Steam\dota2.exe"),
                    creation_time: 1,
                },
                width,
                height,
            }
        }

        #[test]
        fn matches_only_the_dota2_executable_name() {
            assert!(is_dota2_executable(r"Steam\dota2.exe"));
            assert!(is_dota2_executable(r"games\DOTA2.EXE"));
            assert!(!is_dota2_executable(r"Steam\dota2.exe.bak"));
            assert!(!is_dota2_executable(r"Steam\steam.exe"));
        }

        #[test]
        fn prefers_the_foreground_window() {
            let candidates = [
                candidate(hwnd(1), 1_920, 1_080),
                candidate(hwnd(2), 1_280, 720),
            ];

            assert_eq!(
                choose_window(&candidates, hwnd(2)).map(|candidate| candidate.hwnd),
                Ok(hwnd(2))
            );
        }

        #[test]
        fn uses_the_largest_candidate_when_dota_is_not_foreground() {
            let candidates = [
                candidate(hwnd(1), 800, 600),
                candidate(hwnd(2), 2_560, 1_440),
            ];

            assert_eq!(
                choose_window(&candidates, hwnd(3)).map(|candidate| candidate.hwnd),
                Ok(hwnd(2))
            );
        }

        #[test]
        fn rejects_tied_largest_candidates_when_dota_is_not_foreground() {
            let candidates = [
                candidate(hwnd(1), 1_920, 1_080),
                candidate(hwnd(2), 1_920, 1_080),
            ];

            assert_eq!(
                choose_window(&candidates, hwnd(3)).err(),
                Some("Multiple eligible Dota 2 windows were found. Close extra Dota 2 windows and try again.")
            );
        }

        #[test]
        fn process_identity_requires_the_same_path_and_creation_time() {
            let identity = ProcessIdentity {
                executable_path: String::from(r"Steam\dota2.exe"),
                creation_time: 1,
            };
            assert!(identity.matches(&ProcessIdentity {
                executable_path: String::from(r"steam\DOTA2.EXE"),
                creation_time: 1,
            }));
            assert!(!identity.matches(&ProcessIdentity {
                executable_path: String::from(r"Steam\dota2.exe"),
                creation_time: 2,
            }));
            assert!(!identity.matches(&ProcessIdentity {
                executable_path: String::from(r"Other\dota2.exe"),
                creation_time: 1,
            }));
        }
    }
}

#[cfg(target_os = "windows")]
#[tauri::command]
pub async fn capture_dota2_screenshot() -> Result<tauri::ipc::Response, String> {
    let screenshot = tauri::async_runtime::spawn_blocking(windows_capture::capture)
        .await
        .map_err(|error| error.to_string())??;
    Ok(tauri::ipc::Response::new(screenshot.into_payload()))
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
pub async fn capture_dota2_screenshot() -> Result<tauri::ipc::Response, String> {
    Err("Dota 2 window capture is only available on Windows desktop.".to_owned())
}

#[cfg(test)]
mod payload_tests {
    use super::{CaptureTimings, CapturedScreenshot};

    #[test]
    fn binary_payload_contains_dimensions_timings_and_png() {
        let payload = CapturedScreenshot {
            png: vec![137, 80, 78, 71],
            width: 1920,
            height: 1080,
            timings: CaptureTimings {
                total_us: 12_000,
                window_scan_us: 1_000,
                setup_us: 2_000,
                frame_wait_us: 3_000,
                surface_copy_us: 4_000,
                png_encode_us: 5_000,
            },
        }
        .into_payload();

        assert_eq!(&payload[0..4], b"ODS1");
        assert_eq!(u32::from_le_bytes(payload[4..8].try_into().unwrap()), 1920);
        assert_eq!(u32::from_le_bytes(payload[8..12].try_into().unwrap()), 1080);
        assert_eq!(
            u32::from_le_bytes(payload[12..16].try_into().unwrap()),
            12_000
        );
        assert_eq!(&payload[36..], &[137, 80, 78, 71]);
    }
}
