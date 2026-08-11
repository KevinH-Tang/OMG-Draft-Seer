import { useTranslation } from 'react-i18next'
import { findThirdAbilityId } from '../core/combinations'
import { cn } from '../lib/cn'
import { formatPairPercent } from '../lib/recommendation-format'
import type { Ability, CombinationRecommendationGroup } from '../types'
import { CombinationAbilityIcons } from './CombinationAbilityIcons'
import { SkillIcon } from './SkillIcon'

export function PairRecommendationRow({
  group,
  abilities,
  rank,
  variant = 'full',
}: {
  group: CombinationRecommendationGroup
  abilities: ReadonlyMap<number, Ability>
  rank: number
  variant?: 'full' | 'compact'
}) {
  const { t } = useTranslation()
  const isFull = variant === 'full'

  return (
    <article
      className={cn(
        'border-b border-border-subtle last:border-b-0',
        isFull ? 'py-3 first:border-t' : 'pb-2 pt-1.5',
      )}
      data-testid="pair-recommendation-row"
    >
      <div
        className={cn(
          'grid items-center',
          isFull
            ? 'gap-4 min-[761px]:grid-cols-[minmax(190px,0.8fr)_minmax(260px,1.4fr)_auto]'
            : 'grid-cols-[minmax(0,1fr)_auto] gap-2',
        )}
      >
        <div className="min-w-0">
          <div className="mb-1 flex items-center gap-2 font-mono text-[10px] text-text-muted">
            <span>{rank}</span>
            <span>{t('common.pair')}</span>
            {!group.pair && (
              <span className="border border-border-strong bg-surface-raised px-1 py-0.5 font-sans text-[10px]">
                {t('analysis.onlyTripleData')}
              </span>
            )}
          </div>
          <CombinationAbilityIcons
            abilityIds={group.pairAbilityIds}
            abilities={abilities}
            variant={variant}
          />
        </div>

        {isFull && (
          <div className="min-w-0">
            <div className="mb-1 text-[10px] text-text-muted">
              {t('analysis.thirdAbilities')}
            </div>
            <ThirdAbilityList group={group} abilities={abilities} />
          </div>
        )}

        <div className="grid grid-cols-2 justify-self-end gap-3 text-right">
          <PairMetric
            label={t('common.pairWinRate')}
            value={group.pair ? `${group.pair.score.toFixed(1)}%` : '-'}
            compact={!isFull}
          />
          <PairMetric
            label={t('common.synergy')}
            value={
              group.pair ? formatPairPercent(group.pair.synergy, true) : '-'
            }
            positive={
              group.pair === undefined ? undefined : group.pair.synergy >= 0
            }
            compact={!isFull}
          />
        </div>
      </div>

      {!isFull && group.triples.length > 0 && (
        <div className="mt-1.5">
          <ThirdAbilityList group={group} abilities={abilities} compact />
        </div>
      )}
    </article>
  )
}

function PairMetric({
  label,
  value,
  positive,
  compact,
}: {
  label: string
  value: string
  positive?: boolean
  compact: boolean
}) {
  return (
    <div className="grid min-w-14 gap-0.5">
      <span className="whitespace-nowrap text-[9px] text-text-muted">
        {label}
      </span>
      <strong
        className={cn(
          'whitespace-nowrap font-mono',
          compact ? 'text-[11px]' : 'text-[15px]',
          positive === undefined
            ? 'text-text'
            : positive
              ? 'text-positive'
              : 'text-negative',
        )}
      >
        {value}
      </strong>
    </div>
  )
}

function ThirdAbilityList({
  group,
  abilities,
  compact = false,
}: {
  group: CombinationRecommendationGroup
  abilities: ReadonlyMap<number, Ability>
  compact?: boolean
}) {
  const { t } = useTranslation()
  if (group.triples.length === 0) {
    return (
      <span className="text-[11px] text-text-muted">{t('common.none')}</span>
    )
  }

  return (
    <div className="flex min-w-0 flex-wrap gap-1">
      {group.triples.map((triple) => {
        const abilityId = findThirdAbilityId(
          group.pairAbilityIds,
          triple.abilityIds,
        )
        const ability =
          abilityId === undefined ? undefined : abilities.get(abilityId)
        return (
          <span
            className={cn(
              'inline-flex items-center gap-1 bg-surface-raised font-mono',
              compact ? 'px-1 py-0.5 text-[9px]' : 'px-1.5 py-1 text-[10px]',
            )}
            key={triple.abilityIds.join('-')}
            title={`${ability?.name ?? abilityId} · ${triple.picks.toLocaleString()} ${t('common.games')}`}
          >
            <span className="text-text-muted">+</span>
            <SkillIcon
              compact
              abilityId={ability?.id}
              shortName={ability?.shortName}
              name={ability?.name}
              isHero={ability?.isHero}
            />
            {!compact && (
              <b className="max-w-28 truncate font-sans font-medium">
                {ability?.name}
              </b>
            )}
            <span className="text-text">{triple.score.toFixed(1)}%</span>
            <span
              className={
                triple.synergy >= 0 ? 'text-positive' : 'text-negative'
              }
            >
              {formatPairPercent(triple.synergy, true)}
            </span>
          </span>
        )
      })}
    </div>
  )
}
