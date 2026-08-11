import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { rankCombinationAbilityOccurrences } from '../core/combinations'
import { cn } from '../lib/cn'
import type {
  Ability,
  AbilityStats,
  CombinationRecommendationGroup,
} from '../types'
import { SkillIcon } from './SkillIcon'

export function CombinationPopularityRow({
  groups,
  abilities,
  abilityStats,
  variant = 'full',
}: {
  groups: readonly CombinationRecommendationGroup[]
  abilities: ReadonlyMap<number, Ability>
  abilityStats: readonly AbilityStats[]
  variant?: 'full' | 'compact'
}) {
  const { t } = useTranslation()
  const rankings = useMemo(
    () => rankCombinationAbilityOccurrences(groups, abilityStats),
    [abilityStats, groups],
  )
  if (rankings.length === 0) return null

  return (
    <section
      className={cn(
        'grid grid-cols-[32px_minmax(0,1fr)] items-start gap-1 border-b border-border-subtle py-1.5',
        variant === 'full' ? 'mt-3 border-t' : 'mt-1.5',
      )}
      aria-label={t('analysis.popularCombinationAbilities')}
      data-testid="combination-popularity-row"
    >
      <strong className="grid size-8 place-items-center border border-accent bg-accent-soft text-base leading-none text-accent">
        P
      </strong>
      <div className="flex min-w-0 flex-wrap items-start gap-1">
        {rankings.map(({ abilityId, count }, index) => {
          const ability = abilities.get(abilityId)
          return (
            <div
              className="size-8"
              key={abilityId}
              title={`${index + 1}. ${ability?.name ?? abilityId} · ${t('analysis.combinationOccurrences', { count })}`}
            >
              <SkillIcon
                abilityId={ability?.id}
                shortName={ability?.shortName}
                name={ability?.name}
                isHero={ability?.isHero}
              />
            </div>
          )
        })}
      </div>
    </section>
  )
}
