import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  captureDota2Screenshot,
  capturedScreenshotToFile,
  isWindowsDesktopRuntime,
  parseCapturedScreenshot,
  type CapturedScreenshot,
} from './capture'

afterEach(() => {
  vi.unstubAllGlobals()
})

const capturedScreenshot: CapturedScreenshot = {
  bytes: Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]),
  mimeType: 'image/png',
  fileName: 'dota2-capture.png',
  width: 1920,
  height: 1080,
  timings: {
    totalMs: 12,
    windowScanMs: 1,
    setupMs: 2,
    frameWaitMs: 3,
    surfaceCopyMs: 4,
    pngEncodeMs: 5,
  },
}

function capturePayload(): Uint8Array {
  const payload = new Uint8Array(44)
  payload.set([0x4f, 0x44, 0x53, 0x31])
  const view = new DataView(payload.buffer)
  ;[1920, 1080, 12000, 1000, 2000, 3000, 4000, 5000].forEach((value, index) =>
    view.setUint32(4 + index * 4, value, true),
  )
  payload.set(capturedScreenshot.bytes, 36)
  return payload
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
    const invoke = vi.fn().mockResolvedValue(capturePayload().buffer)
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

  it('parses the native binary header and PNG without base64 conversion', () => {
    expect(parseCapturedScreenshot(capturePayload())).toEqual(
      capturedScreenshot,
    )
  })

  it('rejects malformed native screenshot payloads', () => {
    expect(() => parseCapturedScreenshot(new Uint8Array([1, 2, 3]))).toThrow(
      'payload is invalid',
    )
  })

  it('converts the native PNG bytes into a File', async () => {
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
