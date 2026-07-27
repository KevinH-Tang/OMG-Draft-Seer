import { describe, expect, it } from 'vitest'
import { recommendAbilityCombinations } from './combinations'
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
})
