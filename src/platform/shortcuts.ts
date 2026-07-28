import type { StorageAdapter } from './storage'

export type OverlayShortcutMode = 'trigger' | 'hold'
export type OverlayShortcutState = 'pressed' | 'released'

export interface OverlayShortcutModeRequestState {
  requestId: number
  requestedMode: OverlayShortcutMode
}

export interface OverlayHoldCycleState {
  active: boolean
  overlayOpen: boolean
}

export function transitionOverlayHoldCycle(
  state: OverlayHoldCycleState,
  shortcutState: OverlayShortcutState,
): OverlayHoldCycleState {
  if (shortcutState === 'pressed') {
    if (state.active) return state
    return { active: true, overlayOpen: true }
  }
  if (!state.active) return state
  return { active: false, overlayOpen: false }
}

export function overlayShouldCloseOnModeEntry(
  mode: OverlayShortcutMode,
): boolean {
  return mode === 'hold'
}

export function beginOverlayShortcutModeRequest(
  state: OverlayShortcutModeRequestState,
  mode: OverlayShortcutMode,
): number | undefined {
  if (mode === state.requestedMode) return undefined
  state.requestedMode = mode
  state.requestId += 1
  return state.requestId
}

export const OVERLAY_SHORTCUT_MODE_STORAGE_KEY = 'omg-overlay-shortcut-mode-v1'
export const OVERLAY_SHORTCUT_STORAGE_KEY = 'omg-overlay-shortcut-key-v1'
export const DEFAULT_OVERLAY_SHORTCUT = 'Tab'

const MODIFIER_KEYS = new Set(['Alt', 'Control', 'Meta', 'Shift'])
const MODIFIER_CODES = new Set(['Alt', 'Control', 'Shift', 'Super'])
const MODIFIER_LABELS: Record<string, string> = {
  Alt: 'Alt',
  Control: 'Ctrl',
  Shift: 'Shift',
  Super: 'Cmd',
}
const KEY_LABELS: Record<string, string> = {
  Backquote: '`',
  Backslash: '\\',
  BracketLeft: '[',
  BracketRight: ']',
  Comma: ',',
  Delete: 'Delete',
  End: 'End',
  Enter: 'Enter',
  Equal: '=',
  Escape: 'Esc',
  Home: 'Home',
  Insert: 'Insert',
  Minus: '-',
  PageDown: 'Page Down',
  PageUp: 'Page Up',
  Semicolon: ';',
  Slash: '/',
  Space: 'Space',
  Tab: 'Tab',
}

export function readOverlayShortcutMode(
  storage: StorageAdapter,
): OverlayShortcutMode {
  try {
    return storage.getItem(OVERLAY_SHORTCUT_MODE_STORAGE_KEY) === 'hold'
      ? 'hold'
      : 'trigger'
  } catch {
    return 'trigger'
  }
}

export function writeOverlayShortcutMode(
  storage: StorageAdapter,
  mode: OverlayShortcutMode,
): void {
  try {
    storage.setItem(OVERLAY_SHORTCUT_MODE_STORAGE_KEY, mode)
  } catch {
    // Shortcut preferences are optional and remain active for the current session.
  }
}

export function readOverlayShortcut(storage: StorageAdapter): string {
  try {
    const value = storage.getItem(OVERLAY_SHORTCUT_STORAGE_KEY)?.trim()
    return value || DEFAULT_OVERLAY_SHORTCUT
  } catch {
    return DEFAULT_OVERLAY_SHORTCUT
  }
}

export function writeOverlayShortcut(
  storage: StorageAdapter,
  shortcut: string,
): void {
  try {
    storage.setItem(OVERLAY_SHORTCUT_STORAGE_KEY, shortcut)
  } catch {
    // Shortcut preferences are optional and remain active for the current session.
  }
}

function shortcutParts(shortcut: string):
  | {
      key: string
      modifiers: Set<string>
    }
  | undefined {
  const parts = shortcut
    .split('+')
    .map((part) => part.trim())
    .filter(Boolean)
  const key = parts.pop()
  if (!key) return undefined
  if (parts.some((part) => !MODIFIER_CODES.has(part))) return undefined
  return { key, modifiers: new Set(parts) }
}

export function isOverlayShortcutEvent(
  event: KeyboardEvent,
  shortcut = DEFAULT_OVERLAY_SHORTCUT,
): boolean {
  const parts = shortcutParts(shortcut)
  if (!parts) return false
  if (!isOverlayShortcutKeyEvent(event, shortcut)) return false
  return (
    Boolean(event.altKey) === parts.modifiers.has('Alt') &&
    Boolean(event.ctrlKey) === parts.modifiers.has('Control') &&
    Boolean(event.metaKey) === parts.modifiers.has('Super') &&
    Boolean(event.shiftKey) === parts.modifiers.has('Shift')
  )
}

export function isOverlayShortcutKeyEvent(
  event: KeyboardEvent,
  shortcut = DEFAULT_OVERLAY_SHORTCUT,
): boolean {
  const parts = shortcutParts(shortcut)
  if (!parts) return false
  return event.code === parts.key || event.key === parts.key
}

const TYPABLE_CODE_PATTERN =
  /^(Key[A-Z]|Digit[0-9]|Numpad[0-9]|NumpadDecimal|NumpadAdd|NumpadSubtract|NumpadMultiply|NumpadDivide|Space|Comma|Period|Slash|Semicolon|Quote|Backquote|BracketLeft|BracketRight|Backslash|Minus|Equal)$/

export function shortcutFromKeyboardEvent(
  event: KeyboardEvent,
): string | undefined {
  if (
    event.isComposing ||
    event.repeat ||
    !event.code ||
    event.code === 'Unidentified'
  )
    return undefined
  if (MODIFIER_KEYS.has(event.key)) return undefined
  const modifiers = [
    event.ctrlKey ? 'Control' : undefined,
    event.altKey ? 'Alt' : undefined,
    event.metaKey ? 'Super' : undefined,
    event.shiftKey ? 'Shift' : undefined,
  ].filter((modifier): modifier is string => modifier !== undefined)
  if (modifiers.length === 0 && TYPABLE_CODE_PATTERN.test(event.code))
    return undefined
  return [...modifiers, event.code].join('+')
}

export function formatOverlayShortcut(shortcut: string): string {
  const parts = shortcutParts(shortcut)
  if (!parts) return formatShortcutKey(DEFAULT_OVERLAY_SHORTCUT)
  const modifierLabels = [...parts.modifiers].map(
    (modifier) => MODIFIER_LABELS[modifier] ?? modifier,
  )
  return [...modifierLabels, formatShortcutKey(parts.key)].join(' + ')
}

function formatShortcutKey(key: string): string {
  if (KEY_LABELS[key]) return KEY_LABELS[key]
  if (key.startsWith('Key') && key.length === 4) return key.slice(3)
  if (key.startsWith('Digit') && key.length === 6) return key.slice(5)
  if (key.startsWith('Numpad')) return key.replace('Numpad', 'Num ')
  return key
}

const EDITABLE_TAG_NAMES = new Set(['INPUT', 'TEXTAREA', 'SELECT'])
interface MaybeEditableElement {
  tagName?: unknown
  isContentEditable?: unknown
}

export function isEditableEventTarget(target: EventTarget | null): boolean {
  const element = target as MaybeEditableElement | null
  if (!element || typeof element.tagName !== 'string') return false
  return (
    EDITABLE_TAG_NAMES.has(element.tagName) ||
    Boolean(element.isContentEditable)
  )
}

export function createOverlayShortcutController(
  shortcut: string,
  onStateChange: (state: OverlayShortcutState) => void,
) {
  let pressed = false

  const handleState = (state: OverlayShortcutState) => {
    const next = state === 'pressed'
    if (next === pressed) return
    pressed = next
    onStateChange(state)
  }

  const handleKeyDown = (event: KeyboardEvent) => {
    if (
      !isOverlayShortcutEvent(event, shortcut) ||
      event.repeat ||
      event.defaultPrevented ||
      isEditableEventTarget(event.target)
    )
      return
    event.preventDefault()
    handleState('pressed')
  }

  const handleKeyUp = (event: KeyboardEvent) => {
    if (!pressed || !isOverlayShortcutKeyEvent(event, shortcut)) return
    event.preventDefault()
    handleState('released')
  }

  return {
    handleKeyDown,
    handleKeyUp,
    handleState,
    reset: () => {
      handleState('released')
    },
  }
}
