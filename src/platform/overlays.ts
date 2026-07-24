import type { BuildCandidatePools } from '../core/recommendation'
import type { AppLocale } from '../i18n'
import type { TierCategory } from '../core/tiers'
import type { Recommendation } from '../types'

export type OverlayKind = 'recommendation' | 'tier'

export interface OverlayState {
  candidatePools: BuildCandidatePools
  locale: AppLocale
  recommendations: Recommendation[]
  selectedIds: number[]
  tierCategory: TierCategory
  tierQuery: string
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

function overlayStorageKey(kind: OverlayKind): string {
  return `${OVERLAY_CHANNEL_NAME}:${kind}`
}

export function overlayKindFromLocation(): OverlayKind | undefined {
  if (typeof window === 'undefined') return undefined
  const kind = new URLSearchParams(window.location.search).get('overlay')
  return kind === 'recommendation' || kind === 'tier' ? kind : undefined
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

export function openNativeOverlay(kind: OverlayKind): Promise<void> {
  return invokeOverlayCommand('open_overlay', { kind })
}

export function closeNativeOverlay(kind: OverlayKind): Promise<void> {
  return invokeOverlayCommand('close_overlay', { kind })
}
