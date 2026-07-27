import { useTranslation } from 'react-i18next'
import { ArrowLeft } from 'lucide-react'
import { LanguageSwitcher } from './LanguageSwitcher'
import { cn } from '../lib/cn'

export type LayoutMode = 'auto' | 'manual'

export function SettingsPage({
  layoutMode,
  onBack,
  onLayoutModeChange,
}: {
  layoutMode: LayoutMode
  onBack: () => void
  onLayoutModeChange: (mode: LayoutMode) => void
}) {
  const { t } = useTranslation()

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
                  'min-h-9 rounded px-2 py-1 text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-accent',
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
