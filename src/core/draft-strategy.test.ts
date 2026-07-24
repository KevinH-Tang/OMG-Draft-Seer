import { describe, expect, it } from 'vitest'
import { createDraftTestSnapshot, draftTestPool } from './draft-test-fixtures'
import { applyDraftPick, createInitialDraftState } from './draft-state'
import {
  chooseDraftCandidate,
  choosePairFirstCandidate,
  chooseTierFirstCandidate,
  createDraftStrategyContext,
  rankDraftCandidates,
} from './draft-strategy'
import { turnAt } from './draft-turns'

describe('draft strategies', () => {
  it('ranks hero, ability, and ultimate in one global tier order', () => {
    const base = createDraftTestSnapshot()
    const snapshot = {
      ...base,
      abilityStats: base.abilityStats.map((stats) => ({
        ...stats,
        wins:
          stats.abilityId === 101
            ? 95
            : stats.abilityId === 1
              ? 90
              : stats.abilityId === -1
                ? 85
                : 50,
      })),
    }
    const state = createInitialDraftState(draftTestPool, snapshot.abilities)
    const context = createDraftStrategyContext(snapshot)

    expect(chooseTierFirstCandidate(state, context)).toBe(101)
  })

  it('uses a surviving reliable Pair anchor for a pair-first opening pick', () => {
    const base = createDraftTestSnapshot()
    const snapshot = {
      ...base,
      pairStats: [{ abilityIdOne: 30, abilityIdTwo: 31, picks: 100, wins: 95 }],
    }
    const state = createInitialDraftState(draftTestPool, snapshot.abilities)
    const context = createDraftStrategyContext(snapshot)
    const choice = choosePairFirstCandidate(state, turnAt(1), context)

    expect(choice).toMatchObject({ abilityId: 30 })
    expect(choice?.rationale).toContain('Highest Pair WR')
    expect(choice?.pairScore).toBeCloseTo(0.95)
    expect(
      chooseDraftCandidate(state, turnAt(1), 'pair-first', context),
    ).toEqual(choice)
  })

  it('uses the raw Pair WR instead of a synergy delta', () => {
    const base = createDraftTestSnapshot()
    const snapshot = {
      ...base,
      pairStats: [{ abilityIdOne: 30, abilityIdTwo: 31, picks: 100, wins: 20 }],
    }
    const context = createDraftStrategyContext(snapshot)

    expect(context.pairValues.get('30-31')).toBeCloseTo(0.2)
  })

  it('keeps a top-K Pair profile for an adaptable opening anchor', () => {
    const base = createDraftTestSnapshot()
    const snapshot = {
      ...base,
      pairStats: [
        { abilityIdOne: 30, abilityIdTwo: 31, picks: 100, wins: 95 },
        { abilityIdOne: 30, abilityIdTwo: 32, picks: 100, wins: 90 },
        { abilityIdOne: 30, abilityIdTwo: 33, picks: 100, wins: 85 },
      ],
    }
    let state = createInitialDraftState(draftTestPool, snapshot.abilities)
    for (let globalPick = 1; globalPick <= 9; globalPick += 1) {
      state = applyDraftPick(
        state,
        turnAt(globalPick),
        globalPick,
        'opponent-mask',
        'tier-first',
      )
    }
    const choice = choosePairFirstCandidate(
      state,
      turnAt(10),
      createDraftStrategyContext(snapshot),
    )

    expect(choice?.abilityId).toBe(30)
    expect(choice?.pairScore).toBeCloseTo(0.95)
    expect(choice?.pairProfile?.topValues).toEqual([0.95, 0.9, 0.85])
    expect(choice?.pairProfile?.optionCount).toBe(3)
  })

  it('uses the strongest Pair WR rather than summing multiple Pair WRs', () => {
    const base = createDraftTestSnapshot()
    const snapshot = {
      ...base,
      pairStats: [
        { abilityIdOne: 30, abilityIdTwo: 31, picks: 100, wins: 55 },
        { abilityIdOne: 30, abilityIdTwo: 32, picks: 100, wins: 54 },
      ],
    }
    const context = createDraftStrategyContext(snapshot)
    let state = createInitialDraftState(draftTestPool, snapshot.abilities)
    state = applyDraftPick(state, turnAt(1), 30, 'player-pick', 'pair-first')
    for (let globalPick = 2; globalPick <= 19; globalPick += 1) {
      state = applyDraftPick(
        state,
        turnAt(globalPick),
        globalPick - 1,
        'opponent-mask',
        'tier-first',
      )
    }

    const choice = choosePairFirstCandidate(state, turnAt(20), context)
    expect(choice?.abilityId).toBe(31)
    expect(choice?.pairScore).toBeCloseTo(0.55)
    expect(choice?.pairProfile?.topValues).toEqual([0.55])
  })

  it('falls back to tier priority when Pair data is unavailable or zero', () => {
    const snapshot = createDraftTestSnapshot()
    const state = createInitialDraftState(draftTestPool, snapshot.abilities)
    const context = createDraftStrategyContext(snapshot)
    const choice = choosePairFirstCandidate(state, turnAt(1), context)

    expect(choice?.abilityId).toBe(1)
    expect(choice?.rationale).toContain('Tier fallback')
  })

  it('uses the same candidate features while swapping Tier and Pair priority', () => {
    const base = createDraftTestSnapshot()
    const snapshot = {
      ...base,
      pairStats: [{ abilityIdOne: 30, abilityIdTwo: 31, picks: 100, wins: 95 }],
      abilityStats: base.abilityStats.map((stats) => ({
        ...stats,
        wins: stats.abilityId === 1 ? 95 : 50,
      })),
    }
    const state = createInitialDraftState(draftTestPool, snapshot.abilities)
    const context = createDraftStrategyContext(snapshot)
    const tierCandidates = rankDraftCandidates(
      state,
      turnAt(1),
      'tier-first',
      context,
      { limit: 60 },
    )
    const pairCandidates = rankDraftCandidates(
      state,
      turnAt(1),
      'pair-first',
      context,
      { limit: 60 },
    )

    expect(tierCandidates[0]?.abilityId).toBe(1)
    expect(pairCandidates[0]?.abilityId).toBe(30)
    expect(
      tierCandidates.find((candidate) => candidate.abilityId === 30)
        ?.pairProfile.topValues,
    ).toEqual([0.95])
    expect(
      pairCandidates.find((candidate) => candidate.abilityId === 30)?.tierRank,
    ).toBeDefined()
  })

  it('returns at most twenty ranked candidates for the current player position', () => {
    const snapshot = createDraftTestSnapshot()
    const state = createInitialDraftState(draftTestPool, snapshot.abilities)
    const context = createDraftStrategyContext(snapshot)
    const candidates = rankDraftCandidates(
      state,
      turnAt(1),
      'tier-first',
      context,
    )

    expect(candidates).toHaveLength(20)
    expect(candidates.map((candidate) => candidate.rank)).toEqual(
      Array.from({ length: 20 }, (_, index) => index + 1),
    )
  })
})
