import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  captureDota2Screenshot,
  capturedScreenshotToFile,
  isWindowsDesktopRuntime,
  type CapturedScreenshot,
} from './capture'

afterEach(() => {
  vi.unstubAllGlobals()
})

const capturedScreenshot: CapturedScreenshot = {
  data: 'iVBORw0KGgo=',
  mimeType: 'image/png',
  fileName: 'dota2-capture.png',
  width: 1920,
  height: 1080,
}

describe('Dota 2 capture bridge', () => {
  it('is enabled only for Windows desktop runtimes', () => {
    vi.stubGlobal('window', { __TAURI_INTERNALS__: { invoke: vi.fn() } })
    vi.stubGlobal('navigator', {
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    })

    expect(isWindowsDesktopRuntime()).toBe(true)

    vi.stubGlobal('navigator', {
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
    })
    expect(isWindowsDesktopRuntime()).toBe(false)

    vi.stubGlobal('window', {})
    vi.stubGlobal('navigator', {
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    })
    expect(isWindowsDesktopRuntime()).toBe(false)
  })

  it('invokes the native capture command on Windows desktop', async () => {
    const invoke = vi.fn().mockResolvedValue(capturedScreenshot)
    vi.stubGlobal('window', { __TAURI_INTERNALS__: { invoke } })
    vi.stubGlobal('navigator', { userAgent: 'Windows NT 10.0; Win64; x64' })

    await expect(captureDota2Screenshot()).resolves.toEqual(capturedScreenshot)
    expect(invoke).toHaveBeenCalledWith('capture_dota2_screenshot', {})
  })

  it('rejects capture requests outside the Windows desktop runtime', async () => {
    vi.stubGlobal('window', {})
    vi.stubGlobal('navigator', { userAgent: 'Windows NT 10.0; Win64; x64' })

    await expect(captureDota2Screenshot()).rejects.toThrow(
      'only available on Windows desktop',
    )
  })

  it('converts the native base64 PNG payload into a File', async () => {
    const file = capturedScreenshotToFile(capturedScreenshot, 123)

    expect(file.name).toBe('dota2-capture.png')
    expect(file.type).toBe('image/png')
    expect(file.lastModified).toBe(123)
    expect(file.size).toBe(8)
    await expect(file.arrayBuffer()).resolves.toEqual(
      Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]).buffer,
    )
  })
})
