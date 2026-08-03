import { isDesktopRuntime } from './overlays'

export interface CapturedScreenshot {
  data: string
  mimeType: string
  fileName: string
  width: number
  height: number
}

export function isWindowsDesktopRuntime(): boolean {
  if (!isDesktopRuntime() || typeof navigator === 'undefined') return false
  return /Windows/i.test(navigator.userAgent)
}

export function captureDota2Screenshot(): Promise<CapturedScreenshot> {
  if (!isWindowsDesktopRuntime()) {
    return Promise.reject(
      new Error('Dota 2 window capture is only available on Windows desktop.'),
    )
  }
  return window.__TAURI_INTERNALS__!.invoke<CapturedScreenshot>(
    'capture_dota2_screenshot',
    {},
  )
}

export function capturedScreenshotToFile(
  capture: CapturedScreenshot,
  lastModified = Date.now(),
): File {
  const binary = atob(capture.data)
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
  return new File([bytes], capture.fileName, {
    type: capture.mimeType,
    lastModified,
  })
}
