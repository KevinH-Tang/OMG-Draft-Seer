import { describe, expect, it } from 'vitest'
import {
  recommendBuilds,
  scoreDraftBuild,
  type BuildCandidatePools,
} from './recommendation'
import {
  calculateCombinedLogit,
  calculateLogit,
  calculateLogitBase,
  calculateSigmoid,
} from './pairs'
import type { Ability, Snapshot } from '../types'

function ability(
  id: number,
  name: string,
  options: Pick<Ability, 'isHero' | 'isUltimate'>,
): Ability {
  return {
    id,
    name,
    shortName: name.toLowerCase().replaceAll(' ', '_'),
    iconColor: '#888888',
    ...options,
  }
}

const candidatePools: BuildCandidatePools = {
  heroIds: [-1, -2],
  abilityIds: [1, 2, 3, 4],
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
    ability(1, 'Top Ability', { isHero: false, isUltimate: false }),
    ability(2, 'Second Ability', { isHero: false, isUltimate: false }),
    ability(3, 'Third Ability', { isHero: false, isUltimate: false }),
    ability(4, 'Lower Ability', { isHero: false, isUltimate: false }),
    ability(10, 'Top Ultimate', { isHero: false, isUltimate: true }),
    ability(11, 'Lower Ultimate', { isHero: false, isUltimate: true }),
  ],
  abilityStats: [
    [-1, 60],
    [-2, 50],
    [1, 65],
    [2, 60],
    [3, 55],
    [4, 50],
    [10, 62],
    [11, 50],
  ].map(([abilityId, wins], index) => ({
    abilityId,
    picks: 100,
    wins,
    avgPickPosition: index + 1,
  })),
  pairStats: [],
}

describe('build recommendations', () => {
  it('scores a completed draft build with the same metrics as page one', () => {
    const fixedPools: BuildCandidatePools = {
      heroIds: [-1],
      abilityIds: [1, 2, 3],
      ultimateIds: [10],
    }
    const [recommended] = recommendBuilds(fixedPools, [], snapshot)
    const scored = scoreDraftBuild([1, 10, -1, 3, 2], snapshot)

    expect(scored?.abilityIds).toEqual([-1, 1, 3, 2, 10])
    expect(scored?.pickOrderIds).toEqual([-1, 1, 3, 2, 10])
    expect(scored).toMatchObject({
      score: recommended.score,
      abilityWinRate: recommended.abilityWinRate,
      logitSynergy: recommended.logitSynergy,
    })
    expect(scoreDraftBuild([-1, 1, 2, 10], snapshot)).toBeUndefined()
  })

  it('builds exactly one hero, three abilities, and one ultimate', () => {
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

  it('uses the raw logit base and Pair delta after the 50-pick filter', () => {
    const pairSnapshot: Snapshot = {
      ...snapshot,
      pairStats: [{ abilityIdOne: -1, abilityIdTwo: 1, picks: 100, wins: 90 }],
    }
    const fixedPools: BuildCandidatePools = {
      heroIds: [-1],
      abilityIds: [1, 2, 3],
      ultimateIds: [10],
    }
    const [result] = recommendBuilds(fixedPools, [], pairSnapshot)
    const expectedPairBase = calculateCombinedLogit([0.6, 0.65])!
    const expectedRawLogitSynergy = calculateLogit(0.9)! - expectedPairBase
    const expectedBase = calculateLogitBase([0.6, 0.65, 0.6, 0.55, 0.62])!

    expect(result.abilityWinRate).toBeCloseTo(expectedBase)
    expect(result.synergy).toBeGreaterThan(0)
    expect(result.logitSynergy).toBeGreaterThan(0)
    expect(result.effectiveInteractionCount).toBe(1)
    expect(result.effectiveInteractions).toEqual([
      expect.objectContaining({
        type: 'pair',
        abilityIds: [-1, 1],
        rawLogitSynergy: expectedRawLogitSynergy,
        picks: 100,
      }),
    ])
  })

  it('includes every non-zero Pair delta even when interactions share abilities', () => {
    const pairSnapshot: Snapshot = {
      ...snapshot,
      pairStats: [
        { abilityIdOne: -1, abilityIdTwo: 1, picks: 500, wins: 470 },
        { abilityIdOne: -1, abilityIdTwo: 2, picks: 500, wins: 475 },
        { abilityIdOne: 2, abilityIdTwo: 3, picks: 500, wins: 450 },
      ],
    }
    const fixedPools: BuildCandidatePools = {
      heroIds: [-1],
      abilityIds: [1, 2, 3],
      ultimateIds: [10],
    }
    const [result] = recommendBuilds(fixedPools, [], pairSnapshot)
    const selectedAbilityIds = result.effectiveInteractions.flatMap(
      (interaction) => interaction.abilityIds,
    )

    const baseLogit = calculateCombinedLogit([0.6, 0.65, 0.6, 0.55, 0.62])!
    expect(result.score).toBeCloseTo(
      calculateSigmoid(baseLogit + result.logitSynergy) * 100,
    )
    expect(result.effectiveInteractionCount).toBe(3)
    expect(new Set(selectedAbilityIds).size).toBeLessThan(
      selectedAbilityIds.length,
    )
    expect(
      result.effectiveInteractions.map((interaction) => interaction.abilityIds),
    ).toEqual(
      expect.arrayContaining([
        [-1, 1],
        [-1, 2],
        [2, 3],
      ]),
    )
  })

  it('includes a Triple increment alongside its nested Pair deltas', () => {
    const interactionSnapshot: Snapshot = {
      ...snapshot,
      pairStats: [
        { abilityIdOne: -1, abilityIdTwo: 1, picks: 500, wins: 420 },
        { abilityIdOne: -1, abilityIdTwo: 2, picks: 500, wins: 420 },
        { abilityIdOne: 1, abilityIdTwo: 2, picks: 500, wins: 430 },
      ],
      tripletStats: [
        {
          abilityIdOne: -1,
          abilityIdTwo: 1,
          abilityIdThree: 2,
          picks: 500,
          wins: 490,
        },
      ],
    }
    const fixedPools: BuildCandidatePools = {
      heroIds: [-1],
      abilityIds: [1, 2, 3],
      ultimateIds: [10],
    }
    const [result] = recommendBuilds(fixedPools, [], interactionSnapshot)

    expect(result.effectiveInteractionCount).toBe(4)
    expect(result.effectiveInteractions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'pair',
          abilityIds: [-1, 1],
          picks: 500,
        }),
        expect.objectContaining({
          type: 'pair',
          abilityIds: [-1, 2],
          picks: 500,
        }),
        expect.objectContaining({
          type: 'pair',
          abilityIds: [1, 2],
          picks: 500,
        }),
        expect.objectContaining({
          type: 'triple',
          abilityIds: [-1, 1, 2],
          picks: 500,
        }),
      ]),
    )
  })

  it('keeps a partial Triple out of the score and exposes its Pair coverage', () => {
    const partialSnapshot: Snapshot = {
      ...snapshot,
      pairStats: [
        { abilityIdOne: -1, abilityIdTwo: 1, picks: 500, wins: 420 },
        { abilityIdOne: -1, abilityIdTwo: 2, picks: 500, wins: 420 },
      ],
      tripletStats: [
        {
          abilityIdOne: -1,
          abilityIdTwo: 1,
          abilityIdThree: 2,
          picks: 500,
          wins: 490,
        },
      ],
    }
    const fixedPools: BuildCandidatePools = {
      heroIds: [-1],
      abilityIds: [1, 2, 3],
      ultimateIds: [10],
    }
    const [result] = recommendBuilds(fixedPools, [], partialSnapshot)

    expect(result.effectiveInteractionCount).toBe(2)
    expect(
      result.effectiveInteractions.every(
        (interaction) => interaction.type === 'pair',
      ),
    ).toBe(true)
    expect(result.partialInteractions).toEqual([
      expect.objectContaining({
        type: 'triple',
        abilityIds: [-1, 1, 2],
        pairCoverage: 2,
        missingPairIds: [[1, 2]],
        picks: 500,
      }),
    ])
  })

  it('includes a negative Pair delta in the score', () => {
    const fixedPools: BuildCandidatePools = {
      heroIds: [-1],
      abilityIds: [1, 2, 3],
      ultimateIds: [10],
    }
    const neutral = recommendBuilds(fixedPools, [], snapshot)[0]
    const negative = recommendBuilds(fixedPools, [], {
      ...snapshot,
      pairStats: [{ abilityIdOne: -1, abilityIdTwo: 1, picks: 500, wins: 100 }],
    })[0]
    const [interaction] = negative.effectiveInteractions

    expect(negative.score).toBeLessThan(neutral.score)
    expect(interaction).toEqual(
      expect.objectContaining({ type: 'pair', abilityIds: [-1, 1] }),
    )
    expect(interaction.synergy).toBeLessThan(0)
    expect(interaction.logitSynergy).toBeLessThan(0)
  })

  it('keeps the highest valid individual-stat record', () => {
    const result = recommendBuilds(
      {
        heroIds: [-1],
        abilityIds: [1, 2, 3],
        ultimateIds: [10],
      },
      [],
      {
        ...snapshot,
        abilityStats: [
          ...snapshot.abilityStats,
          { abilityId: -1, picks: 200, wins: 250, avgPickPosition: 1 },
        ],
        pairStats: [
          { abilityIdOne: -1, abilityIdTwo: 1, picks: 500, wins: 450 },
        ],
      },
    )[0]

    expect(result.effectiveInteractionCount).toBe(1)
    expect(result.effectiveInteractions[0].abilityIds).toEqual([-1, 1])
  })

  it('filters a Pair below the 50-pick minimum', () => {
    const pairSnapshot: Snapshot = {
      ...snapshot,
      pairStats: [{ abilityIdOne: -1, abilityIdTwo: 1, picks: 49, wins: 34 }],
    }
    const fixedPools: BuildCandidatePools = {
      heroIds: [-1],
      abilityIds: [1, 2, 3],
      ultimateIds: [10],
    }
    const [result] = recommendBuilds(fixedPools, [], pairSnapshot)

    expect(result.synergy).toBe(0)
    expect(result.effectiveInteractionCount).toBe(0)
    expect(result.effectiveInteractions).toEqual([])
  })

  it('uses strong Pair data when prioritizing candidate pools', () => {
    const pairDrivenSnapshot: Snapshot = {
      ...snapshot,
      pairStats: [{ abilityIdOne: -2, abilityIdTwo: 1, picks: 100, wins: 99 }],
    }
    const [result] = recommendBuilds(candidatePools, [], pairDrivenSnapshot)

    expect(result.abilityIds[0]).toBe(-2)
  })

  it('does not emit plans when any required pick category is unavailable', () => {
    expect(
      recommendBuilds({ ...candidatePools, ultimateIds: [] }, [], snapshot),
    ).toEqual([])
  })

  it('ignores unknown or category-invalid locked IDs', () => {
    const invalidCategoryPools: BuildCandidatePools = {
      heroIds: [-2],
      abilityIds: [-1, 1, 2, 3],
      ultimateIds: [10],
    }
    const [result] = recommendBuilds(
      invalidCategoryPools,
      [999999, -1, 10],
      snapshot,
    )

    expect(result.abilityIds).toHaveLength(5)
    expect(result.abilityIds).not.toContain(999999)
    expect(result.abilityIds).not.toContain(-1)
    expect(result.abilityIds[0]).toBe(-2)
  })

  it('shortlists large category pools before evaluating builds', () => {
    const largeSnapshot: Snapshot = {
      ...snapshot,
      abilities: [
        ...Array.from({ length: 12 }, (_, index) =>
          ability(-index - 1, `Hero ${index + 1}`, {
            isHero: true,
            isUltimate: false,
          }),
        ),
        ...Array.from({ length: 60 }, (_, index) =>
          ability(index + 1, `Ability ${index + 1}`, {
            isHero: false,
            isUltimate: false,
          }),
        ),
        ...Array.from({ length: 12 }, (_, index) =>
          ability(index + 101, `Ultimate ${index + 1}`, {
            isHero: false,
            isUltimate: true,
          }),
        ),
      ],
      abilityStats: [
        ...Array.from({ length: 12 }, (_, index) => ({
          abilityId: -index - 1,
          picks: 100,
          wins: 60 - index,
          avgPickPosition: index + 1,
        })),
        ...Array.from({ length: 60 }, (_, index) => ({
          abilityId: index + 1,
          picks: 100,
          wins: 80 - index,
          avgPickPosition: index + 1,
        })),
        ...Array.from({ length: 12 }, (_, index) => ({
          abilityId: index + 101,
          picks: 100,
          wins: 60 - index,
          avgPickPosition: index + 1,
        })),
      ],
      pairStats: [],
    }
    const results = recommendBuilds(
      {
        heroIds: Array.from({ length: 12 }, (_, index) => -index - 1),
        abilityIds: Array.from({ length: 60 }, (_, index) => index + 1),
        ultimateIds: Array.from({ length: 12 }, (_, index) => index + 101),
      },
      [],
      largeSnapshot,
    )

    expect(results).toHaveLength(10)
    expect(results.every((result) => result.abilityIds.length === 5)).toBe(true)
  })

  it('keeps a lower-tier candidate whose Triple contribution is strong', () => {
    const largeSnapshot: Snapshot = {
      ...snapshot,
      abilities: [
        ...Array.from({ length: 12 }, (_, index) =>
          ability(-index - 1, `Hero ${index + 1}`, {
            isHero: true,
            isUltimate: false,
          }),
        ),
        ...Array.from({ length: 60 }, (_, index) =>
          ability(index + 1, `Ability ${index + 1}`, {
            isHero: false,
            isUltimate: false,
          }),
        ),
        ...Array.from({ length: 12 }, (_, index) =>
          ability(index + 101, `Ultimate ${index + 1}`, {
            isHero: false,
            isUltimate: true,
          }),
        ),
      ],
      abilityStats: [
        ...Array.from({ length: 12 }, (_, index) => ({
          abilityId: -index - 1,
          picks: 100,
          wins: 60 - index,
          avgPickPosition: index + 1,
        })),
        ...Array.from({ length: 60 }, (_, index) => ({
          abilityId: index + 1,
          picks: 100,
          wins: 80 - index,
          avgPickPosition: index + 1,
        })),
        ...Array.from({ length: 12 }, (_, index) => ({
          abilityId: index + 101,
          picks: 100,
          wins: 60 - index,
          avgPickPosition: index + 1,
        })),
      ],
      pairStats: [
        { abilityIdOne: -1, abilityIdTwo: 1, picks: 500, wins: 350 },
        { abilityIdOne: -1, abilityIdTwo: 60, picks: 500, wins: 250 },
        { abilityIdOne: 1, abilityIdTwo: 60, picks: 500, wins: 250 },
      ],
      tripletStats: [
        {
          abilityIdOne: -1,
          abilityIdTwo: 1,
          abilityIdThree: 60,
          picks: 500,
          wins: 499,
        },
      ],
    }
    const results = recommendBuilds(
      {
        heroIds: Array.from({ length: 12 }, (_, index) => -index - 1),
        abilityIds: Array.from({ length: 60 }, (_, index) => index + 1),
        ultimateIds: Array.from({ length: 12 }, (_, index) => index + 101),
      },
      [-1, 1],
      largeSnapshot,
    )

    expect(results.some((result) => result.abilityIds.includes(60))).toBe(true)
  })

  it('returns no results for a non-positive result limit', () => {
    expect(recommendBuilds(candidatePools, [], snapshot, 0)).toEqual([])
  })

  it('clamps scores to the percentage range', () => {
    const perfectSnapshot: Snapshot = {
      ...snapshot,
      abilityStats: snapshot.abilityStats.map((stat) => ({
        ...stat,
        wins: stat.picks,
      })),
    }
    const zeroSnapshot: Snapshot = {
      ...snapshot,
      abilityStats: snapshot.abilityStats.map((stat) => ({ ...stat, wins: 0 })),
    }

    expect(recommendBuilds(candidatePools, [], perfectSnapshot)[0].score).toBe(
      100,
    )
    expect(recommendBuilds(candidatePools, [], zeroSnapshot)[0].score).toBe(0)
  })
})
