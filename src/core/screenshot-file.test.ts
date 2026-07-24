import { describe, expect, it } from 'vitest'
import { isSupportedScreenshotFile } from './screenshot-file'

describe('screenshot file support', () => {
  it('accepts PNG, JPG, and JPEG uploads', () => {
    expect(
      isSupportedScreenshotFile({ name: 'draft.png', type: 'image/png' }),
    ).toBe(true)
    expect(
      isSupportedScreenshotFile({ name: 'draft.jpg', type: 'image/jpeg' }),
    ).toBe(true)
    expect(
      isSupportedScreenshotFile({ name: 'draft.jpeg', type: 'image/jpg' }),
    ).toBe(true)
  })

  it('uses the filename when a browser does not provide a MIME type', () => {
    expect(isSupportedScreenshotFile({ name: 'draft.JPEG', type: '' })).toBe(
      true,
    )
    expect(isSupportedScreenshotFile({ name: 'draft.gif', type: '' })).toBe(
      false,
    )
  })

  it('rejects unsupported image formats', () => {
    expect(
      isSupportedScreenshotFile({ name: 'draft.gif', type: 'image/gif' }),
    ).toBe(false)
    expect(
      isSupportedScreenshotFile({ name: 'draft.txt', type: 'text/plain' }),
    ).toBe(false)
  })
})
