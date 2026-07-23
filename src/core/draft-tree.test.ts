import { describe, expect, it } from 'vitest'
import { createDraftTestSnapshot, draftTestPool } from './draft-test-fixtures'
import { playerDraftCategoryCounts } from './draft-state'
import { createDraftStrategyMap, DEFAULT_DRAFT_STRATEGIES, simulateDraft } from './draft-tree'

describe('draft replay simulation', () => {
  it('simulates all ten players for five rounds with one strategy applied at every position', () => {
    const snapshot = createDraftTestSnapshot({
      pairStats: [
        { abilityIdOne: 30, abilityIdTwo: 31, picks: 100, wins: 95 },
        { abilityIdOne: -1, abilityIdTwo: 32, picks: 100, wins: 30 },
      ],
    })
    const result = simulateDraft(draftTestPool, snapshot)

    expect(result.unresolved).toBe(false)
    expect(result.finalState.history).toHaveLength(50)
    expect(result.frames).toHaveLength(51)
    expect(result.frames[20]?.state.nextGlobalPick).toBe(21)
    expect(result.frames[20]?.state.picksByPlayer[1]).toHaveLength(2)
    expect(result.treeId).toBeTruthy()
    expect(Object.values(result.finalState.picksByPlayer).every((picks) => picks.length === 5)).toBe(true)
    expect(new Set(result.finalState.history.map((event) => event.abilityId)).size).toBe(50)
    expect(result.frames.every((frame) => Array.isArray(frame.candidates))).toBe(true)
    expect(result.frames.slice(0, 50).every((frame) => frame.candidates.length <= 20)).toBe(true)
    expect(result.frames.slice(0, 50).every((frame) => frame.candidates.every((candidate, index) => candidate.rank === index + 1))).toBe(true)
    for (let index = 1; index < result.frames.length - 1; index += 1) {
      const pickedId = result.frames[index].event?.abilityId
      expect(pickedId).toBeDefined()
      expect(result.frames[index + 1].candidates.some((candidate) => candidate.abilityId === pickedId)).toBe(false)
    }
    expect(result.frames.slice(1).map((frame) => frame.turn.player)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
      10, 9, 8, 7, 6, 5, 4, 3, 2, 1,
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
      10, 9, 8, 7, 6, 5, 4, 3, 2, 1,
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    ])
    for (let player = 1; player <= 10; player += 1) {
      expect(playerDraftCategoryCounts(result.finalState, player)).toEqual({ hero: 1, ability: 3, ultimate: 1 })
    }
    expect(result.strategyByPlayer).toEqual(DEFAULT_DRAFT_STRATEGIES)
    expect(Object.values(result.strategyByPlayer)).toEqual(Array.from({ length: 10 }, () => 'tier-first'))
    expect(result.finalState.remainingByCategory.heroIds.length + result.finalState.remainingByCategory.abilityIds.length + result.finalState.remainingByCategory.ultimateIds.length).toBe(10)
  })

  it('can replay the same full table with Pair priority at every position', () => {
    const result = simulateDraft(draftTestPool, createDraftTestSnapshot(), createDraftStrategyMap('pair-first'))

    expect(result.unresolved).toBe(false)
    expect(Object.values(result.strategyByPlayer)).toEqual(Array.from({ length: 10 }, () => 'pair-first'))
    expect(result.finalState.history).toHaveLength(50)
    expect(result.frames.slice(1).every((frame) => frame.event?.policy === 'pair-first')).toBe(true)
  })

  it('is deterministic for the same pool, snapshot, and strategy map', () => {
    const snapshot = createDraftTestSnapshot()
    const first = simulateDraft(draftTestPool, snapshot)
    const second = simulateDraft(draftTestPool, snapshot)

    expect(first.treeId).toBe(second.treeId)
    expect(first.finalState.history).toEqual(second.finalState.history)
  })
})
