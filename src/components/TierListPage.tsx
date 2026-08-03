import * as Tooltip from '@radix-ui/react-tooltip'
import { Layers, Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { isHeroAbility } from '../core/ability-category'
import {
  TIER_CATEGORY_OPTIONS,
  TIER_ORDER,
  type AbilityTier,
  type TierCategory,
  type TierEntry,
} from '../core/tiers'
import { cn } from '../lib/cn'
import { TIER_TEXT_CLASSES } from '../lib/tier-presentation'
import type { OverlayKind } from '../platform/overlays'
import type { Snapshot } from '../types'
import { OverlayToggleButton } from './OverlayViews'
import { SkillIcon } from './SkillIcon'
import { PageHeader } from './ui'

function formatAveragePickPosition(value: number): string {
  return Number.isFinite(value) ? value.toFixed(2) : '—'
}

function formatAbilityValue(value: number | undefined): string {
  return value === undefined || !Number.isFinite(value)
    ? '—'
    : `${value >= 0 ? '+' : ''}${(value * 100).toFixed(2)}%`
}

function TierAbilityCard({ entry }: { entry: TierEntry }) {
  const { t } = useTranslation()
  const isHero = isHeroAbility(entry.ability)
  const type = isHero
    ? t('tiers.hero')
    : entry.ability.isUltimate
      ? t('tiers.ultimate')
      : t('tiers.ability')
  const winRate = `${(entry.winRate * 100).toFixed(1)}%`
  const averagePick = formatAveragePickPosition(entry.stats.avgPickPosition)
  const value = formatAbilityValue(entry.value)

  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <button
          className="grid size-11 place-items-center rounded-sm border border-transparent p-0 text-inherit transition-colors hover:border-accent hover:bg-accent-soft focus:border-accent focus:bg-accent-soft focus:outline-hidden focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent [&_.skill-icon]:size-11 [&_.skill-icon]:transition-transform hover:[&_.skill-icon]:scale-110 focus:[&_.skill-icon]:scale-110"
          type="button"
          aria-label={`${entry.ability.name}, ${type}, ${t('common.winRate')} ${winRate}, ${t('common.averagePick')} ${averagePick}, ${t('common.value')} ${value}`}
        >
          <SkillIcon
            abilityId={entry.ability.id}
            shortName={entry.ability.shortName}
            name={entry.ability.name}
            isHero={isHero}
          />
        </button>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          className="z-50 grid w-[218px] gap-1.5 rounded-sm border border-border bg-surface p-3 text-left text-text shadow-panel"
          side="bottom"
          sideOffset={8}
          collisionPadding={10}
        >
          <strong className="truncate text-sm leading-5">
            {entry.ability.name}
          </strong>
          <span
            className={cn(
              'text-[11px]',
              isHero
                ? 'text-cyan-300'
                : entry.ability.isUltimate
                  ? 'text-accent'
                  : 'text-positive',
            )}
          >
            {type} · {t('tiers.rank', { rank: entry.rank })}
          </span>
          <span className="flex justify-between gap-2 font-mono text-xs leading-5 text-text-muted">
            <span>{t('common.winRate')}</span>
            <strong className="text-text-strong">{winRate}</strong>
          </span>
          <span className="flex justify-between gap-2 font-mono text-xs leading-5 text-text-muted">
            <span>{t('common.averagePick')}</span>
            <strong className="text-text-strong">{averagePick}</strong>
          </span>
          <span className="flex justify-between gap-2 font-mono text-xs leading-5 text-text-muted">
            <span>{t('common.value')}</span>
            <strong
              className={
                entry.value === undefined
                  ? 'text-text-strong'
                  : entry.value >= 0
                    ? 'text-positive'
                    : 'text-negative'
              }
            >
              {value}
            </strong>
          </span>
          <Tooltip.Arrow className="fill-surface" width={12} height={6} />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  )
}

export interface TierListPageProps {
  snapshot: Snapshot
  category: TierCategory
  categoryCounts: Record<TierCategory, number>
  query: string
  groups: Record<AbilityTier, TierEntry[]>
  filteredEntryCount: number
  overlayOpen: boolean
  onCategoryChange: (category: TierCategory) => void
  onQueryChange: (query: string) => void
  onToggleOverlay: (kind: OverlayKind) => void
}

export function TierListPage({
  snapshot,
  category,
  categoryCounts,
  query,
  groups,
  filteredEntryCount,
  overlayOpen,
  onCategoryChange,
  onQueryChange,
  onToggleOverlay,
}: TierListPageProps) {
  const { t } = useTranslation()

  return (
    <section
      className="mt-6 border-t border-border-subtle pt-5"
      aria-labelledby="tier-page-title"
    >
      <PageHeader
        titleId="tier-page-title"
        eyebrow={t('tiers.step')}
        title={t('nav.database')}
        description={
          <>
            {t('common.patch')} {snapshot.patch} ·{' '}
            {t('tiers.rankedEntries', { count: categoryCounts[category] })}
          </>
        }
        aside={
          <>
            <Layers size={21} aria-hidden="true" />
            <OverlayToggleButton
              kind="recommendation"
              open={overlayOpen}
              onToggle={onToggleOverlay}
            />
          </>
        }
      />

      <div className="mt-[18px] flex flex-col gap-2 border-b border-border min-[601px]:flex-row min-[601px]:items-end min-[601px]:justify-between">
        <div
          className="order-2 flex min-w-0 gap-1 overflow-x-auto min-[601px]:order-1"
          role="tablist"
          aria-label={t('tiers.categories')}
        >
          {TIER_CATEGORY_OPTIONS.map((tab) => {
            const selected = category === tab.id
            return (
              <button
                key={tab.id}
                id={`tier-tab-${tab.id}`}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-controls={`tier-panel-${tab.id}`}
                className={cn(
                  'inline-flex shrink-0 items-center gap-2 border-b-2 border-transparent px-3 py-2.5 text-sm text-text-muted hover:bg-surface-hover hover:text-text',
                  selected && 'border-accent text-text',
                )}
                onClick={() => onCategoryChange(tab.id)}
              >
                {tab.label}
                <span className="font-mono text-[11px] text-text-muted">
                  {categoryCounts[tab.id]}
                </span>
              </button>
            )
          })}
        </div>
        <label className="order-1 mb-2 flex min-w-0 w-full items-center gap-2 border border-border-strong bg-surface px-2 py-2 text-text-muted focus-within:border-accent min-[601px]:order-2 min-[601px]:mb-[7px] min-[601px]:w-[min(245px,30vw)] min-[601px]:min-w-[190px]">
          <Search size={15} aria-hidden="true" />
          <span className="sr-only">{t('tiers.searchLabel')}</span>
          <input
            className="min-w-0 w-full border-0 bg-transparent text-[13px] text-text outline-hidden placeholder:text-text-muted"
            data-testid="tier-search"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder={t('tiers.searchPlaceholder')}
          />
        </label>
      </div>

      <div
        id={`tier-panel-${category}`}
        className="mt-3"
        role="tabpanel"
        aria-labelledby={`tier-tab-${category}`}
      >
        {TIER_ORDER.map((tier) => (
          <section
            className="grid grid-cols-[72px_minmax(0,1fr)] items-start gap-2 border-b border-border-subtle py-4 min-[601px]:grid-cols-[88px_minmax(0,1fr)] min-[601px]:gap-3"
            key={tier}
            aria-label={t('tiers.tierLabel', { tier })}
          >
            <div className="flex min-h-11 items-center gap-2">
              <strong
                className={cn(
                  'grid size-11 shrink-0 place-items-center border border-current bg-accent-soft text-[22px] leading-none',
                  TIER_TEXT_CLASSES[tier],
                )}
              >
                {tier}
              </strong>
              <span className="inline-flex min-w-6 items-center justify-center border border-border bg-surface-raised px-1 font-mono text-[10px] text-text-muted">
                {groups[tier].length}
              </span>
            </div>
            <div className="flex flex-wrap items-start gap-x-1 gap-y-2">
              {groups[tier].map((entry) => (
                <TierAbilityCard key={entry.ability.id} entry={entry} />
              ))}
              {groups[tier].length === 0 && filteredEntryCount > 0 && (
                <span className="w-full text-text-muted">
                  {t('tiers.noRankedEntries')}
                </span>
              )}
            </div>
          </section>
        ))}
        {filteredEntryCount === 0 && (
          <div
            className="grid min-h-40 place-content-center justify-items-center gap-2 text-text-muted"
            data-testid="tier-no-results"
          >
            <Search size={22} />
            <p className="m-0 text-[13px]">
              {query.trim()
                ? t('tiers.noSearchResults')
                : t('tiers.noRankedEntries')}
            </p>
          </div>
        )}
      </div>
    </section>
  )
}
