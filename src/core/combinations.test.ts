import { describe, expect, it } from 'vitest'
import {
  collectConfirmedCombinationCandidateIds,
  DEFAULT_COMBINATION_RECOMMENDATION_OPTIONS,
  MAX_COMBINATION_RECOMMENDATIONS,
  normalizeCombinationRecommendationOptions,
  recommendAbilityCombinations,
} from './combinations'
import type { Ability, RecognizedSlot, Snapshot } from '../types'

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

const snapshot: Snapshot = {
  version: 'test',
  patch: 'test',
  generatedAt: '2026-07-27T00:00:00.000Z',
  source: 'test fixture',
  heroes: [],
  abilities: [
    ability(-1, 'Hero', { isHero: true, isUltimate: false }),
    ability(1, 'First Ability', { isHero: false, isUltimate: false }),
    ability(2, 'Second Ability', { isHero: false, isUltimate: false }),
    ability(3, 'Third Ability', { isHero: false, isUltimate: false }),
  ],
  abilityStats: [-1, 1, 2, 3].map((abilityId, index) => ({
    abilityId,
    picks: 100,
    avgPickPosition: index + 1,
    wins: 50 + index,
  })),
  pairStats: [
    { abilityIdOne: -1, abilityIdTwo: 1, picks: 100, wins: 80 },
    { abilityIdOne: 1, abilityIdTwo: 2, picks: 49, wins: 48 },
  ],
  tripletStats: [
    {
      abilityIdOne: -1,
      abilityIdTwo: 1,
      abilityIdThree: 2,
      picks: 100,
      wins: 90,
    },
  ],
}

describe('ability combination recommendations', () => {
  it('uses only confirmed recognition values as combination candidates', () => {
    const slots: RecognizedSlot[] = [
      {
        index: 0,
        category: 'ability',
        rect: { x: 0, y: 0, width: 10, height: 10 },
        crop: { x: 0, y: 0, width: 10, height: 10 },
        candidates: [
          { abilityId: 1, score: 0.1 },
          { abilityId: 2, score: 0.2 },
          { abilityId: 3, score: 0.3 },
        ],
        selectedAbilityId: 2,
      },
      {
        index: 1,
        category: 'ability',
        rect: { x: 10, y: 0, width: 10, height: 10 },
        crop: { x: 10, y: 0, width: 10, height: 10 },
        candidates: [
          { abilityId: 4, score: 0.1 },
          { abilityId: 5, score: 0.2 },
        ],
      },
      {
        index: 2,
        category: 'ability',
        rect: { x: 20, y: 0, width: 10, height: 10 },
        crop: { x: 20, y: 0, width: 10, height: 10 },
        candidates: [{ abilityId: 2, score: 0.1 }],
        selectedAbilityId: 2,
      },
    ]

    expect(collectConfirmedCombinationCandidateIds(slots)).toEqual([2])
  })

  it('ranks eligible Pair and Triple records from the current candidates', () => {
    const recommendations = recommendAbilityCombinations(
      [-1, 1, 2, 3],
      [-1, 1],
      snapshot,
    )

    expect(
      recommendations.map((recommendation) => recommendation.type),
    ).toEqual(['triple', 'pair'])
    expect(recommendations[0]).toMatchObject({
      type: 'triple',
      abilityIds: [-1, 1, 2],
      score: 90,
      picks: 100,
      selectedCount: 2,
    })
    expect(recommendations[1]).toMatchObject({
      type: 'pair',
      abilityIds: [-1, 1],
      score: 80,
      selectedCount: 2,
    })
  })

  it('keeps selected IDs eligible and applies the 50-pick threshold', () => {
    const recommendations = recommendAbilityCombinations(
      [2, 3],
      [-1, 1],
      snapshot,
    )

    expect(recommendations).toHaveLength(2)
    expect(
      recommendations.map((recommendation) => recommendation.abilityIds),
    ).toEqual(
      expect.arrayContaining([
        [-1, 1],
        [-1, 1, 2],
      ]),
    )
    expect(
      recommendations.map((recommendation) => recommendation.abilityIds),
    ).not.toContainEqual([1, 2])
  })

  it('does not expose invalid or unavailable combination records', () => {
    expect(
      recommendAbilityCombinations([-1, 1, 2], [], {
        ...snapshot,
        tripletStats: [
          {
            abilityIdOne: -1,
            abilityIdTwo: 1,
            abilityIdThree: 999,
            picks: 100,
            wins: 90,
          },
        ],
      }),
    ).toEqual([expect.objectContaining({ type: 'pair', abilityIds: [-1, 1] })])
  })

  it('applies configurable win-rate and synergy thresholds to Pair and Triple entries', () => {
    const thresholdSnapshot: Snapshot = {
      ...snapshot,
      pairStats: [
        ...snapshot.pairStats,
        { abilityIdOne: 2, abilityIdTwo: 3, picks: 100, wins: 56 },
      ],
    }

    expect(
      recommendAbilityCombinations([-1, 1, 2, 3], [], thresholdSnapshot).map(
        (recommendation) => recommendation.abilityIds,
      ),
    ).not.toContainEqual([2, 3])

    expect(
      recommendAbilityCombinations([-1, 1, 2, 3], [], thresholdSnapshot, {
        minWinRate: 0.55,
        minSynergy: 0.005,
      }).map((recommendation) => recommendation.abilityIds),
    ).toContainEqual([2, 3])
  })

  it('uses strict greater-than comparisons for both configurable thresholds', () => {
    const all = recommendAbilityCombinations([-1, 1, 2, 3], [], snapshot, {
      minWinRate: 0,
      minSynergy: -1,
    })
    const pair = all.find((recommendation) => recommendation.type === 'pair')!

    expect(
      recommendAbilityCombinations([-1, 1, 2, 3], [], snapshot, {
        minWinRate: pair.winRate,
        minSynergy: -1,
      }),
    ).not.toContainEqual(pair)
    expect(
      recommendAbilityCombinations([-1, 1, 2, 3], [], snapshot, {
        minWinRate: 0,
        minSynergy: pair.synergy,
      }),
    ).not.toContainEqual(pair)
  })

  it('normalizes persisted recommendation options', () => {
    expect(DEFAULT_COMBINATION_RECOMMENDATION_OPTIONS.limit).toBe(
      MAX_COMBINATION_RECOMMENDATIONS,
    )
    expect(normalizeCombinationRecommendationOptions({})).toEqual(
      DEFAULT_COMBINATION_RECOMMENDATION_OPTIONS,
    )
    expect(
      normalizeCombinationRecommendationOptions({
        limit: 4.9,
        minWinRate: 0.6,
        minSynergy: 0.08,
      }),
    ).toEqual({ limit: 4, minWinRate: 0.6, minSynergy: 0.08 })
    expect(normalizeCombinationRecommendationOptions({ limit: 31 }).limit).toBe(
      MAX_COMBINATION_RECOMMENDATIONS,
    )
  })
})
