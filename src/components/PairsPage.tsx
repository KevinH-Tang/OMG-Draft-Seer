import {
  ArrowDownUp,
  ChevronDown,
  ChevronUp,
  Filter,
  GitFork,
  Search,
} from 'lucide-react'
import type { ReactNode, RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import type { VirtualItem } from '@tanstack/react-virtual'
import type { AbilityPairEntry } from '../core/pairs'
import { cn } from '../lib/cn'
import { formatPairPercent } from '../lib/recommendation-format'
import type { Snapshot } from '../types'
import { SkillIcon } from './SkillIcon'

const MAX_VISIBLE_HIDDEN_TRIPLES = 6

export type PairSortKey =
  | 'abilityOne'
  | 'winRateOne'
  | 'abilityTwo'
  | 'winRateTwo'
  | 'pairWinRate'
  | 'synergy'
  | 'trueSynergy'
export type SortDirection = 'asc' | 'desc'
export interface PairSort {
  key: PairSortKey
  direction: SortDirection
}

function pairAriaSort(
  sort: PairSort,
  key: PairSortKey,
): 'ascending' | 'descending' | 'none' {
  if (sort.key !== key) return 'none'
  return sort.direction === 'asc' ? 'ascending' : 'descending'
}

function PairAbilityCell({
  ability,
}: {
  ability: AbilityPairEntry['abilityOne']
}) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <SkillIcon
        abilityId={ability.id}
        shortName={ability.shortName}
        name={ability.name}
        isHero={ability.isHero}
      />
      <span className="grid min-w-0 gap-0.5">
        <strong className="truncate text-xs font-medium text-text">
          {ability.name}
        </strong>
      </span>
    </div>
  )
}

function HiddenTriplesCell({
  entries,
}: {
  entries: AbilityPairEntry['hiddenTriples']
}) {
  const { t } = useTranslation()
  if (entries.length === 0) return <span className="text-text-muted">—</span>
  const visibleEntries = entries.slice(0, MAX_VISIBLE_HIDDEN_TRIPLES)
  const hiddenCount = entries.length - visibleEntries.length
  return (
    <div className="flex min-w-0 items-center gap-1 overflow-hidden whitespace-nowrap">
      {visibleEntries.map((entry) => {
        const opacity =
          0.15 + (Math.min(10, Math.abs(entry.winRateShift)) / 10) * 0.35
        const background =
          entry.winRateShift >= 0
            ? `rgba(139, 216, 121, ${opacity})`
            : `rgba(229, 140, 122, ${opacity})`
        return (
          <span
            className="inline-flex size-[26px] shrink-0 items-center justify-center rounded-sm [&_.skill-icon]:size-6"
            key={entry.ability.id}
            style={{ background }}
            title={`${entry.ability.name} · ${entry.picks.toLocaleString()} ${t('common.games')} · ${formatPairPercent(entry.winRate)} ${t('common.winRate')} · ${t('common.synergy')} ${formatPairPercent(entry.winRateShift / 100, true)}`}
          >
            <SkillIcon
              compact
              abilityId={entry.ability.id}
              shortName={entry.ability.shortName}
              name={entry.ability.name}
              isHero={entry.ability.isHero}
            />
          </span>
        )
      })}
      {hiddenCount > 0 && (
        <span
          className="shrink-0 font-mono text-[10px] text-text-muted"
          title={t('pairs.moreHiddenTriples', { count: hiddenCount })}
        >
          +{hiddenCount}
        </span>
      )}
    </div>
  )
}

function PairSortButton({
  label,
  sortKey,
  sort,
  onSort,
  title,
}: {
  label: ReactNode
  sortKey: PairSortKey
  sort: PairSort
  onSort: (key: PairSortKey) => void
  title?: string
}) {
  const selected = sort.key === sortKey
  const Icon = selected
    ? sort.direction === 'asc'
      ? ChevronUp
      : ChevronDown
    : ArrowDownUp
  return (
    <button
      className={cn(
        'inline-flex items-center gap-1 text-left text-xs text-text-muted hover:text-text',
        selected && 'text-text',
      )}
      type="button"
      title={title}
      onClick={() => onSort(sortKey)}
    >
      <span>{label}</span>
      <Icon size={13} aria-hidden="true" />
    </button>
  )
}

export interface PairsPageProps {
  snapshot: Snapshot
  entries: readonly AbilityPairEntry[]
  filteredEntries: readonly AbilityPairEntry[]
  query: string
  excludeSameHero: boolean
  sort: PairSort
  tableRef: RefObject<HTMLDivElement | null>
  virtualRows: readonly VirtualItem[]
  topSpacer: number
  bottomSpacer: number
  onQueryChange: (query: string) => void
  onExcludeSameHeroToggle: () => void
  onSort: (key: PairSortKey) => void
}

export function PairsPage({
  snapshot,
  entries,
  filteredEntries,
  query,
  excludeSameHero,
  sort,
  tableRef,
  virtualRows,
  topSpacer,
  bottomSpacer,
  onQueryChange,
  onExcludeSameHeroToggle,
  onSort,
}: PairsPageProps) {
  const { t } = useTranslation()

  return (
    <section
      className="mt-6 border-t border-border-subtle pt-5"
      aria-labelledby="pairs-page-title"
    >
      <div className="flex flex-col items-start justify-between gap-3 min-[601px]:flex-row">
        <div>
          <p className="eyebrow">{t('pairs.step')}</p>
          <h2 id="pairs-page-title">{t('pairs.title')}</h2>
          <p className="mb-0 mt-2 text-xs text-text-muted">
            {t('common.patch')} {snapshot.patch} ·{' '}
            {t('pairs.visiblePairs', {
              visible: filteredEntries.length.toLocaleString(),
              total: entries.length.toLocaleString(),
            })}
          </p>
        </div>
        <div className="inline-flex items-center gap-2 text-[11px] font-bold tracking-[0.08em] text-accent">
          <GitFork size={21} aria-hidden="true" />
          <span>{t('pairs.synergy')}</span>
        </div>
      </div>

      <div className="mt-[18px] flex flex-col gap-2 min-[601px]:flex-row min-[601px]:items-center min-[601px]:justify-between">
        <label className="flex min-w-0 w-full items-center gap-2 border border-border-strong bg-surface px-2 py-2 text-text-muted focus-within:border-accent min-[601px]:w-[min(360px,48vw)] min-[601px]:min-w-[230px]">
          <Search size={15} aria-hidden="true" />
          <span className="sr-only">{t('pairs.searchLabel')}</span>
          <input
            className="min-w-0 w-full border-0 bg-transparent text-[13px] text-text outline-hidden placeholder:text-text-muted"
            data-testid="pairs-search"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder={t('pairs.searchPlaceholder')}
          />
        </label>
        <div className="flex flex-col items-start gap-2 min-[601px]:flex-row min-[601px]:items-center">
          <span className="text-xs text-text-muted">
            {t('pairs.minimumPicks')}
          </span>
          <button
            className={cn(
              'inline-flex items-center gap-1.5 border border-border-strong bg-surface-raised px-2.5 py-1.5 text-xs text-text hover:border-accent hover:bg-accent-soft',
              excludeSameHero && 'border-accent bg-accent-soft',
            )}
            type="button"
            aria-pressed={excludeSameHero}
            data-testid="pairs-exclude-same-hero"
            onClick={onExcludeSameHeroToggle}
          >
            <Filter size={14} aria-hidden="true" /> {t('pairs.excludeSameHero')}
          </button>
        </div>
      </div>

      <div
        ref={tableRef}
        className="mt-3 max-h-[calc(100vh-360px)] overflow-auto border border-border bg-surface"
      >
        <table className="w-full min-w-[1120px] border-collapse text-xs">
          <thead>
            <tr>
              <th
                className="sticky top-0 z-10 border-b border-border-strong bg-surface-raised px-3 py-2 text-left font-medium"
                aria-sort={pairAriaSort(sort, 'abilityOne')}
              >
                <PairSortButton
                  label={t('pairs.abilityOne')}
                  sortKey="abilityOne"
                  sort={sort}
                  onSort={onSort}
                />
              </th>
              <th
                className="sticky top-0 z-10 border-b border-border-strong bg-surface-raised px-3 py-2 text-center font-medium"
                aria-sort={pairAriaSort(sort, 'winRateOne')}
              >
                <PairSortButton
                  label={t('pairs.winRateOne')}
                  sortKey="winRateOne"
                  sort={sort}
                  onSort={onSort}
                />
              </th>
              <th
                className="sticky top-0 z-10 border-b border-border-strong bg-surface-raised px-3 py-2 text-left font-medium"
                aria-sort={pairAriaSort(sort, 'abilityTwo')}
              >
                <PairSortButton
                  label={t('pairs.abilityTwo')}
                  sortKey="abilityTwo"
                  sort={sort}
                  onSort={onSort}
                />
              </th>
              <th
                className="sticky top-0 z-10 border-b border-border-strong bg-surface-raised px-3 py-2 text-center font-medium"
                aria-sort={pairAriaSort(sort, 'winRateTwo')}
              >
                <PairSortButton
                  label={t('pairs.winRateTwo')}
                  sortKey="winRateTwo"
                  sort={sort}
                  onSort={onSort}
                />
              </th>
              <th
                className="sticky top-0 z-10 border-b border-border-strong bg-surface-raised px-3 py-2 text-center font-medium"
                aria-sort={pairAriaSort(sort, 'pairWinRate')}
              >
                <PairSortButton
                  label={t('common.pairWinRate')}
                  sortKey="pairWinRate"
                  sort={sort}
                  onSort={onSort}
                />
              </th>
              <th
                className="sticky top-0 z-10 border-b border-border-strong bg-surface-raised px-3 py-2 text-center font-medium"
                aria-sort={pairAriaSort(sort, 'synergy')}
              >
                <PairSortButton
                  label={t('common.synergy')}
                  sortKey="synergy"
                  sort={sort}
                  onSort={onSort}
                />
              </th>
              <th
                className="sticky top-0 z-10 border-b border-border-strong bg-surface-raised px-3 py-2 text-center font-medium"
                aria-sort={pairAriaSort(sort, 'trueSynergy')}
              >
                <PairSortButton
                  label={t('pairs.trueSynergy')}
                  sortKey="trueSynergy"
                  sort={sort}
                  onSort={onSort}
                  title={t('pairs.trueSynergyHint')}
                />
              </th>
              <th className="sticky top-0 z-10 border-b border-border-strong bg-surface-raised px-3 py-2 text-left font-medium">
                <span className="inline-flex items-center gap-1 text-text-muted">
                  {t('pairs.hiddenTriples')}{' '}
                  <span
                    className="grid size-3.5 place-items-center rounded-full border border-border-strong text-[9px]"
                    title={t('pairs.hiddenTripleHint')}
                  >
                    ?
                  </span>
                </span>
              </th>
            </tr>
          </thead>
          <tbody>
            {topSpacer > 0 && (
              <tr aria-hidden="true">
                <td
                  className="h-0 border-0 p-0 leading-none"
                  colSpan={8}
                  style={{ height: topSpacer }}
                />
              </tr>
            )}
            {virtualRows.map((virtualRow) => {
              const entry = filteredEntries[virtualRow.index]
              if (!entry) return null
              return (
                <tr
                  className="border-b border-border-subtle hover:bg-surface-hover"
                  key={entry.key}
                >
                  <td className="px-3 py-2">
                    <PairAbilityCell ability={entry.abilityOne} />
                  </td>
                  <td className="px-3 py-2 text-center font-mono text-[11px] text-text-muted whitespace-nowrap">
                    {formatPairPercent(entry.winRateOne)}
                  </td>
                  <td className="px-3 py-2">
                    <PairAbilityCell ability={entry.abilityTwo} />
                  </td>
                  <td className="px-3 py-2 text-center font-mono text-[11px] text-text-muted whitespace-nowrap">
                    {formatPairPercent(entry.winRateTwo)}
                  </td>
                  <td className="px-3 py-2 text-center font-mono text-[11px] font-bold text-text-strong whitespace-nowrap">
                    {formatPairPercent(entry.pairWinRate)}
                  </td>
                  <td
                    className={cn(
                      'px-3 py-2 text-center font-mono text-[11px] whitespace-nowrap',
                      entry.synergy === undefined
                        ? 'text-text-muted'
                        : entry.synergy >= 0
                          ? 'text-positive'
                          : 'text-negative',
                    )}
                  >
                    {formatPairPercent(entry.synergy, true)}
                  </td>
                  <td
                    className={cn(
                      'px-3 py-2 text-center font-mono text-[11px] whitespace-nowrap',
                      entry.trueSynergy === undefined
                        ? 'text-text-muted'
                        : entry.trueSynergy >= 0
                          ? 'text-positive'
                          : 'text-negative',
                    )}
                  >
                    {formatPairPercent(entry.trueSynergy, true)}
                  </td>
                  <td className="px-3 py-2">
                    <HiddenTriplesCell entries={entry.hiddenTriples} />
                  </td>
                </tr>
              )
            })}
            {bottomSpacer > 0 && (
              <tr aria-hidden="true">
                <td
                  className="h-0 border-0 p-0 leading-none"
                  colSpan={8}
                  style={{ height: bottomSpacer }}
                />
              </tr>
            )}
            {filteredEntries.length === 0 && (
              <tr>
                <td
                  className="h-[190px] text-center text-text-muted"
                  colSpan={8}
                >
                  <Search className="mx-auto mb-2" size={22} />
                  <p className="m-0 text-[13px]">
                    {query.trim()
                      ? t('pairs.noSearchResults')
                      : t('pairs.noPairs')}
                  </p>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}
