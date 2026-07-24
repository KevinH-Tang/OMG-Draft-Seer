import type { Ability, SlotCategory } from '../types'

type AbilityCategoryFields = Pick<Ability, 'id' | 'isHero' | 'isUltimate'>

export function isHeroAbility(
  ability: Pick<Ability, 'id' | 'isHero'>,
): boolean {
  return Boolean(ability.isHero || ability.id < 0)
}

export function isSpecialBonusAbility(
  ability: Pick<Ability, 'shortName'>,
): boolean {
  return ability.shortName.startsWith('special_bonus')
}

export function matchesSlotCategory(
  ability: AbilityCategoryFields,
  category: SlotCategory,
): boolean {
  const isHero = isHeroAbility(ability)
  if (category === 'hero') return isHero
  if (isHero) return false
  return category === 'ultimate' ? ability.isUltimate : !ability.isUltimate
}
