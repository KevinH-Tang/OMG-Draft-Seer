import { isSpecialBonusAbility, matchesSlotCategory } from './ability-category'
import { memoizeByKey } from './cache'
import {
  DRAFT_PLAYER_COUNT,
  DRAFT_TOTAL_PICKS,
  type DraftTurn,
} from './draft-turns'
import { BUILD_PICK_LIMITS } from './recommendation'
import { buildAbilityTierList } from './tiers'
import type { Ability, SlotCategory, Snapshot } from '../types'

export const DRAFT_POOL_SIZES: Record<SlotCategory, number> = {
  hero: 12,
  ability: 36,
  ultimate: 12,
}

export const DRAFT_PICK_QUOTAS: Record<SlotCategory, number> = BUILD_PICK_LIMITS

export interface InitialDraftPool {
  heroIds: readonly number[]
  abilityIds: readonly number[]
  ultimateIds: readonly number[]
}

export type DraftStrategyId = 'tier-first' | 'pair-first'
export type DraftPickKind = 'player-pick' | 'opponent-mask'

export interface DraftPickEvent {
  turn: DraftTurn
  abilityId?: number
  category: SlotCategory
  kind: DraftPickKind
  policy: DraftStrategyId
  unresolved?: boolean
  rationale?: string
  pairScore?: number
  pairProfile?: {
    topValues: number[]
    topPartnerIds: number[]
    weightedValue: number
    optionCount: number
  }
  remainingCount?: number
}

export interface DraftPoolCounts {
  hero: number
  ability: number
  ultimate: number
  total: number
}

export interface DraftState {
  nextGlobalPick: number
  remainingByCategory: InitialDraftPool
  picksByPlayer: Record<number, number[]>
  history: DraftPickEvent[]
}

const ALL_REMAINING_IDS_CACHE = new WeakMap<DraftState, readonly number[]>()
const PLAYER_CATEGORY_COUNT_CACHE = new WeakMap<
  DraftState,
  Map<number, DraftPlayerCategoryCounts>
>()

export function buildRankedDraftPool(snapshot: Snapshot): InitialDraftPool {
  const idsForCategory = (category: SlotCategory): number[] => {
    const ranked = buildAbilityTierList(snapshot, category).map(
      (entry) => entry.ability.id,
    )
    const rankedIds = new Set(ranked)
    const fallback = snapshot.abilities
      .filter(
        (ability) =>
          matchesSlotCategory(ability, category) &&
          !isSpecialBonusAbility(ability) &&
          !rankedIds.has(ability.id),
      )
      .sort((left, right) => left.id - right.id)
      .map((ability) => ability.id)
    return [...ranked, ...fallback].slice(0, DRAFT_POOL_SIZES[category])
  }
  return {
    heroIds: idsForCategory('hero'),
    abilityIds: idsForCategory('ability'),
    ultimateIds: idsForCategory('ultimate'),
  }
}

function poolEntries(
  pool: InitialDraftPool,
): Array<{ category: SlotCategory; ids: readonly number[] }> {
  return [
    { category: 'hero', ids: pool.heroIds },
    { category: 'ability', ids: pool.abilityIds },
    { category: 'ultimate', ids: pool.ultimateIds },
  ]
}

function uniqueIds(ids: readonly number[]): number[] {
  return [...new Set(ids)].sort((left, right) => left - right)
}

export function validateInitialDraftPool(
  pool: InitialDraftPool,
  abilities?: Iterable<Ability>,
): string[] {
  const errors: string[] = []
  const seen = new Map<number, SlotCategory>()
  const abilitiesById = abilities
    ? new Map([...abilities].map((ability) => [ability.id, ability]))
    : undefined

  for (const { category, ids } of poolEntries(pool)) {
    if (ids.length !== DRAFT_POOL_SIZES[category]) {
      errors.push(
        `${category} pool must contain ${DRAFT_POOL_SIZES[category]} candidates, got ${ids.length}.`,
      )
    }
    for (const id of ids) {
      if (!Number.isInteger(id)) {
        errors.push(`${category} pool contains a non-integer ability id.`)
        continue
      }
      const previousCategory = seen.get(id)
      if (previousCategory)
        errors.push(
          `Ability ${id} appears in both ${previousCategory} and ${category} pools.`,
        )
      seen.set(id, category)
      const ability = abilitiesById?.get(id)
      if (abilitiesById && !ability)
        errors.push(`Ability ${id} is missing from the snapshot.`)
      if (ability && !matchesSlotCategory(ability, category))
        errors.push(`Ability ${id} does not belong to the ${category} pool.`)
    }
  }

  const total = poolEntries(pool).reduce(
    (sum, entry) => sum + entry.ids.length,
    0,
  )
  if (total < DRAFT_TOTAL_PICKS)
    errors.push(
      `Draft pool needs at least ${DRAFT_TOTAL_PICKS} candidates, got ${total}.`,
    )
  return errors
}

export function createInitialDraftState(
  pool: InitialDraftPool,
  abilities?: Iterable<Ability>,
): DraftState {
  const errors = validateInitialDraftPool(pool, abilities)
  if (errors.length > 0) throw new Error(errors.join(' '))
  const picksByPlayer = Object.fromEntries(
    Array.from({ length: DRAFT_PLAYER_COUNT }, (_, index) => [
      index + 1,
      [] as number[],
    ]),
  ) as Record<number, number[]>
  return {
    nextGlobalPick: 1,
    remainingByCategory: {
      heroIds: uniqueIds(pool.heroIds),
      abilityIds: uniqueIds(pool.abilityIds),
      ultimateIds: uniqueIds(pool.ultimateIds),
    },
    picksByPlayer,
    history: [],
  }
}

export function allRemainingIds(state: DraftState): readonly number[] {
  const cached = ALL_REMAINING_IDS_CACHE.get(state)
  if (cached) return cached
  const result = uniqueIds([
    ...state.remainingByCategory.heroIds,
    ...state.remainingByCategory.abilityIds,
    ...state.remainingByCategory.ultimateIds,
  ])
  ALL_REMAINING_IDS_CACHE.set(state, result)
  return result
}

export function draftPoolCounts(pool: InitialDraftPool): DraftPoolCounts {
  const hero = pool.heroIds.length
  const ability = pool.abilityIds.length
  const ultimate = pool.ultimateIds.length
  return { hero, ability, ultimate, total: hero + ability + ultimate }
}

export function remainingPoolCounts(state: DraftState): DraftPoolCounts {
  return draftPoolCounts(state.remainingByCategory)
}

function categoryKey(category: SlotCategory): keyof InitialDraftPool {
  return `${category}Ids` as keyof InitialDraftPool
}

export function categoryForDraftId(
  state: DraftState,
  abilityId: number,
): SlotCategory | undefined {
  if (state.remainingByCategory.heroIds.includes(abilityId)) return 'hero'
  if (state.remainingByCategory.abilityIds.includes(abilityId)) return 'ability'
  if (state.remainingByCategory.ultimateIds.includes(abilityId))
    return 'ultimate'
  return undefined
}

export interface DraftPlayerCategoryCounts {
  hero: number
  ability: number
  ultimate: number
}

export function playerDraftCategoryCounts(
  state: DraftState,
  player: number,
): DraftPlayerCategoryCounts {
  return memoizeByKey(PLAYER_CATEGORY_COUNT_CACHE, state, player, () =>
    state.history
      .filter((event) => event.turn.player === player)
      .reduce<DraftPlayerCategoryCounts>(
        (counts, event) => {
          counts[event.category] += 1
          return counts
        },
        { hero: 0, ability: 0, ultimate: 0 },
      ),
  )
}

export function applyDraftPick(
  state: DraftState,
  turn: DraftTurn,
  abilityId: number,
  kind: DraftPickKind,
  policy: DraftStrategyId,
  details: Pick<
    DraftPickEvent,
    'rationale' | 'pairScore' | 'pairProfile' | 'unresolved'
  > = {},
): DraftState {
  if (turn.globalPick !== state.nextGlobalPick)
    throw new Error(
      `Expected draft pick ${state.nextGlobalPick}, got ${turn.globalPick}.`,
    )
  if (!Number.isInteger(abilityId))
    throw new Error('Draft pick must be an integer ability id.')
  if (turn.player < 1 || turn.player > DRAFT_PLAYER_COUNT)
    throw new Error(`Invalid draft player ${turn.player}.`)

  const category = categoryForDraftId(state, abilityId)
  if (!category)
    throw new Error(
      `Ability ${abilityId} is not available at draft pick ${turn.globalPick}.`,
    )
  const playerCounts = playerDraftCategoryCounts(state, turn.player)
  if (playerCounts[category] >= DRAFT_PICK_QUOTAS[category]) {
    throw new Error(
      `Player ${turn.player} already has the ${category} quota at draft pick ${turn.globalPick}.`,
    )
  }
  const key = categoryKey(category)
  const remainingByCategory = {
    ...state.remainingByCategory,
    [key]: state.remainingByCategory[key].filter((id) => id !== abilityId),
  }
  const picksByPlayer = {
    ...state.picksByPlayer,
    [turn.player]: [...state.picksByPlayer[turn.player], abilityId],
  }
  const event: DraftPickEvent = {
    turn,
    abilityId,
    category,
    kind,
    policy,
    ...details,
    remainingCount:
      remainingByCategory.heroIds.length +
      remainingByCategory.abilityIds.length +
      remainingByCategory.ultimateIds.length,
  }
  return {
    nextGlobalPick: state.nextGlobalPick + 1,
    remainingByCategory,
    picksByPlayer,
    history: [...state.history, event],
  }
}
