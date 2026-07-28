import { listen } from '@tauri-apps/api/event'
import type { BuildCandidatePools } from '../core/recommendation'
import type { RuntimeSlot } from '../core/layout'
import type { AbilityTier, TierCategory } from '../core/tiers'
import type { AppLocale } from '../i18n'
import type { CombinationRecommendation, Recommendation } from '../types'

export type OverlayKind = 'recommendation' | 'tier' | 'layout'
export type OverlayRecognitionStatus =
  'idle' | 'recognizing' | 'ready' | 'error'

export interface OverlayViewport {
  width: number
  height: number
}

export interface OverlayState {
  recognitionStatus: OverlayRecognitionStatus
  candidatePools: BuildCandidatePools
  combinationRecommendations: CombinationRecommendation[]
  pairRecommendations?: CombinationRecommendation[]
  locale: AppLocale
  recommendations: Recommendation[]
  selectedIds: number[]
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
export const MAIN_WINDOW_HIDDEN_EVENT = 'omg-draft-seer-main-window-hidden'

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
    // Storage is an optional handoff path; BroadcastChannel remains authoritative.
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
): Promise<boolean> {
  return invokeOverlayCommand('open_overlay', {
    kind,
    ...(viewport
      ? { width: viewport.width, height: viewport.height }
      : undefined),
  })
}

export function closeNativeOverlay(kind: OverlayKind): Promise<void> {
  return invokeOverlayCommand('close_overlay', { kind })
}

export function setNativeOverlayShortcut(
  shortcut: string,
  enabled: boolean,
): Promise<void> {
  return invokeOverlayCommand('set_overlay_shortcut', { shortcut, enabled })
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

export async function listenMainWindowHidden(
  handler: () => void,
): Promise<() => void> {
  return listen(MAIN_WINDOW_HIDDEN_EVENT, handler)
}
