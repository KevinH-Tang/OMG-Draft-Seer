import { buildPairStatsMap, calculateWinRate, MIN_ABILITY_PAIR_PICKS } from './pairs'
import { buildAbilityTierList, type AbilityTier } from './tiers'
import { memoizeByKey } from './cache'
import { allRemainingIds, applyDraftPick, DRAFT_PICK_QUOTAS, playerDraftCategoryCounts, type DraftState, type DraftStrategyId } from './draft-state'
import { DRAFT_TOTAL_PICKS, turnAt, type DraftTurn } from './draft-turns'
import type { AbilityStats, Snapshot } from '../types'

interface TierInfo {
  rank: number
  tier: AbilityTier
  picks: number
}

export interface DraftStrategyContext {
  tiers: Map<number, TierInfo>
  stats: Map<number, AbilityStats>
  pairValues: Map<string, number>
  pairValuesByAbility: Map<number, Map<number, number>>
  futureStrategies: Readonly<Record<number, DraftStrategyId>>
  futurePoolCache: WeakMap<DraftState, Map<string, readonly number[]>>
  futureStateCache: WeakMap<DraftState, Map<string, DraftState>>
  rankedCandidatesCache: WeakMap<DraftState, Map<string, RankedDraftCandidate[]>>
  snapshot: Snapshot
}

export interface PairProfile {
  topValues: number[]
  topPartnerIds: number[]
  weightedValue: number
  optionCount: number
}

export const DRAFT_TOP_K = 20

export interface RankedDraftCandidate {
  abilityId: number
  rank: number
  tierRank: number
  tier?: AbilityTier
  pairProfile: PairProfile
  individualWinRate: number
  sampleCount: number
  avgPickPosition?: number
}

export interface DraftChoice {
  abilityId: number
  rationale: string
  pairScore?: number
  pairProfile?: PairProfile
}

export interface RankDraftCandidatesOptions {
  limit?: number
  allowFutureLookahead?: boolean
}

function legalRemainingIds(state: DraftState, turn?: DraftTurn): number[] {
  const candidates = allRemainingIds(state)
  if (!turn) return candidates.slice()
  const counts = playerDraftCategoryCounts(state, turn.player)
  const blocked = new Set<number>()
  if (counts.hero >= DRAFT_PICK_QUOTAS.hero) for (const id of state.remainingByCategory.heroIds) blocked.add(id)
  if (counts.ability >= DRAFT_PICK_QUOTAS.ability) for (const id of state.remainingByCategory.abilityIds) blocked.add(id)
  if (counts.ultimate >= DRAFT_PICK_QUOTAS.ultimate) for (const id of state.remainingByCategory.ultimateIds) blocked.add(id)
  return blocked.size === 0 ? candidates.slice() : candidates.filter((abilityId) => !blocked.has(abilityId))
}

function pairWinRate(pair: { picks: number; wins: number }): number | undefined {
  if (pair.picks < MIN_ABILITY_PAIR_PICKS) return undefined
  return calculateWinRate(pair.picks, pair.wins)
}

export function createDraftStrategyContext(snapshot: Snapshot, futureStrategies: Readonly<Record<number, DraftStrategyId>> = {}): DraftStrategyContext {
  const stats = new Map(snapshot.abilityStats.map((entry) => [entry.abilityId, entry]))
  const tiers = new Map<number, TierInfo>()
  for (const entry of buildAbilityTierList(snapshot, 'all')) {
    tiers.set(entry.ability.id, { rank: entry.rank, tier: entry.tier, picks: entry.stats.picks })
  }
  const pairStats = buildPairStatsMap(snapshot.pairStats)
  const pairValues = new Map<string, number>()
  const pairValuesByAbility = new Map<number, Map<number, number>>()
  for (const [key, pair] of pairStats) {
    const value = pairWinRate(pair)
    if (value === undefined) continue
    pairValues.set(key, value)
    const leftPartners = pairValuesByAbility.get(pair.abilityIdOne) ?? new Map<number, number>()
    const rightPartners = pairValuesByAbility.get(pair.abilityIdTwo) ?? new Map<number, number>()
    leftPartners.set(pair.abilityIdTwo, value)
    rightPartners.set(pair.abilityIdOne, value)
    pairValuesByAbility.set(pair.abilityIdOne, leftPartners)
    pairValuesByAbility.set(pair.abilityIdTwo, rightPartners)
  }
  return {
    tiers,
    stats,
    pairValues,
    pairValuesByAbility,
    futureStrategies,
    futurePoolCache: new WeakMap(),
    futureStateCache: new WeakMap(),
    rankedCandidatesCache: new WeakMap(),
    snapshot,
  }
}

export function pairValue(leftId: number, rightId: number, context: DraftStrategyContext): number | undefined {
  return context.pairValuesByAbility.get(leftId)?.get(rightId)
}

function compareTierPriority(leftId: number, rightId: number, context: DraftStrategyContext): number {
  const leftTier = context.tiers.get(leftId)
  const rightTier = context.tiers.get(rightId)
  const leftRank = leftTier?.rank ?? Number.POSITIVE_INFINITY
  const rightRank = rightTier?.rank ?? Number.POSITIVE_INFINITY
  if (Number.isFinite(leftRank) !== Number.isFinite(rightRank)) return Number.isFinite(leftRank) ? -1 : 1
  if (leftRank !== rightRank) return leftRank - rightRank
  const leftPicks = leftTier?.picks ?? context.stats.get(leftId)?.picks ?? 0
  const rightPicks = rightTier?.picks ?? context.stats.get(rightId)?.picks ?? 0
  return rightPicks - leftPicks || leftId - rightId
}

export function chooseTierFirstCandidate(state: DraftState, context: DraftStrategyContext, turn?: DraftTurn): number | undefined {
  if (!turn) return legalRemainingIds(state).sort((left, right) => compareTierPriority(left, right, context))[0]
  return rankDraftCandidates(state, turn, 'tier-first', context, { limit: 1, allowFutureLookahead: false })[0]?.abilityId
}

function nextTurnForPlayer(turn: DraftTurn, player: number): DraftTurn | undefined {
  for (let globalPick = turn.globalPick + 1; globalPick <= DRAFT_TOTAL_PICKS; globalPick += 1) {
    const nextTurn = turnAt(globalPick)
    if (nextTurn.player === player) return nextTurn
  }
  return undefined
}

function survivingFutureCandidates(state: DraftState, turn: DraftTurn, player: number, candidateId: number, context: DraftStrategyContext): readonly number[] {
  const cacheKey = `${turn.globalPick}|${player}|${candidateId}`
  return memoizeByKey(context.futurePoolCache, state, cacheKey, () => {
    const hypothetical = futureStateAfterMasks(state, turn, player, candidateId, context)
    const nextTurn = nextTurnForPlayer(turn, player)
    return nextTurn ? legalRemainingIds(hypothetical, nextTurn) : allRemainingIds(hypothetical)
  })
}

function futureStateAfterMasks(state: DraftState, turn: DraftTurn, player: number, candidateId: number, context: DraftStrategyContext): DraftState {
  const cacheKey = `${turn.globalPick}|${player}|${candidateId}`
  return memoizeByKey(context.futureStateCache, state, cacheKey, () => {
    let hypothetical = applyDraftPick(state, turn, candidateId, 'player-pick', 'pair-first')
    const nextTurn = nextTurnForPlayer(turn, player)
    if (nextTurn) {
      while (hypothetical.nextGlobalPick < nextTurn.globalPick) {
        const maskTurn = turnAt(hypothetical.nextGlobalPick)
        const maskPolicy = context.futureStrategies[maskTurn.player] ?? 'tier-first'
        const maskChoice = chooseMaskCandidate(hypothetical, maskTurn, maskPolicy, context)
        if (!maskChoice) break
        hypothetical = applyDraftPick(hypothetical, maskTurn, maskChoice.abilityId, 'opponent-mask', maskPolicy, {
          rationale: maskChoice.rationale,
          pairScore: maskChoice.pairScore,
          pairProfile: maskChoice.pairProfile,
        })
      }
    }
    return hypothetical
  })
}

const PAIR_PRIMARY_MARGIN = 0.01
const PAIR_PROFILE_MARGIN = 0.003
const PAIR_PROFILE_WEIGHTS = [0.55, 0.3, 0.15]

function pairProfileForPartners(candidateId: number, partnerIds: readonly number[], context: DraftStrategyContext): PairProfile {
  const values = partnerIds.flatMap((partnerId) => {
    const value = pairValue(candidateId, partnerId, context)
    return value === undefined ? [] : [{ value, partnerId }]
  })
  const top = values
    .slice()
    .sort((left, right) => right.value - left.value || left.partnerId - right.partnerId)
    .slice(0, PAIR_PROFILE_WEIGHTS.length)
  const weightTotal = top.reduce((sum, _entry, index) => sum + PAIR_PROFILE_WEIGHTS[index], 0)
  return {
    topValues: top.map((entry) => entry.value),
    topPartnerIds: top.map((entry) => entry.partnerId),
    weightedValue: weightTotal === 0 ? 0 : top.reduce((sum, entry, index) => sum + entry.value * PAIR_PROFILE_WEIGHTS[index], 0) / weightTotal,
    optionCount: values.length,
  }
}

function firstPickProfile(state: DraftState, turn: DraftTurn, candidateId: number, context: DraftStrategyContext): PairProfile {
  const surviving = survivingFutureCandidates(state, turn, turn.player, candidateId, context)
  return pairProfileForPartners(candidateId, surviving, context)
}

function immediateFirstPickProfile(state: DraftState, turn: DraftTurn, candidateId: number, context: DraftStrategyContext): PairProfile {
  const hypothetical = applyDraftPick(state, turn, candidateId, 'player-pick', 'pair-first')
  const nextTurn = nextTurnForPlayer(turn, turn.player)
  const available = nextTurn ? legalRemainingIds(hypothetical, nextTurn) : allRemainingIds(hypothetical)
  return pairProfileForPartners(candidateId, available, context)
}

function independentWinRate(abilityId: number, context: DraftStrategyContext): number {
  const stat = context.stats.get(abilityId)
  return (stat && calculateWinRate(stat.picks, stat.wins)) ?? 0.5
}

function compareIndependentPriority(left: RankedDraftCandidate, right: RankedDraftCandidate): number {
  return right.individualWinRate - left.individualWinRate
    || right.sampleCount - left.sampleCount
    || (left.avgPickPosition ?? Number.POSITIVE_INFINITY) - (right.avgPickPosition ?? Number.POSITIVE_INFINITY)
    || left.abilityId - right.abilityId
}

function comparePairProfile(left: PairProfile, right: PairProfile): number {
  const leftTop = left.topValues[0] ?? Number.NEGATIVE_INFINITY
  const rightTop = right.topValues[0] ?? Number.NEGATIVE_INFINITY
  if (Math.abs(rightTop - leftTop) > PAIR_PRIMARY_MARGIN) return rightTop - leftTop

  for (let index = 1; index < PAIR_PROFILE_WEIGHTS.length; index += 1) {
    const leftValue = left.topValues[index] ?? Number.NEGATIVE_INFINITY
    const rightValue = right.topValues[index] ?? Number.NEGATIVE_INFINITY
    if (leftValue === Number.NEGATIVE_INFINITY || rightValue === Number.NEGATIVE_INFINITY) {
      if (leftValue !== rightValue) return rightValue - leftValue
      continue
    }
    if (Math.abs(rightValue - leftValue) > PAIR_PROFILE_MARGIN) return rightValue - leftValue
  }

  return Math.abs(right.weightedValue - left.weightedValue) > PAIR_PROFILE_MARGIN
    ? right.weightedValue - left.weightedValue
    : right.optionCount - left.optionCount
}

function compareDraftCandidates(
  left: RankedDraftCandidate,
  right: RankedDraftCandidate,
  policy: DraftStrategyId,
): number {
  const primary = policy === 'pair-first'
    ? comparePairProfile(left.pairProfile, right.pairProfile)
    : left.tierRank - right.tierRank
  const secondary = policy === 'pair-first'
    ? left.tierRank - right.tierRank
    : comparePairProfile(left.pairProfile, right.pairProfile)
  return primary || secondary || compareIndependentPriority(left, right)
}

function candidatePairProfile(
  state: DraftState,
  turn: DraftTurn,
  candidateId: number,
  context: DraftStrategyContext,
  allowFutureLookahead: boolean,
): PairProfile {
  const ownPicks = state.picksByPlayer[turn.player] ?? []
  if (ownPicks.length > 0) return pairProfileForPartners(candidateId, ownPicks, context)
  return allowFutureLookahead
    ? firstPickProfile(state, turn, candidateId, context)
    : immediateFirstPickProfile(state, turn, candidateId, context)
}

function candidateRank(
  state: DraftState,
  turn: DraftTurn,
  abilityId: number,
  context: DraftStrategyContext,
  allowFutureLookahead: boolean,
): RankedDraftCandidate {
  const tier = context.tiers.get(abilityId)
  const stat = context.stats.get(abilityId)
  return {
    abilityId,
    rank: 0,
    tierRank: tier?.rank ?? Number.POSITIVE_INFINITY,
    tier: tier?.tier,
    pairProfile: candidatePairProfile(state, turn, abilityId, context, allowFutureLookahead),
    individualWinRate: independentWinRate(abilityId, context),
    sampleCount: tier?.picks ?? stat?.picks ?? 0,
    avgPickPosition: stat?.avgPickPosition,
  }
}

export function rankDraftCandidates(
  state: DraftState,
  turn: DraftTurn,
  policy: DraftStrategyId,
  context: DraftStrategyContext,
  options: RankDraftCandidatesOptions = {},
): RankedDraftCandidate[] {
  const allowFutureLookahead = options.allowFutureLookahead ?? true
  const limit = options.limit ?? DRAFT_TOP_K
  if (limit <= 0) return []
  const cacheKey = `${turn.globalPick}|${policy}|${allowFutureLookahead ? 'lookahead' : 'immediate'}|${limit}`

  return memoizeByKey(context.rankedCandidatesCache, state, cacheKey, () => {
    const legalIds = legalRemainingIds(state, turn)
    if (legalIds.length === 0) return []

    if (limit === 1) {
      let best: RankedDraftCandidate | undefined
      for (const abilityId of legalIds) {
        const candidate = candidateRank(state, turn, abilityId, context, allowFutureLookahead)
        if (!best || compareDraftCandidates(candidate, best, policy) < 0) best = candidate
      }
      return best ? [{ ...best, rank: 1 }] : []
    }

    return legalIds
      .map((abilityId) => candidateRank(state, turn, abilityId, context, allowFutureLookahead))
      .sort((left, right) => compareDraftCandidates(left, right, policy))
      .map((candidate, index) => ({ ...candidate, rank: index + 1 }))
      .slice(0, limit)
  })
}

export function draftChoiceFromRankedCandidate(candidate: RankedDraftCandidate, policy: DraftStrategyId): DraftChoice {
  const pairScore = candidate.pairProfile.topValues[0]
  const rationale = policy === 'pair-first'
    ? pairScore === undefined
      ? 'Tier fallback: no Pair data'
      : `Highest Pair WR with ${candidate.pairProfile.optionCount} connected picks`
    : 'Highest global tier'
  return {
    abilityId: candidate.abilityId,
    rationale,
    pairScore,
    pairProfile: candidate.pairProfile,
  }
}

function chooseDraftCandidateInternal(
  state: DraftState,
  turn: DraftTurn,
  policy: DraftStrategyId,
  context: DraftStrategyContext,
  allowFutureLookahead: boolean,
): DraftChoice | undefined {
  const candidate = rankDraftCandidates(state, turn, policy, context, { limit: 1, allowFutureLookahead })[0]
  return candidate ? draftChoiceFromRankedCandidate(candidate, policy) : undefined
}

function chooseMaskCandidate(state: DraftState, turn: DraftTurn, policy: DraftStrategyId, context: DraftStrategyContext): DraftChoice | undefined {
  return chooseDraftCandidateInternal(state, turn, policy, context, false)
}

export function choosePairFirstCandidate(state: DraftState, turn: DraftTurn, context: DraftStrategyContext): DraftChoice | undefined {
  return chooseDraftCandidateInternal(state, turn, 'pair-first', context, true)
}

export function chooseDraftCandidate(state: DraftState, turn: DraftTurn, policy: DraftStrategyId, context: DraftStrategyContext): DraftChoice | undefined {
  return chooseDraftCandidateInternal(state, turn, policy, context, true)
}
