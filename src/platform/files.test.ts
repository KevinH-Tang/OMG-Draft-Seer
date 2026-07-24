import { afterEach, describe, expect, it, vi } from 'vitest'
import { getBrowserFileAdapter } from './files'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('browser file adapter', () => {
  it('reads text from a browser File or Blob', async () => {
    const adapter = getBrowserFileAdapter()

    await expect(
      adapter.readText(
        new Blob(['{"version":1}'], { type: 'application/json' }),
      ),
    ).resolves.toBe('{"version":1}')
  })

  it('downloads text through a temporary object URL', async () => {
    const link = { href: '', download: '', click: vi.fn() }
    const createElement = vi.fn(() => link)
    let createdBlob: Blob | undefined
    const createObjectURL = vi.fn((value: Blob) => {
      createdBlob = value
      return 'blob:layout'
    })
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('document', { createElement })
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL })

    getBrowserFileAdapter().downloadText(
      'layout.json',
      '{"version":1}',
      'application/json',
    )

    expect(createElement).toHaveBeenCalledWith('a')
    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob))
    expect(createdBlob).toBeDefined()
    await expect(createdBlob?.text()).resolves.toBe('{"version":1}')
    expect(createdBlob?.type).toBe('application/json')
    expect(link).toMatchObject({ href: 'blob:layout', download: 'layout.json' })
    expect(link.click).toHaveBeenCalledOnce()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:layout')
  })
})
