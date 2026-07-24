export const DRAFT_PLAYER_COUNT = 10
export const DRAFT_ROUND_COUNT = 5
export const DRAFT_TOTAL_PICKS = DRAFT_PLAYER_COUNT * DRAFT_ROUND_COUNT

export type DraftRound = 1 | 2 | 3 | 4 | 5

export interface DraftTurn {
  globalPick: number
  round: DraftRound
  player: number
  playerPick: DraftRound
  selectionPool: 'all'
}

function createDraftTurn(globalPick: number): DraftTurn {
  const round = (Math.floor((globalPick - 1) / DRAFT_PLAYER_COUNT) +
    1) as DraftRound
  const offset = (globalPick - 1) % DRAFT_PLAYER_COUNT
  const player = round % 2 === 1 ? offset + 1 : DRAFT_PLAYER_COUNT - offset
  return {
    globalPick,
    round,
    player,
    playerPick: round,
    selectionPool: 'all',
  }
}

const DRAFT_TURNS = Array.from({ length: DRAFT_TOTAL_PICKS }, (_, index) =>
  createDraftTurn(index + 1),
)
const POSITIONS_BY_PLAYER = new Map<number, number[]>(
  Array.from({ length: DRAFT_PLAYER_COUNT }, (_, index) => {
    const player = index + 1
    return [
      player,
      DRAFT_TURNS.filter((turn) => turn.player === player).map(
        (turn) => turn.globalPick,
      ),
    ]
  }),
)

export function turnAt(globalPick: number): DraftTurn {
  if (
    !Number.isInteger(globalPick) ||
    globalPick < 1 ||
    globalPick > DRAFT_TOTAL_PICKS
  ) {
    throw new RangeError(
      `Draft pick must be between 1 and ${DRAFT_TOTAL_PICKS}.`,
    )
  }
  return DRAFT_TURNS[globalPick - 1]
}

export function buildDraftTurns(): DraftTurn[] {
  return DRAFT_TURNS.slice()
}

export function positionsForPlayer(player: number): number[] {
  if (!Number.isInteger(player) || player < 1 || player > DRAFT_PLAYER_COUNT)
    return []
  return POSITIONS_BY_PLAYER.get(player)?.slice() ?? []
}
