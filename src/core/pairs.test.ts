import { describe, expect, it } from 'vitest'
import { buildAbilityPairList } from './pairs'
import { demoSnapshot } from '../data/demoSnapshot'
import type { Snapshot } from '../types'

describe('buildAbilityPairList', () => {
  it('calculates pair win rate, geometric-mean synergy, and logit true synergy', () => {
    const rows = buildAbilityPairList(demoSnapshot)
    const row = rows.find((entry) => entry.key === '5048-8158')
    const leftWinRate = 506 / 940
    const rightWinRate = 488 / 910
    const expectedPairWinRate = 1 / (1 + Math.exp(-(
      Math.log(leftWinRate / (1 - leftWinRate))
      + Math.log(rightWinRate / (1 - rightWinRate))
    )))

    expect(row?.pairWinRate).toBeCloseTo(98 / 160)
    expect(row?.synergy).toBeCloseTo(98 / 160 - Math.sqrt(leftWinRate * rightWinRate))
    expect(row?.trueSynergy).toBeCloseTo(98 / 160 - expectedPairWinRate)
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
    expect(buildAbilityPairList(snapshot, { excludeSameHero: true })[0].trueSynergy).toBeUndefined()
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

  it('keeps the highest-sample record for duplicate Pair and Triple keys', () => {
    const snapshot: Snapshot = {
      ...demoSnapshot,
      abilities: [
        { id: 1, name: 'First', shortName: 'first', isUltimate: false, iconColor: '#111111' },
        { id: 2, name: 'Second', shortName: 'second', isUltimate: false, iconColor: '#222222' },
        { id: 3, name: 'Third', shortName: 'third', isUltimate: false, iconColor: '#333333' },
      ],
      abilityStats: [
        { abilityId: 1, picks: 100, avgPickPosition: 1, wins: 50 },
        { abilityId: 2, picks: 100, avgPickPosition: 2, wins: 50 },
        { abilityId: 3, picks: 100, avgPickPosition: 3, wins: 50 },
      ],
      pairStats: [
        { abilityIdOne: 1, abilityIdTwo: 2, picks: 60, wins: 30 },
        { abilityIdOne: 2, abilityIdTwo: 1, picks: 100, wins: 70 },
      ],
      tripletStats: [
        { abilityIdOne: 1, abilityIdTwo: 2, abilityIdThree: 3, picks: 70, wins: 35 },
        { abilityIdOne: 3, abilityIdTwo: 1, abilityIdThree: 2, picks: 110, wins: 77 },
      ],
    }

    const [row] = buildAbilityPairList(snapshot)
    expect(row).toMatchObject({ key: '1-2', picks: 100, wins: 70 })
    expect(row.hiddenTriples).toEqual([expect.objectContaining({ ability: snapshot.abilities[2], picks: 110, winRate: 0.7 })])
  })

  it('drops invalid Pair and Triple win records before indexing them', () => {
    const snapshot: Snapshot = {
      ...demoSnapshot,
      abilities: [
        { id: 1, name: 'First', shortName: 'first', isUltimate: false, iconColor: '#111111' },
        { id: 2, name: 'Second', shortName: 'second', isUltimate: false, iconColor: '#222222' },
        { id: 3, name: 'Third', shortName: 'third', isUltimate: false, iconColor: '#333333' },
      ],
      abilityStats: [
        { abilityId: 1, picks: 100, avgPickPosition: 1, wins: 50 },
        { abilityId: 2, picks: 100, avgPickPosition: 2, wins: 50 },
        { abilityId: 3, picks: 100, avgPickPosition: 3, wins: 50 },
      ],
      pairStats: [
        { abilityIdOne: 1, abilityIdTwo: 2, picks: 60, wins: 30 },
        { abilityIdOne: 1, abilityIdTwo: 2, picks: 100, wins: 101 },
      ],
      tripletStats: [
        { abilityIdOne: 1, abilityIdTwo: 2, abilityIdThree: 3, picks: 70, wins: 35 },
        { abilityIdOne: 1, abilityIdTwo: 2, abilityIdThree: 3, picks: 110, wins: -1 },
      ],
    }

    const [row] = buildAbilityPairList(snapshot)
    expect(row).toMatchObject({ key: '1-2', picks: 60, wins: 30 })
    expect(row.hiddenTriples).toEqual([expect.objectContaining({ picks: 70, winRate: 0.5 })])
  })
})
