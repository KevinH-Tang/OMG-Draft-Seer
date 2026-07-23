import { describe, expect, it } from 'vitest'
import { appResourceUrl, localAbilityIconUrl, remoteAbilityIconUrl } from './resources'

describe('platform resource URLs', () => {
  it('joins local resources to the configured Vite base URL', () => {
    expect(appResourceUrl('/data/snapshots/latest.json', '/omg/')).toBe('/omg/data/snapshots/latest.json')
    expect(appResourceUrl('assets/icon.png', './')).toBe('./assets/icon.png')
  })

  it('keeps local icon URLs under the configured application base', () => {
    expect(localAbilityIconUrl(-1, 'antimage', true)).toBe('/assets/hero-icons/-1.png')
    expect(localAbilityIconUrl(3060, 'hidden_gates', false)).toBe('/assets/ability-icons/3060.png')
    expect(remoteAbilityIconUrl('antimage', true)).toBe('https://cdn.datdota.com/images/miniheroes/antimage.png')
  })

  it('encodes CDN icon names as URL path segments', () => {
    expect(remoteAbilityIconUrl('hero ability', false)).toBe('https://cdn.datdota.com/images/ability/hero%20ability.png')
  })
})
