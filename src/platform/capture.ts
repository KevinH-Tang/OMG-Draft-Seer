import { isDesktopRuntime } from './overlays'

export interface CapturedScreenshot {
  bytes: Uint8Array
  mimeType: string
  fileName: string
  width: number
  height: number
  timings: NativeCaptureTimings
}

export interface NativeCaptureTimings {
  totalMs: number
  windowScanMs: number
  setupMs: number
  frameWaitMs: number
  surfaceCopyMs: number
  pngEncodeMs: number
}

const CAPTURE_PAYLOAD_HEADER_LENGTH = 36
const CAPTURE_PAYLOAD_MAGIC = [0x4f, 0x44, 0x53, 0x31]

export function isWindowsDesktopRuntime(): boolean {
  if (!isDesktopRuntime() || typeof navigator === 'undefined') return false
  return /Windows/i.test(navigator.userAgent)
}

export async function captureDota2Screenshot(): Promise<CapturedScreenshot> {
  if (!isWindowsDesktopRuntime()) {
    throw new Error(
      'Dota 2 window capture is only available on Windows desktop.',
    )
  }
  const payload = await window.__TAURI_INTERNALS__!.invoke<
    ArrayBuffer | Uint8Array
  >('capture_dota2_screenshot', {})
  return parseCapturedScreenshot(payload)
}

export function parseCapturedScreenshot(
  payload: ArrayBuffer | Uint8Array,
): CapturedScreenshot {
  const bytes =
    payload instanceof Uint8Array ? payload : new Uint8Array(payload)
  if (
    bytes.length <= CAPTURE_PAYLOAD_HEADER_LENGTH ||
    CAPTURE_PAYLOAD_MAGIC.some((value, index) => bytes[index] !== value)
  )
    throw new Error('The native screenshot payload is invalid.')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const milliseconds = (offset: number) => view.getUint32(offset, true) / 1_000
  const png = bytes.slice(CAPTURE_PAYLOAD_HEADER_LENGTH)
  if (
    png.length < 8 ||
    png[0] !== 137 ||
    png[1] !== 80 ||
    png[2] !== 78 ||
    png[3] !== 71
  )
    throw new Error('The native screenshot does not contain a PNG image.')
  return {
    bytes: png,
    mimeType: 'image/png',
    fileName: 'dota2-capture.png',
    width: view.getUint32(4, true),
    height: view.getUint32(8, true),
    timings: {
      totalMs: milliseconds(12),
      windowScanMs: milliseconds(16),
      setupMs: milliseconds(20),
      frameWaitMs: milliseconds(24),
      surfaceCopyMs: milliseconds(28),
      pngEncodeMs: milliseconds(32),
    },
  }
}

export function capturedScreenshotToFile(
  capture: CapturedScreenshot,
  lastModified = Date.now(),
): File {
  const bytes = new Uint8Array(capture.bytes.byteLength)
  bytes.set(capture.bytes)
  return new File([bytes.buffer], capture.fileName, {
    type: capture.mimeType,
    lastModified,
  })
}
