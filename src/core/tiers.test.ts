import { describe, expect, it } from 'vitest'
import { demoSnapshot } from '../data/demoSnapshot'
import { buildAbilityTierList, matchesTierCategory, tierForRank } from './tiers'
import type { Snapshot } from '../types'

describe('ability tier list', () => {
  it('filters the ranked snapshot into the four public categories', () => {
    const snapshot: Snapshot = {
      ...demoSnapshot,
      abilities: [
        { id: 1, name: 'Hero', shortName: 'hero', isHero: true, isUltimate: false, iconColor: '#111111' },
        { id: 2, name: 'Ultimate', shortName: 'ultimate', isHero: false, isUltimate: true, iconColor: '#222222' },
        { id: 3, name: 'Ability', shortName: 'ability', isHero: false, isUltimate: false, iconColor: '#333333' },
        { id: 4, name: 'Unranked', shortName: 'unranked', isHero: false, isUltimate: false, iconColor: '#444444' },
      ],
      abilityStats: [
        { abilityId: 1, picks: 100, avgPickPosition: 10, wins: 60 },
        { abilityId: 2, picks: 100, avgPickPosition: 10, wins: 60 },
        { abilityId: 3, picks: 100, avgPickPosition: 10, wins: 60 },
      ],
      abilityValuations: { '1': 0.125, '2': -0.04 },
    }

    expect(buildAbilityTierList(snapshot, 'all')).toHaveLength(3)
    expect(buildAbilityTierList(snapshot, 'ultimates').map((entry) => entry.ability.id)).toEqual([2])
    expect(buildAbilityTierList(snapshot, 'heroes').map((entry) => entry.ability.id)).toEqual([1])
    expect(buildAbilityTierList(snapshot, 'abilities').map((entry) => entry.ability.id)).toEqual([3])
    expect(buildAbilityTierList(snapshot, 'heroes')[0].value).toBe(0.125)
    expect(buildAbilityTierList(snapshot, 'ultimates')[0].value).toBe(-0.04)
    expect(matchesTierCategory(snapshot.abilities[0], 'heroes')).toBe(true)
    expect(matchesTierCategory(snapshot.abilities[0], 'abilities')).toBe(false)
  })

  it('assigns Windrun percentile bands from the sorted rank', () => {
    expect(tierForRank(2, 100)).toBe('S')
    expect(tierForRank(3, 100)).toBe('A')
    expect(tierForRank(9, 100)).toBe('A')
    expect(tierForRank(10, 100)).toBe('B')
    expect(tierForRank(24, 100)).toBe('B')
    expect(tierForRank(25, 100)).toBe('C')
    expect(tierForRank(50, 100)).toBe('D')
    expect(tierForRank(75, 100)).toBe('E')
    expect(tierForRank(90, 100)).toBe('F')
    expect(tierForRank(18, 636)).toBe('S')
    expect(tierForRank(19, 636)).toBe('A')
  })

  it('sorts by raw win rate before assigning tiers', () => {
    const snapshot: Snapshot = {
      ...demoSnapshot,
      abilities: [
        { id: 1, name: 'Lower', shortName: 'lower', isUltimate: false, iconColor: '#111111' },
        { id: 2, name: 'Higher', shortName: 'higher', isUltimate: false, iconColor: '#222222' },
      ],
      abilityStats: [
        { abilityId: 1, picks: 100, avgPickPosition: 1, wins: 55 },
        { abilityId: 2, picks: 100, avgPickPosition: 50, wins: 65 },
      ],
    }
    const entries = buildAbilityTierList(snapshot)

    expect(entries.map((entry) => entry.ability.name)).toEqual(['Higher', 'Lower'])
    expect(entries[0]).toMatchObject({ rank: 1, tier: 'C' })
    expect(entries[1]).toMatchObject({ rank: 2, tier: 'F' })
  })
})
