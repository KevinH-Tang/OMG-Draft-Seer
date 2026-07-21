import { describe, expect, it } from 'vitest'
import { missingRuntimeCapabilities, type RuntimeCapabilities } from './capabilities'

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
})
