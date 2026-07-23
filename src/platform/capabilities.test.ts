import { afterEach, describe, expect, it, vi } from 'vitest'
import { detectRuntimeCapabilities, missingRuntimeCapabilities, type RuntimeCapabilities } from './capabilities'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('runtime capability checks', () => {
  it('lists only missing recognition capabilities', () => {
    const capabilities: RuntimeCapabilities = {
      createImageBitmap: true,
      worker: false,
      offscreenCanvas: false,
    }

    expect(missingRuntimeCapabilities(capabilities)).toEqual(['Web Worker', 'OffscreenCanvas'])
  })

  it('returns no errors when all capabilities are available', () => {
    expect(missingRuntimeCapabilities({ createImageBitmap: true, worker: true, offscreenCanvas: true })).toEqual([])
  })

  it('detects browser primitives from the runtime global', () => {
    vi.stubGlobal('createImageBitmap', vi.fn())
    vi.stubGlobal('Worker', class {})
    vi.stubGlobal('OffscreenCanvas', class {})

    expect(detectRuntimeCapabilities()).toEqual({
      createImageBitmap: true,
      worker: true,
      offscreenCanvas: true,
    })
  })
})
