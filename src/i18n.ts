import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { getBrowserStorage } from './platform/storage'

export type AppLocale = 'zh-CN' | 'en'

export const APP_LOCALE_STORAGE_KEY = 'omg-draft-seer.locale'

const resources = {
  'zh-CN': {
    translation: {
      nav: {
        analysis: '技能分析',
        layout: '布局校准',
        database: '技能梯度',
        pairs: '技能组合',
        draft: '选秀回放',
      },
      language: { zh: '中文', en: 'EN' },
      app: { snapshot: '数据快照', ready: '就绪' },
      overlay: { tier: '梯度参考', recommendation: '构筑推荐', passThrough: '鼠标穿透' },
    },
  },
  en: {
    translation: {
      nav: {
        analysis: 'Skill Analysis',
        layout: 'Layout',
        database: 'Ability Tiers',
        pairs: 'Ability Pairs',
        draft: 'Draft Replay',
      },
      language: { zh: '中文', en: 'EN' },
      app: { snapshot: 'Snapshot', ready: 'Ready' },
      overlay: { tier: 'Tier Reference', recommendation: 'Build Recommendation', passThrough: 'Click-through' },
    },
  },
} as const

function readLocale(): AppLocale {
  return getBrowserStorage().getItem(APP_LOCALE_STORAGE_KEY) === 'en' ? 'en' : 'zh-CN'
}

export function toAppLocale(value: string | undefined): AppLocale {
  return value === 'en' ? 'en' : 'zh-CN'
}

export function setAppLocale(locale: AppLocale): Promise<unknown> {
  getBrowserStorage().setItem(APP_LOCALE_STORAGE_KEY, locale)
  return i18n.changeLanguage(locale)
}

void i18n
  .use(initReactI18next)
  .init({
    resources,
    lng: readLocale(),
    fallbackLng: 'zh-CN',
    interpolation: { escapeValue: false },
  })

export default i18n
