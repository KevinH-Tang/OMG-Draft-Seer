import { describe, expect, it } from 'vitest'
import { buildDraftTurns, positionsForPlayer, turnAt } from './draft-turns'

describe('draft turn generator', () => {
  it('generates the 50-pick snake order', () => {
    const turns = buildDraftTurns()

    expect(turns).toHaveLength(50)
    expect(turns.slice(0, 10).map((turn) => turn.player)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    expect(turns.slice(10, 20).map((turn) => turn.player)).toEqual([10, 9, 8, 7, 6, 5, 4, 3, 2, 1])
    expect(turns.slice(20, 30).map((turn) => turn.player)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    expect(turns.slice(40, 50).map((turn) => turn.player)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    expect(turns.every((turn) => turn.selectionPool === 'all')).toBe(true)
  })

  it('keeps each player position table stable across rounds', () => {
    expect(positionsForPlayer(1)).toEqual([1, 20, 21, 40, 41])
    expect(positionsForPlayer(10)).toEqual([10, 11, 30, 31, 50])
    expect(turnAt(19)).toMatchObject({ round: 2, player: 2, playerPick: 2 })
    expect(turnAt(42)).toMatchObject({ round: 5, player: 2, playerPick: 5 })
  })
})
