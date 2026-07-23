import type { Ability, AbilityStats, Snapshot } from '../types'
import { isHeroAbility, isSpecialBonusAbility } from './ability-category'
import { memoizeByKey } from './cache'

export const TIER_CATEGORY_OPTIONS = [
  { id: 'all', label: 'All' },
  { id: 'ultimate', label: 'Ultimate' },
  { id: 'hero', label: 'Hero' },
  { id: 'ability', label: 'Ability' },
] as const

export const TIER_DEFINITIONS = [
  { id: 'S', threshold: 0.03 },
  { id: 'A', threshold: 0.1 },
  { id: 'B', threshold: 0.25 },
  { id: 'C', threshold: 0.5 },
  { id: 'D', threshold: 0.75 },
  { id: 'E', threshold: 0.9 },
  { id: 'F', threshold: 1 },
] as const

export type TierCategory = typeof TIER_CATEGORY_OPTIONS[number]['id']
export type AbilityTier = typeof TIER_DEFINITIONS[number]['id']

export const TIER_ORDER: AbilityTier[] = TIER_DEFINITIONS.map((tier) => tier.id)

export interface TierEntry {
  ability: Ability
  stats: AbilityStats
  rank: number
  tier: AbilityTier
  winRate: number
  value?: number
}

const TIER_LIST_CACHE = new WeakMap<Snapshot, Map<TierCategory, TierEntry[]>>()

function isInCategory(ability: Ability, category: TierCategory): boolean {
  if (category === 'all') return true
  const isHero = isHeroAbility(ability)
  if (category === 'hero') return isHero
  if (category === 'ultimate') return !isHero && ability.isUltimate
  return !isHero && !ability.isUltimate
}

export function tierForRank(rank: number, total: number): AbilityTier {
  if (total <= 0 || rank < 0) return 'F'
  const percentile = (rank + 1) / total
  return TIER_DEFINITIONS.find((tier) => percentile <= tier.threshold)?.id ?? 'F'
}

function compareEntries(left: TierEntry, right: TierEntry): number {
  return right.winRate - left.winRate
    || right.stats.picks - left.stats.picks
    || left.ability.name.localeCompare(right.ability.name)
}

export function buildAbilityTierList(snapshot: Snapshot, category: TierCategory = 'all'): TierEntry[] {
  return memoizeByKey(TIER_LIST_CACHE, snapshot, category, () => {
    const statsByAbilityId = new Map(snapshot.abilityStats.map((stats) => [stats.abilityId, stats]))
    const entries = snapshot.abilities.flatMap((ability) => {
      const stats = statsByAbilityId.get(ability.id)
      if (!stats || stats.picks <= 0 || isSpecialBonusAbility(ability) || !isInCategory(ability, category)) return []
      return [{
        ability,
        stats,
        winRate: stats.wins / stats.picks,
        value: snapshot.abilityValuations?.[String(ability.id)],
        rank: 0,
        tier: 'F' as AbilityTier,
      }]
    })

    return entries
      .sort(compareEntries)
      .map((entry, index, sorted) => ({
        ...entry,
        rank: index + 1,
        tier: tierForRank(index, sorted.length),
      }))
  })
}

export function matchesTierCategory(ability: Ability, category: TierCategory): boolean {
  return isInCategory(ability, category)
}

export function getTierCategoryCounts(snapshot: Snapshot): Record<TierCategory, number> {
  const counts: Record<TierCategory, number> = { all: 0, ultimate: 0, hero: 0, ability: 0 }
  for (const category of TIER_CATEGORY_OPTIONS) {
    counts[category.id] = buildAbilityTierList(snapshot, category.id).length
  }
  return counts
}
