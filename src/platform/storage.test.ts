import { describe, expect, it } from 'vitest'
import { readStoredJson, type StorageAdapter, writeStoredJson } from './storage'

function createMemoryStorage(): StorageAdapter {
  const values = new Map<string, string>()
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  }
}

describe('storage adapter', () => {
  it('round-trips JSON values', () => {
    const storage = createMemoryStorage()
    writeStoredJson(storage, 'layout', { version: 1, slots: 60 })

    expect(readStoredJson(storage, 'layout', null)).toEqual({
      version: 1,
      slots: 60,
    })
  })

  it('returns the fallback for missing or malformed values', () => {
    const storage = createMemoryStorage()
    storage.setItem('broken', '{')

    expect(readStoredJson(storage, 'missing', { defaulted: true })).toEqual({
      defaulted: true,
    })
    expect(readStoredJson(storage, 'broken', { defaulted: true })).toEqual({
      defaulted: true,
    })
  })

  it('keeps the session usable when persistence throws', () => {
    const storage: StorageAdapter = {
      getItem: () => {
        throw new Error('storage unavailable')
      },
      setItem: () => {
        throw new Error('storage unavailable')
      },
      removeItem: () => {
        throw new Error('storage unavailable')
      },
    }

    expect(() =>
      writeStoredJson(storage, 'layout', { version: 1 }),
    ).not.toThrow()
    expect(readStoredJson(storage, 'layout', { fallback: true })).toEqual({
      fallback: true,
    })
  })
})
