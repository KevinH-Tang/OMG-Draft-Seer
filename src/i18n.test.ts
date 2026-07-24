import { afterEach, describe, expect, it } from 'vitest'
import i18n from './i18n'

describe('application translations', () => {
  afterEach(async () => {
    await i18n.changeLanguage('zh-CN')
  })

  it('provides localized Draft replay labels in Chinese and English', async () => {
    await i18n.changeLanguage('zh-CN')
    expect(i18n.t('common.available')).toBe('可用')
    expect(i18n.t('draft.tierRationale')).toBe('选择全局梯度最高的候选')

    await i18n.changeLanguage('en')
    expect(i18n.t('common.available')).toBe('available')
    expect(i18n.t('draft.tierRationale')).toBe('Highest global tier candidate')
  })
})
