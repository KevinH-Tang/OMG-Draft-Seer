import type {
  Ability,
  AbilityStats,
  PairStats,
  PartialRecommendationInteraction,
  Recommendation,
  RecommendationInteraction,
  SlotCategory,
  Snapshot,
  TripletStats,
} from '../types'
import { matchesSlotCategory } from './ability-category'
import {
  abilityPairKey,
  abilityTripletKey,
  buildAbilityStatsMap,
  buildPairStatsMap,
  buildTripletStatsMap,
  calculateCombinedLogit,
  calculateLogit,
  calculateSigmoid,
  calculateWinRate,
  MIN_ABILITY_PAIR_PICKS,
} from './pairs'
import { buildAbilityTierList } from './tiers'

export const MAX_COMBINATION_EVALUATIONS = 50_000
export const MAX_SHORTLIST_SIZE = 28

export const BUILD_PICK_LIMITS = {
  hero: 1,
  ability: 3,
  ultimate: 1,
} as const

export interface BuildCandidatePools {
  heroIds: readonly number[]
  abilityIds: readonly number[]
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
  metrics: Map<number, AbilityMetric>
  pairImpacts: Map<string, InteractionImpact | null>
  tripletImpacts: Map<string, TripleImpact | null>
}

const SCORE_CONTEXT_CACHE = new WeakMap<Snapshot, ScoreContext>()

interface InteractionEstimate {
  baselineLogit: number
  rawValue: number
  picks: number
}

interface InteractionImpact {
  value: number
  rawValue: number
  synergy: number
  rawSynergy: number
  picks: number
  type: RecommendationInteraction['type']
  abilityIds: number[]
}

interface PartialTripleImpact {
  abilityIds: number[]
  rawValue: number
  picks: number
  pairCoverage: number
  missingPairIds: number[][]
}

interface TripleImpact {
  impact?: InteractionImpact
  partial?: PartialTripleImpact
}

interface InteractionSummary {
  value: number
  effectiveInteractions: RecommendationInteraction[]
  partialInteractions: PartialRecommendationInteraction[]
}

interface SearchPool {
  category: SlotCategory
  candidates: number[]
  needed: number
}

const BUILD_SLOT_CATEGORIES: readonly SlotCategory[] = [
  'hero',
  'ability',
  'ultimate',
]

function createTierMetrics(snapshot: Snapshot): Map<number, TierMetric> {
  const metrics = new Map<number, TierMetric>()
  for (const category of BUILD_SLOT_CATEGORIES) {
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
  const cached = SCORE_CONTEXT_CACHE.get(snapshot)
  if (cached) return cached

  const abilities = new Map(
    snapshot.abilities.map((ability) => [ability.id, ability]),
  )
  const context = {
    abilities,
    stats: buildAbilityStatsMap(snapshot.abilityStats),
    pairs: buildPairStatsMap(snapshot.pairStats),
    triplets: buildTripletStatsMap(snapshot.tripletStats ?? []),
    tiers: createTierMetrics(snapshot),
    metrics: new Map<number, AbilityMetric>(),
    pairImpacts: new Map<string, InteractionImpact | null>(),
    tripletImpacts: new Map<string, TripleImpact | null>(),
  }
  SCORE_CONTEXT_CACHE.set(snapshot, context)
  return context
}

function abilityMetric(
  abilityId: number,
  context: ScoreContext,
): AbilityMetric {
  const cached = context.metrics.get(abilityId)
  if (cached) return cached

  const stat = context.stats.get(abilityId)
  const winRate = stat ? calculateWinRate(stat.picks, stat.wins) : undefined
  const metric =
    !stat || winRate === undefined
      ? { winRate: 0.5, picks: 0 }
      : {
          winRate,
          avgPickPosition: stat.avgPickPosition,
          picks: stat.picks,
        }
  context.metrics.set(abilityId, metric)
  return metric
}

function estimateInteraction(
  abilityIds: number[],
  wins: number,
  picks: number,
  context: ScoreContext,
): InteractionEstimate | undefined {
  if (picks < MIN_ABILITY_PAIR_PICKS) return undefined
  const groupWinRate = calculateWinRate(picks, wins)
  if (groupWinRate === undefined || groupWinRate <= 0 || groupWinRate >= 1)
    return undefined
  const metrics = abilityIds.map((id) => abilityMetric(id, context))
  if (
    metrics.some(
      (metric) =>
        metric.picks <= 0 || metric.winRate <= 0 || metric.winRate >= 1,
    )
  )
    return undefined
  const baselineLogit = calculateCombinedLogit(
    metrics.map((metric) => metric.winRate),
  )
  const groupLogit = calculateLogit(groupWinRate)
  if (baselineLogit === undefined || groupLogit === undefined) return undefined
  return {
    baselineLogit,
    rawValue: groupLogit - baselineLogit,
    picks,
  }
}

function buildInteractionImpact(
  type: RecommendationInteraction['type'],
  abilityIds: number[],
  estimate: InteractionEstimate,
): InteractionImpact {
  const value = estimate.rawValue
  const baseline = calculateSigmoid(estimate.baselineLogit)
  return {
    value,
    rawValue: estimate.rawValue,
    synergy: calculateSigmoid(estimate.baselineLogit + value) - baseline,
    rawSynergy:
      calculateSigmoid(estimate.baselineLogit + estimate.rawValue) - baseline,
    picks: estimate.picks,
    type,
    abilityIds,
  }
}

function pairImpact(
  leftId: number,
  rightId: number,
  context: ScoreContext,
): InteractionImpact | undefined {
  const key = abilityPairKey(leftId, rightId)
  if (context.pairImpacts.has(key))
    return context.pairImpacts.get(key) ?? undefined
  const pair = context.pairs.get(key)
  const estimate = pair
    ? estimateInteraction([leftId, rightId], pair.wins, pair.picks, context)
    : undefined
  const impact = estimate
    ? buildInteractionImpact('pair', [leftId, rightId], estimate)
    : undefined
  context.pairImpacts.set(key, impact ?? null)
  return impact
}

function tripletImpact(
  firstId: number,
  secondId: number,
  thirdId: number,
  context: ScoreContext,
): TripleImpact | undefined {
  const key = abilityTripletKey(firstId, secondId, thirdId)
  if (context.tripletImpacts.has(key))
    return context.tripletImpacts.get(key) ?? undefined
  const triplet = context.triplets.get(key)
  if (!triplet) {
    context.tripletImpacts.set(key, null)
    return undefined
  }
  const direct = estimateInteraction(
    [firstId, secondId, thirdId],
    triplet.wins,
    triplet.picks,
    context,
  )
  if (!direct) {
    context.tripletImpacts.set(key, null)
    return undefined
  }

  const pairEntries = [
    {
      ids: [firstId, secondId],
      impact: pairImpact(firstId, secondId, context),
    },
    { ids: [firstId, thirdId], impact: pairImpact(firstId, thirdId, context) },
    {
      ids: [secondId, thirdId],
      impact: pairImpact(secondId, thirdId, context),
    },
  ]
  const pairImpacts = pairEntries
    .map((entry) => entry.impact)
    .filter((impact): impact is InteractionImpact => impact !== undefined)
  if (pairImpacts.length < pairEntries.length) {
    const result = {
      partial: {
        abilityIds: [firstId, secondId, thirdId],
        rawValue: direct.rawValue,
        picks: direct.picks,
        pairCoverage: pairImpacts.length,
        missingPairIds: pairEntries
          .filter((entry) => entry.impact === undefined)
          .map((entry) => entry.ids),
      },
    }
    context.tripletImpacts.set(key, result)
    return result
  }

  const incrementalEstimate: InteractionEstimate = {
    ...direct,
    rawValue:
      direct.rawValue -
      pairImpacts.reduce((sum, impact) => sum + impact.value, 0),
  }
  const result = {
    impact: buildInteractionImpact(
      'triple',
      [firstId, secondId, thirdId],
      incrementalEstimate,
    ),
  }
  context.tripletImpacts.set(key, result)
  return result
}

function buildInteractionSummary(
  ids: number[],
  context: ScoreContext,
): InteractionSummary {
  const candidates: InteractionImpact[] = []
  const partialInteractions: PartialRecommendationInteraction[] = []
  for (let leftIndex = 0; leftIndex < ids.length; leftIndex += 1) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < ids.length;
      rightIndex += 1
    ) {
      const impact = pairImpact(ids[leftIndex], ids[rightIndex], context)
      if (!impact || impact.value === 0) continue
      candidates.push({
        ...impact,
        type: 'pair',
        abilityIds: [ids[leftIndex], ids[rightIndex]],
      })
    }
  }
  for (let firstIndex = 0; firstIndex < ids.length; firstIndex += 1) {
    for (
      let secondIndex = firstIndex + 1;
      secondIndex < ids.length;
      secondIndex += 1
    ) {
      for (
        let thirdIndex = secondIndex + 1;
        thirdIndex < ids.length;
        thirdIndex += 1
      ) {
        const triple = tripletImpact(
          ids[firstIndex],
          ids[secondIndex],
          ids[thirdIndex],
          context,
        )
        if (!triple) continue
        if (triple.impact && triple.impact.value !== 0) {
          candidates.push({
            ...triple.impact,
            abilityIds: [ids[firstIndex], ids[secondIndex], ids[thirdIndex]],
          })
        } else if (triple.partial) {
          partialInteractions.push({
            type: 'triple',
            abilityIds: triple.partial.abilityIds,
            rawLogitSynergy: triple.partial.rawValue,
            picks: triple.partial.picks,
            pairCoverage: triple.partial.pairCoverage,
            missingPairIds: triple.partial.missingPairIds,
          })
        }
      }
    }
  }

  return {
    value: candidates.reduce((sum, candidate) => sum + candidate.value, 0),
    effectiveInteractions: candidates
      .map(
        ({
          type,
          abilityIds,
          value,
          rawValue,
          synergy,
          rawSynergy,
          picks,
        }) => ({
          type,
          abilityIds,
          synergy,
          rawSynergy,
          logitSynergy: value,
          rawLogitSynergy: rawValue,
          picks,
        }),
      )
      .sort(
        (left, right) =>
          Math.abs(right.logitSynergy) - Math.abs(left.logitSynergy) ||
          right.picks - left.picks,
      ),
    partialInteractions: partialInteractions.sort(
      (left, right) =>
        Math.abs(right.rawLogitSynergy) - Math.abs(left.rawLogitSynergy) ||
        right.picks - left.picks,
    ),
  }
}

function combinationCount(
  items: number,
  needed: number,
  stopAt = Number.POSITIVE_INFINITY,
): number {
  if (needed < 0 || needed > items) return 0
  const selected = Math.min(needed, items - needed)
  let count = 1
  for (let index = 1; index <= selected; index += 1) {
    count = (count * (items - selected + index)) / index
    if (count > stopAt) return count
  }
  return count
}

function searchCombinationCount(
  pools: SearchPool[],
  stopAt = Number.POSITIVE_INFINITY,
): number {
  let count = 1
  for (const pool of pools) {
    const poolCount = combinationCount(
      pool.candidates.length,
      pool.needed,
      stopAt / count,
    )
    count *= poolCount
    if (count > stopAt) return count
  }
  return count
}

function forEachCombination<T>(
  items: T[],
  needed: number,
  visit: (selection: T[]) => void,
): void {
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
  const baseLogit =
    calculateCombinedLogit(individual.map((metric) => metric.winRate)) ?? 0
  const synergy = buildInteractionSummary(ids, context)
  const abilityWinRate = calculateSigmoid(baseLogit)
  const scoreWinRate = calculateSigmoid(baseLogit + synergy.value)
  const score = scoreWinRate * 100
  const positions = individual.flatMap((metric) =>
    metric.avgPickPosition === undefined ? [] : [metric.avgPickPosition],
  )
  const averagePickPosition =
    positions.length > 0
      ? positions.reduce((sum, position) => sum + position, 0) /
        positions.length
      : 50
  const pickOrderIds = ids
    .map((id, index) => ({
      id,
      index,
      position:
        abilityMetric(id, context).avgPickPosition ?? Number.POSITIVE_INFINITY,
    }))
    .sort(
      (left, right) =>
        left.position - right.position || left.index - right.index,
    )
    .map((item) => item.id)
  return {
    abilityIds: ids,
    pickOrderIds,
    score,
    abilityWinRate,
    synergy: scoreWinRate - abilityWinRate,
    logitSynergy: synergy.value,
    effectiveInteractionCount: synergy.effectiveInteractions.length,
    effectiveInteractions: synergy.effectiveInteractions,
    partialInteractions: synergy.partialInteractions,
    averagePickPosition,
  }
}

export function scoreDraftBuild(
  ids: readonly number[],
  snapshot: Snapshot,
): Recommendation | undefined {
  if (
    ids.length !==
    BUILD_PICK_LIMITS.hero +
      BUILD_PICK_LIMITS.ability +
      BUILD_PICK_LIMITS.ultimate
  )
    return undefined
  const context = createScoreContext(snapshot)
  const selected = [...new Set(ids)]
  if (selected.length !== ids.length) return undefined

  const grouped: Record<SlotCategory, number[]> = {
    hero: [],
    ability: [],
    ultimate: [],
  }
  for (const id of selected) {
    const ability = context.abilities.get(id)
    if (!ability) return undefined
    const category = (['hero', 'ability', 'ultimate'] as const).find(
      (candidate) => matchesSlotCategory(ability, candidate),
    )
    if (!category) return undefined
    grouped[category].push(id)
  }
  if (
    grouped.hero.length !== BUILD_PICK_LIMITS.hero ||
    grouped.ability.length !== BUILD_PICK_LIMITS.ability ||
    grouped.ultimate.length !== BUILD_PICK_LIMITS.ultimate
  )
    return undefined
  return scoreBuild(
    [...grouped.hero, ...grouped.ability, ...grouped.ultimate],
    context,
  )
}

function candidatePriority(
  id: number,
  selectedIds: number[],
  referenceIds: number[],
  context: ScoreContext,
): number {
  const tierStrength = context.tiers.get(id)?.strength ?? 0
  const baseLogit =
    calculateCombinedLogit([abilityMetric(id, context).winRate]) ?? 0
  const selectedPairPotential = selectedIds.reduce(
    (sum, selectedId) =>
      sum + (pairImpact(id, selectedId, context)?.value ?? 0),
    0,
  )
  let selectedTriplePotential = 0
  for (let firstIndex = 0; firstIndex < selectedIds.length; firstIndex += 1) {
    for (
      let secondIndex = firstIndex + 1;
      secondIndex < selectedIds.length;
      secondIndex += 1
    ) {
      selectedTriplePotential +=
        tripletImpact(
          id,
          selectedIds[firstIndex],
          selectedIds[secondIndex],
          context,
        )?.impact?.value ?? 0
    }
  }
  const pairPotential = referenceIds.reduce((best, referenceId) => {
    if (referenceId === id) return best
    return Math.max(best, pairImpact(id, referenceId, context)?.value ?? 0)
  }, 0)
  let futureTriplePotential = 0
  for (const selectedId of selectedIds) {
    for (const referenceId of referenceIds) {
      if (referenceId === id || referenceId === selectedId) continue
      futureTriplePotential = Math.max(
        futureTriplePotential,
        tripletImpact(id, selectedId, referenceId, context)?.impact?.value ?? 0,
      )
    }
  }
  return (
    tierStrength * 100 +
    baseLogit * 10 +
    selectedPairPotential * 100 +
    selectedTriplePotential * 100 +
    pairPotential * 50 +
    futureTriplePotential * 50
  )
}

function shortlistCandidatePools(
  pools: SearchPool[],
  selectedIds: number[],
  context: ScoreContext,
): SearchPool[] {
  if (
    searchCombinationCount(pools, MAX_COMBINATION_EVALUATIONS) <=
    MAX_COMBINATION_EVALUATIONS
  )
    return pools
  const referenceIds = [
    ...new Set([...selectedIds, ...pools.flatMap((pool) => pool.candidates)]),
  ]

  const shortlist = pools.map((pool) => ({
    ...pool,
    candidates: pool.candidates
      .map((id, index) => ({
        id,
        index,
        priority: candidatePriority(id, selectedIds, referenceIds, context),
      }))
      .sort(
        (left, right) =>
          right.priority - left.priority || left.index - right.index,
      )
      .slice(0, Math.max(pool.needed, MAX_SHORTLIST_SIZE))
      .map((candidate) => candidate.id),
  }))

  while (
    searchCombinationCount(shortlist, MAX_COMBINATION_EVALUATIONS) >
    MAX_COMBINATION_EVALUATIONS
  ) {
    const reduciblePools = shortlist.filter(
      (pool) => pool.candidates.length > pool.needed,
    )
    if (reduciblePools.length === 0) break
    reduciblePools.sort((left, right) => {
      const countDifference =
        combinationCount(right.candidates.length, right.needed) -
        combinationCount(left.candidates.length, left.needed)
      return countDifference || right.candidates.length - left.candidates.length
    })
    reduciblePools[0].candidates.pop()
  }
  return shortlist
}

function normalizeCandidatePool(
  ids: readonly number[],
  category: SlotCategory,
  context: ScoreContext,
): number[] {
  return [...new Set(ids)].filter((id) => {
    const ability = context.abilities.get(id)
    return ability !== undefined && matchesSlotCategory(ability, category)
  })
}

function selectedCandidates(
  candidateIds: number[],
  selectedIds: number[],
  limit: number,
): number[] {
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
  const heroCandidates = normalizeCandidatePool(
    candidatePools.heroIds,
    'hero',
    context,
  )
  const abilityCandidates = normalizeCandidatePool(
    candidatePools.abilityIds,
    'ability',
    context,
  )
  const ultimateCandidates = normalizeCandidatePool(
    candidatePools.ultimateIds,
    'ultimate',
    context,
  )
  const selectedHeroIds = selectedCandidates(
    heroCandidates,
    selectedIds,
    BUILD_PICK_LIMITS.hero,
  )
  const selectedAbilityIds = selectedCandidates(
    abilityCandidates,
    selectedIds,
    BUILD_PICK_LIMITS.ability,
  )
  const selectedUltimateIds = selectedCandidates(
    ultimateCandidates,
    selectedIds,
    BUILD_PICK_LIMITS.ultimate,
  )

  const pools: SearchPool[] = [
    {
      category: 'hero',
      candidates: heroCandidates.filter((id) => !selectedHeroIds.includes(id)),
      needed: BUILD_PICK_LIMITS.hero - selectedHeroIds.length,
    },
    {
      category: 'ability',
      candidates: abilityCandidates.filter(
        (id) => !selectedAbilityIds.includes(id),
      ),
      needed: BUILD_PICK_LIMITS.ability - selectedAbilityIds.length,
    },
    {
      category: 'ultimate',
      candidates: ultimateCandidates.filter(
        (id) => !selectedUltimateIds.includes(id),
      ),
      needed: BUILD_PICK_LIMITS.ultimate - selectedUltimateIds.length,
    },
  ]
  if (
    pools.some(
      (pool) => pool.needed < 0 || pool.candidates.length < pool.needed,
    )
  )
    return []

  const selected = [
    ...selectedHeroIds,
    ...selectedAbilityIds,
    ...selectedUltimateIds,
  ]
  const [heroPool, abilityPool, ultimatePool] = shortlistCandidatePools(
    pools,
    selected,
    context,
  )
  const recommendations: Recommendation[] = []
  forEachCombination(heroPool.candidates, heroPool.needed, (heroAddition) => {
    forEachCombination(
      abilityPool.candidates,
      abilityPool.needed,
      (abilityAddition) => {
        forEachCombination(
          ultimatePool.candidates,
          ultimatePool.needed,
          (ultimateAddition) => {
            recommendations.push(
              scoreBuild(
                [
                  ...selectedHeroIds,
                  ...heroAddition,
                  ...selectedAbilityIds,
                  ...abilityAddition,
                  ...selectedUltimateIds,
                  ...ultimateAddition,
                ],
                context,
              ),
            )
          },
        )
      },
    )
  })

  return recommendations
    .sort(
      (left, right) =>
        right.score - left.score ||
        right.synergy - left.synergy ||
        right.abilityWinRate - left.abilityWinRate ||
        left.abilityIds.join(':').localeCompare(right.abilityIds.join(':')),
    )
    .slice(0, limit)
}
