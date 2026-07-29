import { useTranslation } from 'react-i18next'
import { setAppLocale, toAppLocale } from '../i18n'
import { SegmentedControl } from './ui/SegmentedControl'

export function LanguageSwitcher({
  fullWidth = false,
}: {
  fullWidth?: boolean
}) {
  const { i18n, t } = useTranslation()
  const locale = toAppLocale(i18n.resolvedLanguage ?? i18n.language)

  return (
    <SegmentedControl
      ariaLabel={t('app.language')}
      fullWidth={fullWidth}
      options={[
        {
          value: 'zh-CN',
          label: t('language.zh'),
          description: t('language.zhSecondary'),
          testId: 'locale-zh-CN',
        },
        {
          value: 'en',
          label: t('language.en'),
          description: t('language.enSecondary'),
          testId: 'locale-en',
        },
      ]}
      testId="locale-switcher"
      value={locale}
      onValueChange={(option) => void setAppLocale(option)}
    />
  )
}
