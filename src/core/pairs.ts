import type { Ability, AbilityStats, PairStats, Snapshot, TripletStats } from '../types'
import { memoizeByKey } from './cache'

export const MIN_ABILITY_PAIR_PICKS = 50

export interface HiddenTriple {
  ability: Ability
  picks: number
  winRate: number
  winRateShift: number
}

export interface AbilityPairEntry {
  key: string
  abilityOne: Ability
  abilityTwo: Ability
  winRateOne: number | undefined
  winRateTwo: number | undefined
  picks: number
  wins: number
  pairWinRate: number
  synergy: number | undefined
  trueSynergy: number | undefined
  hiddenTriples: HiddenTriple[]
}

export interface AbilityPairOptions {
  excludeSameHero?: boolean
  minimumPicks?: number
}

const PAIR_STATS_MAP_CACHE = new WeakMap<PairStats[], Map<string, PairStats>>()
const TRIPLET_STATS_MAP_CACHE = new WeakMap<TripletStats[], Map<string, TripletStats>>()
const PAIR_LIST_CACHE = new WeakMap<Snapshot, Map<string, AbilityPairEntry[]>>()

export function abilityPairKey(leftId: number, rightId: number): string {
  return leftId < rightId ? `${leftId}-${rightId}` : `${rightId}-${leftId}`
}

export function abilityTripletKey(firstId: number, secondId: number, thirdId: number): string {
  return [firstId, secondId, thirdId].sort((left, right) => left - right).join('-')
}

function sameOwnerHero(left: Ability, right: Ability): boolean {
  return left.ownerHeroId !== undefined
    && right.ownerHeroId !== undefined
    && left.ownerHeroId === right.ownerHeroId
}

export function calculateWinRate(picks: number, wins: number): number | undefined {
  return picks > 0
    && Number.isFinite(picks)
    && Number.isFinite(wins)
    && wins >= 0
    && wins <= picks
    ? wins / picks
    : undefined
}

export function calculateLogit(value: number): number | undefined {
  if (!Number.isFinite(value) || value < 0 || value > 1) return undefined
  if (value === 0) return Number.NEGATIVE_INFINITY
  if (value === 1) return Number.POSITIVE_INFINITY
  return Math.log(value / (1 - value))
}

export function calculateSigmoid(value: number): number {
  if (value >= 0) {
    const exponential = Math.exp(-value)
    return 1 / (1 + exponential)
  }
  const exponential = Math.exp(value)
  return exponential / (1 + exponential)
}

export function calculateCombinedLogit(winRates: number[]): number | undefined {
  if (winRates.length === 0 || winRates.some((rate) => !Number.isFinite(rate) || rate < 0 || rate > 1)) return undefined

  let combinedLogit = 0
  let hasPositiveInfinity = false
  let hasNegativeInfinity = false
  for (const rate of winRates) {
    const logit = calculateLogit(rate)
    if (logit === Number.POSITIVE_INFINITY) {
      hasPositiveInfinity = true
      continue
    }
    if (logit === Number.NEGATIVE_INFINITY) {
      hasNegativeInfinity = true
      continue
    }
    if (logit === undefined) return undefined
    combinedLogit += logit
  }

  if (hasPositiveInfinity && hasNegativeInfinity) return 0
  if (hasPositiveInfinity) return Number.POSITIVE_INFINITY
  if (hasNegativeInfinity) return Number.NEGATIVE_INFINITY
  return combinedLogit
}

export function calculateLogitBase(winRates: number[]): number | undefined {
  const combinedLogit = calculateCombinedLogit(winRates)
  return combinedLogit === undefined ? undefined : calculateSigmoid(combinedLogit)
}

export function buildPairStatsMap(pairStats: PairStats[]): Map<string, PairStats> {
  const cached = PAIR_STATS_MAP_CACHE.get(pairStats)
  if (cached) return cached

  const pairs = new Map<string, PairStats>()
  for (const pair of pairStats) {
    if (calculateWinRate(pair.picks, pair.wins) === undefined) continue
    const key = abilityPairKey(pair.abilityIdOne, pair.abilityIdTwo)
    const previous = pairs.get(key)
    if (!previous || pair.picks > previous.picks) pairs.set(key, pair)
  }
  PAIR_STATS_MAP_CACHE.set(pairStats, pairs)
  return pairs
}

export function buildTripletStatsMap(tripletStats: TripletStats[]): Map<string, TripletStats> {
  const cached = TRIPLET_STATS_MAP_CACHE.get(tripletStats)
  if (cached) return cached

  const triplets = new Map<string, TripletStats>()
  for (const triplet of tripletStats) {
    if (calculateWinRate(triplet.picks, triplet.wins) === undefined) continue
    const key = abilityTripletKey(triplet.abilityIdOne, triplet.abilityIdTwo, triplet.abilityIdThree)
    const previous = triplets.get(key)
    if (!previous || triplet.picks > previous.picks) triplets.set(key, triplet)
  }
  TRIPLET_STATS_MAP_CACHE.set(tripletStats, triplets)
  return triplets
}

export function calculatePairSynergy(
  pair: PairStats,
  leftStats: AbilityStats | undefined,
  rightStats: AbilityStats | undefined,
): number | undefined {
  const pairWinRate = calculateWinRate(pair.picks, pair.wins)
  const leftWinRate = leftStats ? calculateWinRate(leftStats.picks, leftStats.wins) : undefined
  const rightWinRate = rightStats ? calculateWinRate(rightStats.picks, rightStats.wins) : undefined
  if (pairWinRate === undefined || leftWinRate === undefined || rightWinRate === undefined || leftWinRate <= 0 || rightWinRate <= 0) return undefined
  return pairWinRate - Math.sqrt(leftWinRate * rightWinRate)
}

export function calculateTruePairSynergy(
  pair: PairStats,
  leftStats: AbilityStats | undefined,
  rightStats: AbilityStats | undefined,
): number | undefined {
  const pairWinRate = calculateWinRate(pair.picks, pair.wins)
  const leftWinRate = leftStats ? calculateWinRate(leftStats.picks, leftStats.wins) : undefined
  const rightWinRate = rightStats ? calculateWinRate(rightStats.picks, rightStats.wins) : undefined
  if (
    pairWinRate === undefined
    || leftWinRate === undefined
    || rightWinRate === undefined
    || leftWinRate <= 0
    || leftWinRate >= 1
    || rightWinRate <= 0
    || rightWinRate >= 1
  ) return undefined

  const expectedPairWinRate = calculateLogitBase([leftWinRate, rightWinRate])
  if (expectedPairWinRate === undefined) return undefined
  return pairWinRate - expectedPairWinRate
}

export function buildHiddenTripleMap(
  tripletStats: TripletStats[],
  pairStats: Map<string, PairStats>,
  abilities: Map<number, Ability>,
  excludeSameHero: boolean,
): Map<string, HiddenTriple[]> {
  const hiddenTriples = new Map<string, HiddenTriple[]>()
  const seen = new Set<string>()

  for (const triplet of tripletStats) {
    const ids = [triplet.abilityIdOne, triplet.abilityIdTwo, triplet.abilityIdThree]
    for (const [leftId, rightId, thirdId] of [
      [ids[0], ids[1], ids[2]],
      [ids[0], ids[2], ids[1]],
      [ids[1], ids[2], ids[0]],
    ]) {
      const left = abilities.get(leftId)
      const right = abilities.get(rightId)
      const third = abilities.get(thirdId)
      const pair = pairStats.get(abilityPairKey(leftId, rightId))
      if (!left || !right || !third || !pair) continue
      if (excludeSameHero && (sameOwnerHero(left, right) || sameOwnerHero(left, third) || sameOwnerHero(right, third))) continue

      const key = abilityPairKey(leftId, rightId)
      const tripleKey = `${key}-${thirdId}`
      if (seen.has(tripleKey)) continue
      const pairRate = calculateWinRate(pair.picks, pair.wins)
      const tripleRate = calculateWinRate(triplet.picks, triplet.wins)
      if (pairRate === undefined || tripleRate === undefined) continue

      const sharesOwner = sameOwnerHero(left, third) || sameOwnerHero(right, third) || sameOwnerHero(left, right)
      const minimumComparablePicks = pair.picks * (sharesOwner ? 0.6 : 0.0001)
      if (triplet.picks < minimumComparablePicks) continue

      seen.add(tripleKey)
      const entries = hiddenTriples.get(key) ?? []
      entries.push({
        ability: third,
        picks: triplet.picks,
        winRate: tripleRate,
        winRateShift: (tripleRate - pairRate) * 100,
      })
      hiddenTriples.set(key, entries)
    }
  }

  for (const entries of hiddenTriples.values()) entries.sort((left, right) => right.winRateShift - left.winRateShift || right.picks - left.picks)
  return hiddenTriples
}

export function buildAbilityPairList(snapshot: Snapshot, options: AbilityPairOptions = {}): AbilityPairEntry[] {
  const minimumPicks = options.minimumPicks ?? MIN_ABILITY_PAIR_PICKS
  const excludeSameHero = options.excludeSameHero ?? false
  const cacheKey = `${minimumPicks}:${excludeSameHero ? 'exclude-same-hero' : 'include-same-hero'}`

  return memoizeByKey(PAIR_LIST_CACHE, snapshot, cacheKey, () => {
    const abilities = new Map(snapshot.abilities.map((ability) => [ability.id, ability]))
    const stats = new Map(snapshot.abilityStats.map((stat) => [stat.abilityId, stat]))
    const pairs = buildPairStatsMap(snapshot.pairStats)
    const triplets = buildTripletStatsMap(snapshot.tripletStats ?? [])
    const hiddenTripleMap = buildHiddenTripleMap([...triplets.values()], pairs, abilities, excludeSameHero)

    return [...pairs.entries()].flatMap(([key, pair]) => {
      if (pair.picks < minimumPicks) return []
      const abilityOne = abilities.get(pair.abilityIdOne)
      const abilityTwo = abilities.get(pair.abilityIdTwo)
      if (!abilityOne || !abilityTwo || abilityOne.id === abilityTwo.id) return []
      if (excludeSameHero && sameOwnerHero(abilityOne, abilityTwo)) return []

      const statsOne = stats.get(abilityOne.id)
      const statsTwo = stats.get(abilityTwo.id)
      const winRateOne = statsOne ? calculateWinRate(statsOne.picks, statsOne.wins) : undefined
      const winRateTwo = statsTwo ? calculateWinRate(statsTwo.picks, statsTwo.wins) : undefined
      const pairWinRate = calculateWinRate(pair.picks, pair.wins)
      if (pairWinRate === undefined) return []
      const synergy = calculatePairSynergy(pair, statsOne, statsTwo)
      const trueSynergy = calculateTruePairSynergy(pair, statsOne, statsTwo)

      return [{
        key,
        abilityOne,
        abilityTwo,
        winRateOne,
        winRateTwo,
        picks: pair.picks,
        wins: pair.wins,
        pairWinRate,
        synergy,
        trueSynergy,
        hiddenTriples: hiddenTripleMap.get(key) ?? [],
      }]
    })
  })
}
