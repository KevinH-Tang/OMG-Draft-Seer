import type { Ability, CombinationRecommendation } from '../types'
import { SkillIcon } from './SkillIcon'

export function CombinationAbilityIcons({
  recommendation,
  abilities,
  variant = 'full',
}: {
  recommendation: CombinationRecommendation
  abilities: ReadonlyMap<number, Ability>
  variant?: 'full' | 'compact'
}) {
  const isFull = variant === 'full'
  const Wrapper = isFull ? 'div' : 'span'
  return (
    <Wrapper
      className={
        isFull
          ? 'flex min-w-0 flex-wrap items-center gap-1.5'
          : 'inline-flex min-w-0 items-center gap-1'
      }
    >
      {recommendation.abilityIds.map((id, index) => {
        const item = abilities.get(id)
        return (
          <span
            className={
              isFull
                ? 'inline-flex min-w-0 items-center gap-1.5 bg-surface px-2 py-1.5 text-[13px] text-text'
                : 'inline-flex min-w-0 items-center gap-1'
            }
            key={id}
            title={isFull ? item?.name : undefined}
          >
            {index > 0 && (
              <span
                className={
                  isFull
                    ? 'font-mono text-[11px] text-text-muted'
                    : 'text-[10px] text-text-muted'
                }
              >
                +
              </span>
            )}
            <SkillIcon
              compact
              abilityId={item?.id}
              shortName={item?.shortName}
              name={item?.name}
              isHero={item?.isHero}
            />
            {isFull && (
              <b className="max-w-[140px] truncate font-medium">{item?.name}</b>
            )}
          </span>
        )
      })}
    </Wrapper>
  )
}
