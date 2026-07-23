import { applyDraftPick, createInitialDraftState, type DraftPickEvent, type DraftState, type DraftStrategyId, type InitialDraftPool } from './draft-state'
import { buildDraftTurns, DRAFT_TOTAL_PICKS, turnAt, type DraftTurn } from './draft-turns'
import { createDraftStrategyContext, draftChoiceFromRankedCandidate, rankDraftCandidates, type DraftStrategyContext, type RankedDraftCandidate } from './draft-strategy'
import type { Snapshot } from '../types'

export function createDraftStrategyMap(strategy: DraftStrategyId): Record<number, DraftStrategyId> {
  return Object.fromEntries(Array.from({ length: 10 }, (_, index) => [index + 1, strategy])) as Record<number, DraftStrategyId>
}
export const DEFAULT_DRAFT_STRATEGIES = createDraftStrategyMap('tier-first')

export interface DraftReplayFrame {
  step: number
  state: DraftState
  turn: DraftTurn
  candidates: RankedDraftCandidate[]
  event?: DraftPickEvent
}

export interface DraftSimulationResult {
  treeId: string
  initialPool: InitialDraftPool
  initialState: DraftState
  finalState: DraftState
  frames: DraftReplayFrame[]
  strategyByPlayer: Record<number, DraftStrategyId>
  unresolved: boolean
}

const DRAFT_SIMULATION_CACHE_LIMIT = 4
const DRAFT_SIMULATION_CACHE = new WeakMap<Snapshot, Map<string, DraftSimulationResult>>()

function poolFingerprint(pool: InitialDraftPool): string {
  return [pool.heroIds, pool.abilityIds, pool.ultimateIds].map((ids) => [...ids].sort((left, right) => left - right).join(',')).join('|')
}

function strategyFingerprint(strategyByPlayer: Record<number, DraftStrategyId>): string {
  return Object.keys(strategyByPlayer).sort((left, right) => Number(left) - Number(right)).map((player) => `${player}:${strategyByPlayer[Number(player)]}`).join(',')
}

export function draftTreeId(pool: InitialDraftPool, snapshot: Snapshot, strategyByPlayer: Record<number, DraftStrategyId>): string {
  return `${snapshot.version}::${snapshot.patch}::${poolFingerprint(pool)}::${strategyFingerprint(strategyByPlayer)}`
}

export function simulateDraft(
  pool: InitialDraftPool,
  snapshot: Snapshot,
  strategyByPlayer: Record<number, DraftStrategyId> = DEFAULT_DRAFT_STRATEGIES,
  context?: DraftStrategyContext,
): DraftSimulationResult {
  const treeId = draftTreeId(pool, snapshot, strategyByPlayer)
  if (!context) {
    const cached = DRAFT_SIMULATION_CACHE.get(snapshot)?.get(treeId)
    if (cached) return cached
  }

  const strategyContext = context ?? createDraftStrategyContext(snapshot, strategyByPlayer)
  const initialState = createInitialDraftState(pool, snapshot.abilities)
  let state = initialState
  const initialTurn = turnAt(1)
  const initialPolicy = strategyByPlayer[initialTurn.player] ?? 'tier-first'
  const frames: DraftReplayFrame[] = [{
    step: 0,
    state,
    turn: initialTurn,
    candidates: rankDraftCandidates(state, initialTurn, initialPolicy, strategyContext),
  }]
  let unresolved = false

  for (const turn of buildDraftTurns()) {
    const policy = strategyByPlayer[turn.player] ?? 'tier-first'
    const candidates = rankDraftCandidates(state, turn, policy, strategyContext)
    const rankedCandidate = candidates[0]
    if (!rankedCandidate) {
      unresolved = true
      frames.push({ step: turn.globalPick, state, turn, candidates })
      break
    }
    const choice = draftChoiceFromRankedCandidate(rankedCandidate, policy)
    state = applyDraftPick(state, turn, choice.abilityId, 'player-pick', policy, {
      rationale: choice.rationale,
      pairScore: choice.pairScore,
      pairProfile: choice.pairProfile,
    })
    frames.push({ step: turn.globalPick, state, turn, candidates, event: state.history[state.history.length - 1] })
  }

  if (!unresolved && state.history.length !== DRAFT_TOTAL_PICKS) unresolved = true
  const result = {
    treeId,
    initialPool: pool,
    initialState,
    finalState: state,
    frames,
    strategyByPlayer,
    unresolved,
  }
  if (!context) {
    const entries = DRAFT_SIMULATION_CACHE.get(snapshot) ?? new Map<string, DraftSimulationResult>()
    entries.delete(treeId)
    entries.set(treeId, result)
    while (entries.size > DRAFT_SIMULATION_CACHE_LIMIT) entries.delete(entries.keys().next().value!)
    if (!DRAFT_SIMULATION_CACHE.has(snapshot)) DRAFT_SIMULATION_CACHE.set(snapshot, entries)
  }
  return result
}
