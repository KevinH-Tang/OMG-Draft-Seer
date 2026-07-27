import { useTranslation } from 'react-i18next'
import { setAppLocale, toAppLocale } from '../i18n'
import { cn } from '../lib/cn'

export function LanguageSwitcher({
  fullWidth = false,
}: {
  fullWidth?: boolean
}) {
  const { i18n, t } = useTranslation()
  const locale = toAppLocale(i18n.resolvedLanguage ?? i18n.language)

  return (
    <div
      className={cn(
        'inline-flex rounded-md border border-border bg-surface-raised p-0.5',
        fullWidth && 'grid w-full grid-cols-2',
      )}
      aria-label={t('app.language')}
      data-testid="locale-switcher"
    >
      {(['zh-CN', 'en'] as const).map((option) => (
        <button
          className={cn(
            'rounded px-2 py-1 font-mono text-[11px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-accent',
            fullWidth && 'min-h-9',
            option === locale
              ? 'bg-accent text-canvas'
              : 'text-text-muted hover:bg-surface-hover hover:text-text',
          )}
          type="button"
          aria-pressed={option === locale}
          data-testid={`locale-${option}`}
          key={option}
          onClick={() => void setAppLocale(option)}
        >
          {option === 'zh-CN' ? t('language.zh') : t('language.en')}
        </button>
      ))}
    </div>
  )
}
