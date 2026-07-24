import { describe, expect, it } from 'vitest'
import { createDraftTestSnapshot, draftTestPool } from './draft-test-fixtures'
import {
  allRemainingIds,
  applyDraftPick,
  createInitialDraftState,
  remainingPoolCounts,
  validateInitialDraftPool,
} from './draft-state'
import {
  chooseTierFirstCandidate,
  createDraftStrategyContext,
} from './draft-strategy'
import { turnAt } from './draft-turns'

describe('draft shared state', () => {
  it('validates the 12/36/12 pool and rejects duplicate ids', () => {
    const snapshot = createDraftTestSnapshot()
    expect(validateInitialDraftPool(draftTestPool, snapshot.abilities)).toEqual(
      [],
    )
    expect(
      validateInitialDraftPool(
        {
          ...draftTestPool,
          abilityIds: [-1, ...draftTestPool.abilityIds.slice(1)],
        },
        snapshot.abilities,
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining('appears in both hero and ability'),
      ]),
    )
  })

  it('consumes 18 all-pool masks before P1 reaches Pick2', () => {
    const snapshot = createDraftTestSnapshot({
      abilityStats: snapshotStats({ topIds: [-1, 1, 101] }),
    })
    const context = createDraftStrategyContext(snapshot)
    let state = createInitialDraftState(draftTestPool, snapshot.abilities)
    state = applyDraftPick(state, turnAt(1), 12, 'player-pick', 'tier-first')
    for (let globalPick = 2; globalPick <= 19; globalPick += 1) {
      const turn = turnAt(globalPick)
      const abilityId = chooseTierFirstCandidate(state, context, turn)
      expect(abilityId).toBeDefined()
      state = applyDraftPick(
        state,
        turn,
        abilityId!,
        'opponent-mask',
        'tier-first',
      )
    }

    expect(state.nextGlobalPick).toBe(20)
    expect(state.history.slice(1).map((event) => event.turn.player)).toEqual([
      2, 3, 4, 5, 6, 7, 8, 9, 10, 10, 9, 8, 7, 6, 5, 4, 3, 2,
    ])
    expect(state.history.every((event) => event.abilityId !== undefined)).toBe(
      true,
    )
    expect(allRemainingIds(state)).toHaveLength(41)
    expect(allRemainingIds(state)).not.toContain(-1)
    expect(allRemainingIds(state)).not.toContain(1)
    expect(allRemainingIds(state)).not.toContain(101)
    expect(remainingPoolCounts(state).total).toBe(41)
  })
})

function snapshotStats({ topIds }: { topIds: number[] }) {
  const snapshot = createDraftTestSnapshot()
  const top = new Set(topIds)
  return snapshot.abilityStats.map((stats) => ({
    ...stats,
    wins: top.has(stats.abilityId) ? 90 : 50,
  }))
}
