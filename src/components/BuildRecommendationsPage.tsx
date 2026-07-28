import { FileImage, GitFork, Sparkles } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import {
  BUILD_PICK_LIMITS,
  type BuildCandidatePools,
} from '../core/recommendation'
import type { AbilityTier } from '../core/tiers'
import { cn } from '../lib/cn'
import {
  formatLogitDelta,
  formatPairPercent,
} from '../lib/recommendation-format'
import { TIER_TEXT_CLASSES } from '../lib/tier-presentation'
import type { OverlayKind } from '../platform/overlays'
import type {
  Ability,
  CombinationRecommendation,
  Recommendation,
} from '../types'
import { CombinationAbilityIcons } from './CombinationAbilityIcons'
import { OverlayToggleButton } from './OverlayViews'
import { RecommendationInteractionsPopover } from './RecommendationInteractionsPopover'
import { SkillIcon } from './SkillIcon'
import { PageHeader } from './ui'

export const BUILD_PICK_GROUPS: Array<{
  key: keyof BuildCandidatePools
  labelKey: 'common.hero' | 'common.ability' | 'common.ultimate'
  limit: number
}> = [
  { key: 'heroIds', labelKey: 'common.hero', limit: BUILD_PICK_LIMITS.hero },
  {
    key: 'abilityIds',
    labelKey: 'common.ability',
    limit: BUILD_PICK_LIMITS.ability,
  },
  {
    key: 'ultimateIds',
    labelKey: 'common.ultimate',
    limit: BUILD_PICK_LIMITS.ultimate,
  },
]

function pickRoleKey(
  ability: Ability | undefined,
): 'common.hero' | 'common.ability' | 'common.ultimate' {
  if (!ability) return 'common.ability'
  if (ability.isHero) return 'common.hero'
  return ability.isUltimate ? 'common.ultimate' : 'common.ability'
}

export interface BuildRecommendationsPageProps {
  candidatePools: BuildCandidatePools
  candidateTierInfo: ReadonlyMap<number, { tier: AbilityTier }>
  selectedIds: readonly number[]
  combinationRecommendations: readonly CombinationRecommendation[]
  recommendations: readonly Recommendation[]
  abilities: ReadonlyMap<number, Ability>
  assistantOverlayOpen: boolean
  onToggleSelected: (id: number) => void
  onToggleOverlay: (kind: OverlayKind) => void
}

export function BuildRecommendationsPage({
  candidatePools,
  candidateTierInfo,
  selectedIds,
  combinationRecommendations,
  recommendations,
  abilities,
  assistantOverlayOpen,
  onToggleSelected,
  onToggleOverlay,
}: BuildRecommendationsPageProps) {
  const { t } = useTranslation()
  const candidateIds = useMemo(
    () =>
      new Set([
        ...candidatePools.heroIds,
        ...candidatePools.abilityIds,
        ...candidatePools.ultimateIds,
      ]),
    [candidatePools],
  )

  return (
    <section
      className="mt-6 border-t border-border-subtle pt-5"
      aria-labelledby="build-recommendations-page-title"
      data-testid="build-recommendations-page"
    >
      <PageHeader
        titleId="build-recommendations-page-title"
        eyebrow={t('analysis.buildStep')}
        title={t('analysis.combinationRecommendations')}
        aside={
          <div className="flex flex-wrap justify-end gap-2">
            <OverlayToggleButton
              kind="recommendation"
              open={assistantOverlayOpen}
              onToggle={onToggleOverlay}
            />
            <Sparkles size={19} aria-hidden="true" />
          </div>
        }
      />

      <fieldset className="mt-[22px] border-0 p-0">
        <legend className="mb-2 text-sm text-text">
          {t('analysis.lockPick')}{' '}
          <span className="text-text-muted">{selectedIds.length}/5</span>
        </legend>
        <div className="grid gap-3">
          {BUILD_PICK_GROUPS.map((group) => {
            const ids = candidatePools[group.key]
            const selectedCount = selectedIds.filter((id) =>
              ids.includes(id),
            ).length
            return (
              <section className="grid gap-1.5" key={group.key}>
                <header className="flex items-center justify-between text-xs font-bold text-text">
                  <span>{t(group.labelKey)}</span>
                  <small className="font-mono font-normal text-text-muted">
                    {selectedCount}/{group.limit}
                  </small>
                </header>
                <div className="flex flex-wrap gap-1.5">
                  {ids.map((id) => {
                    const item = abilities.get(id)
                    if (!item) return null
                    const tier = candidateTierInfo.get(id)?.tier
                    return (
                      <button
                        key={id}
                        className={cn(
                          'inline-flex min-w-0 items-center gap-1.5 rounded-sm border border-border bg-surface-raised px-2 py-1.5 text-[13px] text-text hover:border-accent hover:bg-accent-soft [&>span:not(.skill-icon)]:max-w-[130px] [&>span:not(.skill-icon)]:truncate',
                          selectedIds.includes(id) &&
                            'border-accent bg-accent-soft',
                        )}
                        type="button"
                        onClick={() => onToggleSelected(id)}
                      >
                        <SkillIcon
                          compact
                          abilityId={id}
                          shortName={item.shortName}
                          name={item.name}
                          isHero={item.isHero}
                        />
                        <span>{item.name}</span>
                        {tier && (
                          <small
                            className={cn(
                              'grid size-4 place-items-center border border-current font-mono text-[10px] font-bold',
                              TIER_TEXT_CLASSES[tier],
                            )}
                          >
                            {tier}
                          </small>
                        )}
                      </button>
                    )
                  })}
                  {ids.length === 0 && (
                    <p className="my-1 text-[13px] text-text-muted">
                      {t('analysis.noConfirmedCandidates')}
                    </p>
                  )}
                </div>
              </section>
            )
          })}
          {candidateIds.size === 0 && (
            <p className="my-1 text-[13px] text-text-muted">
              {t('analysis.confirmForBuild')}
            </p>
          )}
        </div>
      </fieldset>

      <section
        className="mt-6 border-t border-border-subtle pt-5"
        aria-labelledby="combination-recommendations-title"
        data-testid="combination-recommendations"
      >
        <header className="flex items-start justify-between gap-3">
          <div>
            <h2
              id="combination-recommendations-title"
              className="inline-flex items-center gap-2 text-base"
            >
              <GitFork size={17} aria-hidden="true" />
              {t('analysis.combinationRecommendations')}
            </h2>
            <p className="mb-0 mt-1 text-xs text-text-muted">
              {t('analysis.combinationHint')}
            </p>
          </div>
        </header>
        {combinationRecommendations.length > 0 ? (
          <div className="mt-3">
            {combinationRecommendations.map((recommendation, index) => (
              <article
                className="border-b border-border-subtle py-3 first:border-t"
                key={`${recommendation.type}-${recommendation.abilityIds.join('-')}`}
              >
                <div className="grid items-center gap-3 min-[761px]:grid-cols-[minmax(0,1fr)_auto]">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-xs text-text-muted">
                      <span>{t('analysis.plan', { number: index + 1 })}</span>
                      <span className="border border-border-strong bg-surface-raised px-1.5 py-0.5 font-mono text-[10px] uppercase">
                        {t(`common.${recommendation.type}`)}
                      </span>
                    </div>
                    <div className="mt-2">
                      <CombinationAbilityIcons
                        recommendation={recommendation}
                        abilities={abilities}
                      />
                    </div>
                  </div>
                  <dl className="m-0 grid grid-cols-2 gap-3 min-[601px]:grid-cols-4">
                    <div className="grid min-w-16 gap-1">
                      <dt className="whitespace-nowrap text-[11px] text-text-muted">
                        {t('common.score')}
                      </dt>
                      <dd className="m-0 whitespace-nowrap font-mono text-[15px] font-bold text-text-strong">
                        {recommendation.score.toFixed(1)}%
                      </dd>
                    </div>
                    <div className="grid min-w-16 gap-1">
                      <dt className="whitespace-nowrap text-[11px] text-text-muted">
                        {t('common.baseWinRate')}
                      </dt>
                      <dd className="m-0 whitespace-nowrap font-mono text-[15px] font-bold text-text-strong">
                        {(recommendation.baseWinRate * 100).toFixed(1)}%
                      </dd>
                    </div>
                    <div
                      className="grid min-w-16 gap-1"
                      title={t('analysis.combinationSynergyHint')}
                    >
                      <dt className="whitespace-nowrap text-[11px] text-text-muted">
                        {t('common.synergy')}
                      </dt>
                      <dd
                        className={cn(
                          'm-0 whitespace-nowrap font-mono text-[15px] font-bold',
                          recommendation.synergy >= 0
                            ? 'text-positive'
                            : 'text-negative',
                        )}
                      >
                        {formatPairPercent(recommendation.synergy, true)}
                      </dd>
                    </div>
                    <div className="grid min-w-16 gap-1">
                      <dt className="whitespace-nowrap text-[11px] text-text-muted">
                        {t('common.games')}
                      </dt>
                      <dd className="m-0 whitespace-nowrap font-mono text-[15px] font-bold text-text-strong">
                        {recommendation.picks.toLocaleString()}
                      </dd>
                    </div>
                  </dl>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="mt-3 grid min-h-24 place-content-center justify-items-center border border-dashed border-border-strong bg-surface text-center text-[13px] text-text-muted">
            {t('analysis.noCombinations')}
          </div>
        )}
      </section>

      <section
        className="mt-6 border-t border-border-subtle pt-5"
        aria-labelledby="five-pick-score-title"
        data-testid="five-pick-recommendations"
      >
        <header className="flex items-start justify-between gap-3">
          <div>
            <h2 id="five-pick-score-title" className="text-base">
              {t('analysis.fivePickScore')}
            </h2>
            <p className="mb-0 mt-1 text-xs text-text-muted">
              {t('analysis.fivePickScoreHint')}
            </p>
          </div>
        </header>
        {recommendations.length > 0 ? (
          <div className="mt-3">
            <div className="border-l-[3px] border-accent bg-accent-soft p-4">
              <span className="mb-1 block text-[13px] text-text-muted">
                {t('analysis.nextPick')}
              </span>
              <strong className="text-[19px] text-text-strong">
                {
                  abilities.get(
                    recommendations[0].pickOrderIds.find(
                      (id) => !selectedIds.includes(id),
                    ) ?? recommendations[0].pickOrderIds[0],
                  )?.name
                }
              </strong>
            </div>
            {recommendations.map((recommendation, index) => (
              <article
                className="border-b border-border-subtle py-[18px]"
                key={recommendation.abilityIds.join('-')}
              >
                <div className="grid items-center gap-4 min-[761px]:grid-cols-[minmax(0,1fr)_auto]">
                  <div>
                    <div className="flex items-center gap-2 text-xs text-text-muted">
                      <span>{t('analysis.plan', { number: index + 1 })}</span>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {recommendation.pickOrderIds.map((id, pickIndex) => {
                        const item = abilities.get(id)
                        return (
                          <span
                            className="relative inline-flex min-h-[52px] items-center gap-1.5 bg-surface px-2 pb-1 pt-4 text-xs text-text"
                            key={id}
                            title={item?.name}
                          >
                            <small className="absolute left-2 top-0.5 text-[9px] text-text-muted">
                              {t('analysis.pick', { number: pickIndex + 1 })} ·{' '}
                              {t(pickRoleKey(item))}
                            </small>
                            <SkillIcon
                              compact
                              abilityId={id}
                              shortName={item?.shortName}
                              name={item?.name}
                              isHero={item?.isHero}
                            />
                            <b className="max-w-[132px] truncate font-medium">
                              {item?.name}
                            </b>
                          </span>
                        )
                      })}
                    </div>
                  </div>
                  <dl className="m-0 grid grid-cols-2 gap-3 min-[601px]:grid-cols-4">
                    <div className="grid min-w-16 gap-1">
                      <dt className="whitespace-nowrap text-[11px] text-text-muted">
                        {t('common.score')}
                      </dt>
                      <dd className="m-0 grid gap-0.5 whitespace-nowrap font-mono text-[15px] font-bold text-text-strong">
                        {recommendation.score.toFixed(1)}%
                      </dd>
                    </div>
                    <div className="grid min-w-16 gap-1">
                      <dt className="whitespace-nowrap text-[11px] text-text-muted">
                        {t('common.baseWinRate')}
                      </dt>
                      <dd className="m-0 grid gap-0.5 whitespace-nowrap font-mono text-[15px] font-bold text-text-strong">
                        {(recommendation.abilityWinRate * 100).toFixed(1)}%
                      </dd>
                    </div>
                    <div
                      className="group relative grid min-w-16 cursor-help gap-1 rounded-sm focus-visible:outline focus-visible:outline-accent focus-visible:outline-offset-2"
                      tabIndex={0}
                      aria-label={t('analysis.synergyAria', {
                        synergy: formatPairPercent(
                          recommendation.synergy,
                          true,
                        ),
                        delta: formatLogitDelta(recommendation.logitSynergy),
                        interactions: recommendation.effectiveInteractionCount,
                        partial: recommendation.partialInteractions.length,
                      })}
                    >
                      <dt className="whitespace-nowrap text-[11px] text-text-muted">
                        {t('common.synergy')}
                      </dt>
                      <dd className="m-0 grid gap-0.5 whitespace-nowrap font-mono text-[15px] font-bold text-text-strong">
                        {formatPairPercent(recommendation.synergy, true)}
                        <small className="text-[10px] font-normal text-text-muted">
                          {t('common.logitDelta')}{' '}
                          {formatLogitDelta(recommendation.logitSynergy)} ·{' '}
                          {t('draft.interactionGroups', {
                            count: recommendation.effectiveInteractionCount,
                          })}
                          {recommendation.partialInteractions.length > 0
                            ? ` · ${t('analysis.partialInteractions')} ${recommendation.partialInteractions.length}`
                            : ''}
                        </small>
                      </dd>
                      <RecommendationInteractionsPopover
                        interactions={recommendation.effectiveInteractions}
                        partialInteractions={recommendation.partialInteractions}
                        abilities={abilities}
                      />
                    </div>
                    <div className="grid min-w-16 gap-1">
                      <dt className="whitespace-nowrap text-[11px] text-text-muted">
                        {t('common.averagePick')}
                      </dt>
                      <dd className="m-0 grid gap-0.5 whitespace-nowrap font-mono text-[15px] font-bold text-text-strong">
                        {recommendation.averagePickPosition.toFixed(1)}
                      </dd>
                    </div>
                  </dl>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="mt-3 grid min-h-[190px] place-content-center justify-items-center border border-dashed border-border-strong bg-surface text-center text-text-muted">
            <FileImage size={24} />
            <p className="mb-0 mt-2.5 max-w-[220px] text-[13px]">
              {t('analysis.buildRequirement')}
            </p>
          </div>
        )}
      </section>
    </section>
  )
}
