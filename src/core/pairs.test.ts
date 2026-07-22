import { describe, expect, it } from 'vitest'
import { buildAbilityPairList } from './pairs'
import { demoSnapshot } from '../data/demoSnapshot'
import type { Snapshot } from '../types'

describe('buildAbilityPairList', () => {
  it('calculates pair win rate and arithmetic-mean synergy', () => {
    const rows = buildAbilityPairList(demoSnapshot)
    const row = rows.find((entry) => entry.key === '5048-8158')

    expect(row?.pairWinRate).toBeCloseTo(98 / 160)
    expect(row?.synergy).toBeCloseTo(98 / 160 - ((506 / 940) + (488 / 910)) / 2)
  })

  it('removes same-owner pairs and keeps pairs with missing base stats', () => {
    const snapshot: Snapshot = {
      ...demoSnapshot,
      abilities: [
        { id: 1, name: 'First', shortName: 'first', ownerHeroId: 7, isUltimate: false, iconColor: '#111111' },
        { id: 2, name: 'Second', shortName: 'second', ownerHeroId: 7, isUltimate: false, iconColor: '#222222' },
        { id: 3, name: 'Third', shortName: 'third', isUltimate: false, iconColor: '#333333' },
      ],
      abilityStats: [{ abilityId: 1, picks: 100, avgPickPosition: 1, wins: 50 }],
      pairStats: [
        { abilityIdOne: 1, abilityIdTwo: 2, picks: 100, wins: 50 },
        { abilityIdOne: 1, abilityIdTwo: 3, picks: 100, wins: 60 },
      ],
    }

    expect(buildAbilityPairList(snapshot, { excludeSameHero: true }).map((entry) => entry.key)).toEqual(['1-3'])
    expect(buildAbilityPairList(snapshot, { excludeSameHero: true })[0].synergy).toBeUndefined()
  })

  it('derives hidden triples and applies the comparable sample threshold', () => {
    const snapshot: Snapshot = {
      ...demoSnapshot,
      abilities: [
        { id: 1, name: 'First', shortName: 'first', ownerHeroId: 7, isUltimate: false, iconColor: '#111111' },
        { id: 2, name: 'Second', shortName: 'second', ownerHeroId: 8, isUltimate: false, iconColor: '#222222' },
        { id: 3, name: 'Third', shortName: 'third', isUltimate: false, iconColor: '#333333' },
      ],
      abilityStats: [
        { abilityId: 1, picks: 100, avgPickPosition: 1, wins: 50 },
        { abilityId: 2, picks: 100, avgPickPosition: 2, wins: 50 },
      ],
      pairStats: [{ abilityIdOne: 1, abilityIdTwo: 2, picks: 100, wins: 50 }],
      tripletStats: [{ abilityIdOne: 1, abilityIdTwo: 2, abilityIdThree: 3, picks: 80, wins: 48 }],
    }

    const [row] = buildAbilityPairList(snapshot)
    expect(row.hiddenTriples[0]).toMatchObject({ ability: snapshot.abilities[2], picks: 80, winRate: 0.6 })
    expect(row.hiddenTriples[0].winRateShift).toBeCloseTo(10)

    const sameOwnerSnapshot: Snapshot = {
      ...snapshot,
      abilities: snapshot.abilities.map((ability) => ability.id === 3 ? { ...ability, ownerHeroId: 7 } : ability),
    }
    expect(buildAbilityPairList(sameOwnerSnapshot, { excludeSameHero: true })[0].hiddenTriples).toEqual([])
  })

  it('ignores pairs below the public minimum sample size', () => {
    const snapshot: Snapshot = {
      ...demoSnapshot,
      pairStats: [{ abilityIdOne: 5048, abilityIdTwo: 8158, picks: 49, wins: 30 }],
    }

    expect(buildAbilityPairList(snapshot)).toEqual([])
  })
})
