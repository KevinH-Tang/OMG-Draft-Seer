import { memo } from 'react'
import { isHeroAbility } from '../core/ability-category'
import {
  localAbilityIconUrl,
  remoteAbilityIconUrl,
} from '../platform/resources'

export interface SkillIconProps {
  abilityId?: number
  shortName?: string
  name?: string
  isHero?: boolean
  compact?: boolean
  catalog?: boolean
}

export const SkillIcon = memo(function SkillIcon({
  abilityId,
  shortName,
  name,
  isHero,
  compact = false,
  catalog = false,
}: SkillIconProps) {
  const resolvedIsHero =
    abilityId === undefined
      ? Boolean(isHero)
      : isHeroAbility({ id: abilityId, isHero })
  const localUrl = shortName
    ? localAbilityIconUrl(abilityId, shortName, resolvedIsHero)
    : undefined
  const fallbackUrl = shortName
    ? remoteAbilityIconUrl(shortName, resolvedIsHero)
    : undefined
  const fallbackLabel = Array.from(name ?? shortName ?? '?')
    .slice(0, 2)
    .join('')
    .toUpperCase()

  return (
    <span
      className={`skill-icon ${compact ? 'compact' : ''} ${catalog ? 'catalog' : ''}`}
      style={{ background: 'transparent' }}
    >
      <span className="skill-icon-fallback" aria-hidden="true">
        {fallbackLabel}
      </span>
      {shortName && (
        <img
          src={localUrl ?? fallbackUrl}
          alt={name ?? ''}
          loading="lazy"
          decoding="async"
          onError={(event) => {
            const image = event.currentTarget
            if (
              localUrl &&
              fallbackUrl &&
              image.dataset.cdnFallback !== 'true'
            ) {
              image.dataset.cdnFallback = 'true'
              image.src = fallbackUrl
            } else {
              image.style.display = 'none'
            }
          }}
        />
      )}
    </span>
  )
})
