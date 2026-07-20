import { describe, expect, it } from 'vitest'
import { demoSnapshot } from '../data/demoSnapshot'
import { MAX_COMBINATION_EVALUATIONS, MAX_SHORTLIST_SIZE, recommendBuilds } from './recommendation'
import type { Snapshot } from '../types'

describe('build recommendations', () => {
  const candidateIds = [5048, 5050, 5101, 5121, 5150, 5153, 8158]

  it('builds four-skill plans that retain selected skills', () => {
    const results = recommendBuilds(candidateIds, [5150], demoSnapshot)
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].abilityIds).toHaveLength(4)
    expect(results[0].abilityIds).toContain(5150)
    expect(results[0].abilityWinRate).toBeGreaterThan(0)
    expect(results[0].averagePickPosition).toBeGreaterThanOrEqual(1)
    expect(results[0].averagePickPosition).toBeLessThanOrEqual(50)
    expect(results[0].sampleConfidence).toBeGreaterThan(0)
  })

  it('does not emit recommendations when the pool cannot fill four slots', () => {
    expect(recommendBuilds([5048, 5050], [], demoSnapshot)).toEqual([])
  })

  it('keeps the result deterministically sorted', () => {
    const results = recommendBuilds(candidateIds, [], demoSnapshot)
    expect(results).toEqual([...results].sort((left, right) => right.score - left.score))
    expect(results[0].reasons.join(' ')).toContain('样本')
  })

  it('ignores unknown selected IDs instead of emitting incomplete builds', () => {
    const results = recommendBuilds([...candidateIds, 999999], [999999], demoSnapshot)
    expect(results.length).toBeGreaterThan(0)
    expect(results.every((result) => result.abilityIds.every((id) => id !== 999999))).toBe(true)
    expect(results.every((result) => result.abilityIds.length === 4)).toBe(true)
  })

  it('shortlists a large pool before evaluating combinations', () => {
    const snapshot: Snapshot = {
      ...demoSnapshot,
      abilities: Array.from({ length: 60 }, (_, index) => ({
        id: index + 1,
        name: `Ability ${index + 1}`,
        shortName: `ability_${index + 1}`,
        isUltimate: false,
        iconColor: '#888888',
      })),
      abilityStats: Array.from({ length: 60 }, (_, index) => ({
        abilityId: index + 1,
        picks: 100,
        avgPickPosition: index + 1,
        wins: index < MAX_SHORTLIST_SIZE ? 75 : 50,
      })),
      pairStats: [],
    }
    const results = recommendBuilds(Array.from({ length: 60 }, (_, index) => index + 1), [], snapshot)

    expect(MAX_COMBINATION_EVALUATIONS).toBe(50_000)
    expect(results).toHaveLength(10)
    expect(results.every((result) => result.abilityIds.every((id) => id <= MAX_SHORTLIST_SIZE))).toBe(true)
  })

  it('returns no results for a non-positive result limit', () => {
    expect(recommendBuilds(candidateIds, [], demoSnapshot, 0)).toEqual([])
  })

  it('uses weighted ability rates, logarithmic pair weights, and average pick positions', () => {
    const snapshot: Snapshot = {
      ...demoSnapshot,
      abilities: [1, 2, 3, 4].map((id) => ({ id, name: `Ability ${id}`, shortName: `ability_${id}`, isUltimate: false, iconColor: '#888888' })),
      abilityStats: [
        { abilityId: 1, picks: 100, wins: 50, avgPickPosition: 10 },
        { abilityId: 2, picks: 1000, wins: 600, avgPickPosition: 20 },
        { abilityId: 3, picks: 10000, wins: 6000, avgPickPosition: 30 },
        { abilityId: 4, picks: 1000, wins: 500, avgPickPosition: 40 },
      ],
      pairStats: [{ abilityIdOne: 1, abilityIdTwo: 2, picks: 100, wins: 60 }],
    }
    const [result] = recommendBuilds([1, 2, 3, 4], [], snapshot)
    const metrics = snapshot.abilityStats.map((stat) => ({
      rate: (stat.wins + 25) / (stat.picks + 50),
      weight: stat.picks / (stat.picks + 50),
    }))
    const totalWeight = metrics.reduce((sum, item) => sum + item.weight, 0)
    const expectedAbilityWinRate = metrics.reduce((sum, item) => sum + item.rate * item.weight, 0) / totalWeight
    const pairSynergy = 60 / 100 - (metrics[0].rate + metrics[1].rate) / 2

    expect(result.abilityWinRate).toBeCloseTo(expectedAbilityWinRate)
    expect(result.synergy).toBeCloseTo(pairSynergy)
    expect(result.averagePickPosition).toBe(25)
  })
})
