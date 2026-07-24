import i18n from '../i18n'
import { cn } from '../lib/cn'
import {
  formatLogitDelta,
  formatPairPercent,
} from '../lib/recommendation-format'
import type {
  Ability,
  PartialRecommendationInteraction,
  RecommendationInteraction,
} from '../types'
import { SkillIcon } from './SkillIcon'

function ui(key: string, options?: Record<string, unknown>): string {
  return i18n.t(key, options)
}

export function RecommendationInteractionsPopover({
  interactions,
  partialInteractions,
  abilities,
}: {
  interactions: readonly RecommendationInteraction[]
  partialInteractions: readonly PartialRecommendationInteraction[]
  abilities: ReadonlyMap<number, Ability>
}) {
  const popoverClass =
    'absolute right-0 top-[calc(100%+8px)] z-20 grid max-h-[232px] w-[208px] translate-y-[-4px] gap-1 overflow-y-auto border border-border bg-surface p-2 opacity-0 pointer-events-none shadow-panel transition-[opacity,transform,visibility] duration-150 group-hover:translate-y-0 group-hover:opacity-100 group-hover:pointer-events-auto group-focus:translate-y-0 group-focus:opacity-100 group-focus:pointer-events-auto'
  if (interactions.length === 0 && partialInteractions.length === 0)
    return (
      <div className={popoverClass}>{ui('analysis.noTrustedInteractions')}</div>
    )

  return (
    <div className={popoverClass}>
      {interactions.map((interaction) => (
        <div
          className="flex min-h-[26px] items-center gap-1 text-text"
          key={`${interaction.type}-${interaction.abilityIds.join('-')}`}
          title={ui('analysis.interactionTitle', {
            type: ui(`common.${interaction.type}`),
            lift: formatPairPercent(interaction.rawSynergy, true),
            delta: formatLogitDelta(interaction.rawLogitSynergy),
            count: interaction.picks.toLocaleString(),
          })}
        >
          <span className="inline-flex min-w-0 items-center">
            {interaction.abilityIds.map((id, index) => {
              const ability = abilities.get(id)
              return (
                <span
                  className="inline-flex items-center gap-1 [&_.skill-icon]:size-6"
                  key={id}
                >
                  {index > 0 && (
                    <span className="text-[11px] text-text-muted">+</span>
                  )}
                  <SkillIcon
                    compact
                    abilityId={ability?.id}
                    shortName={ability?.shortName}
                    name={ability?.name}
                    isHero={ability?.isHero}
                  />
                </span>
              )
            })}
          </span>
          <strong
            className={cn(
              'ml-auto font-mono text-[10px]',
              interaction.synergy >= 0 ? 'text-positive' : 'text-negative',
            )}
            title={`${ui('common.logitDelta')} ${formatLogitDelta(interaction.logitSynergy)}`}
          >
            {formatPairPercent(interaction.synergy, true)}
          </strong>
        </div>
      ))}
      {partialInteractions.length > 0 && (
        <div className="mt-1 grid gap-1 border-t border-border pt-1.5">
          <span className="text-[10px] text-warning">
            {ui('analysis.partialInteractions')}
          </span>
          {partialInteractions.map((interaction) => {
            const missingPairs = interaction.missingPairIds
              .map(
                ([leftId, rightId]) =>
                  `${abilities.get(leftId)?.shortName ?? leftId} + ${abilities.get(rightId)?.shortName ?? rightId}`,
              )
              .join(', ')
            return (
              <div
                className="flex min-h-[26px] items-center gap-1 text-warning"
                key={`partial-${interaction.abilityIds.join('-')}`}
                title={ui('analysis.partialInteractionTitle', {
                  coverage: interaction.pairCoverage,
                  missing: missingPairs,
                  delta: formatLogitDelta(interaction.rawLogitSynergy),
                  count: interaction.picks.toLocaleString(),
                })}
              >
                <span className="inline-flex min-w-0 items-center">
                  {interaction.abilityIds.map((id, index) => {
                    const ability = abilities.get(id)
                    return (
                      <span
                        className="inline-flex items-center gap-1 [&_.skill-icon]:size-6"
                        key={id}
                      >
                        {index > 0 && (
                          <span className="text-[11px] text-text-muted">+</span>
                        )}
                        <SkillIcon
                          compact
                          abilityId={ability?.id}
                          shortName={ability?.shortName}
                          name={ability?.name}
                          isHero={ability?.isHero}
                        />
                      </span>
                    )
                  })}
                </span>
                <strong className="ml-auto font-mono text-[10px]">
                  {interaction.pairCoverage}/3
                </strong>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
