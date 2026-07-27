import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  OVERLAY_CHANNEL_NAME,
  closeNativeOverlay,
  isDesktopRuntime,
  openNativeOverlay,
  overlayKindFromLocation,
  readOverlayState,
  resizeNativeOverlay,
  setNativeOverlayShortcut,
  writeOverlayState,
  type OverlayState,
} from './overlays'

const overlayState: OverlayState = {
  candidatePools: { heroIds: [], abilityIds: [], ultimateIds: [] },
  combinationRecommendations: [],
  locale: 'zh-CN',
  recommendations: [],
  selectedIds: [],
  tierCategory: 'all',
  tierQuery: '',
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('overlay platform bridge', () => {
  it('recognizes only supported overlay query values', () => {
    vi.stubGlobal('window', { location: { search: '?overlay=tier' } })
    expect(overlayKindFromLocation()).toBe('tier')

    vi.stubGlobal('window', { location: { search: '?overlay=layout' } })
    expect(overlayKindFromLocation()).toBe('layout')

    vi.stubGlobal('window', { location: { search: '?overlay=unknown' } })
    expect(overlayKindFromLocation()).toBeUndefined()
  })

  it('persists and restores each overlay state independently', () => {
    const values = new Map<string, string>()
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
      },
    })

    writeOverlayState('tier', overlayState)

    expect(values.get(`${OVERLAY_CHANNEL_NAME}:tier`)).toBe(
      JSON.stringify(overlayState),
    )
    expect(readOverlayState('tier')).toEqual(overlayState)
    expect(readOverlayState('recommendation')).toBeUndefined()
  })

  it('treats storage failures as an optional synchronization-path failure', () => {
    vi.stubGlobal('window', {
      localStorage: {
        getItem: () => {
          throw new Error('storage unavailable')
        },
        setItem: () => {
          throw new Error('storage unavailable')
        },
      },
    })

    expect(() => writeOverlayState('tier', overlayState)).not.toThrow()
    expect(readOverlayState('tier')).toBeUndefined()
  })

  it('uses the desktop bridge only when Tauri internals are present', async () => {
    const invoke = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('window', { __TAURI_INTERNALS__: { invoke } })

    expect(isDesktopRuntime()).toBe(true)
    await openNativeOverlay('tier')
    await openNativeOverlay('layout', { width: 1920, height: 1080 })
    await closeNativeOverlay('recommendation')
    await resizeNativeOverlay('recommendation', 940)
    await setNativeOverlayShortcut('F8', true)

    expect(invoke).toHaveBeenNthCalledWith(1, 'open_overlay', { kind: 'tier' })
    expect(invoke).toHaveBeenNthCalledWith(2, 'open_overlay', {
      kind: 'layout',
      width: 1920,
      height: 1080,
    })
    expect(invoke).toHaveBeenNthCalledWith(3, 'close_overlay', {
      kind: 'recommendation',
    })
    expect(invoke).toHaveBeenNthCalledWith(4, 'resize_overlay', {
      kind: 'recommendation',
      height: 940,
    })
    expect(invoke).toHaveBeenNthCalledWith(5, 'set_overlay_shortcut', {
      shortcut: 'F8',
      enabled: true,
    })
  })

  it('rejects native overlay commands outside the desktop shell', async () => {
    vi.stubGlobal('window', {})

    expect(isDesktopRuntime()).toBe(false)
    await expect(openNativeOverlay('tier')).rejects.toThrow(
      'Overlay windows are only available in the desktop shell.',
    )
  })
})
