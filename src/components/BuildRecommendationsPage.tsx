import { GitFork } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { CombinationRecommendationOptions } from '../core/combinations'
import { cn } from '../lib/cn'
import { formatPairPercent } from '../lib/recommendation-format'
import type { OverlayKind } from '../platform/overlays'
import type { Ability, CombinationRecommendation } from '../types'
import { CombinationAbilityIcons } from './CombinationAbilityIcons'
import { OverlayToggleButton } from './OverlayViews'
import { Field, PageHeader } from './ui'

export interface BuildRecommendationsPageProps {
  combinationRecommendations: readonly CombinationRecommendation[]
  recommendationOptions: CombinationRecommendationOptions
  abilities: ReadonlyMap<number, Ability>
  assistantOverlayOpen: boolean
  onRecommendationOptionsChange: (
    options: CombinationRecommendationOptions,
  ) => void
  onToggleOverlay: (kind: OverlayKind) => void
}

export function BuildRecommendationsPage({
  combinationRecommendations,
  recommendationOptions,
  abilities,
  assistantOverlayOpen,
  onRecommendationOptionsChange,
  onToggleOverlay,
}: BuildRecommendationsPageProps) {
  const { t } = useTranslation()

  return (
    <section
      className="mt-6 border-t border-border-subtle pt-5"
      aria-labelledby="build-recommendations-page-title"
      data-testid="build-recommendations-page"
    >
      <PageHeader
        titleId="build-recommendations-page-title"
        eyebrow={t('analysis.buildStep')}
        title={t('nav.build')}
        aside={
          <OverlayToggleButton
            kind="recommendation"
            open={assistantOverlayOpen}
            onToggle={onToggleOverlay}
          />
        }
      />

      <section
        className="mt-[22px]"
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
              {t('analysis.combinationHint', {
                winRate: (recommendationOptions.minWinRate * 100).toFixed(0),
                synergy: (recommendationOptions.minSynergy * 100).toFixed(0),
              })}
            </p>
          </div>
        </header>
        <fieldset className="mt-4 grid max-w-xl grid-cols-1 gap-3 border-0 p-0 min-[481px]:grid-cols-2">
          <legend className="sr-only">{t('analysis.thresholds')}</legend>
          <Field
            id="combination-min-win-rate"
            data-testid="combination-min-win-rate"
            type="number"
            min={0}
            max={100}
            step={1}
            label={t('analysis.minimumCombinationWinRate')}
            hint="%"
            value={Number((recommendationOptions.minWinRate * 100).toFixed(2))}
            onChange={(event) =>
              onRecommendationOptionsChange({
                ...recommendationOptions,
                minWinRate:
                  Math.min(100, Math.max(0, Number(event.target.value))) / 100,
              })
            }
          />
          <Field
            id="combination-min-synergy"
            data-testid="combination-min-synergy"
            type="number"
            min={-100}
            max={100}
            step={1}
            label={t('analysis.minimumSynergy')}
            hint="%"
            value={Number((recommendationOptions.minSynergy * 100).toFixed(2))}
            onChange={(event) =>
              onRecommendationOptionsChange({
                ...recommendationOptions,
                minSynergy:
                  Math.min(100, Math.max(-100, Number(event.target.value))) /
                  100,
              })
            }
          />
        </fieldset>
        {combinationRecommendations.length > 0 ? (
          <div
            className="mt-3 max-h-[465px] overflow-y-auto overscroll-contain"
            data-testid="combination-recommendations-scroll"
            aria-labelledby="combination-recommendations-title"
            tabIndex={0}
          >
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
                        {t('common.combinationWinRate')}
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
            {t('analysis.noCombinations', {
              winRate: (recommendationOptions.minWinRate * 100).toFixed(0),
              synergy: (recommendationOptions.minSynergy * 100).toFixed(0),
            })}
          </div>
        )}
      </section>
    </section>
  )
}
