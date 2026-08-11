import { describe, expect, it } from 'vitest'
import {
  collectConfirmedCombinationCandidateIds,
  DEFAULT_COMBINATION_RECOMMENDATION_OPTIONS,
  MAX_COMBINATION_RECOMMENDATIONS,
  normalizeCombinationRecommendationOptions,
  rankCombinationAbilityOccurrences,
  recommendAbilityCombinationGroups,
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

  it('groups Triple recommendations under Pair rows and keeps direct Pair rows first', () => {
    const groups = recommendAbilityCombinationGroups([-1, 1, 2, 3], [], {
      ...snapshot,
      tripletStats: [
        ...snapshot.tripletStats!,
        {
          abilityIdOne: -1,
          abilityIdTwo: 1,
          abilityIdThree: 3,
          picks: 100,
          wins: 85,
        },
      ],
    })

    expect(groups[0]).toMatchObject({
      pairAbilityIds: [-1, 1],
      pair: { type: 'pair', score: 80 },
    })
    expect(groups[0].triples.map((triple) => triple.score)).toEqual([90, 85])
    expect(groups).toHaveLength(1)
  })

  it('ranks visible grouped abilities by occurrence count', () => {
    const triple = recommendAbilityCombinations([-1, 1, 2], [], snapshot).find(
      (recommendation) => recommendation.type === 'triple',
    )!
    const rankings = rankCombinationAbilityOccurrences(
      [
        { pairAbilityIds: [-1, 1], triples: [triple] },
        { pairAbilityIds: [-1, 2], triples: [] },
      ],
      snapshot.abilityStats,
      3,
    )

    expect(rankings).toEqual([
      { abilityId: 2, count: 2 },
      { abilityId: -1, count: 2 },
      { abilityId: 1, count: 1 },
    ])
  })

  it('assigns each Triple only to the highest-synergy eligible Pair', () => {
    const groups = recommendAbilityCombinationGroups([-1, 1, 2], [], {
      ...snapshot,
      pairStats: [
        { abilityIdOne: -1, abilityIdTwo: 1, picks: 100, wins: 80 },
        { abilityIdOne: -1, abilityIdTwo: 2, picks: 100, wins: 75 },
        { abilityIdOne: 1, abilityIdTwo: 2, picks: 100, wins: 85 },
      ],
    })
    const owningGroups = groups.filter((group) => group.triples.length > 0)

    expect(owningGroups).toHaveLength(1)
    expect(owningGroups[0].pairAbilityIds).toEqual([1, 2])
    expect(owningGroups[0].triples).toHaveLength(1)
    expect(groups).toHaveLength(1)
  })

  it('prefers Pair synergy over Pair win rate when aggregation counts tie', () => {
    const groups = recommendAbilityCombinationGroups([-1, 1, 2], [], {
      ...snapshot,
      abilityStats: [
        { abilityId: -1, picks: 100, wins: 80, avgPickPosition: 1 },
        { abilityId: 1, picks: 100, wins: 80, avgPickPosition: 2 },
        { abilityId: 2, picks: 100, wins: 20, avgPickPosition: 3 },
      ],
      pairStats: [
        { abilityIdOne: -1, abilityIdTwo: 1, picks: 100, wins: 90 },
        { abilityIdOne: 1, abilityIdTwo: 2, picks: 100, wins: 80 },
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
    })

    expect(groups).toHaveLength(1)
    expect(groups[0].pairAbilityIds).toEqual([1, 2])
    expect(groups[0].pair?.score).toBe(80)
    expect(groups[0].triples).toHaveLength(1)
  })

  it('prioritizes a shared Pair that aggregates multiple Triples', () => {
    const groups = recommendAbilityCombinationGroups([-1, 1, 2, 3], [], {
      ...snapshot,
      pairStats: [
        { abilityIdOne: -1, abilityIdTwo: 1, picks: 100, wins: 80 },
        { abilityIdOne: 1, abilityIdTwo: 2, picks: 49, wins: 48 },
        { abilityIdOne: 2, abilityIdTwo: 3, picks: 100, wins: 75 },
      ],
      tripletStats: [
        {
          abilityIdOne: -1,
          abilityIdTwo: 1,
          abilityIdThree: 2,
          picks: 100,
          wins: 90,
        },
        {
          abilityIdOne: 1,
          abilityIdTwo: 2,
          abilityIdThree: 3,
          picks: 100,
          wins: 85,
        },
      ],
    })
    const owningGroups = groups.filter((group) => group.triples.length > 0)

    expect(owningGroups).toHaveLength(1)
    expect(owningGroups[0].pairAbilityIds).toEqual([1, 2])
    expect(owningGroups[0].pair).toBeUndefined()
    expect(owningGroups[0].triples.map((triple) => triple.score)).toEqual([
      90, 85,
    ])
  })

  it('creates one deterministic Triple-only Pair row when all Pair data is missing', () => {
    const groups = recommendAbilityCombinationGroups([-1, 1, 2], [], {
      ...snapshot,
      pairStats: [],
    })

    expect(groups).toHaveLength(1)
    expect(groups[0].pairAbilityIds).toEqual([-1, 1])
    expect(groups[0].pair).toBeUndefined()
    expect(groups[0].triples).toHaveLength(1)
  })

  it('allows a below-threshold Pair to own an eligible Triple', () => {
    const groups = recommendAbilityCombinationGroups([-1, 1, 2], [], snapshot, {
      ...DEFAULT_COMBINATION_RECOMMENDATION_OPTIONS,
      pairMinWinRate: 0.85,
    })

    expect(groups).toHaveLength(1)
    expect(groups[0].pairAbilityIds).toEqual([-1, 1])
    expect(groups[0].pair?.winRate).toBe(0.8)
    expect(groups[0].triples).toHaveLength(1)
  })

  it('applies Pair thresholds to standalone Pair rows', () => {
    const groups = recommendAbilityCombinationGroups([-1, 1], [], snapshot, {
      ...DEFAULT_COMBINATION_RECOMMENDATION_OPTIONS,
      pairMinWinRate: 0.85,
    })

    expect(groups).toEqual([])
  })

  it('removes a Triple from a Pair row when its win rate is lower than the Pair win rate', () => {
    const groups = recommendAbilityCombinationGroups([-1, 1, 2], [], {
      ...snapshot,
      tripletStats: [
        {
          abilityIdOne: -1,
          abilityIdTwo: 1,
          abilityIdThree: 2,
          picks: 100,
          wins: 70,
        },
      ],
    })
    const directPairGroup = groups.find(
      (group) =>
        group.pairAbilityIds[0] === -1 && group.pairAbilityIds[1] === 1,
    )

    expect(directPairGroup?.pair?.winRate).toBe(0.8)
    expect(directPairGroup?.triples).toEqual([])
    expect(groups).toHaveLength(2)
    expect(
      groups.some(
        (group) =>
          group.pair === undefined &&
          group.triples.some((triple) => triple.winRate === 0.7),
      ),
    ).toBe(true)
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
        ...DEFAULT_COMBINATION_RECOMMENDATION_OPTIONS,
        pairMinWinRate: 0.55,
        pairMinSynergy: 0.005,
      }).map((recommendation) => recommendation.abilityIds),
    ).toContainEqual([2, 3])
  })

  it('uses strict greater-than comparisons for both configurable thresholds', () => {
    const all = recommendAbilityCombinations([-1, 1, 2, 3], [], snapshot, {
      ...DEFAULT_COMBINATION_RECOMMENDATION_OPTIONS,
      pairMinWinRate: 0,
      pairMinSynergy: -1,
      tripleMinWinRate: 0,
      tripleMinSynergy: -1,
    })
    const pair = all.find((recommendation) => recommendation.type === 'pair')!

    expect(
      recommendAbilityCombinations([-1, 1, 2, 3], [], snapshot, {
        ...DEFAULT_COMBINATION_RECOMMENDATION_OPTIONS,
        pairMinWinRate: pair.winRate,
        pairMinSynergy: -1,
      }),
    ).not.toContainEqual(pair)
    expect(
      recommendAbilityCombinations([-1, 1, 2, 3], [], snapshot, {
        ...DEFAULT_COMBINATION_RECOMMENDATION_OPTIONS,
        pairMinWinRate: 0,
        pairMinSynergy: pair.synergy,
      }),
    ).not.toContainEqual(pair)
  })

  it('applies Pair and Triple thresholds independently', () => {
    const pairBlocked = recommendAbilityCombinations(
      [-1, 1, 2, 3],
      [],
      snapshot,
      {
        ...DEFAULT_COMBINATION_RECOMMENDATION_OPTIONS,
        pairMinWinRate: 1,
        pairMinSynergy: 1,
        tripleMinWinRate: 0,
        tripleMinSynergy: -1,
      },
    )
    expect(pairBlocked.some((entry) => entry.type === 'pair')).toBe(false)
    expect(pairBlocked.some((entry) => entry.type === 'triple')).toBe(true)

    const tripleBlocked = recommendAbilityCombinations(
      [-1, 1, 2, 3],
      [],
      snapshot,
      {
        ...DEFAULT_COMBINATION_RECOMMENDATION_OPTIONS,
        pairMinWinRate: 0,
        pairMinSynergy: -1,
        tripleMinWinRate: 1,
        tripleMinSynergy: 1,
      },
    )
    expect(tripleBlocked.some((entry) => entry.type === 'pair')).toBe(true)
    expect(tripleBlocked.some((entry) => entry.type === 'triple')).toBe(false)
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
        pairMinWinRate: 0.6,
        pairMinSynergy: 0.08,
        tripleMinWinRate: 0.7,
        tripleMinSynergy: 0.09,
      }),
    ).toEqual({
      limit: 4,
      pairMinWinRate: 0.6,
      pairMinSynergy: 0.08,
      tripleMinWinRate: 0.7,
      tripleMinSynergy: 0.09,
    })
    expect(
      normalizeCombinationRecommendationOptions({
        minWinRate: 0.6,
        minSynergy: 0.08,
      }),
    ).toEqual({
      limit: MAX_COMBINATION_RECOMMENDATIONS,
      pairMinWinRate: 0.6,
      pairMinSynergy: 0.08,
      tripleMinWinRate: 0.6,
      tripleMinSynergy: 0.08,
    })
    expect(
      normalizeCombinationRecommendationOptions({ limit: 101 }).limit,
    ).toBe(MAX_COMBINATION_RECOMMENDATIONS)
  })
})
