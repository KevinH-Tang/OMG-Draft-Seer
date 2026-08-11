import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ArrowLeft,
  CircleAlert,
  CircleCheck,
  Database,
  Keyboard,
  LoaderCircle,
  Power,
  RefreshCw,
  RotateCcw,
} from 'lucide-react'
import { LanguageSwitcher } from './LanguageSwitcher'
import { SegmentedControl } from './ui/SegmentedControl'
import { cn } from '../lib/cn'
import {
  readAutostartEnabled,
  setAutostartEnabled,
} from '../platform/autostart'
import { isDesktopRuntime } from '../platform/overlays'
import {
  DEFAULT_OVERLAY_SHORTCUT,
  formatOverlayShortcut,
  shortcutFromKeyboardEvent,
  type OverlayShortcutMode,
} from '../platform/shortcuts'
import type { Snapshot } from '../types'

export type LayoutMode = 'auto' | 'manual'

export function SettingsPage({
  layoutMode,
  overlayShortcut,
  overlayShortcutMode,
  overlayShortcutRegistered,
  snapshot,
  onBack,
  onDataUpdate,
  onLayoutModeChange,
  onOverlayShortcutChange,
  onOverlayShortcutModeChange,
}: {
  layoutMode: LayoutMode
  overlayShortcut: string
  overlayShortcutMode: OverlayShortcutMode
  overlayShortcutRegistered?: boolean
  snapshot: Snapshot
  onBack: () => void
  onDataUpdate: () => Promise<void>
  onLayoutModeChange: (mode: LayoutMode) => void
  onOverlayShortcutChange: (shortcut: string) => void
  onOverlayShortcutModeChange: (mode: OverlayShortcutMode) => void
}) {
  const { t } = useTranslation()
  const [recordingShortcut, setRecordingShortcut] = useState(false)
  const [autostartEnabled, setAutostartEnabledState] = useState<
    boolean | undefined
  >()
  const [autostartPending, setAutostartPending] = useState(false)
  const [autostartError, setAutostartError] = useState(false)
  const [dataUpdatePending, setDataUpdatePending] = useState(false)
  const [dataUpdateResult, setDataUpdateResult] = useState<
    'success' | 'error' | undefined
  >()
  const autostartPendingRef = useRef(false)
  const autostartRequestRef = useRef(0)
  const desktopRuntime = isDesktopRuntime()
  const generatedAt = new Date(snapshot.generatedAt)
  const formattedGeneratedAt = Number.isNaN(generatedAt.getTime())
    ? snapshot.generatedAt
    : new Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(generatedAt)

  useEffect(() => {
    if (!desktopRuntime) return
    const requestId = ++autostartRequestRef.current
    void readAutostartEnabled()
      .then((enabled) => {
        if (autostartRequestRef.current !== requestId) return
        setAutostartEnabledState(enabled)
      })
      .catch(() => {
        if (autostartRequestRef.current !== requestId) return
        setAutostartError(true)
      })
    return () => {
      autostartRequestRef.current += 1
      autostartPendingRef.current = false
    }
  }, [desktopRuntime])

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

  async function toggleAutostart() {
    if (autostartEnabled === undefined || autostartPendingRef.current) return
    const requested = !autostartEnabled
    const requestId = ++autostartRequestRef.current
    autostartPendingRef.current = true
    setAutostartPending(true)
    setAutostartError(false)
    try {
      await setAutostartEnabled(requested)
      const registered = await readAutostartEnabled()
      if (autostartRequestRef.current !== requestId) return
      setAutostartEnabledState(registered)
      setAutostartError(registered !== requested)
    } catch {
      if (autostartRequestRef.current !== requestId) return
      setAutostartError(true)
      try {
        const registered = await readAutostartEnabled()
        if (autostartRequestRef.current === requestId) {
          setAutostartEnabledState(registered)
        }
      } catch {
        // Keep the last known state when the native plugin is unavailable.
      }
    } finally {
      if (autostartRequestRef.current === requestId) {
        autostartPendingRef.current = false
        setAutostartPending(false)
      }
    }
  }

  async function updateData() {
    if (!desktopRuntime || dataUpdatePending) return
    setDataUpdatePending(true)
    setDataUpdateResult(undefined)
    try {
      await onDataUpdate()
      setDataUpdateResult('success')
    } catch {
      setDataUpdateResult('error')
    } finally {
      setDataUpdatePending(false)
    }
  }

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
        <section className="w-full" aria-labelledby="data-update-title">
          <h2
            id="data-update-title"
            className="inline-flex items-center gap-2 text-base"
          >
            <Database size={16} aria-hidden="true" />
            {t('settings.dataUpdate')}
          </h2>
          <p className="mb-3 mt-1 text-xs text-text-muted">
            {t('settings.dataSnapshot', {
              patch: snapshot.patch,
              date: formattedGeneratedAt,
            })}
          </p>
          <button
            className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded border border-border bg-surface px-3 py-2 text-xs font-semibold text-text transition-colors hover:border-accent hover:bg-surface-hover disabled:pointer-events-none disabled:opacity-55 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            type="button"
            aria-busy={dataUpdatePending}
            data-testid="data-update-button"
            disabled={!desktopRuntime || dataUpdatePending}
            onClick={() => void updateData()}
          >
            {dataUpdatePending ? (
              <LoaderCircle
                className="animate-spin"
                size={16}
                aria-hidden="true"
              />
            ) : (
              <RefreshCw size={16} aria-hidden="true" />
            )}
            {!desktopRuntime
              ? t('settings.dataUpdateDesktopOnly')
              : dataUpdatePending
                ? t('settings.dataUpdating')
                : t('settings.dataUpdateAction')}
          </button>
          {dataUpdateResult && (
            <p
              className={cn(
                'mb-0 mt-2 inline-flex items-center gap-1.5 text-xs',
                dataUpdateResult === 'success'
                  ? 'text-positive'
                  : 'text-negative',
              )}
              role="status"
              data-testid="data-update-status"
            >
              {dataUpdateResult === 'success' ? (
                <CircleCheck size={13} aria-hidden="true" />
              ) : (
                <CircleAlert size={13} aria-hidden="true" />
              )}
              {t(
                dataUpdateResult === 'success'
                  ? 'settings.dataUpdateSuccess'
                  : 'settings.dataUpdateError',
              )}
            </p>
          )}
        </section>
        <section className="w-full" aria-labelledby="layout-mode-title">
          <h2 id="layout-mode-title" className="text-base">
            {t('settings.layoutMode')}
          </h2>
          <p className="mb-3 mt-1 text-xs text-text-muted">
            {t('settings.layoutModeHint')}
          </p>
          <SegmentedControl
            ariaLabel={t('settings.layoutMode')}
            fullWidth
            options={(['auto', 'manual'] as const).map((mode) => ({
              value: mode,
              label: t(`settings.layoutModeOptions.${mode}`),
              testId: `layout-mode-${mode}`,
            }))}
            testId="layout-mode-switcher"
            value={layoutMode}
            onValueChange={onLayoutModeChange}
          />
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
          {desktopRuntime && (
            <p
              className={cn(
                'mb-2 mt-0 inline-flex min-h-5 items-center gap-1.5 text-xs',
                overlayShortcutRegistered === false
                  ? 'text-danger'
                  : 'text-text-muted',
              )}
              aria-live="polite"
              data-testid="overlay-shortcut-registration-status"
            >
              {overlayShortcutRegistered === undefined ? (
                <LoaderCircle
                  className="animate-spin"
                  size={13}
                  aria-hidden="true"
                />
              ) : overlayShortcutRegistered ? (
                <CircleCheck size={13} aria-hidden="true" />
              ) : (
                <CircleAlert size={13} aria-hidden="true" />
              )}
              {overlayShortcutRegistered === undefined
                ? t('settings.overlayShortcutChecking')
                : overlayShortcutRegistered
                  ? t('settings.overlayShortcutRegistered')
                  : t('settings.overlayShortcutUnregistered')}
            </p>
          )}
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
          <SegmentedControl
            ariaLabel={t('settings.overlayShortcut')}
            fullWidth
            options={(['trigger', 'hold'] as const).map((mode) => ({
              value: mode,
              label: t(`settings.overlayShortcutOptions.${mode}`),
              testId: `overlay-shortcut-${mode}`,
            }))}
            testId="overlay-shortcut-mode-switcher"
            value={overlayShortcutMode}
            onValueChange={onOverlayShortcutModeChange}
          />
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
        <section className="w-full" aria-labelledby="autostart-title">
          <h2
            id="autostart-title"
            className="inline-flex items-center gap-2 text-base"
          >
            <Power size={16} aria-hidden="true" />
            {t('settings.autostart')}
          </h2>
          <p className="mb-3 mt-1 text-xs text-text-muted">
            {t('settings.autostartHint')}
          </p>
          <button
            className="flex min-h-10 w-full items-center justify-between gap-3 rounded border border-border bg-surface px-3 py-2 text-left transition-colors hover:border-accent hover:bg-surface-hover disabled:pointer-events-none disabled:opacity-55 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            type="button"
            role="switch"
            aria-checked={autostartEnabled ?? false}
            aria-busy={autostartPending}
            aria-label={t('settings.autostart')}
            data-testid="autostart-toggle"
            disabled={
              !desktopRuntime ||
              autostartEnabled === undefined ||
              autostartPending
            }
            onClick={() => void toggleAutostart()}
          >
            <span className="text-xs font-semibold text-text">
              {!desktopRuntime
                ? t('settings.autostartDesktopOnly')
                : autostartEnabled === undefined
                  ? autostartError
                    ? t('settings.autostartUnavailable')
                    : t('settings.autostartLoading')
                  : autostartEnabled
                    ? t('settings.autostartEnabled')
                    : t('settings.autostartDisabled')}
            </span>
            {autostartPending ||
            (desktopRuntime &&
              autostartEnabled === undefined &&
              !autostartError) ? (
              <LoaderCircle
                className="shrink-0 animate-spin text-accent"
                size={16}
                aria-hidden="true"
              />
            ) : (
              <span
                className={cn(
                  'relative h-5 w-9 shrink-0 rounded-full border transition-colors',
                  autostartEnabled
                    ? 'border-accent bg-accent'
                    : 'border-border bg-surface-raised',
                )}
                aria-hidden="true"
              >
                <span
                  className={cn(
                    'absolute top-0.5 size-3.5 rounded-full bg-text transition-transform',
                    autostartEnabled ? 'translate-x-[17px]' : 'translate-x-0.5',
                  )}
                />
              </span>
            )}
          </button>
          {autostartError && (
            <p className="mb-0 mt-2 text-xs text-negative" role="status">
              {t('settings.autostartError')}
            </p>
          )}
        </section>
      </div>
    </section>
  )
}
