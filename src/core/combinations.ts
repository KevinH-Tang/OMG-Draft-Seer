import type {
  Ability,
  AbilityStats,
  CombinationRecommendation,
  CombinationRecommendationGroup,
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
  pairMinWinRate: number
  pairMinSynergy: number
  tripleMinWinRate: number
  tripleMinSynergy: number
}

interface LegacyCombinationRecommendationOptions {
  minWinRate?: number
  minSynergy?: number
}

export const MAX_COMBINATION_RECOMMENDATIONS = 100

export const DEFAULT_COMBINATION_RECOMMENDATION_OPTIONS: CombinationRecommendationOptions =
  {
    limit: MAX_COMBINATION_RECOMMENDATIONS,
    pairMinWinRate: 0.55,
    pairMinSynergy: 0.05,
    tripleMinWinRate: 0.55,
    tripleMinSynergy: 0.05,
  }

function normalizeThreshold(
  value: unknown,
  fallback: number,
  minimum: number,
): number {
  return Number.isFinite(value) &&
    Number(value) >= minimum &&
    Number(value) <= 1
    ? Number(value)
    : fallback
}

export function normalizeCombinationRecommendationOptions(
  value: unknown,
): CombinationRecommendationOptions {
  if (!value || typeof value !== 'object')
    return DEFAULT_COMBINATION_RECOMMENDATION_OPTIONS
  const options = value as Partial<CombinationRecommendationOptions> &
    LegacyCombinationRecommendationOptions
  const legacyMinWinRate = normalizeThreshold(
    options.minWinRate,
    DEFAULT_COMBINATION_RECOMMENDATION_OPTIONS.pairMinWinRate,
    0,
  )
  const legacyMinSynergy = normalizeThreshold(
    options.minSynergy,
    DEFAULT_COMBINATION_RECOMMENDATION_OPTIONS.pairMinSynergy,
    -1,
  )
  return {
    limit:
      Number.isFinite(options.limit) && Number(options.limit) > 0
        ? Math.min(
            Math.floor(Number(options.limit)),
            MAX_COMBINATION_RECOMMENDATIONS,
          )
        : DEFAULT_COMBINATION_RECOMMENDATION_OPTIONS.limit,
    pairMinWinRate: normalizeThreshold(
      options.pairMinWinRate,
      legacyMinWinRate,
      0,
    ),
    pairMinSynergy: normalizeThreshold(
      options.pairMinSynergy,
      legacyMinSynergy,
      -1,
    ),
    tripleMinWinRate: normalizeThreshold(
      options.tripleMinWinRate,
      legacyMinWinRate,
      0,
    ),
    tripleMinSynergy: normalizeThreshold(
      options.tripleMinSynergy,
      legacyMinSynergy,
      -1,
    ),
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

interface CombinationCandidates {
  pairs: CombinationRecommendation[]
  triples: CombinationRecommendation[]
}

function pairKey(abilityIds: readonly number[]): string {
  return [...abilityIds].sort((left, right) => left - right).join(':')
}

export function findThirdAbilityId(
  pairAbilityIds: readonly number[],
  tripleAbilityIds: readonly number[],
): number | undefined {
  const remainingPairIds = [...pairAbilityIds]
  return tripleAbilityIds.find((abilityId) => {
    const pairIndex = remainingPairIds.indexOf(abilityId)
    if (pairIndex < 0) return true
    remainingPairIds.splice(pairIndex, 1)
    return false
  })
}

export interface CombinationAbilityOccurrence {
  abilityId: number
  count: number
}

export function rankCombinationAbilityOccurrences(
  groups: readonly CombinationRecommendationGroup[],
  abilityStats: readonly AbilityStats[],
  limit = 8,
): CombinationAbilityOccurrence[] {
  if (!Number.isFinite(limit) || limit <= 0) return []
  const occurrences = new Map<
    number,
    CombinationAbilityOccurrence & { firstSeen: number }
  >()
  let firstSeen = 0
  const winRates = new Map(
    abilityStats.map((stat) => [
      stat.abilityId,
      calculateWinRate(stat.picks, stat.wins) ?? Number.NEGATIVE_INFINITY,
    ]),
  )
  const countAbility = (abilityId: number) => {
    const occurrence = occurrences.get(abilityId)
    if (occurrence) {
      occurrence.count += 1
      return
    }
    occurrences.set(abilityId, { abilityId, count: 1, firstSeen })
    firstSeen += 1
  }

  for (const group of groups) {
    group.pairAbilityIds.forEach(countAbility)
    for (const triple of group.triples) {
      const abilityId = findThirdAbilityId(
        group.pairAbilityIds,
        triple.abilityIds,
      )
      if (abilityId !== undefined) countAbility(abilityId)
    }
  }

  return [...occurrences.values()]
    .sort(
      (left, right) =>
        right.count - left.count ||
        (winRates.get(right.abilityId) ?? Number.NEGATIVE_INFINITY) -
          (winRates.get(left.abilityId) ?? Number.NEGATIVE_INFINITY) ||
        left.firstSeen - right.firstSeen ||
        left.abilityId - right.abilityId,
    )
    .slice(0, Math.floor(limit))
    .map(({ abilityId, count }) => ({ abilityId, count }))
}

function buildCombinationCandidates(
  candidateIds: readonly number[],
  selectedIds: readonly number[],
  snapshot: Snapshot,
): CombinationCandidates {
  const candidateSet = new Set([...candidateIds, ...selectedIds])
  const stats = buildAbilityStatsMap(snapshot.abilityStats)
  const abilities = buildAbilitiesMap(snapshot.abilities)
  const selectedSet = new Set(selectedIds)
  const pairs: CombinationRecommendation[] = []
  const triples: CombinationRecommendation[] = []

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
    if (recommendation) {
      pairs.push(recommendation)
    }
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
    if (recommendation) triples.push(recommendation)
  }

  return { pairs, triples }
}

function recommendAbilityCombinationsInternal(
  candidateIds: readonly number[],
  selectedIds: readonly number[],
  snapshot: Snapshot,
  options: CombinationRecommendationOptions,
): CombinationRecommendation[] {
  if (options.limit <= 0) return []

  const { pairs, triples } = buildCombinationCandidates(
    candidateIds,
    selectedIds,
    snapshot,
  )

  return [...pairs, ...triples]
    .filter((recommendation) =>
      passesRecommendationThreshold(recommendation, options),
    )
    .sort(compareRecommendations)
    .slice(0, options.limit)
}

function passesRecommendationThreshold(
  recommendation: CombinationRecommendation,
  options: CombinationRecommendationOptions,
): boolean {
  const minWinRate =
    recommendation.type === 'pair'
      ? options.pairMinWinRate
      : options.tripleMinWinRate
  const minSynergy =
    recommendation.type === 'pair'
      ? options.pairMinSynergy
      : options.tripleMinSynergy
  return (
    recommendation.winRate > minWinRate && recommendation.synergy > minSynergy
  )
}

function compareRecommendations(
  left: CombinationRecommendation,
  right: CombinationRecommendation,
): number {
  return (
    right.score - left.score ||
    Math.abs(right.synergy) - Math.abs(left.synergy) ||
    right.selectedCount - left.selectedCount ||
    right.picks - left.picks ||
    left.type.localeCompare(right.type) ||
    left.abilityIds.join(':').localeCompare(right.abilityIds.join(':'))
  )
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

export function recommendAbilityCombinationGroups(
  candidateIds: readonly number[],
  selectedIds: readonly number[],
  snapshot: Snapshot,
  options: Partial<CombinationRecommendationOptions> = {},
): CombinationRecommendationGroup[] {
  const normalizedOptions = normalizeCombinationRecommendationOptions(options)
  if (normalizedOptions.limit <= 0) return []

  const { pairs, triples } = buildCombinationCandidates(
    candidateIds,
    selectedIds,
    snapshot,
  )
  const groups = new Map<string, CombinationRecommendationGroup>()

  for (const pair of pairs) {
    groups.set(pairKey(pair.abilityIds), {
      pairAbilityIds: pair.abilityIds as [number, number],
      pair,
      triples: [],
    })
  }

  const eligibleTriples = triples.filter((recommendation) =>
    passesRecommendationThreshold(recommendation, normalizedOptions),
  )
  const ownershipCandidates = new Map<
    CombinationRecommendation,
    Array<[number, number]>
  >()
  const pairAggregationCounts = new Map<string, number>()
  const suppressedStandalonePairKeys = new Set<string>()

  for (const triple of eligibleTriples) {
    const [first, second, third] = triple.abilityIds
    const constituentPairs: Array<[number, number]> = [
      [first, second],
      [first, third],
      [second, third],
    ]
    const candidates = constituentPairs.filter((pairAbilityIds) => {
      const pair = groups.get(pairKey(pairAbilityIds))?.pair
      return pair === undefined || triple.winRate >= pair.winRate
    })
    ownershipCandidates.set(triple, candidates)
    for (const pairAbilityIds of candidates) {
      const key = pairKey(pairAbilityIds)
      pairAggregationCounts.set(key, (pairAggregationCounts.get(key) ?? 0) + 1)
    }
  }

  for (const triple of eligibleTriples) {
    const pairAbilityIds = ownershipCandidates
      .get(triple)
      ?.sort((left, right) => {
        const leftKey = pairKey(left)
        const rightKey = pairKey(right)
        const aggregationDifference =
          (pairAggregationCounts.get(rightKey) ?? 0) -
          (pairAggregationCounts.get(leftKey) ?? 0)
        if (aggregationDifference !== 0) return aggregationDifference

        const leftPair = groups.get(leftKey)?.pair
        const rightPair = groups.get(rightKey)?.pair
        if (leftPair && !rightPair) return -1
        if (!leftPair && rightPair) return 1
        if (leftPair && rightPair) {
          const synergyDifference = rightPair.synergy - leftPair.synergy
          if (synergyDifference !== 0) return synergyDifference
          const recommendationDifference = compareRecommendations(
            leftPair,
            rightPair,
          )
          if (recommendationDifference !== 0) return recommendationDifference
        }
        return leftKey.localeCompare(rightKey)
      })[0]
    if (!pairAbilityIds) continue

    const key = pairKey(pairAbilityIds)
    const group = groups.get(key) ?? { pairAbilityIds, triples: [] }
    group.triples.push(triple)
    groups.set(key, group)
    for (const candidatePairAbilityIds of ownershipCandidates.get(triple) ??
      []) {
      const candidateKey = pairKey(candidatePairAbilityIds)
      if (candidateKey !== key) suppressedStandalonePairKeys.add(candidateKey)
    }
  }

  for (const group of groups.values()) {
    group.triples.sort(compareRecommendations)
  }

  return [...groups.values()]
    .filter(
      (group) =>
        group.triples.length > 0 ||
        (!suppressedStandalonePairKeys.has(pairKey(group.pairAbilityIds)) &&
          group.pair !== undefined &&
          passesRecommendationThreshold(group.pair, normalizedOptions)),
    )
    .sort((left, right) => {
      if (left.pair && !right.pair) return -1
      if (!left.pair && right.pair) return 1
      const leftRank = left.pair ?? left.triples[0]
      const rightRank = right.pair ?? right.triples[0]
      return (
        compareRecommendations(leftRank, rightRank) ||
        pairKey(left.pairAbilityIds).localeCompare(
          pairKey(right.pairAbilityIds),
        )
      )
    })
    .slice(0, normalizedOptions.limit)
}
