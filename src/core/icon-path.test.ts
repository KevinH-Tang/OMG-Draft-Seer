import { describe, expect, it } from 'vitest'
import { localAbilityIconUrl, remoteAbilityIconUrl } from './icon-path'

describe('ability icon paths', () => {
  it('uses the local hero cache before the Windrun CDN fallback', () => {
    expect(localAbilityIconUrl(-1, 'antimage', true)).toBe('/assets/hero-icons/-1.png')
    expect(remoteAbilityIconUrl('antimage', true)).toBe('https://cdn.datdota.com/images/miniheroes/antimage.png')
  })

  it('uses the ability ID for local non-hero cache entries', () => {
    expect(localAbilityIconUrl(3060, 'templar_assassin_hidden_gates')).toBe('/assets/ability-icons/3060.png')
    expect(localAbilityIconUrl(1617, 'templar_assassin_hidden_gates')).toBe('/assets/ability-icons/1617.png')
  })

  it('keeps CDN URLs as the fallback source', () => {
    expect(remoteAbilityIconUrl('mirana_arrow')).toContain('/ability/mirana_arrow.png')
  })
})
