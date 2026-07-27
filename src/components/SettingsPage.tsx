import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, Keyboard, RotateCcw } from 'lucide-react'
import { LanguageSwitcher } from './LanguageSwitcher'
import { cn } from '../lib/cn'
import {
  DEFAULT_OVERLAY_SHORTCUT,
  formatOverlayShortcut,
  shortcutFromKeyboardEvent,
  type OverlayShortcutMode,
} from '../platform/shortcuts'

export type LayoutMode = 'auto' | 'manual'

export function SettingsPage({
  layoutMode,
  overlayShortcut,
  overlayShortcutMode,
  onBack,
  onLayoutModeChange,
  onOverlayShortcutChange,
  onOverlayShortcutModeChange,
}: {
  layoutMode: LayoutMode
  overlayShortcut: string
  overlayShortcutMode: OverlayShortcutMode
  onBack: () => void
  onLayoutModeChange: (mode: LayoutMode) => void
  onOverlayShortcutChange: (shortcut: string) => void
  onOverlayShortcutModeChange: (mode: OverlayShortcutMode) => void
}) {
  const { t } = useTranslation()
  const [recordingShortcut, setRecordingShortcut] = useState(false)

  useEffect(() => {
    if (!recordingShortcut) return
    const handleKeyDown = (event: KeyboardEvent) => {
      event.preventDefault()
      event.stopPropagation()
      if (event.key === 'Escape') {
        setRecordingShortcut(false)
        return
      }
      const shortcut = shortcutFromKeyboardEvent(event)
      if (!shortcut) return
      onOverlayShortcutChange(shortcut)
      setRecordingShortcut(false)
    }
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [onOverlayShortcutChange, recordingShortcut])

  return (
    <section
      className="w-full pt-1"
      aria-labelledby="settings-title"
      data-testid="settings-page"
    >
      <header className="flex items-center gap-3 border-b border-border pb-3">
        <button
          className="grid size-9 place-items-center rounded border border-border bg-surface text-text-muted transition-colors hover:border-accent hover:bg-surface-hover hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          type="button"
          aria-label={t('settings.back')}
          data-testid="settings-back"
          onClick={onBack}
        >
          <ArrowLeft aria-hidden="true" size={17} />
        </button>
        <h1 id="settings-title" className="m-0 text-2xl font-semibold">
          {t('settings.title')}
        </h1>
      </header>
      <div className="grid max-w-[420px] gap-7 pt-6">
        <section className="w-full" aria-labelledby="layout-mode-title">
          <h2 id="layout-mode-title" className="text-base">
            {t('settings.layoutMode')}
          </h2>
          <p className="mb-3 mt-1 text-xs text-text-muted">
            {t('settings.layoutModeHint')}
          </p>
          <div
            className="grid w-full grid-cols-2 rounded-md border border-border bg-surface-raised p-0.5"
            role="group"
            aria-label={t('settings.layoutMode')}
            data-testid="layout-mode-switcher"
          >
            {(['auto', 'manual'] as const).map((mode) => (
              <button
                className={cn(
                  'min-h-9 whitespace-nowrap rounded px-2 py-1 text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-accent',
                  mode === layoutMode
                    ? 'bg-accent text-canvas'
                    : 'text-text-muted hover:bg-surface-hover hover:text-text',
                )}
                type="button"
                aria-pressed={mode === layoutMode}
                data-testid={`layout-mode-${mode}`}
                key={mode}
                onClick={() => onLayoutModeChange(mode)}
              >
                {t(`settings.layoutModeOptions.${mode}`)}
              </button>
            ))}
          </div>
        </section>
        <section className="w-full" aria-labelledby="overlay-shortcut-title">
          <h2
            id="overlay-shortcut-title"
            className="inline-flex items-center gap-2 text-base"
          >
            <Keyboard size={16} aria-hidden="true" />
            {t('settings.overlayShortcut')}
          </h2>
          <p className="mb-3 mt-1 text-xs text-text-muted">
            {t('settings.overlayShortcutHint')}
          </p>
          <p className="mb-2 mt-0 text-xs text-text-muted">
            {t('settings.overlayShortcutKeyHint')}
          </p>
          <div className="flex items-center gap-2">
            <button
              className={cn(
                'inline-flex min-h-9 flex-1 items-center justify-center gap-2 whitespace-nowrap rounded border px-3 py-1 text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
                recordingShortcut
                  ? 'border-accent bg-accent/15 text-accent'
                  : 'border-border bg-surface text-text-muted hover:border-accent hover:bg-surface-hover hover:text-text',
              )}
              type="button"
              aria-pressed={recordingShortcut}
              data-testid="overlay-shortcut-capture"
              onClick={() => setRecordingShortcut((current) => !current)}
            >
              <Keyboard size={15} aria-hidden="true" />
              <kbd>
                {recordingShortcut
                  ? t('settings.overlayShortcutRecording')
                  : formatOverlayShortcut(overlayShortcut)}
              </kbd>
            </button>
            <button
              className="grid size-9 shrink-0 place-items-center rounded border border-border bg-surface text-text-muted transition-colors hover:border-accent hover:bg-surface-hover hover:text-text disabled:pointer-events-none disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              type="button"
              aria-label={t('settings.overlayShortcutReset')}
              title={t('settings.overlayShortcutReset')}
              data-testid="overlay-shortcut-reset"
              disabled={overlayShortcut === DEFAULT_OVERLAY_SHORTCUT}
              onClick={() => {
                setRecordingShortcut(false)
                onOverlayShortcutChange(DEFAULT_OVERLAY_SHORTCUT)
              }}
            >
              <RotateCcw size={15} aria-hidden="true" />
            </button>
          </div>
          <div
            className="grid w-full grid-cols-2 rounded-md border border-border bg-surface-raised p-0.5"
            role="group"
            aria-label={t('settings.overlayShortcut')}
            data-testid="overlay-shortcut-mode-switcher"
          >
            {(['trigger', 'hold'] as const).map((mode) => (
              <button
                className={cn(
                  'min-h-9 whitespace-nowrap rounded px-2 py-1 text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-accent',
                  mode === overlayShortcutMode
                    ? 'bg-accent text-canvas'
                    : 'text-text-muted hover:bg-surface-hover hover:text-text',
                )}
                type="button"
                aria-pressed={mode === overlayShortcutMode}
                data-testid={`overlay-shortcut-${mode}`}
                key={mode}
                onClick={() => onOverlayShortcutModeChange(mode)}
              >
                {t(`settings.overlayShortcutOptions.${mode}`)}
              </button>
            ))}
          </div>
        </section>
        <section className="w-full" aria-labelledby="language-title">
          <h2 id="language-title" className="text-base">
            {t('settings.language')}
          </h2>
          <p className="mb-3 mt-1 text-xs text-text-muted">
            {t('settings.languageHint')}
          </p>
          <LanguageSwitcher fullWidth />
        </section>
      </div>
    </section>
  )
}
