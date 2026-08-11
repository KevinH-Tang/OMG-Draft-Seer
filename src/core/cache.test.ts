import { describe, expect, it, vi } from 'vitest'
import { memoizeByKey } from './cache'

describe('memoizeByKey', () => {
  it('caches an undefined result as a real value', () => {
    const cache = new WeakMap<object, Map<string, undefined>>()
    const key = {}
    const compute = vi.fn(() => undefined)

    expect(memoizeByKey(cache, key, 'value', compute)).toBeUndefined()
    expect(memoizeByKey(cache, key, 'value', compute)).toBeUndefined()
    expect(compute).toHaveBeenCalledOnce()
  })
})
