import { describe, expect, it } from 'vitest'
import { isHeroAbility, matchesSlotCategory } from './ability-category'

describe('ability categories', () => {
  it('recognizes explicit and legacy negative-ID hero records', () => {
    expect(isHeroAbility({ id: 1, isHero: true })).toBe(true)
    expect(isHeroAbility({ id: -1, isHero: false })).toBe(true)
    expect(isHeroAbility({ id: 1, isHero: false })).toBe(false)
  })

  it('keeps heroes, normal abilities, and ultimates in separate slot pools', () => {
    const legacyHero = { id: -1, isHero: false, isUltimate: false }
    const normalAbility = { id: 1, isHero: false, isUltimate: false }
    const ultimate = { id: 2, isHero: false, isUltimate: true }

    expect(matchesSlotCategory(legacyHero, 'hero')).toBe(true)
    expect(matchesSlotCategory(legacyHero, 'normal')).toBe(false)
    expect(matchesSlotCategory(normalAbility, 'normal')).toBe(true)
    expect(matchesSlotCategory(normalAbility, 'ultimate')).toBe(false)
    expect(matchesSlotCategory(ultimate, 'ultimate')).toBe(true)
  })
})
