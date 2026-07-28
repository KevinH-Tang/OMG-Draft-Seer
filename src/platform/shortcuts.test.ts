import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_OVERLAY_SHORTCUT,
  OVERLAY_SHORTCUT_MODE_STORAGE_KEY,
  OVERLAY_SHORTCUT_STORAGE_KEY,
  beginOverlayShortcutModeRequest,
  createOverlayShortcutController,
  formatOverlayShortcut,
  isEditableEventTarget,
  isOverlayShortcutEvent,
  isOverlayShortcutKeyEvent,
  overlayShouldCloseOnModeEntry,
  readOverlayShortcut,
  readOverlayShortcutMode,
  shortcutFromKeyboardEvent,
  transitionOverlayHoldCycle,
  writeOverlayShortcut,
  writeOverlayShortcutMode,
} from './shortcuts'
import type { StorageAdapter } from './storage'

function createStorage(initial?: string): StorageAdapter {
  let value = initial ?? null
  return {
    getItem: () => value,
    setItem: (_key, next) => {
      value = next
    },
    removeItem: () => {
      value = null
    },
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('overlay shortcut preferences', () => {
  it('claims an open overlay for a hold cycle and closes it on release', () => {
    let state = { active: false, overlayOpen: true }

    state = transitionOverlayHoldCycle(state, 'pressed')
    expect(state).toEqual({ active: true, overlayOpen: true })

    state = transitionOverlayHoldCycle(state, 'released')
    expect(state).toEqual({ active: false, overlayOpen: false })
  })

  it('closes the recommendation overlay when entering hold mode', () => {
    expect(overlayShouldCloseOnModeEntry('hold')).toBe(true)
    expect(overlayShouldCloseOnModeEntry('trigger')).toBe(false)
  })

  it('lets the latest mode click supersede a pending mode request', () => {
    const requests = {
      requestId: 0,
      requestedMode: 'trigger' as const,
    }

    const holdRequest = beginOverlayShortcutModeRequest(requests, 'hold')
    const triggerRequest = beginOverlayShortcutModeRequest(requests, 'trigger')

    expect(holdRequest).toBe(1)
    expect(triggerRequest).toBe(2)
    expect(requests.requestedMode).toBe('trigger')
  })

  it('defaults to trigger and persists hold mode', () => {
    const storage = createStorage()

    expect(readOverlayShortcutMode(storage)).toBe('trigger')
    writeOverlayShortcutMode(storage, 'hold')
    expect(readOverlayShortcutMode(storage)).toBe('hold')
    expect(OVERLAY_SHORTCUT_MODE_STORAGE_KEY).toBe(
      'omg-overlay-shortcut-mode-v1',
    )
  })

  it('defaults the configurable shortcut to Tab and persists changes', () => {
    const storage = createStorage()

    expect(readOverlayShortcut(storage)).toBe(DEFAULT_OVERLAY_SHORTCUT)
    writeOverlayShortcut(storage, 'F8')
    expect(readOverlayShortcut(storage)).toBe('F8')
    expect(OVERLAY_SHORTCUT_STORAGE_KEY).toBe('omg-overlay-shortcut-key-v1')
  })

  it('falls back to trigger when storage is unavailable', () => {
    const storage: StorageAdapter = {
      getItem: () => {
        throw new Error('storage unavailable')
      },
      setItem: () => {
        throw new Error('storage unavailable')
      },
      removeItem: () => undefined,
    }

    expect(readOverlayShortcutMode(storage)).toBe('trigger')
    expect(() => writeOverlayShortcutMode(storage, 'hold')).not.toThrow()
  })

  it('recognizes configured keys and modifier combinations', () => {
    expect(
      isOverlayShortcutEvent(
        { key: DEFAULT_OVERLAY_SHORTCUT } as KeyboardEvent,
        DEFAULT_OVERLAY_SHORTCUT,
      ),
    ).toBe(true)
    expect(
      isOverlayShortcutEvent(
        { code: DEFAULT_OVERLAY_SHORTCUT } as KeyboardEvent,
        DEFAULT_OVERLAY_SHORTCUT,
      ),
    ).toBe(true)
    expect(
      isOverlayShortcutEvent(
        { key: 'Enter', code: 'Enter' } as KeyboardEvent,
        DEFAULT_OVERLAY_SHORTCUT,
      ),
    ).toBe(false)
    expect(
      isOverlayShortcutEvent(
        {
          code: 'KeyQ',
          key: 'q',
          ctrlKey: true,
          altKey: false,
          metaKey: false,
          shiftKey: true,
        } as KeyboardEvent,
        'Control+Shift+KeyQ',
      ),
    ).toBe(true)
    expect(
      isOverlayShortcutEvent(
        {
          code: 'KeyQ',
          key: 'q',
          ctrlKey: true,
          altKey: false,
          metaKey: false,
          shiftKey: false,
        } as KeyboardEvent,
        'Control+Shift+KeyQ',
      ),
    ).toBe(false)
  })

  it('recognizes the configured key after modifiers have been released', () => {
    const event = {
      code: 'KeyQ',
      key: 'q',
      ctrlKey: false,
      altKey: false,
      metaKey: false,
      shiftKey: false,
    } as KeyboardEvent

    expect(isOverlayShortcutEvent(event, 'Control+Shift+KeyQ')).toBe(false)
    expect(isOverlayShortcutKeyEvent(event, 'Control+Shift+KeyQ')).toBe(true)
  })

  it('serializes keyboard events and formats readable labels', () => {
    expect(
      shortcutFromKeyboardEvent({
        code: 'KeyQ',
        key: 'Q',
        ctrlKey: true,
        shiftKey: true,
      } as KeyboardEvent),
    ).toBe('Control+Shift+KeyQ')
    expect(
      shortcutFromKeyboardEvent({
        key: 'Shift',
        code: 'ShiftLeft',
      } as KeyboardEvent),
    ).toBeUndefined()
    expect(formatOverlayShortcut('Tab')).toBe('Tab')
    expect(formatOverlayShortcut('Control+Shift+KeyQ')).toBe('Ctrl + Shift + Q')
  })

  it('rejects bare typable keys that would break normal text entry', () => {
    expect(
      shortcutFromKeyboardEvent({ code: 'KeyE', key: 'e' } as KeyboardEvent),
    ).toBeUndefined()
    expect(
      shortcutFromKeyboardEvent({ code: 'Digit1', key: '1' } as KeyboardEvent),
    ).toBeUndefined()
    expect(
      shortcutFromKeyboardEvent({ code: 'F8', key: 'F8' } as KeyboardEvent),
    ).toBe('F8')
    expect(
      shortcutFromKeyboardEvent({
        code: 'KeyE',
        key: 'e',
        ctrlKey: true,
      } as KeyboardEvent),
    ).toBe('Control+KeyE')
  })

  it('releases an active shortcut when its listener is disposed', () => {
    const onStateChange = vi.fn()
    const controller = createOverlayShortcutController(
      DEFAULT_OVERLAY_SHORTCUT,
      onStateChange,
    )

    controller.handleState('pressed')
    controller.reset()

    expect(onStateChange.mock.calls).toEqual([['pressed'], ['released']])
  })

  it('identifies editable event targets so the shortcut does not hijack typing', () => {
    const asTarget = (value: unknown) => value as EventTarget
    expect(isEditableEventTarget(asTarget({ tagName: 'INPUT' }))).toBe(true)
    expect(isEditableEventTarget(asTarget({ tagName: 'TEXTAREA' }))).toBe(true)
    expect(isEditableEventTarget(asTarget({ tagName: 'SELECT' }))).toBe(true)
    expect(
      isEditableEventTarget(
        asTarget({ tagName: 'DIV', isContentEditable: true }),
      ),
    ).toBe(true)
    expect(isEditableEventTarget(asTarget({ tagName: 'BUTTON' }))).toBe(false)
    expect(isEditableEventTarget(asTarget({ tagName: 'DIV' }))).toBe(false)
    expect(isEditableEventTarget(null)).toBe(false)
  })
})
