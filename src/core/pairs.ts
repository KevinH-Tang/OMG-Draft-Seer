import type { Ability, AbilityStats, PairStats, Snapshot, TripletStats } from '../types'

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
  hiddenTriples: HiddenTriple[]
}

export interface AbilityPairOptions {
  excludeSameHero?: boolean
  minimumPicks?: number
}

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

function winRate(picks: number, wins: number): number | undefined {
  return picks > 0 && Number.isFinite(picks) && Number.isFinite(wins) ? wins / picks : undefined
}

export function buildPairStatsMap(pairStats: PairStats[]): Map<string, PairStats> {
  const pairs = new Map<string, PairStats>()
  for (const pair of pairStats) {
    const key = abilityPairKey(pair.abilityIdOne, pair.abilityIdTwo)
    const previous = pairs.get(key)
    if (!previous || pair.picks > previous.picks) pairs.set(key, pair)
  }
  return pairs
}

export function buildTripletStatsMap(tripletStats: TripletStats[]): Map<string, TripletStats> {
  const triplets = new Map<string, TripletStats>()
  for (const triplet of tripletStats) {
    const key = abilityTripletKey(triplet.abilityIdOne, triplet.abilityIdTwo, triplet.abilityIdThree)
    const previous = triplets.get(key)
    if (!previous || triplet.picks > previous.picks) triplets.set(key, triplet)
  }
  return triplets
}

export function calculatePairSynergy(
  pair: PairStats,
  leftStats: AbilityStats | undefined,
  rightStats: AbilityStats | undefined,
): number | undefined {
  const pairWinRate = winRate(pair.picks, pair.wins)
  const leftWinRate = leftStats ? winRate(leftStats.picks, leftStats.wins) : undefined
  const rightWinRate = rightStats ? winRate(rightStats.picks, rightStats.wins) : undefined
  if (pairWinRate === undefined || leftWinRate === undefined || rightWinRate === undefined || leftWinRate <= 0 || rightWinRate <= 0) return undefined
  return pairWinRate - (leftWinRate + rightWinRate) / 2
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
      const pairRate = winRate(pair.picks, pair.wins)
      const tripleRate = winRate(triplet.picks, triplet.wins)
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
  const abilities = new Map(snapshot.abilities.map((ability) => [ability.id, ability]))
  const stats = new Map(snapshot.abilityStats.map((stat) => [stat.abilityId, stat]))
  const pairs = buildPairStatsMap(snapshot.pairStats)
  const hiddenTripleMap = buildHiddenTripleMap(snapshot.tripletStats ?? [], pairs, abilities, excludeSameHero)

  return [...pairs.entries()].flatMap(([key, pair]) => {
    if (pair.picks < minimumPicks) return []
    const abilityOne = abilities.get(pair.abilityIdOne)
    const abilityTwo = abilities.get(pair.abilityIdTwo)
    if (!abilityOne || !abilityTwo || abilityOne.id === abilityTwo.id) return []
    if (excludeSameHero && sameOwnerHero(abilityOne, abilityTwo)) return []

    const statsOne = stats.get(abilityOne.id)
    const statsTwo = stats.get(abilityTwo.id)
    const winRateOne = statsOne ? winRate(statsOne.picks, statsOne.wins) : undefined
    const winRateTwo = statsTwo ? winRate(statsTwo.picks, statsTwo.wins) : undefined
    const pairWinRate = winRate(pair.picks, pair.wins)
    if (pairWinRate === undefined) return []
    const synergy = calculatePairSynergy(pair, statsOne, statsTwo)

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
      hiddenTriples: hiddenTripleMap.get(key) ?? [],
    }]
  })
}
