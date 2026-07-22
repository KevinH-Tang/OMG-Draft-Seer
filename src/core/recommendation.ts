import type { Ability, AbilityStats, PairStats, Recommendation, RecommendationInteraction, SlotCategory, Snapshot, TripletStats } from '../types'
import { matchesSlotCategory } from './ability-category'
import { abilityPairKey, abilityTripletKey, buildPairStatsMap, buildTripletStatsMap, calculatePairSynergy, MIN_ABILITY_PAIR_PICKS } from './pairs'
import { buildAbilityTierList, type TierCategory } from './tiers'

export const MAX_COMBINATION_EVALUATIONS = 50_000
export const MAX_SHORTLIST_SIZE = 28
export const INTERACTION_CONFIDENCE_Z_SCORE = 1.96

export const BUILD_PICK_LIMITS = {
  hero: 1,
  normal: 3,
  ultimate: 1,
} as const

export interface BuildCandidatePools {
  heroIds: readonly number[]
  normalIds: readonly number[]
  ultimateIds: readonly number[]
}

interface AbilityMetric {
  winRate: number
  avgPickPosition?: number
  picks: number
}

interface TierMetric {
  strength: number
}

interface ScoreContext {
  abilities: Map<number, Ability>
  stats: Map<number, AbilityStats>
  pairs: Map<string, PairStats>
  triplets: Map<string, TripletStats>
  tiers: Map<number, TierMetric>
}

interface PairImpact {
  value: number
  rawValue: number
  picks: number
}

interface InteractionImpact extends PairImpact {
  type: RecommendationInteraction['type']
  abilityIds: number[]
}

interface InteractionSummary {
  value: number
  effectiveInteractions: RecommendationInteraction[]
}

interface SearchPool {
  category: SlotCategory
  candidates: number[]
  needed: number
}

const TIER_CATEGORY_BY_SLOT: Record<SlotCategory, TierCategory> = {
  hero: 'heroes',
  normal: 'abilities',
  ultimate: 'ultimates',
}

function createTierMetrics(snapshot: Snapshot): Map<number, TierMetric> {
  const metrics = new Map<number, TierMetric>()
  for (const category of Object.values(TIER_CATEGORY_BY_SLOT)) {
    const entries = buildAbilityTierList(snapshot, category)
    const lastRank = Math.max(1, entries.length - 1)
    for (const entry of entries) {
      metrics.set(entry.ability.id, {
        strength: entries.length <= 1 ? 1 : 1 - (entry.rank - 1) / lastRank,
      })
    }
  }
  return metrics
}

function createScoreContext(snapshot: Snapshot): ScoreContext {
  const abilities = new Map(snapshot.abilities.map((ability) => [ability.id, ability]))
  const pairs = buildPairStatsMap(snapshot.pairStats)
  return {
    abilities,
    stats: new Map(snapshot.abilityStats.map((stat) => [stat.abilityId, stat])),
    pairs,
    triplets: buildTripletStatsMap(snapshot.tripletStats ?? []),
    tiers: createTierMetrics(snapshot),
  }
}

function abilityMetric(abilityId: number, context: ScoreContext): AbilityMetric {
  const stat = context.stats.get(abilityId)
  if (!stat || stat.picks <= 0 || !Number.isFinite(stat.picks) || !Number.isFinite(stat.wins)) {
    return { winRate: 0.5, picks: 0 }
  }
  return {
    winRate: stat.wins / stat.picks,
    avgPickPosition: stat.avgPickPosition,
    picks: stat.picks,
  }
}

function interactionImpact(
  type: RecommendationInteraction['type'],
  abilityIds: number[],
  wins: number,
  picks: number,
  context: ScoreContext,
): InteractionImpact | undefined {
  if (picks < MIN_ABILITY_PAIR_PICKS || picks <= 0 || !Number.isFinite(wins)) return undefined
  const observedWinRate = wins / picks
  if (!Number.isFinite(observedWinRate) || observedWinRate <= 0 || observedWinRate > 1) return undefined
  const metrics = abilityIds.map((id) => abilityMetric(id, context))
  if (metrics.some((metric) => metric.picks <= 0)) return undefined
  const baseline = metrics.reduce((sum, metric) => sum + metric.winRate, 0) / metrics.length
  const rawValue = observedWinRate - baseline
  const observedVariance = observedWinRate * (1 - observedWinRate) / picks
  const baselineVariance = metrics.reduce((sum, metric) => sum + metric.winRate * (1 - metric.winRate) / metric.picks, 0) / metrics.length ** 2
  const standardError = Math.sqrt(observedVariance + baselineVariance)
  const value = Math.sign(rawValue) * Math.max(0, Math.abs(rawValue) - INTERACTION_CONFIDENCE_Z_SCORE * standardError)
  return { type, abilityIds, value, rawValue, picks }
}

function pairImpact(leftId: number, rightId: number, context: ScoreContext): PairImpact | undefined {
  const pair = context.pairs.get(abilityPairKey(leftId, rightId))
  if (!pair || pair.picks < MIN_ABILITY_PAIR_PICKS) return undefined
  const rawValue = calculatePairSynergy(pair, context.stats.get(leftId), context.stats.get(rightId))
  if (rawValue === undefined) return undefined
  const impact = interactionImpact('pair', [leftId, rightId], pair.wins, pair.picks, context)
  return impact ? { value: impact.value, rawValue, picks: impact.picks } : undefined
}

function tripletImpact(firstId: number, secondId: number, thirdId: number, context: ScoreContext): InteractionImpact | undefined {
  const triplet = context.triplets.get(abilityTripletKey(firstId, secondId, thirdId))
  if (!triplet) return undefined
  return interactionImpact('triple', [firstId, secondId, thirdId], triplet.wins, triplet.picks, context)
}

function buildInteractionCoverage(ids: number[], context: ScoreContext): InteractionSummary {
  const idBit = new Map(ids.map((id, index) => [id, 1 << index]))
  const candidates: Array<InteractionImpact & { mask: number }> = []
  for (let leftIndex = 0; leftIndex < ids.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < ids.length; rightIndex += 1) {
      const impact = pairImpact(ids[leftIndex], ids[rightIndex], context)
      if (!impact || impact.value <= 0) continue
      candidates.push({ ...impact, type: 'pair', abilityIds: [ids[leftIndex], ids[rightIndex]], mask: (idBit.get(ids[leftIndex]) ?? 0) | (idBit.get(ids[rightIndex]) ?? 0) })
    }
  }
  for (let firstIndex = 0; firstIndex < ids.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < ids.length; secondIndex += 1) {
      for (let thirdIndex = secondIndex + 1; thirdIndex < ids.length; thirdIndex += 1) {
        const triple = tripletImpact(ids[firstIndex], ids[secondIndex], ids[thirdIndex], context)
        if (!triple || triple.value <= 0) continue
        candidates.push({ ...triple, mask: (idBit.get(ids[firstIndex]) ?? 0) | (idBit.get(ids[secondIndex]) ?? 0) | (idBit.get(ids[thirdIndex]) ?? 0) })
      }
    }
  }

  const coverage = new Map<number, { value: number; interactions: Array<InteractionImpact & { mask: number }> }>()
  coverage.set(0, { value: 0, interactions: [] })
  for (const candidate of candidates) {
    for (const [mask, state] of [...coverage.entries()]) {
      if ((mask & candidate.mask) !== 0) continue
      const nextMask = mask | candidate.mask
      const nextValue = state.value + candidate.value
      const previous = coverage.get(nextMask)
      if (!previous || nextValue > previous.value) coverage.set(nextMask, { value: nextValue, interactions: [...state.interactions, candidate] })
    }
  }

  const best = [...coverage.values()].reduce((current, candidate) => candidate.value > current.value ? candidate : current)
  return {
    value: best.value,
    effectiveInteractions: best.interactions
      .map(({ type, abilityIds, value, rawValue, picks }) => ({ type, abilityIds, synergy: value, rawSynergy: rawValue, picks }))
      .sort((left, right) => right.synergy - left.synergy || right.picks - left.picks),
  }
}

function combinationCount(items: number, needed: number, stopAt = Number.POSITIVE_INFINITY): number {
  if (needed < 0 || needed > items) return 0
  const selected = Math.min(needed, items - needed)
  let count = 1
  for (let index = 1; index <= selected; index += 1) {
    count = (count * (items - selected + index)) / index
    if (count > stopAt) return count
  }
  return count
}

function searchCombinationCount(pools: SearchPool[], stopAt = Number.POSITIVE_INFINITY): number {
  let count = 1
  for (const pool of pools) {
    const poolCount = combinationCount(pool.candidates.length, pool.needed, stopAt / count)
    count *= poolCount
    if (count > stopAt) return count
  }
  return count
}

function forEachCombination<T>(items: T[], needed: number, visit: (selection: T[]) => void): void {
  const selection: T[] = []
  const visitBranch = (start: number, remaining: number) => {
    if (remaining === 0) {
      visit([...selection])
      return
    }
    for (let index = start; index <= items.length - remaining; index += 1) {
      selection.push(items[index])
      visitBranch(index + 1, remaining - 1)
      selection.pop()
    }
  }
  visitBranch(0, needed)
}

function scoreBuild(ids: number[], context: ScoreContext): Recommendation {
  const individual = ids.map((id) => abilityMetric(id, context))
  const abilityWinRate = individual.reduce((sum, metric) => sum + metric.winRate, 0) / Math.max(1, individual.length)
  const synergy = buildInteractionCoverage(ids, context)
  const score = Math.min(1, Math.max(0, abilityWinRate + synergy.value)) * 100
  const positions = individual.flatMap((metric) => metric.avgPickPosition === undefined ? [] : [metric.avgPickPosition])
  const averagePickPosition = positions.length > 0 ? positions.reduce((sum, position) => sum + position, 0) / positions.length : 50
  const pickOrderIds = ids
    .map((id, index) => ({ id, index, position: abilityMetric(id, context).avgPickPosition ?? Number.POSITIVE_INFINITY }))
    .sort((left, right) => left.position - right.position || left.index - right.index)
    .map((item) => item.id)
  return {
    abilityIds: ids,
    pickOrderIds,
    score,
    abilityWinRate,
    synergy: synergy.value,
    effectiveInteractionCount: synergy.effectiveInteractions.length,
    effectiveInteractions: synergy.effectiveInteractions,
    averagePickPosition,
  }
}

function candidatePriority(id: number, selectedIds: number[], context: ScoreContext): number {
  const tierStrength = context.tiers.get(id)?.strength ?? 0
  const selectedSynergy = selectedIds.reduce((sum, selectedId) => sum + (pairImpact(id, selectedId, context)?.value ?? 0), 0)
  return tierStrength * 100 + selectedSynergy * 100
}

function shortlistCandidatePools(pools: SearchPool[], selectedIds: number[], context: ScoreContext): SearchPool[] {
  if (searchCombinationCount(pools, MAX_COMBINATION_EVALUATIONS) <= MAX_COMBINATION_EVALUATIONS) return pools

  const shortlist = pools.map((pool) => ({
    ...pool,
    candidates: pool.candidates
      .map((id, index) => ({ id, index, priority: candidatePriority(id, selectedIds, context) }))
      .sort((left, right) => right.priority - left.priority || left.index - right.index)
      .slice(0, Math.max(pool.needed, MAX_SHORTLIST_SIZE))
      .map((candidate) => candidate.id),
  }))

  while (searchCombinationCount(shortlist, MAX_COMBINATION_EVALUATIONS) > MAX_COMBINATION_EVALUATIONS) {
    const reduciblePools = shortlist.filter((pool) => pool.candidates.length > pool.needed)
    if (reduciblePools.length === 0) break
    reduciblePools.sort((left, right) => {
      const countDifference = combinationCount(right.candidates.length, right.needed) - combinationCount(left.candidates.length, left.needed)
      return countDifference || right.candidates.length - left.candidates.length
    })
    reduciblePools[0].candidates.pop()
  }
  return shortlist
}

function normalizeCandidatePool(ids: readonly number[], category: SlotCategory, context: ScoreContext): number[] {
  return [...new Set(ids)].filter((id) => {
    const ability = context.abilities.get(id)
    return ability !== undefined && matchesSlotCategory(ability, category)
  })
}

function selectedCandidates(candidateIds: number[], selectedIds: number[], limit: number): number[] {
  const selected = new Set(selectedIds)
  return candidateIds.filter((id) => selected.has(id)).slice(0, limit)
}

export function recommendBuilds(
  candidatePools: BuildCandidatePools,
  selectedIds: number[],
  snapshot: Snapshot,
  limit = 10,
): Recommendation[] {
  if (limit <= 0) return []
  const context = createScoreContext(snapshot)
  const heroCandidates = normalizeCandidatePool(candidatePools.heroIds, 'hero', context)
  const normalCandidates = normalizeCandidatePool(candidatePools.normalIds, 'normal', context)
  const ultimateCandidates = normalizeCandidatePool(candidatePools.ultimateIds, 'ultimate', context)
  const selectedHeroIds = selectedCandidates(heroCandidates, selectedIds, BUILD_PICK_LIMITS.hero)
  const selectedNormalIds = selectedCandidates(normalCandidates, selectedIds, BUILD_PICK_LIMITS.normal)
  const selectedUltimateIds = selectedCandidates(ultimateCandidates, selectedIds, BUILD_PICK_LIMITS.ultimate)

  const pools: SearchPool[] = [
    {
      category: 'hero',
      candidates: heroCandidates.filter((id) => !selectedHeroIds.includes(id)),
      needed: BUILD_PICK_LIMITS.hero - selectedHeroIds.length,
    },
    {
      category: 'normal',
      candidates: normalCandidates.filter((id) => !selectedNormalIds.includes(id)),
      needed: BUILD_PICK_LIMITS.normal - selectedNormalIds.length,
    },
    {
      category: 'ultimate',
      candidates: ultimateCandidates.filter((id) => !selectedUltimateIds.includes(id)),
      needed: BUILD_PICK_LIMITS.ultimate - selectedUltimateIds.length,
    },
  ]
  if (pools.some((pool) => pool.needed < 0 || pool.candidates.length < pool.needed)) return []

  const selected = [...selectedHeroIds, ...selectedNormalIds, ...selectedUltimateIds]
  const [heroPool, normalPool, ultimatePool] = shortlistCandidatePools(pools, selected, context)
  const recommendations: Recommendation[] = []
  forEachCombination(heroPool.candidates, heroPool.needed, (heroAddition) => {
    forEachCombination(normalPool.candidates, normalPool.needed, (normalAddition) => {
      forEachCombination(ultimatePool.candidates, ultimatePool.needed, (ultimateAddition) => {
        recommendations.push(scoreBuild([
          ...selectedHeroIds,
          ...heroAddition,
          ...selectedNormalIds,
          ...normalAddition,
          ...selectedUltimateIds,
          ...ultimateAddition,
        ], context))
      })
    })
  })

  return recommendations
    .sort((left, right) => right.score - left.score || right.synergy - left.synergy || right.abilityWinRate - left.abilityWinRate || left.abilityIds.join(':').localeCompare(right.abilityIds.join(':')))
    .slice(0, limit)
}
