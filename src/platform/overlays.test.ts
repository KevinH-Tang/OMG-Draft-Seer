import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  OVERLAY_CHANNEL_NAME,
  canMarkOverlayReady,
  closeNativeOverlay,
  getNativeOverlayVisibility,
  isDesktopRuntime,
  markNativeOverlayReady,
  mergeNativeOverlayVisibility,
  openNativeOverlay,
  overlayKindFromLocation,
  readOverlayState,
  resizeNativeOverlay,
  scheduleOverlayReadyAfterPaint,
  scheduleOverlayReadyRetry,
  shouldObserveOverlayPanel,
  setNativeOverlayInteractionRegion,
  setNativeOverlayShortcut,
  setNativeOverlayViewport,
  toggleNativeOverlay,
  writeOverlayState,
  type NativeOverlayVisibility,
  type OverlayState,
} from './overlays'

const overlayState: OverlayState = {
  recognitionStatus: 'idle',
  candidatePools: { heroIds: [], abilityIds: [], ultimateIds: [] },
  combinationRecommendations: [],
  locale: 'zh-CN',
  tierCategory: 'all',
  tierQuery: '',
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('overlay platform bridge', () => {
  it('waits for both runtime data and synchronized content before native ready', () => {
    expect(canMarkOverlayReady(true, true)).toBe(true)
    expect(canMarkOverlayReady(true, false)).toBe(false)
    expect(canMarkOverlayReady(false, true)).toBe(false)
    expect(canMarkOverlayReady(false, false)).toBe(false)
  })

  it('starts panel measurement only after gated content mounts', () => {
    expect(shouldObserveOverlayPanel(true, 'recommendation', false, true)).toBe(
      false,
    )
    expect(shouldObserveOverlayPanel(true, 'recommendation', true, true)).toBe(
      true,
    )
    expect(shouldObserveOverlayPanel(true, 'layout', true, true)).toBe(false)
    expect(shouldObserveOverlayPanel(false, 'tier', true, true)).toBe(false)
  })

  it('retries a rejected native ready handshake without looping forever', async () => {
    let retry: (() => void) | undefined
    const scheduler = {
      setTimeout: vi.fn((callback: () => void) => {
        retry = callback
        return 41
      }),
      clearTimeout: vi.fn(),
    }
    const markReady = vi
      .fn<() => Promise<boolean>>()
      .mockRejectedValueOnce(new Error('show failed'))
      .mockResolvedValue(false)
    const report = vi.fn()

    const dispose = scheduleOverlayReadyRetry(markReady, report, scheduler, 2)
    await Promise.resolve()
    expect(report).toHaveBeenCalledOnce()
    expect(scheduler.setTimeout).toHaveBeenCalledOnce()

    retry?.()
    await Promise.resolve()
    expect(markReady).toHaveBeenCalledTimes(2)
    expect(scheduler.setTimeout).toHaveBeenCalledOnce()

    dispose()
  })

  it('ignores a pending ready rejection after disposal', async () => {
    let rejectReady: (reason: unknown) => void = () => undefined
    const scheduler = {
      setTimeout: vi.fn(() => 41),
      clearTimeout: vi.fn(),
    }
    const markReady = vi.fn(
      () =>
        new Promise<boolean>((_resolve, reject) => {
          rejectReady = reject
        }),
    )
    const report = vi.fn()

    const dispose = scheduleOverlayReadyRetry(markReady, report, scheduler)
    dispose()
    rejectReady(new Error('late show failure'))
    await Promise.resolve()

    expect(report).not.toHaveBeenCalled()
    expect(scheduler.setTimeout).not.toHaveBeenCalled()
  })

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
    const visibility: NativeOverlayVisibility = {
      kind: 'tier',
      open: true,
      ready: true,
      visible: true,
      visibilityObserved: true,
      displayed: true,
      revision: 4,
    }
    const invoke = vi.fn().mockResolvedValue(visibility)
    vi.stubGlobal('window', { __TAURI_INTERNALS__: { invoke } })

    expect(isDesktopRuntime()).toBe(true)
    await expect(openNativeOverlay('tier')).resolves.toEqual(visibility)
    await expect(
      openNativeOverlay('layout', { width: 1920, height: 1080 }),
    ).resolves.toEqual(visibility)
    await closeNativeOverlay('recommendation')
    await toggleNativeOverlay('recommendation', { width: 1920, height: 1080 })
    await resizeNativeOverlay('recommendation', 940)
    await setNativeOverlayInteractionRegion('recommendation', 372, 720)
    await setNativeOverlayViewport({ width: 1920, height: 1080 })
    await setNativeOverlayShortcut('F8', true, 'hold')

    expect(invoke).toHaveBeenNthCalledWith(1, 'open_overlay', { kind: 'tier' })
    expect(invoke).toHaveBeenNthCalledWith(2, 'open_overlay', {
      kind: 'layout',
      width: 1920,
      height: 1080,
    })
    expect(invoke).toHaveBeenNthCalledWith(3, 'close_overlay', {
      kind: 'recommendation',
    })
    expect(invoke).toHaveBeenNthCalledWith(4, 'toggle_overlay', {
      kind: 'recommendation',
      width: 1920,
      height: 1080,
    })
    expect(invoke).toHaveBeenNthCalledWith(5, 'resize_overlay', {
      kind: 'recommendation',
      height: 940,
    })
    expect(invoke).toHaveBeenNthCalledWith(
      6,
      'set_overlay_interaction_region',
      {
        kind: 'recommendation',
        width: 372,
        height: 720,
      },
    )
    expect(invoke).toHaveBeenNthCalledWith(7, 'set_overlay_viewport', {
      width: 1920,
      height: 1080,
    })
    expect(invoke).toHaveBeenNthCalledWith(8, 'set_overlay_shortcut', {
      shortcut: 'F8',
      enabled: true,
      mode: 'hold',
    })
  })

  it('signals that a mounted overlay is ready for native display', async () => {
    const invoke = vi.fn().mockResolvedValue(true)
    vi.stubGlobal('window', { __TAURI_INTERNALS__: { invoke } })

    await expect(markNativeOverlayReady('tier')).resolves.toBe(true)
    expect(invoke).toHaveBeenCalledWith('mark_overlay_ready', { kind: 'tier' })
  })

  it('queries the native visibility snapshot after event subscription', async () => {
    const visibility: NativeOverlayVisibility[] = [
      {
        kind: 'recommendation',
        open: true,
        ready: true,
        visible: true,
        visibilityObserved: true,
        displayed: true,
        revision: 5,
      },
      {
        kind: 'tier',
        open: false,
        ready: false,
        visible: false,
        visibilityObserved: true,
        displayed: false,
        revision: 2,
      },
      {
        kind: 'layout',
        open: false,
        ready: false,
        visible: false,
        visibilityObserved: true,
        displayed: false,
        revision: 0,
      },
    ]
    const invoke = vi.fn().mockResolvedValue(visibility)
    vi.stubGlobal('window', { __TAURI_INTERNALS__: { invoke } })

    await expect(getNativeOverlayVisibility()).resolves.toEqual(visibility)
    expect(invoke).toHaveBeenCalledWith('get_overlay_visibility', {})
  })

  it('ignores stale native visibility projections', () => {
    const projection = {
      visibility: { recommendation: true, tier: false, layout: false },
      revisions: { recommendation: 7, tier: 0, layout: 0 },
    }

    expect(
      mergeNativeOverlayVisibility(projection, {
        kind: 'recommendation',
        open: false,
        ready: false,
        visible: false,
        visibilityObserved: true,
        displayed: false,
        revision: 6,
      }),
    ).toBe(projection)
    expect(
      mergeNativeOverlayVisibility(projection, {
        kind: 'recommendation',
        open: true,
        ready: false,
        visible: true,
        visibilityObserved: true,
        displayed: false,
        revision: 8,
      }),
    ).toEqual({
      visibility: { recommendation: false, tier: false, layout: false },
      revisions: { recommendation: 8, tier: 0, layout: 0 },
    })
  })

  it('projects displayed state independently from an accepted open request', () => {
    const projection = {
      visibility: { recommendation: false, tier: false, layout: false },
      revisions: { recommendation: 3, tier: 0, layout: 0 },
    }

    const requested = mergeNativeOverlayVisibility(projection, {
      kind: 'recommendation',
      open: true,
      ready: false,
      visible: true,
      visibilityObserved: true,
      displayed: false,
      revision: 4,
    })
    expect(requested).toEqual({
      visibility: { recommendation: false, tier: false, layout: false },
      revisions: { recommendation: 4, tier: 0, layout: 0 },
    })

    expect(
      mergeNativeOverlayVisibility(requested, {
        kind: 'recommendation',
        open: true,
        ready: true,
        visible: true,
        visibilityObserved: true,
        displayed: true,
        revision: 4,
      }),
    ).toEqual({
      visibility: { recommendation: true, tier: false, layout: false },
      revisions: { recommendation: 4, tier: 0, layout: 0 },
    })
  })

  it('waits for two animation frames before signaling overlay readiness', () => {
    const frames: FrameRequestCallback[] = []
    const scheduler = {
      requestAnimationFrame: vi.fn((callback: FrameRequestCallback) => {
        frames.push(callback)
        return frames.length
      }),
      cancelAnimationFrame: vi.fn(),
      setTimeout: vi.fn(() => 1),
      clearTimeout: vi.fn(),
    }
    const ready = vi.fn()

    scheduleOverlayReadyAfterPaint(ready, scheduler)
    expect(ready).not.toHaveBeenCalled()

    frames.shift()?.(0)
    expect(ready).not.toHaveBeenCalled()

    frames.shift()?.(16)
    expect(ready).toHaveBeenCalledOnce()
  })

  it('does not signal readiness after the overlay document is disposed', () => {
    const frames: FrameRequestCallback[] = []
    const scheduler = {
      requestAnimationFrame: vi.fn((callback: FrameRequestCallback) => {
        frames.push(callback)
        return frames.length
      }),
      cancelAnimationFrame: vi.fn(),
      setTimeout: vi.fn(() => 1),
      clearTimeout: vi.fn(),
    }
    const ready = vi.fn()

    const dispose = scheduleOverlayReadyAfterPaint(ready, scheduler)
    dispose()
    frames.shift()?.(0)
    frames.shift()?.(16)

    expect(ready).not.toHaveBeenCalled()
  })

  it('uses a timer fallback when a hidden webview does not produce frames', () => {
    const frames: FrameRequestCallback[] = []
    let timeoutCallback: (() => void) | undefined
    const scheduler = {
      requestAnimationFrame: vi.fn((callback: FrameRequestCallback) => {
        frames.push(callback)
        return frames.length
      }),
      cancelAnimationFrame: vi.fn(),
      setTimeout: vi.fn((callback: () => void) => {
        timeoutCallback = callback
        return 99
      }),
      clearTimeout: vi.fn(),
    }
    const ready = vi.fn()

    scheduleOverlayReadyAfterPaint(ready, scheduler)
    timeoutCallback?.()
    frames.shift()?.(0)
    frames.shift()?.(16)

    expect(ready).toHaveBeenCalledOnce()
    expect(scheduler.clearTimeout).toHaveBeenCalledWith(99)
  })

  it('rejects native overlay commands outside the desktop shell', async () => {
    vi.stubGlobal('window', {})

    expect(isDesktopRuntime()).toBe(false)
    await expect(openNativeOverlay('tier')).rejects.toThrow(
      'Overlay windows are only available in the desktop shell.',
    )
  })
})
