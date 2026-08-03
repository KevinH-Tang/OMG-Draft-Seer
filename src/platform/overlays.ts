import { listen } from '@tauri-apps/api/event'
import type { BuildCandidatePools } from '../core/recommendation'
import type { RuntimeSlot } from '../core/layout'
import type { AbilityTier, TierCategory } from '../core/tiers'
import type { AppLocale } from '../i18n'
import type { CombinationRecommendation } from '../types'
import type { OverlayShortcutMode } from './shortcuts'

export type OverlayKind = 'recommendation' | 'tier' | 'layout'
export type OverlayRecognitionStatus =
  'idle' | 'recognizing' | 'ready' | 'error'

export interface OverlayViewport {
  width: number
  height: number
}

export interface NativeOverlayVisibility {
  kind: OverlayKind
  open: boolean
  ready: boolean
  visible: boolean
  visibilityObserved: boolean
  displayed: boolean
  revision: number
  position?: { x: number; y: number }
  size?: OverlayViewport
  monitor?: {
    name?: string
    position: { x: number; y: number }
    size: OverlayViewport
    scaleFactor: number
  }
  targetMonitor?: {
    name?: string
    position: { x: number; y: number }
    size: OverlayViewport
    scaleFactor: number
  }
  withinMonitorBounds?: boolean
}

export interface OverlayVisibilityProjection {
  visibility: Record<OverlayKind, boolean>
  revisions: Record<OverlayKind, number>
}

export interface NativeOverlayShortcutStatus {
  shortcut: string
  registered: boolean
  mode: OverlayShortcutMode
}

export interface OverlayState {
  recognitionStatus: OverlayRecognitionStatus
  candidatePools: BuildCandidatePools
  combinationRecommendations: CombinationRecommendation[]
  locale: AppLocale
  tierCategory: TierCategory
  tierQuery: string
  layout?: RuntimeSlot[]
  layoutTiers?: Array<AbilityTier | null>
  layoutViewport?: OverlayViewport
}

export type OverlayMessage =
  | { type: 'overlay-ready'; kind: OverlayKind }
  | { type: 'overlay-state'; kind: OverlayKind; state: OverlayState }

interface TauriInternals {
  invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>
}

declare global {
  interface Window {
    __TAURI_INTERNALS__?: TauriInternals
  }
}

export const OVERLAY_CHANNEL_NAME = 'omg-draft-seer-overlay-v1'
export const OVERLAY_VISIBILITY_EVENT = 'omg-draft-seer-overlay-visibility'

interface AnimationFrameScheduler {
  requestAnimationFrame(callback: FrameRequestCallback): number
  cancelAnimationFrame(handle: number): void
  setTimeout(callback: () => void, delay: number): number
  clearTimeout(handle: number): void
}

interface RetryScheduler {
  setTimeout(callback: () => void, delay: number): number
  clearTimeout(handle: number): void
}

export function canMarkOverlayReady(
  snapshotSettled: boolean,
  contentSynchronized: boolean,
): boolean {
  return snapshotSettled && contentSynchronized
}

export function shouldObserveOverlayPanel(
  desktop: boolean,
  kind: OverlayKind,
  contentReady: boolean,
  resizeObserverAvailable: boolean,
): boolean {
  return desktop && kind !== 'layout' && contentReady && resizeObserverAvailable
}

export function scheduleOverlayReadyRetry(
  markReady: () => Promise<boolean>,
  reportError: (error: unknown) => void,
  scheduler: RetryScheduler = window,
  maxAttempts = 3,
): () => void {
  let active = true
  let attempt = 0
  let timeout = 0
  const run = () => {
    attempt += 1
    void markReady().catch((error: unknown) => {
      if (!active) return
      reportError(error)
      if (attempt >= maxAttempts) return
      timeout = scheduler.setTimeout(run, 250)
    })
  }
  run()
  return () => {
    active = false
    if (timeout) scheduler.clearTimeout(timeout)
  }
}

export function scheduleOverlayReadyAfterPaint(
  callback: () => void,
  scheduler: AnimationFrameScheduler = window,
): () => void {
  let active = true
  let timeout = 0
  const finish = () => {
    if (!active) return
    active = false
    scheduler.cancelAnimationFrame(frame)
    scheduler.clearTimeout(timeout)
    callback()
  }
  let frame = scheduler.requestAnimationFrame(() => {
    if (!active) return
    frame = scheduler.requestAnimationFrame(finish)
  })
  timeout = scheduler.setTimeout(finish, 100)
  return () => {
    if (!active) return
    active = false
    scheduler.cancelAnimationFrame(frame)
    scheduler.clearTimeout(timeout)
  }
}

function overlayStorageKey(kind: OverlayKind): string {
  return `${OVERLAY_CHANNEL_NAME}:${kind}`
}

export function overlayKindFromLocation(): OverlayKind | undefined {
  if (typeof window === 'undefined') return undefined
  const kind = new URLSearchParams(window.location.search).get('overlay')
  return kind === 'recommendation' || kind === 'tier' || kind === 'layout'
    ? kind
    : undefined
}

export function isDesktopRuntime(): boolean {
  return typeof window !== 'undefined' && Boolean(window.__TAURI_INTERNALS__)
}

export function createOverlayChannel(): BroadcastChannel | undefined {
  if (typeof BroadcastChannel === 'undefined') return undefined
  return new BroadcastChannel(OVERLAY_CHANNEL_NAME)
}

export function readOverlayState(kind: OverlayKind): OverlayState | undefined {
  if (typeof window === 'undefined') return undefined
  try {
    const value = window.localStorage.getItem(overlayStorageKey(kind))
    return value ? (JSON.parse(value) as OverlayState) : undefined
  } catch {
    return undefined
  }
}

export function writeOverlayState(
  kind: OverlayKind,
  state: OverlayState,
): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(overlayStorageKey(kind), JSON.stringify(state))
  } catch {
    // BroadcastChannel remains available for live updates when storage is blocked.
  }
}

async function invokeOverlayCommand<T>(
  command: string,
  args: Record<string, unknown>,
): Promise<T> {
  const internals =
    typeof window === 'undefined' ? undefined : window.__TAURI_INTERNALS__
  if (!internals)
    throw new Error('Overlay windows are only available in the desktop shell.')
  return internals.invoke<T>(command, args)
}

export function openNativeOverlay(
  kind: OverlayKind,
  viewport?: OverlayViewport,
): Promise<NativeOverlayVisibility> {
  return invokeOverlayCommand('open_overlay', {
    kind,
    ...(viewport
      ? { width: viewport.width, height: viewport.height }
      : undefined),
  })
}

export function markNativeOverlayReady(kind: OverlayKind): Promise<boolean> {
  return invokeOverlayCommand('mark_overlay_ready', { kind })
}

export function closeNativeOverlay(
  kind: OverlayKind,
): Promise<NativeOverlayVisibility> {
  return invokeOverlayCommand('close_overlay', { kind })
}

export function toggleNativeOverlay(
  kind: OverlayKind,
  viewport?: OverlayViewport,
): Promise<NativeOverlayVisibility> {
  return invokeOverlayCommand('toggle_overlay', {
    kind,
    ...(viewport
      ? { width: viewport.width, height: viewport.height }
      : undefined),
  })
}

export function getNativeOverlayVisibility(): Promise<
  NativeOverlayVisibility[]
> {
  return invokeOverlayCommand('get_overlay_visibility', {})
}

export function mergeNativeOverlayVisibility(
  projection: OverlayVisibilityProjection,
  status: NativeOverlayVisibility,
): OverlayVisibilityProjection {
  if (status.revision < projection.revisions[status.kind]) return projection
  return {
    visibility:
      projection.visibility[status.kind] === status.displayed
        ? projection.visibility
        : { ...projection.visibility, [status.kind]: status.displayed },
    revisions: {
      ...projection.revisions,
      [status.kind]: status.revision,
    },
  }
}

export function setNativeOverlayShortcut(
  shortcut: string,
  enabled: boolean,
  mode: OverlayShortcutMode,
): Promise<NativeOverlayShortcutStatus> {
  return invokeOverlayCommand('set_overlay_shortcut', {
    shortcut,
    enabled,
    mode,
  })
}

export function getNativeOverlayShortcutStatus(): Promise<NativeOverlayShortcutStatus> {
  return invokeOverlayCommand('get_overlay_shortcut_status', {})
}

export function resizeNativeOverlay(
  kind: OverlayKind,
  height: number,
): Promise<void> {
  return invokeOverlayCommand('resize_overlay', { kind, height })
}

export function setNativeOverlayInteractionRegion(
  kind: OverlayKind,
  width: number,
  height: number,
): Promise<void> {
  return invokeOverlayCommand('set_overlay_interaction_region', {
    kind,
    width,
    height,
  })
}

export function setNativeOverlayViewport(
  viewport: OverlayViewport,
): Promise<void> {
  return invokeOverlayCommand('set_overlay_viewport', {
    width: viewport.width,
    height: viewport.height,
  })
}

export async function listenOverlayVisibility(
  handler: (status: NativeOverlayVisibility) => void,
): Promise<() => void> {
  return listen<NativeOverlayVisibility>(OVERLAY_VISIBILITY_EVENT, (event) =>
    handler(event.payload),
  )
}
