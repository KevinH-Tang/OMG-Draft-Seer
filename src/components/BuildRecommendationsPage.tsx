import { GitFork } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { CombinationRecommendationOptions } from '../core/combinations'
import type { OverlayKind } from '../platform/overlays'
import type {
  Ability,
  AbilityStats,
  CombinationRecommendationGroup,
} from '../types'
import { CombinationPopularityRow } from './CombinationPopularityRow'
import { OverlayToggleButton } from './OverlayViews'
import { PairRecommendationRow } from './PairRecommendationRow'
import { Field, PageHeader } from './ui'

export interface BuildRecommendationsPageProps {
  combinationRecommendationGroups: readonly CombinationRecommendationGroup[]
  recommendationOptions: CombinationRecommendationOptions
  abilities: ReadonlyMap<number, Ability>
  abilityStats: readonly AbilityStats[]
  assistantOverlayOpen: boolean
  onRecommendationOptionsChange: (
    options: CombinationRecommendationOptions,
  ) => void
  onToggleOverlay: (kind: OverlayKind) => void
}

export function BuildRecommendationsPage({
  combinationRecommendationGroups,
  recommendationOptions,
  abilities,
  abilityStats,
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
                pairWinRate: (
                  recommendationOptions.pairMinWinRate * 100
                ).toFixed(0),
                pairSynergy: (
                  recommendationOptions.pairMinSynergy * 100
                ).toFixed(0),
                tripleWinRate: (
                  recommendationOptions.tripleMinWinRate * 100
                ).toFixed(0),
                tripleSynergy: (
                  recommendationOptions.tripleMinSynergy * 100
                ).toFixed(0),
              })}
            </p>
          </div>
        </header>
        <fieldset className="mt-4 grid max-w-4xl grid-cols-1 gap-3 border-0 p-0 min-[481px]:grid-cols-2 min-[901px]:grid-cols-4">
          <legend className="sr-only">{t('analysis.thresholds')}</legend>
          <Field
            id="pair-min-win-rate"
            data-testid="pair-min-win-rate"
            type="number"
            min={0}
            max={100}
            step={1}
            label={t('analysis.minimumPairWinRate')}
            hint="%"
            value={Number(
              (recommendationOptions.pairMinWinRate * 100).toFixed(2),
            )}
            onChange={(event) =>
              onRecommendationOptionsChange({
                ...recommendationOptions,
                pairMinWinRate:
                  Math.min(100, Math.max(0, Number(event.target.value))) / 100,
              })
            }
          />
          <Field
            id="pair-min-synergy"
            data-testid="pair-min-synergy"
            type="number"
            min={-100}
            max={100}
            step={1}
            label={t('analysis.minimumPairSynergy')}
            hint="%"
            value={Number(
              (recommendationOptions.pairMinSynergy * 100).toFixed(2),
            )}
            onChange={(event) =>
              onRecommendationOptionsChange({
                ...recommendationOptions,
                pairMinSynergy:
                  Math.min(100, Math.max(-100, Number(event.target.value))) /
                  100,
              })
            }
          />
          <Field
            id="triple-min-win-rate"
            data-testid="triple-min-win-rate"
            type="number"
            min={0}
            max={100}
            step={1}
            label={t('analysis.minimumTripleWinRate')}
            hint="%"
            value={Number(
              (recommendationOptions.tripleMinWinRate * 100).toFixed(2),
            )}
            onChange={(event) =>
              onRecommendationOptionsChange({
                ...recommendationOptions,
                tripleMinWinRate:
                  Math.min(100, Math.max(0, Number(event.target.value))) / 100,
              })
            }
          />
          <Field
            id="triple-min-synergy"
            data-testid="triple-min-synergy"
            type="number"
            min={-100}
            max={100}
            step={1}
            label={t('analysis.minimumTripleSynergy')}
            hint="%"
            value={Number(
              (recommendationOptions.tripleMinSynergy * 100).toFixed(2),
            )}
            onChange={(event) =>
              onRecommendationOptionsChange({
                ...recommendationOptions,
                tripleMinSynergy:
                  Math.min(100, Math.max(-100, Number(event.target.value))) /
                  100,
              })
            }
          />
        </fieldset>
        {combinationRecommendationGroups.length > 0 ? (
          <>
            <CombinationPopularityRow
              groups={combinationRecommendationGroups}
              abilities={abilities}
              abilityStats={abilityStats}
            />
            <div
              className="max-h-[465px] overflow-y-auto overscroll-contain"
              data-testid="combination-recommendations-scroll"
              aria-labelledby="combination-recommendations-title"
              tabIndex={0}
            >
              {combinationRecommendationGroups.map((group, index) => (
                <PairRecommendationRow
                  group={group}
                  abilities={abilities}
                  rank={index + 1}
                  key={group.pairAbilityIds.join('-')}
                />
              ))}
            </div>
          </>
        ) : (
          <div className="mt-3 grid min-h-24 place-content-center justify-items-center border border-dashed border-border-strong bg-surface text-center text-[13px] text-text-muted">
            {t('analysis.noCombinations')}
          </div>
        )}
      </section>
    </section>
  )
}
