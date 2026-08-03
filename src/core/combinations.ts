import type {
  Ability,
  AbilityStats,
  CombinationRecommendation,
  RecognizedSlot,
  Snapshot,
} from '../types'
import {
  buildAbilityStatsMap,
  buildPairStatsMap,
  buildTripletStatsMap,
  calculateCombinedLogit,
  calculateLogit,
  calculateSigmoid,
  calculateWinRate,
  MIN_ABILITY_PAIR_PICKS,
} from './pairs'

const ABILITIES_MAP_CACHE = new WeakMap<Ability[], Map<number, Ability>>()

export interface CombinationRecommendationOptions {
  limit: number
  minWinRate: number
  minSynergy: number
}

export const MAX_COMBINATION_RECOMMENDATIONS = 30

export const DEFAULT_COMBINATION_RECOMMENDATION_OPTIONS: CombinationRecommendationOptions =
  {
    limit: MAX_COMBINATION_RECOMMENDATIONS,
    minWinRate: 0.55,
    minSynergy: 0.05,
  }

export function normalizeCombinationRecommendationOptions(
  value: unknown,
): CombinationRecommendationOptions {
  if (!value || typeof value !== 'object')
    return DEFAULT_COMBINATION_RECOMMENDATION_OPTIONS
  const options = value as Partial<CombinationRecommendationOptions>
  return {
    limit:
      Number.isFinite(options.limit) && Number(options.limit) > 0
        ? Math.min(
            Math.floor(Number(options.limit)),
            MAX_COMBINATION_RECOMMENDATIONS,
          )
        : DEFAULT_COMBINATION_RECOMMENDATION_OPTIONS.limit,
    minWinRate:
      Number.isFinite(options.minWinRate) &&
      Number(options.minWinRate) >= 0 &&
      Number(options.minWinRate) <= 1
        ? Number(options.minWinRate)
        : DEFAULT_COMBINATION_RECOMMENDATION_OPTIONS.minWinRate,
    minSynergy:
      Number.isFinite(options.minSynergy) &&
      Number(options.minSynergy) >= -1 &&
      Number(options.minSynergy) <= 1
        ? Number(options.minSynergy)
        : DEFAULT_COMBINATION_RECOMMENDATION_OPTIONS.minSynergy,
  }
}

export function collectConfirmedCombinationCandidateIds(
  slots: readonly RecognizedSlot[],
): number[] {
  return [
    ...new Set(
      slots.flatMap((slot) =>
        slot.selectedAbilityId === undefined ? [] : [slot.selectedAbilityId],
      ),
    ),
  ]
}

function buildAbilitiesMap(abilities: Ability[]): Map<number, Ability> {
  const cached = ABILITIES_MAP_CACHE.get(abilities)
  if (cached) return cached
  const map = new Map(abilities.map((ability) => [ability.id, ability]))
  ABILITIES_MAP_CACHE.set(abilities, map)
  return map
}

function buildRecommendation(
  type: CombinationRecommendation['type'],
  abilityIds: number[],
  picks: number,
  wins: number,
  abilities: ReadonlyMap<number, Ability>,
  stats: Map<number, AbilityStats>,
  selectedIds: ReadonlySet<number>,
): CombinationRecommendation | undefined {
  if (abilityIds.some((id) => !abilities.has(id))) return undefined

  const componentWinRates = abilityIds.map((id) => {
    const stat = stats.get(id)
    return stat ? calculateWinRate(stat.picks, stat.wins) : undefined
  })
  if (
    componentWinRates.some(
      (rate) => rate === undefined || rate <= 0 || rate >= 1,
    )
  )
    return undefined

  const winRate = calculateWinRate(picks, wins)
  if (winRate === undefined || winRate <= 0 || winRate >= 1) return undefined
  const baseLogit = calculateCombinedLogit(componentWinRates as number[])
  const observedLogit = calculateLogit(winRate)
  if (baseLogit === undefined || observedLogit === undefined) return undefined

  const baseWinRate = calculateSigmoid(baseLogit)
  return {
    type,
    abilityIds,
    score: winRate * 100,
    winRate,
    baseWinRate,
    synergy: winRate - baseWinRate,
    logitSynergy: observedLogit - baseLogit,
    picks,
    selectedCount: abilityIds.filter((id) => selectedIds.has(id)).length,
  }
}

function recommendAbilityCombinationsInternal(
  candidateIds: readonly number[],
  selectedIds: readonly number[],
  snapshot: Snapshot,
  options: CombinationRecommendationOptions,
): CombinationRecommendation[] {
  if (options.limit <= 0) return []

  const candidateSet = new Set([...candidateIds, ...selectedIds])
  const stats = buildAbilityStatsMap(snapshot.abilityStats)
  const abilities = buildAbilitiesMap(snapshot.abilities)
  const selectedSet = new Set(selectedIds)
  const recommendations: CombinationRecommendation[] = []

  for (const pair of buildPairStatsMap(snapshot.pairStats).values()) {
    if (
      pair.picks < MIN_ABILITY_PAIR_PICKS ||
      !candidateSet.has(pair.abilityIdOne) ||
      !candidateSet.has(pair.abilityIdTwo)
    )
      continue
    const recommendation = buildRecommendation(
      'pair',
      [pair.abilityIdOne, pair.abilityIdTwo].sort(
        (left, right) => left - right,
      ),
      pair.picks,
      pair.wins,
      abilities,
      stats,
      selectedSet,
    )
    if (recommendation) recommendations.push(recommendation)
  }

  for (const triple of buildTripletStatsMap(
    snapshot.tripletStats ?? [],
  ).values()) {
    if (
      triple.picks < MIN_ABILITY_PAIR_PICKS ||
      !candidateSet.has(triple.abilityIdOne) ||
      !candidateSet.has(triple.abilityIdTwo) ||
      !candidateSet.has(triple.abilityIdThree)
    )
      continue
    const recommendation = buildRecommendation(
      'triple',
      [triple.abilityIdOne, triple.abilityIdTwo, triple.abilityIdThree].sort(
        (left, right) => left - right,
      ),
      triple.picks,
      triple.wins,
      abilities,
      stats,
      selectedSet,
    )
    if (recommendation) recommendations.push(recommendation)
  }

  return recommendations
    .filter(
      (recommendation) =>
        recommendation.winRate > options.minWinRate &&
        recommendation.synergy > options.minSynergy,
    )
    .sort(
      (left, right) =>
        right.score - left.score ||
        Math.abs(right.synergy) - Math.abs(left.synergy) ||
        right.selectedCount - left.selectedCount ||
        right.picks - left.picks ||
        left.type.localeCompare(right.type) ||
        left.abilityIds.join(':').localeCompare(right.abilityIds.join(':')),
    )
    .slice(0, options.limit)
}

export function recommendAbilityCombinations(
  candidateIds: readonly number[],
  selectedIds: readonly number[],
  snapshot: Snapshot,
  options: Partial<CombinationRecommendationOptions> = {},
): CombinationRecommendation[] {
  return recommendAbilityCombinationsInternal(
    candidateIds,
    selectedIds,
    snapshot,
    normalizeCombinationRecommendationOptions(options),
  )
}
