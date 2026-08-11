import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  getUserWindrunSnapshot,
  loadRuntimeSnapshot,
  updateWindrunSnapshot,
} from './data-update'
import type { Snapshot } from '../types'

const snapshot = {
  version: 'windrun-test',
  patch: '7.41',
  generatedAt: '2026-08-09T00:00:00Z',
  source: 'test',
  abilities: [],
  heroes: [],
  abilityStats: [],
  pairStats: [],
} satisfies Snapshot

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('desktop Windrun data', () => {
  it('invokes the native read and update commands', async () => {
    const invoke = vi.fn().mockResolvedValue(snapshot)
    vi.stubGlobal('window', { __TAURI_INTERNALS__: { invoke } })

    await expect(getUserWindrunSnapshot()).resolves.toBe(snapshot)
    await expect(updateWindrunSnapshot()).resolves.toBe(snapshot)
    expect(invoke).toHaveBeenNthCalledWith(1, 'get_user_windrun_snapshot', {})
    expect(invoke).toHaveBeenNthCalledWith(2, 'update_windrun_snapshot', {})
  })

  it('prefers a saved desktop snapshot over the bundled resource', async () => {
    const invoke = vi.fn().mockResolvedValue(snapshot)
    const fetch = vi.fn()
    vi.stubGlobal('window', { __TAURI_INTERNALS__: { invoke } })
    vi.stubGlobal('fetch', fetch)

    await expect(loadRuntimeSnapshot('/data/latest.json')).resolves.toBe(
      snapshot,
    )
    expect(fetch).not.toHaveBeenCalled()
  })

  it('loads the bundled resource when no desktop snapshot exists', async () => {
    const invoke = vi.fn().mockResolvedValue(null)
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(snapshot),
    })
    vi.stubGlobal('window', { __TAURI_INTERNALS__: { invoke } })
    vi.stubGlobal('fetch', fetch)

    await expect(loadRuntimeSnapshot('/data/latest.json')).resolves.toBe(
      snapshot,
    )
    expect(fetch).toHaveBeenCalledWith('/data/latest.json', {
      signal: undefined,
    })
  })
})
