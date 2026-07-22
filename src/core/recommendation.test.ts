import { describe, expect, it } from 'vitest'
import { MAX_COMBINATION_EVALUATIONS, recommendBuilds, type BuildCandidatePools } from './recommendation'
import type { Ability, Snapshot } from '../types'

function ability(id: number, name: string, options: Pick<Ability, 'isHero' | 'isUltimate'>): Ability {
  return { id, name, shortName: name.toLowerCase().replaceAll(' ', '_'), iconColor: '#888888', ...options }
}

const candidatePools: BuildCandidatePools = {
  heroIds: [-1, -2],
  normalIds: [1, 2, 3, 4],
  ultimateIds: [10, 11],
}

const snapshot: Snapshot = {
  version: 'test',
  patch: 'test',
  generatedAt: '2026-07-22T00:00:00.000Z',
  source: 'test fixture',
  heroes: [],
  abilities: [
    ability(-1, 'Top Hero', { isHero: true, isUltimate: false }),
    ability(-2, 'Lower Hero', { isHero: true, isUltimate: false }),
    ability(1, 'Top Normal', { isHero: false, isUltimate: false }),
    ability(2, 'Second Normal', { isHero: false, isUltimate: false }),
    ability(3, 'Third Normal', { isHero: false, isUltimate: false }),
    ability(4, 'Lower Normal', { isHero: false, isUltimate: false }),
    ability(10, 'Top Ultimate', { isHero: false, isUltimate: true }),
    ability(11, 'Lower Ultimate', { isHero: false, isUltimate: true }),
  ],
  abilityStats: [
    [-1, 60], [-2, 50], [1, 65], [2, 60], [3, 55], [4, 50], [10, 62], [11, 50],
  ].map(([abilityId, wins], index) => ({ abilityId, picks: 100, wins, avgPickPosition: index + 1 })),
  pairStats: [],
}

describe('build recommendations', () => {
  it('builds exactly one hero, three normal skills, and one ultimate', () => {
    const [result] = recommendBuilds(candidatePools, [], snapshot)

    expect(result.abilityIds).toHaveLength(5)
    expect(result.abilityIds[0]).toBe(-1)
    expect(result.abilityIds.slice(1, 4)).toEqual([1, 2, 3])
    expect(result.abilityIds[4]).toBe(10)
    expect(result.abilityWinRate).toBeGreaterThan(0)
  })

  it('retains locked picks within their required categories', () => {
    const [result] = recommendBuilds(candidatePools, [-2, 4, 10], snapshot)

    expect(result.abilityIds).toHaveLength(5)
    expect(result.abilityIds[0]).toBe(-2)
    expect(result.abilityIds.slice(1, 4)).toContain(4)
    expect(result.abilityIds[4]).toBe(10)
    expect(result.pickOrderIds).toEqual([-2, 1, 2, 4, 10])
  })

  it('keeps the arithmetic-mean pair lift while shrinking its score contribution by confidence', () => {
    const pairSnapshot: Snapshot = {
      ...snapshot,
      pairStats: [{ abilityIdOne: -1, abilityIdTwo: 1, picks: 100, wins: 80 }],
    }
    const fixedPools: BuildCandidatePools = {
      heroIds: [-1],
      normalIds: [1, 2, 3],
      ultimateIds: [10],
    }
    const [result] = recommendBuilds(fixedPools, [], pairSnapshot)
    const expectedSynergy = 0.8 - (0.6 + 0.65) / 2

    expect(result.synergy).toBeGreaterThan(0)
    expect(result.synergy).toBeLessThan(expectedSynergy)
    expect(result.effectiveInteractionCount).toBe(1)
    expect(result.effectiveInteractions).toEqual([expect.objectContaining({ type: 'pair', abilityIds: [-1, 1], rawSynergy: expectedSynergy, picks: 100 })])
  })

  it('uses only non-overlapping interactions in the score', () => {
    const pairSnapshot: Snapshot = {
      ...snapshot,
      pairStats: [
        { abilityIdOne: -1, abilityIdTwo: 1, picks: 500, wins: 400 },
        { abilityIdOne: -1, abilityIdTwo: 2, picks: 500, wins: 425 },
        { abilityIdOne: 2, abilityIdTwo: 3, picks: 500, wins: 375 },
      ],
    }
    const fixedPools: BuildCandidatePools = {
      heroIds: [-1],
      normalIds: [1, 2, 3],
      ultimateIds: [10],
    }
    const [result] = recommendBuilds(fixedPools, [], pairSnapshot)
    const selectedAbilityIds = result.effectiveInteractions.flatMap((interaction) => interaction.abilityIds)

    expect(result.score).toBeCloseTo((result.abilityWinRate + result.synergy) * 100)
    expect(result.effectiveInteractionCount).toBe(2)
    expect(new Set(selectedAbilityIds).size).toBe(selectedAbilityIds.length)
    expect(result.effectiveInteractions.map((interaction) => interaction.abilityIds)).toEqual([[-1, 1], [2, 3]])
  })

  it('selects a strong Triple as one interaction instead of its nested pairs', () => {
    const interactionSnapshot: Snapshot = {
      ...snapshot,
      pairStats: [
        { abilityIdOne: -1, abilityIdTwo: 1, picks: 500, wins: 400 },
        { abilityIdOne: -1, abilityIdTwo: 2, picks: 500, wins: 390 },
      ],
      tripletStats: [{ abilityIdOne: -1, abilityIdTwo: 1, abilityIdThree: 2, picks: 500, wins: 470 }],
    }
    const fixedPools: BuildCandidatePools = {
      heroIds: [-1],
      normalIds: [1, 2, 3],
      ultimateIds: [10],
    }
    const [result] = recommendBuilds(fixedPools, [], interactionSnapshot)

    expect(result.effectiveInteractionCount).toBe(1)
    expect(result.effectiveInteractions).toEqual([expect.objectContaining({ type: 'triple', abilityIds: [-1, 1, 2], picks: 500 })])
  })

  it('does not score an uncertain low-sample Pair lift', () => {
    const pairSnapshot: Snapshot = {
      ...snapshot,
      pairStats: [{ abilityIdOne: -1, abilityIdTwo: 1, picks: 50, wins: 35 }],
    }
    const fixedPools: BuildCandidatePools = {
      heroIds: [-1],
      normalIds: [1, 2, 3],
      ultimateIds: [10],
    }
    const [result] = recommendBuilds(fixedPools, [], pairSnapshot)

    expect(result.synergy).toBe(0)
    expect(result.effectiveInteractionCount).toBe(0)
    expect(result.effectiveInteractions).toEqual([])
  })

  it('allows strong comparable pair data to affect the tier-based ranking', () => {
    const pairDrivenSnapshot: Snapshot = {
      ...snapshot,
      pairStats: [{ abilityIdOne: -2, abilityIdTwo: 1, picks: 100, wins: 100 }],
    }
    const [result] = recommendBuilds(candidatePools, [], pairDrivenSnapshot)

    expect(result.abilityIds[0]).toBe(-2)
  })

  it('does not emit plans when any required pick category is unavailable', () => {
    expect(recommendBuilds({ ...candidatePools, ultimateIds: [] }, [], snapshot)).toEqual([])
  })

  it('ignores unknown or category-invalid locked IDs', () => {
    const [result] = recommendBuilds(candidatePools, [999999, 1, 10], snapshot)

    expect(result.abilityIds).toHaveLength(5)
    expect(result.abilityIds).not.toContain(999999)
    expect(result.abilityIds[0]).toBe(-1)
  })

  it('shortlists large category pools before evaluating builds', () => {
    const largeSnapshot: Snapshot = {
      ...snapshot,
      abilities: [
        ...Array.from({ length: 12 }, (_, index) => ability(-index - 1, `Hero ${index + 1}`, { isHero: true, isUltimate: false })),
        ...Array.from({ length: 60 }, (_, index) => ability(index + 1, `Normal ${index + 1}`, { isHero: false, isUltimate: false })),
        ...Array.from({ length: 12 }, (_, index) => ability(index + 101, `Ultimate ${index + 1}`, { isHero: false, isUltimate: true })),
      ],
      abilityStats: [
        ...Array.from({ length: 12 }, (_, index) => ({ abilityId: -index - 1, picks: 100, wins: 60 - index, avgPickPosition: index + 1 })),
        ...Array.from({ length: 60 }, (_, index) => ({ abilityId: index + 1, picks: 100, wins: 80 - index, avgPickPosition: index + 1 })),
        ...Array.from({ length: 12 }, (_, index) => ({ abilityId: index + 101, picks: 100, wins: 60 - index, avgPickPosition: index + 1 })),
      ],
      pairStats: [],
    }
    const results = recommendBuilds({
      heroIds: Array.from({ length: 12 }, (_, index) => -index - 1),
      normalIds: Array.from({ length: 60 }, (_, index) => index + 1),
      ultimateIds: Array.from({ length: 12 }, (_, index) => index + 101),
    }, [], largeSnapshot)

    expect(MAX_COMBINATION_EVALUATIONS).toBe(50_000)
    expect(results).toHaveLength(10)
    expect(results.every((result) => result.abilityIds.length === 5)).toBe(true)
  })

  it('returns no results for a non-positive result limit', () => {
    expect(recommendBuilds(candidatePools, [], snapshot, 0)).toEqual([])
  })
})
