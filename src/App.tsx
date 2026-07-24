import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import * as AlertDialog from '@radix-ui/react-alert-dialog'
import * as Popover from '@radix-ui/react-popover'
import * as Tooltip from '@radix-ui/react-tooltip'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useTranslation } from 'react-i18next'
import { ArrowDownUp, Bug, Check, ChevronDown, ChevronUp, CircleAlert, Download, FileImage, Filter, FolderOpen, GitFork, Layers, LayoutPanelTop, MousePointer2Off, PanelTop, Pause, Pin, PinOff, Play, RefreshCw, RotateCcw, ScanSearch, Search, Settings2, SkipBack, SkipForward, Sparkles, Timer, Upload, Users } from 'lucide-react'
import { Toaster, toast } from 'sonner'
import { demoSnapshot } from './data/demoSnapshot'
import { clampRectToCanvas, cropCenter, DEFAULT_LAYOUT_DOCUMENT, MATCH_CROP_RATIO, parseLayoutDocument, scaleLayoutToCanvas, scaleRect, slotLabel, ULTIMATE_SLOT_ORDER, validateScreenshotDimensions, type FixedSlot, type LayoutDocument } from './core/layout'
import { buildAbilityPairList, type AbilityPairEntry } from './core/pairs'
import { BUILD_PICK_LIMITS, recommendBuilds, scoreDraftBuild, type BuildCandidatePools } from './core/recommendation'
import { buildRankedDraftPool, DRAFT_PICK_QUOTAS, DRAFT_POOL_SIZES, playerDraftCategoryCounts, remainingPoolCounts, validateInitialDraftPool, type DraftState, type DraftStrategyId, type InitialDraftPool } from './core/draft-state'
import { createDraftStrategyMap, simulateDraft, type DraftReplayFrame, type DraftSimulationResult } from './core/draft-tree'
import { positionsForPlayer, turnAt } from './core/draft-turns'
import type { RankedDraftCandidate } from './core/draft-strategy'
import { isSupportedScreenshotFile, SCREENSHOT_FILE_ACCEPT } from './core/screenshot-file'
import { buildAbilityTierList, filterTierEntries, getTierCategoryCounts, TIER_CATEGORY_OPTIONS, TIER_ORDER, type AbilityTier, type TierCategory, type TierEntry } from './core/tiers'
import { isHeroAbility } from './core/ability-category'
import { detectRuntimeCapabilities, missingRuntimeCapabilities } from './platform/capabilities'
import { getBrowserFileAdapter } from './platform/files'
import { closeNativeOverlay, createOverlayChannel, isDesktopRuntime, openNativeOverlay, overlayKindFromLocation, readOverlayState, writeOverlayState, type OverlayKind, type OverlayMessage, type OverlayState } from './platform/overlays'
import { appResourceUrl, localAbilityIconUrl, remoteAbilityIconUrl } from './platform/resources'
import { getBrowserStorage, readStoredJson, writeStoredJson } from './platform/storage'
import { LanguageSwitcher } from './components/LanguageSwitcher'
import { toAppLocale } from './i18n'
import { cn } from './lib/cn'
import type { Ability, IconSignature, PartialRecommendationInteraction, Recommendation, RecommendationInteraction, RecognizedSlot, Rect, SlotCategory, Snapshot } from './types'

const categoryLabel = { hero: '英雄', ability: '技能', ultimate: '终极' } as const
const goldenLabels: Record<number, number> = { 6: -41, 50: 5342 }
type AppPage = 'analysis' | 'layout' | 'database' | 'pairs' | 'draft'
type PairSortKey = 'abilityOne' | 'winRateOne' | 'abilityTwo' | 'winRateTwo' | 'pairWinRate' | 'synergy' | 'trueSynergy'
type SortDirection = 'asc' | 'desc'

const appPages: Array<{ id: AppPage; labelKey: 'nav.analysis' | 'nav.layout' | 'nav.database' | 'nav.pairs' | 'nav.draft'; icon: typeof ScanSearch }> = [
  { id: 'analysis', labelKey: 'nav.analysis', icon: ScanSearch },
  { id: 'layout', labelKey: 'nav.layout', icon: LayoutPanelTop },
  { id: 'database', labelKey: 'nav.database', icon: Layers },
  { id: 'pairs', labelKey: 'nav.pairs', icon: GitFork },
  { id: 'draft', labelKey: 'nav.draft', icon: Play },
]

const DEBUG_CONTEXT_PADDING = 12
const DEBUG_PREVIEW_SIZE = 240
const DEBUG_BORDER_WIDTH = 2
const DEBUG_MATCH_CANDIDATES = 5
const RECOGNITION_TIMEOUT_MS = 30_000
const PAIR_ROW_HEIGHT = 52
const MAX_VISIBLE_HIDDEN_TRIPLES = 6
const BUILD_PICK_GROUPS: Array<{ key: keyof BuildCandidatePools; label: string; limit: number }> = [
  { key: 'heroIds', label: '英雄', limit: BUILD_PICK_LIMITS.hero },
  { key: 'abilityIds', label: '技能', limit: BUILD_PICK_LIMITS.ability },
  { key: 'ultimateIds', label: '终极', limit: BUILD_PICK_LIMITS.ultimate },
]

type ImageSize = Pick<LayoutDocument, 'width' | 'height'>

const DEFAULT_IMAGE_SIZE: ImageSize = {
  width: DEFAULT_LAYOUT_DOCUMENT.width,
  height: DEFAULT_LAYOUT_DOCUMENT.height,
}

const EMPTY_OVERLAY_STATE: OverlayState = {
  candidatePools: { heroIds: [], abilityIds: [], ultimateIds: [] },
  locale: 'zh-CN',
  recommendations: [],
  selectedIds: [],
  tierCategory: 'all',
  tierQuery: '',
}

function buildScaledLayout(document: LayoutDocument, overrides: Record<number, Rect>, imageSize: ImageSize): FixedSlot[] {
  const sourceSlots = document.slots.map((slot, index) => ({
    ...slot,
    rect: overrides[index] ?? slot.rect,
  }))
  return scaleLayoutToCanvas(sourceSlots, document.width, document.height, imageSize.width, imageSize.height)
}

function updateSlotSelection(slots: RecognizedSlot[], index: number, selectedAbilityId: number | undefined): RecognizedSlot[] {
  let changed = false
  const next = slots.map((slot) => {
    if (slot.index !== index || slot.selectedAbilityId === selectedAbilityId) return slot
    changed = true
    return { ...slot, selectedAbilityId }
  })
  return changed ? next : slots
}

const SkillIcon = memo(function SkillIcon({ abilityId, shortName, name, isHero, compact = false, catalog = false }: { abilityId?: number; shortName?: string; name?: string; isHero?: boolean; compact?: boolean; catalog?: boolean }) {
  const resolvedIsHero = abilityId === undefined ? Boolean(isHero) : isHeroAbility({ id: abilityId, isHero })
  const localUrl = shortName ? localAbilityIconUrl(abilityId, shortName, resolvedIsHero) : undefined
  const fallbackUrl = shortName ? remoteAbilityIconUrl(shortName, resolvedIsHero) : undefined
  const fallbackLabel = Array.from(name ?? shortName ?? '?').slice(0, 2).join('').toUpperCase()
  return (
    <span className={`skill-icon ${compact ? 'compact' : ''} ${catalog ? 'catalog' : ''}`} style={{ background: 'transparent' }}>
      <span className="skill-icon-fallback" aria-hidden="true">{fallbackLabel}</span>
      {shortName && <img src={localUrl ?? fallbackUrl} alt={name ?? ''} loading="lazy" decoding="async" onError={(event) => {
        const image = event.currentTarget
        if (localUrl && fallbackUrl && image.dataset.cdnFallback !== 'true') {
          image.dataset.cdnFallback = 'true'
          image.src = fallbackUrl
        } else {
          image.style.display = 'none'
        }
      }} />}
    </span>
  )
})

const ABILITY_POOL_GROUPS: Array<{ category: SlotCategory; label: string }> = [
  { category: 'ultimate', label: 'ULTIMATES' },
  { category: 'ability', label: 'ABILITIES' },
  { category: 'hero', label: 'HEROES' },
]

const ManualAbilitySlot = memo(function ManualAbilitySlot({ slot, abilities, isOpen, onOpenChange, onSelect }: {
  slot: RecognizedSlot
  abilities: ReadonlyMap<number, Ability>
  isOpen: boolean
  onOpenChange: (slotIndex: number, open: boolean) => void
  onSelect: (slotIndex: number, abilityId: number) => void
}) {
  const best = slot.candidates[0]
  const bestAbility = best === undefined ? undefined : abilities.get(best.abilityId)
  const selectedAbility = slot.selectedAbilityId === undefined ? undefined : abilities.get(slot.selectedAbilityId)
  const displayedAbility = selectedAbility ?? bestAbility
  const confirmed = slot.selectedAbilityId !== undefined
  const slotName = displayedAbility?.name ?? '未知技能'

  return <Popover.Root open={isOpen} onOpenChange={(open) => onOpenChange(slot.index, open)}>
    <Popover.Trigger asChild>
      <button
        type="button"
        className={`manual-pool-item ${confirmed ? 'confirmed' : ''}`}
        title={`${slotLabel(slot.index)} · ${slotName}${confirmed ? ' · confirmed' : ' · suggestion'}`}
        aria-label={`${slotLabel(slot.index)}，${slotName}，${confirmed ? '已确认' : '待确认'}，选择候选技能`}
      >
        <SkillIcon abilityId={displayedAbility?.id} shortName={displayedAbility?.shortName} name={displayedAbility?.name} isHero={displayedAbility?.isHero} />
        <span className="manual-pool-slot-position">{slotLabel(slot.index)}</span>
      </button>
    </Popover.Trigger>
    <Popover.Portal>
      <Popover.Content className="manual-candidates manual-candidates-popover" side="bottom" align="start" sideOffset={5} collisionPadding={8}>
        {slot.candidates.map((candidate, index) => {
          const item = abilities.get(candidate.abilityId)
          if (!item) return null
          return <button
            type="button"
            className="manual-candidate"
            key={candidate.abilityId}
            onClick={() => onSelect(slot.index, candidate.abilityId)}
          >
            <span className="candidate-rank">{index + 1}</span>
            <SkillIcon abilityId={item.id} shortName={item.shortName} name={item.name} isHero={item.isHero} />
            <span className="candidate-name">{item.name}</span>
          </button>
        })}
        {slot.candidates.length === 0 && <span className="manual-candidates-empty">没有可用候选技能</span>}
        <Popover.Arrow className="manual-candidates-arrow" width={12} height={6} />
      </Popover.Content>
    </Popover.Portal>
  </Popover.Root>
})

const ManualAbilityPool = memo(function ManualAbilityPool({ slots, abilities, manualSlotIndex, onOpenChange, onSelect }: {
  slots: readonly RecognizedSlot[]
  abilities: ReadonlyMap<number, Ability>
  manualSlotIndex?: number
  onOpenChange: (slotIndex: number, open: boolean) => void
  onSelect: (slotIndex: number, abilityId: number) => void
}) {
  return <div className="manual-pool-sections" aria-label="Ability pool manual validation">
    {ABILITY_POOL_GROUPS.map(({ category, label }) => {
      const categorySlots = slots.filter((slot) => slot.category === category)
      const confirmedCount = categorySlots.filter((slot) => slot.selectedAbilityId !== undefined).length
      return <section className={`manual-pool-section ${category}`} key={category} aria-labelledby={`manual-pool-${category}`}>
        <header>
          <span id={`manual-pool-${category}`}>{label}</span>
          <strong aria-label={`${confirmedCount} of ${categorySlots.length} confirmed`}>{confirmedCount}/{categorySlots.length}</strong>
        </header>
        <div className={`manual-pool-grid ${category === 'ability' ? 'wide' : 'narrow'}`}>
          {categorySlots.map((slot) => <ManualAbilitySlot
            key={slot.index}
            slot={slot}
            abilities={abilities}
            isOpen={manualSlotIndex === slot.index}
            onOpenChange={onOpenChange}
            onSelect={onSelect}
          />)}
        </div>
      </section>
    })}
  </div>
})

function formatAveragePickPosition(value: number): string {
  return Number.isFinite(value) ? value.toFixed(2) : '—'
}

function formatAbilityValue(value: number | undefined): string {
  return value === undefined || !Number.isFinite(value) ? '—' : `${value >= 0 ? '+' : ''}${(value * 100).toFixed(2)}%`
}

function formatPairPercent(value: number | undefined, signed = false): string {
  if (value === undefined || !Number.isFinite(value)) return '—'
  const percent = value * 100
  return `${signed && percent > 0 ? '+' : ''}${percent.toFixed(1)}%`
}

function formatLogitDelta(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return '—'
  return `${value > 0 ? '+' : ''}${value.toFixed(2)}`
}

function comparePairEntries(left: AbilityPairEntry, right: AbilityPairEntry, key: PairSortKey): number {
  if (key === 'abilityOne' || key === 'abilityTwo') {
    const leftAbility = key === 'abilityOne' ? left.abilityOne : left.abilityTwo
    const rightAbility = key === 'abilityOne' ? right.abilityOne : right.abilityTwo
    return leftAbility.name.localeCompare(rightAbility.name)
  }

  const leftValue = left[key]
  const rightValue = right[key]
  if (typeof leftValue === 'number' && typeof rightValue === 'number') {
    return leftValue - rightValue
  }
  if (leftValue === undefined && rightValue === undefined) return 0
  if (leftValue === undefined) return 1
  if (rightValue === undefined) return -1
  return 0
}

function pairAriaSort(sort: { key: PairSortKey; direction: SortDirection }, key: PairSortKey): 'ascending' | 'descending' | 'none' {
  if (sort.key !== key) return 'none'
  return sort.direction === 'asc' ? 'ascending' : 'descending'
}

function PairAbilityCell({ ability }: { ability: AbilityPairEntry['abilityOne'] }) {
  return <div className="pair-ability-cell">
    <SkillIcon abilityId={ability.id} shortName={ability.shortName} name={ability.name} isHero={ability.isHero} />
    <span className="pair-ability-name"><strong>{ability.name}</strong></span>
  </div>
}

function pickRoleLabel(ability: Ability | undefined): string {
  if (!ability) return '技能'
  if (isHeroAbility(ability)) return '英雄'
  return ability.isUltimate ? '终极' : '技能'
}

function HiddenTriplesCell({ entries }: { entries: AbilityPairEntry['hiddenTriples'] }) {
  if (entries.length === 0) return <span className="pair-muted">—</span>
  const visibleEntries = entries.slice(0, MAX_VISIBLE_HIDDEN_TRIPLES)
  const hiddenCount = entries.length - visibleEntries.length
  return <div className="hidden-triples-cell">
    {visibleEntries.map((entry) => {
      const opacity = 0.15 + Math.min(10, Math.abs(entry.winRateShift)) / 10 * 0.35
      const background = entry.winRateShift >= 0 ? `rgba(139, 216, 121, ${opacity})` : `rgba(229, 140, 122, ${opacity})`
      return <span
        className="hidden-triple-icon"
        key={entry.ability.id}
        style={{ background }}
        title={`${entry.ability.name} · ${entry.picks.toLocaleString()} games · ${formatPairPercent(entry.winRate)} WR · Shift ${formatPairPercent(entry.winRateShift / 100, true)}`}
      >
        <SkillIcon compact abilityId={entry.ability.id} shortName={entry.ability.shortName} name={entry.ability.name} isHero={entry.ability.isHero} />
      </span>
    })}
    {hiddenCount > 0 && <span className="hidden-triple-more" title={`${hiddenCount} more hidden triples`}>+{hiddenCount}</span>}
  </div>
}

function PairSortButton({ label, sortKey, sort, onSort, title }: { label: ReactNode; sortKey: PairSortKey; sort: { key: PairSortKey; direction: SortDirection }; onSort: (key: PairSortKey) => void; title?: string }) {
  const selected = sort.key === sortKey
  const Icon = selected ? sort.direction === 'asc' ? ChevronUp : ChevronDown : ArrowDownUp
  return <button className={`pair-sort-button ${selected ? 'selected' : ''}`} type="button" title={title} onClick={() => onSort(sortKey)}>
    <span>{label}</span><Icon size={13} aria-hidden="true" />
  </button>
}

function TierAbilityCard({ entry }: { entry: TierEntry }) {
  const isHero = isHeroAbility(entry.ability)
  const type = isHero ? 'Hero' : entry.ability.isUltimate ? 'Ultimate' : 'Ability'
  const winRate = `${(entry.winRate * 100).toFixed(1)}%`
  const averagePick = formatAveragePickPosition(entry.stats.avgPickPosition)
  const value = formatAbilityValue(entry.value)

  return <Tooltip.Root>
    <Tooltip.Trigger asChild>
      <button
        className="tier-card"
        type="button"
        aria-label={`${entry.ability.name}, ${type}, Win Rate ${winRate}, Avg Pick # ${averagePick}, Value ${value}`}
      >
        <SkillIcon abilityId={entry.ability.id} shortName={entry.ability.shortName} name={entry.ability.name} isHero={isHero} />
      </button>
    </Tooltip.Trigger>
    <Tooltip.Portal>
      <Tooltip.Content className="tier-card-tooltip" side="bottom" sideOffset={8} collisionPadding={10}>
        <strong className="tier-card-popover-title">{entry.ability.name}</strong>
        <span className={`tier-card-popover-type ${type.toLowerCase()}`}>{type} · Rank #{entry.rank}</span>
        <span className="tier-card-popover-stat"><span>Win Rate</span><strong>{winRate}</strong></span>
        <span className="tier-card-popover-stat"><span>Avg Pick #</span><strong>{averagePick}</strong></span>
        <span className="tier-card-popover-stat"><span>Value</span><strong className={entry.value === undefined ? '' : entry.value >= 0 ? 'positive-value' : 'negative-value'}>{value}</strong></span>
        <Tooltip.Arrow className="tier-card-tooltip-arrow" width={12} height={6} />
      </Tooltip.Content>
    </Tooltip.Portal>
  </Tooltip.Root>
}

function OverlayToggleButton({ kind, open, onToggle }: { kind: OverlayKind; open: boolean; onToggle: (kind: OverlayKind) => void }) {
  const { t } = useTranslation()
  const isTier = kind === 'tier'
  const label = isTier ? t('overlay.tier') : t('overlay.recommendation')
  const Icon = open ? PinOff : Pin
  return <button
    className={`overlay-toggle ${open ? 'active' : ''}`}
    type="button"
    aria-pressed={open}
    aria-label={`${open ? 'Close' : 'Open'} ${label}`}
    title={`${open ? 'Close' : 'Open'} ${label}`}
    data-testid={`overlay-toggle-${kind}`}
    onClick={() => onToggle(kind)}
  >
    <Icon size={15} aria-hidden="true" />
  </button>
}

function OverlayTierCard({ entry }: { entry: TierEntry }) {
  const isHero = isHeroAbility(entry.ability)
  return <span className="overlay-tier-card" title={`${entry.ability.name} · ${entry.tier} · ${(entry.winRate * 100).toFixed(1)}% WR`}>
    <SkillIcon abilityId={entry.ability.id} shortName={entry.ability.shortName} name={entry.ability.name} isHero={isHero} />
  </span>
}

function OverlayTierContent({ state, snapshot }: { state: OverlayState; snapshot: Snapshot }) {
  const entries = useMemo(() => filterTierEntries(buildAbilityTierList(snapshot, state.tierCategory), state.tierQuery), [snapshot, state.tierCategory, state.tierQuery])
  const entriesById = useMemo(() => new Map(entries.map((entry) => [entry.ability.id, entry])), [entries])
  const candidateIds = useMemo(() => [...new Set([
    ...state.candidatePools.heroIds,
    ...state.candidatePools.abilityIds,
    ...state.candidatePools.ultimateIds,
  ])], [state.candidatePools])
  const visibleEntries = useMemo(() => {
    const candidates = candidateIds.map((id) => entriesById.get(id)).filter((entry): entry is TierEntry => entry !== undefined)
    return candidates.length > 0 ? candidates : entries.slice(0, 36)
  }, [candidateIds, entries, entriesById])
  const groups = useMemo(() => {
    const grouped: Record<AbilityTier, TierEntry[]> = { S: [], A: [], B: [], C: [], D: [], E: [], F: [] }
    for (const entry of visibleEntries) grouped[entry.tier].push(entry)
    return grouped
  }, [visibleEntries])
  const sourceLabel = candidateIds.some((id) => entriesById.has(id)) ? '当前截图候选' : '全局 Top 36'

  return <>
    <div className="overlay-summary"><span>{sourceLabel}</span><strong>{visibleEntries.length} 项</strong><span>Patch {snapshot.patch}</span></div>
    <div className="overlay-tier-list">
      {TIER_ORDER.map((tier) => groups[tier].length > 0 && <section className={`overlay-tier-row overlay-tier-row-${tier.toLowerCase()}`} key={tier}>
        <span className="overlay-tier-label">{tier}</span>
        <div className="overlay-tier-items">{groups[tier].map((entry) => <OverlayTierCard key={entry.ability.id} entry={entry} />)}</div>
      </section>)}
    </div>
  </>
}

function OverlayRecommendationContent({ state, abilities }: { state: OverlayState; abilities: ReadonlyMap<number, Ability> }) {
  const firstRecommendation = state.recommendations[0]
  const nextPickId = firstRecommendation?.pickOrderIds.find((id) => !state.selectedIds.includes(id)) ?? firstRecommendation?.pickOrderIds[0]
  const nextPick = nextPickId === undefined ? undefined : abilities.get(nextPickId)

  return <>
    <div className="overlay-next-pick">
      <span>建议下一手</span>
      <strong>{nextPick?.name ?? '确认 1 / 3 / 1 候选后生成'}</strong>
      <small>{state.selectedIds.length}/5 locked · {state.recommendations.length} builds ranked</small>
    </div>
    {state.recommendations.slice(0, 3).map((recommendation, index) => <article className="overlay-build" key={recommendation.abilityIds.join('-')}>
      <header><span>方案 {index + 1}</span><strong>{recommendation.score.toFixed(1)}%</strong></header>
      <div className="overlay-build-picks">
        {recommendation.pickOrderIds.map((id, pickIndex) => {
          const item = abilities.get(id)
          return <span key={id} title={item?.name}>
            <small>{pickIndex + 1}</small>
            <SkillIcon compact abilityId={item?.id} shortName={item?.shortName} name={item?.name} isHero={item?.isHero} />
          </span>
        })}
      </div>
      <div className="overlay-build-stats"><span>Base WR <b>{(recommendation.abilityWinRate * 100).toFixed(1)}%</b></span><span>Synergy <b className={recommendation.synergy >= 0 ? 'positive' : 'negative'}>{formatPairPercent(recommendation.synergy, true)}</b></span><span>Avg Pick <b>{recommendation.averagePickPosition.toFixed(1)}</b></span></div>
    </article>)}
    {state.recommendations.length === 0 && <div className="overlay-empty"><Sparkles size={22} /><span>锁定至少 1 个英雄、3 个技能和 1 个终极</span></div>}
  </>
}

function FloatingOverlay({ kind, state, snapshot, abilities }: { kind: OverlayKind; state: OverlayState; snapshot: Snapshot; abilities: ReadonlyMap<number, Ability> }) {
  const { t } = useTranslation()
  const isTier = kind === 'tier'
  return <aside className={`floating-overlay floating-overlay-${kind}`} aria-label={isTier ? t('overlay.tier') : t('overlay.recommendation')}>
    <div className="floating-overlay-panel">
      <header className="floating-overlay-header">
        <div><p className="eyebrow"><PanelTop size={13} aria-hidden="true" /> PINNED {isTier ? 'TIERS' : 'RECOMMENDATION'}</p><h2>{isTier ? t('overlay.tier') : t('overlay.recommendation')}</h2></div>
        <span className="overlay-pass-through"><MousePointer2Off size={13} aria-hidden="true" />{t('overlay.passThrough')}</span>
      </header>
      {isTier ? <OverlayTierContent state={state} snapshot={snapshot} /> : <OverlayRecommendationContent state={state} abilities={abilities} />}
    </div>
  </aside>
}

function OverlayApp({ kind }: { kind: OverlayKind }) {
  const { i18n } = useTranslation()
  const [snapshot, setSnapshot] = useState<Snapshot>(demoSnapshot)
  const [state, setState] = useState<OverlayState>(() => readOverlayState(kind) ?? EMPTY_OVERLAY_STATE)

  useEffect(() => {
    document.documentElement.classList.add('overlay-document')
    return () => document.documentElement.classList.remove('overlay-document')
  }, [])

  useEffect(() => {
    fetch(appResourceUrl('/data/snapshots/latest.json'))
      .then((response) => response.ok ? response.json() as Promise<Snapshot> : Promise.reject(new Error('no local snapshot')))
      .then(setSnapshot)
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    const channel = createOverlayChannel()
    if (!channel) return
    channel.onmessage = (event: MessageEvent<OverlayMessage>) => {
      const message = event.data
      if (message?.type === 'overlay-state' && message.kind === kind) setState(message.state)
    }
    channel.postMessage({ type: 'overlay-ready', kind } satisfies OverlayMessage)
    return () => channel.close()
  }, [kind])

  useEffect(() => {
    void i18n.changeLanguage(state.locale)
  }, [i18n, state.locale])

  const abilitiesById = useMemo(() => new Map(snapshot.abilities.map((ability) => [ability.id, ability])), [snapshot])
  return <Tooltip.Provider delayDuration={250} skipDelayDuration={150}>
    <main className={`overlay-root overlay-root-${kind}`}>
      <FloatingOverlay kind={kind} state={state} snapshot={snapshot} abilities={abilitiesById} />
    </main>
  </Tooltip.Provider>
}

function EffectiveInteractionsPopover({ interactions, partialInteractions, abilities }: { interactions: RecommendationInteraction[]; partialInteractions: PartialRecommendationInteraction[]; abilities: Map<number, Ability> }) {
  if (interactions.length === 0 && partialInteractions.length === 0) return <div className="build-pairs-popover">当前构筑没有可信的互动。</div>

  return <div className="build-pairs-popover">
    {interactions.map((interaction) => {
      return <div className="build-effective-interaction" key={`${interaction.type}-${interaction.abilityIds.join('-')}`} title={`${interaction.type === 'pair' ? 'Pair' : 'Triple'} · 原始 lift ${formatPairPercent(interaction.rawSynergy, true)} · raw logit Δ ${formatLogitDelta(interaction.rawLogitSynergy)} · ${interaction.picks.toLocaleString()} 场`}>
        <span className="build-interaction-icons">{interaction.abilityIds.map((id, index) => {
          const ability = abilities.get(id)
          return <span className="build-interaction-icon" key={id}>{index > 0 && <span className="build-pair-plus">+</span>}<SkillIcon compact abilityId={ability?.id} shortName={ability?.shortName} name={ability?.name} isHero={ability?.isHero} /></span>
        })}</span>
        <strong className={interaction.synergy >= 0 ? 'positive' : 'negative'} title={`logit Δ ${formatLogitDelta(interaction.logitSynergy)}`}>{formatPairPercent(interaction.synergy, true)}</strong>
      </div>
    })}
    {partialInteractions.length > 0 && <div className="build-partial-interactions">
      <span className="build-partial-label">未计分 Triple</span>
      {partialInteractions.map((interaction) => {
        const missingPairs = interaction.missingPairIds.map(([leftId, rightId]) => `${abilities.get(leftId)?.shortName ?? leftId} + ${abilities.get(rightId)?.shortName ?? rightId}`).join(', ')
        return <div className="build-partial-interaction" key={`partial-${interaction.abilityIds.join('-')}`} title={`Triple · ${interaction.pairCoverage}/3 Pair · 缺失 ${missingPairs} · raw logit Δ ${formatLogitDelta(interaction.rawLogitSynergy)} · ${interaction.picks.toLocaleString()} 场`}>
          <span className="build-interaction-icons">{interaction.abilityIds.map((id, index) => {
            const ability = abilities.get(id)
            return <span className="build-interaction-icon" key={id}>{index > 0 && <span className="build-pair-plus">+</span>}<SkillIcon compact abilityId={ability?.id} shortName={ability?.shortName} name={ability?.name} isHero={ability?.isHero} /></span>
          })}</span>
          <strong>{interaction.pairCoverage}/3</strong>
        </div>
      })}
    </div>}
  </div>
}

function DebugCropPreview({ imageUrl, crop }: { imageUrl: string; crop: Rect }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const imageRef = useRef<HTMLImageElement | null>(null)
  const cropRef = useRef(crop)
  cropRef.current = crop

  useEffect(() => {
    const image = new Image()
    image.decoding = 'async'
    image.onload = () => {
      imageRef.current = image
      drawPreview()
    }
    image.src = imageUrl
    return () => {
      image.onload = null
      if (imageRef.current === image) imageRef.current = null
    }
  }, [imageUrl])

  useEffect(() => {
    const frame = requestAnimationFrame(() => drawPreview())
    return () => cancelAnimationFrame(frame)
  }, [crop.x, crop.y, crop.width, crop.height])

  function drawPreview() {
    const image = imageRef.current
    const canvas = canvasRef.current
    if (!image || !canvas || !image.naturalWidth || !image.naturalHeight) return

    const currentCrop = cropRef.current
    const left = Math.max(0, Math.floor(currentCrop.x - DEBUG_CONTEXT_PADDING))
    const top = Math.max(0, Math.floor(currentCrop.y - DEBUG_CONTEXT_PADDING))
    const right = Math.min(image.naturalWidth, Math.ceil(currentCrop.x + currentCrop.width + DEBUG_CONTEXT_PADDING))
    const bottom = Math.min(image.naturalHeight, Math.ceil(currentCrop.y + currentCrop.height + DEBUG_CONTEXT_PADDING))
    const sourceWidth = Math.max(1, right - left)
    const sourceHeight = Math.max(1, bottom - top)
    const scale = Math.min(DEBUG_PREVIEW_SIZE / sourceWidth, DEBUG_PREVIEW_SIZE / sourceHeight)
    const drawWidth = Math.max(1, Math.round(sourceWidth * scale))
    const drawHeight = Math.max(1, Math.round(sourceHeight * scale))
    const offsetX = Math.floor((DEBUG_PREVIEW_SIZE - drawWidth) / 2)
    const offsetY = Math.floor((DEBUG_PREVIEW_SIZE - drawHeight) / 2)
    canvas.width = DEBUG_PREVIEW_SIZE
    canvas.height = DEBUG_PREVIEW_SIZE
    const context = canvas.getContext('2d')
    if (!context) return
    context.imageSmoothingEnabled = false
    context.fillStyle = '#050706'
    context.clearRect(0, 0, canvas.width, canvas.height)
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(image, left, top, sourceWidth, sourceHeight, offsetX, offsetY, drawWidth, drawHeight)
    context.strokeStyle = '#ffefad'
    context.lineWidth = DEBUG_BORDER_WIDTH
    context.strokeRect(offsetX + (currentCrop.x - left) * scale + 0.5, offsetY + (currentCrop.y - top) * scale + 0.5, currentCrop.width * scale, currentCrop.height * scale)
  }

  return <canvas ref={canvasRef} className="raw-crop debug-preview" width={DEBUG_PREVIEW_SIZE} height={DEBUG_PREVIEW_SIZE} aria-label="裁剪框及外扩像素预览" />
}

function DraftStrategyBadge({ strategy }: { strategy: DraftStrategyId }) {
  const isTier = strategy === 'tier-first'
  return <span className={`draft-strategy-badge ${isTier ? 'tier' : 'pair'}`}>
    <span className="draft-strategy-mark" aria-hidden="true">{isTier ? 'T' : 'P'}</span>
    {isTier ? 'TIER FIRST' : 'PAIR FIRST'}
  </span>
}

function DraftPlayerRow({ player, strategy, state, side, currentGlobalPick, abilities }: { player: number; strategy: DraftStrategyId; state: DraftState; side: 'radiant' | 'dire'; currentGlobalPick?: number; abilities: Map<number, Ability> }) {
  const positions = positionsForPlayer(player)
  const picks = state.picksByPlayer[player] ?? []
  const categoryCounts = playerDraftCategoryCounts(state, player)
  const remainingLabels = [
    ...Array.from({ length: Math.max(0, DRAFT_PICK_QUOTAS.hero - categoryCounts.hero) }, () => 'H'),
    ...Array.from({ length: Math.max(0, DRAFT_PICK_QUOTAS.ability - categoryCounts.ability) }, () => 'S'),
    ...Array.from({ length: Math.max(0, DRAFT_PICK_QUOTAS.ultimate - categoryCounts.ultimate) }, () => 'U'),
  ]
  const isCurrentPlayer = positions.includes(currentGlobalPick ?? -1)
  const displayPlayer = side === 'dire' ? player - 5 : player
  const playerNumber = <span className={`draft-player-number ${side}`} aria-label={`Player ${player}`}>{displayPlayer}</span>
  const pickSlots = <div className="draft-player-content">
    <div className="draft-player-picks">
      {positions.map((globalPick, index) => {
        const abilityId = picks[index]
        const item = abilityId === undefined ? undefined : abilities.get(abilityId)
        const isCurrent = currentGlobalPick === globalPick
        const pendingLabel = remainingLabels[index - picks.length]
        const ariaLabel = item ? `Pick ${index + 1}, ${item.name}` : `Pick ${index + 1}, ${pendingLabel ?? 'empty'}`
        return <div className={`draft-pick-cell ${item ? 'picked' : 'pending'} ${isCurrent ? 'current' : ''}`} key={globalPick} title={item?.name} aria-label={ariaLabel}>
          {item ? <>
            <SkillIcon compact abilityId={item.id} shortName={item.shortName} name={item.name} isHero={item.isHero} />
            <span className="draft-pick-position">{globalPick}</span>
          </> : <span className="draft-pick-placeholder">{pendingLabel ?? '—'}</span>}
        </div>
      })}
    </div>
  </div>
  return <article className={`draft-player-row ${side} ${isCurrentPlayer ? 'current' : ''} ${strategy === 'tier-first' ? 'tier-player' : 'pair-player'}`}>
    {playerNumber}{pickSlots}
  </article>
}

function DraftPoolSection({ category, label, ids, remainingIds, abilities }: { category: SlotCategory; label: string; ids: readonly number[]; remainingIds: readonly number[]; abilities: Map<number, Ability> }) {
  const remaining = new Set(remainingIds)
  return <section className={`draft-pool-section ${category}`}>
    <header><span>{label}</span><strong className="draft-pool-count" aria-label={`${remaining.size} of ${ids.length} available`}>{remaining.size}/{ids.length}</strong></header>
    <div className={`draft-pool-grid ${category === 'ability' ? 'wide' : 'narrow'}`}>
      {ids.map((id) => {
        const item = abilities.get(id)
        if (!item) return null
        const available = remaining.has(id)
        return <span className={`draft-pool-item ${available ? '' : 'picked'}`} key={id} title={`${item.name}${available ? '' : ' · picked'}`} aria-label={`${item.name}${available ? '' : ' · picked'}`}>
          <SkillIcon compact abilityId={item.id} shortName={item.shortName} name={item.name} isHero={item.isHero} />
        </span>
      })}
    </div>
  </section>
}

function DraftTopCandidates({ candidates, turn, strategy, abilities }: { candidates: RankedDraftCandidate[]; turn: DraftReplayFrame['turn']; strategy: DraftStrategyId; abilities: Map<number, Ability> }) {
  return <section className="draft-top-candidates" aria-labelledby="draft-top-candidates-title">
    <header className="draft-top-candidates-header">
      <div><span id="draft-top-candidates-title">TOP 20 PICK OPTIONS</span><small>POS {turn.globalPick} · P{turn.player} PICK {turn.playerPick}</small></div>
      <DraftStrategyBadge strategy={strategy} />
    </header>
    <div className="draft-top-candidates-grid">
      {candidates.map((candidate) => {
        const item = abilities.get(candidate.abilityId)
        if (!item) return null
        const pairScore = candidate.pairProfile.topValues[0]
        return <article className="draft-top-candidate" key={candidate.abilityId} title={item.name}>
          <span className="draft-top-candidate-rank">{String(candidate.rank).padStart(2, '0')}</span>
          <SkillIcon compact abilityId={item.id} shortName={item.shortName} name={item.name} isHero={item.isHero} />
          <div className="draft-top-candidate-name"><strong>{item.shortName}</strong><small>{candidate.tier ?? '—'} · {(candidate.individualWinRate * 100).toFixed(1)}% WR</small></div>
          <div className="draft-top-candidate-stats"><strong>{pairScore === undefined ? '—' : `${(pairScore * 100).toFixed(1)}%`}</strong><small>{candidate.avgPickPosition === undefined ? 'Avg —' : `Avg ${candidate.avgPickPosition.toFixed(1)}`}</small></div>
        </article>
      })}
    </div>
  </section>
}

function DraftFinalScoreTable({ scores, strategyByPlayer, abilities }: { scores: Array<{ player: number; recommendation?: Recommendation }>; strategyByPlayer: Record<number, DraftStrategyId>; abilities: Map<number, Ability> }) {
  return <section className="draft-final-scores" aria-labelledby="draft-final-score-title">
    <div className="draft-final-scores-header">
      <div><p className="eyebrow">FINAL BUILD SCORE</p><h3 id="draft-final-score-title">Complete 1 / 3 / 1 builds</h3><p>Same Score, Base WR, Synergy and Avg Pick metrics as page one.</p></div>
      <span className="draft-final-score-status">{scores.filter((entry) => entry.recommendation).length} / 10 scored</span>
    </div>
    <div className="draft-score-scroll">
      <div className="draft-score-table">
        <div className="draft-score-table-header"><span>PLAYER</span><span>BUILD</span><span>SCORE</span><span>BASE WR</span><span>SYNERGY</span><span>AVG PICK #</span></div>
        {scores.map(({ player, recommendation }) => recommendation ? <article className="draft-score-row" key={player}>
          <div className="draft-score-player"><strong>P{player}</strong><DraftStrategyBadge strategy={strategyByPlayer[player]} /></div>
          <div className="draft-score-build">{recommendation.pickOrderIds.map((id, index) => {
            const item = abilities.get(id)
            return <span key={id} title={`${index + 1}. ${item?.name ?? id}`}><small>{index + 1}</small><SkillIcon compact abilityId={item?.id} shortName={item?.shortName} name={item?.name} isHero={item?.isHero} /></span>
          })}</div>
          <strong className="draft-score-value">{recommendation.score.toFixed(1)}%</strong>
          <span className="draft-score-stat">{(recommendation.abilityWinRate * 100).toFixed(1)}%</span>
          <div className="build-pairs-stat draft-score-synergy" tabIndex={0} aria-label={`Synergy ${formatPairPercent(recommendation.synergy, true)}, logit delta ${formatLogitDelta(recommendation.logitSynergy)}`}>
            <strong className={recommendation.synergy >= 0 ? 'positive' : 'negative'}>{formatPairPercent(recommendation.synergy, true)}</strong>
            <small>Δ {formatLogitDelta(recommendation.logitSynergy)} · {recommendation.effectiveInteractionCount} groups</small>
            <EffectiveInteractionsPopover interactions={recommendation.effectiveInteractions} partialInteractions={recommendation.partialInteractions} abilities={abilities} />
          </div>
          <span className="draft-score-stat">{recommendation.averagePickPosition.toFixed(1)}</span>
        </article> : <article className="draft-score-row draft-score-incomplete" key={player}><div className="draft-score-player"><strong>P{player}</strong><DraftStrategyBadge strategy={strategyByPlayer[player]} /></div><span>Incomplete build</span></article>)}
      </div>
    </div>
  </section>
}

function DraftTeamPanel({ side, state, simulation, currentGlobalPick, abilities }: {
  side: 'radiant' | 'dire'
  state: DraftState
  simulation: DraftSimulationResult
  currentGlobalPick?: number
  abilities: Map<number, Ability>
}) {
  const firstPlayer = side === 'radiant' ? 1 : 6
  return <section className={`draft-players-panel ${side}-panel`} aria-label={`${side === 'radiant' ? 'Radiant' : 'Dire'} draft board`}>
    <h3 className={`draft-panel-title ${side}-title`}>{side === 'radiant' ? 'Radiant' : 'Dire'} <span>5 players</span></h3>
    {Array.from({ length: 5 }, (_, index) => firstPlayer + index).map((player) => <DraftPlayerRow key={player} player={player} side={side} strategy={simulation.strategyByPlayer[player]} state={state} currentGlobalPick={currentGlobalPick} abilities={abilities} />)}
  </section>
}

function DraftReplayPage({ simulation, snapshot, abilities, pool, poolSource, poolError, finalScores, activeStrategy, onStrategyChange, replayStep, isPlaying, onStepChange, onTogglePlaying }: {
  simulation?: DraftSimulationResult
  snapshot: Snapshot
  abilities: Map<number, Ability>
  pool?: InitialDraftPool
  poolSource: string
  poolError?: string
  finalScores: Array<{ player: number; recommendation?: Recommendation }>
  activeStrategy: DraftStrategyId
  onStrategyChange: (strategy: DraftStrategyId) => void
  replayStep: number
  isPlaying: boolean
  onStepChange: (step: number) => void
  onTogglePlaying: () => void
}) {
  if (!simulation || !pool) {
    return <section className="draft-page" aria-labelledby="draft-page-title">
      <div className="draft-page-header">
        <div><p className="eyebrow">05 / DRAFT REPLAY</p><h2 id="draft-page-title">Draft Replay</h2></div>
        <div className="draft-page-mark"><Play size={21} aria-hidden="true" /><span>10 PLAYERS / 50 PICKS</span></div>
      </div>
      <div className="draft-empty">
        <CircleAlert size={25} />
        <h3>Draft pool unavailable</h3>
        <p>{poolError ?? `The current snapshot does not provide a complete ${DRAFT_POOL_SIZES.hero}/${DRAFT_POOL_SIZES.ability}/${DRAFT_POOL_SIZES.ultimate} candidate pool.`}</p>
      </div>
    </section>
  }

  const frame: DraftReplayFrame = simulation.frames[Math.min(replayStep, simulation.frames.length - 1)] ?? simulation.frames[0]
  const state = frame.state
  const currentStep = frame.step
  const currentEvent = frame.event
  const currentAbility = currentEvent?.abilityId === undefined ? undefined : abilities.get(currentEvent.abilityId)
  const counts = remainingPoolCounts(state)
  const totalPool = pool.heroIds.length + pool.abilityIds.length + pool.ultimateIds.length
  const maxStep = simulation.frames.at(-1)?.step ?? 0
  const nextTurn = currentStep < maxStep && currentStep < 50 ? turnAt(currentStep + 1) : undefined
  const currentPairProfile = currentEvent?.pairProfile
  const currentStrategy = simulation.strategyByPlayer[frame.turn.player] ?? 'tier-first'

  return <section className="draft-page" aria-labelledby="draft-page-title">
    <div className="draft-page-header">
      <div>
        <p className="eyebrow">05 / DRAFT REPLAY</p>
        <h2 id="draft-page-title">Draft Replay</h2>
        <p className="draft-page-subtitle">Patch {snapshot.patch} · {poolSource} · final loadout 1 Hero / 3 Skill / 1 Ultimate</p>
      </div>
      <div className="draft-page-mark"><Users size={21} aria-hidden="true" /><span>10 PLAYERS / 50 PICKS</span></div>
    </div>

    <DraftFinalScoreTable scores={finalScores} strategyByPlayer={simulation.strategyByPlayer} abilities={abilities} />

    <div className="draft-strategy-strip">
      <div className="draft-strategy-group tier-group">
        <span className="draft-strategy-group-label">ALL PLAYERS</span>
        <div>{Array.from({ length: 10 }, (_, index) => <span className="draft-player-chip" key={index + 1}>P{index + 1}</span>)}</div>
      </div>
      <div className="draft-strategy-switch" role="tablist" aria-label="Draft pick strategy">
        {(['tier-first', 'pair-first'] as const).map((strategy) => <button type="button" role="tab" aria-selected={activeStrategy === strategy} data-testid={`draft-strategy-${strategy}`} className={activeStrategy === strategy ? 'active' : ''} key={strategy} onClick={() => onStrategyChange(strategy)}>
          {strategy === 'tier-first' ? 'Tier first' : 'Pair first'}
        </button>)}
      </div>
      <div className="draft-simulation-status"><span className="status-dot" /> all 10 players · {simulation.unresolved ? 'incomplete' : 'complete'}</div>
    </div>

    <div className="draft-replay-layout">
      <DraftTeamPanel side="radiant" state={state} simulation={simulation} currentGlobalPick={nextTurn?.globalPick} abilities={abilities} />

      <section className="draft-center-panel" aria-label="Ability pool">
        <header className="draft-center-header">
          <div><p className="eyebrow">ABILITY POOL</p><strong>{counts.total}<small> / {totalPool} available</small></strong></div>
          <div className="draft-center-turn">
            <span>{nextTurn ? `P${nextTurn.player} · PICK ${nextTurn.playerPick}` : 'DRAFT COMPLETE'}</span>
            <small>{currentAbility ? `Last: ${currentAbility.name}` : 'Ready to draft'}</small>
          </div>
        </header>
        {currentEvent && <div className="draft-decision-readout" title={currentEvent.rationale}>
          <div><strong>{currentEvent.policy === 'pair-first' ? 'PAIR-FIRST DECISION' : 'TIER-FIRST DECISION'}</strong><span>{currentEvent.rationale}</span></div>
          {currentEvent.pairScore !== undefined && <span className="draft-decision-score">Pair WR {(currentEvent.pairScore * 100).toFixed(1)}%</span>}
          {currentPairProfile && <small>Top options {currentPairProfile.topValues.map((value) => `${(value * 100).toFixed(1)}%`).join(' · ')} · {currentPairProfile.optionCount} connected</small>}
        </div>}
        <DraftTopCandidates candidates={frame.candidates} turn={frame.turn} strategy={currentStrategy} abilities={abilities} />
        <div className="draft-pool-sections">
          <DraftPoolSection category="ultimate" label="ULTIMATES" ids={pool.ultimateIds} remainingIds={state.remainingByCategory.ultimateIds} abilities={abilities} />
          <DraftPoolSection category="ability" label="ABILITIES" ids={pool.abilityIds} remainingIds={state.remainingByCategory.abilityIds} abilities={abilities} />
          <DraftPoolSection category="hero" label="HEROES" ids={pool.heroIds} remainingIds={state.remainingByCategory.heroIds} abilities={abilities} />
        </div>
        <section className="draft-replay-controls" aria-label="Draft replay controls">
          <div className="draft-control-buttons">
            <button type="button" className="draft-control-button" title="Restart replay" aria-label="Restart replay" onClick={() => onStepChange(0)}><SkipBack size={16} /></button>
            <button type="button" className="draft-control-button draft-play-button" onClick={onTogglePlaying} aria-label={isPlaying ? 'Pause replay' : 'Play replay'}>{isPlaying ? <Pause size={16} /> : <Play size={16} />}<span>{isPlaying ? 'Pause' : 'Play'}</span></button>
            <button type="button" className="draft-control-button" title="Next pick" aria-label="Next pick" onClick={() => onStepChange(Math.min(maxStep, currentStep + 1))}><SkipForward size={16} /></button>
          </div>
          <div className="draft-scrubber">
            <div className="draft-scrubber-label"><strong>Pick {String(currentStep).padStart(2, '0')}</strong><span>{currentStep === 0 ? 'Lobby' : `Round ${currentEvent?.turn.round ?? frame.state.history.at(-1)?.turn.round ?? 1}`}</span><span>{currentStep} / {maxStep}</span></div>
            <input type="range" min="0" max={maxStep} step="1" value={currentStep} aria-label="Draft replay position" onChange={(event) => onStepChange(Number(event.target.value))} />
            <div className="draft-round-markers" aria-hidden="true">{[1, 2, 3, 4, 5].map((round) => <span key={round}>R{round}</span>)}</div>
          </div>
          <div className="draft-live-readout"><Timer size={15} /><span>{nextTurn ? `P${nextTurn.player} choosing` : 'Complete'}</span></div>
        </section>
      </section>

      <DraftTeamPanel side="dire" state={state} simulation={simulation} currentGlobalPick={nextTurn?.globalPick} abilities={abilities} />
    </div>
  </section>
}

function MainApp() {
  const { i18n, t } = useTranslation()
  const locale = toAppLocale(i18n.resolvedLanguage ?? i18n.language)
  const storage = useMemo(getBrowserStorage, [])
  const fileAdapter = useMemo(getBrowserFileAdapter, [])
  const runtimeCapabilities = useMemo(detectRuntimeCapabilities, [])
  const inputRef = useRef<HTMLInputElement>(null)
  const [screenshotUrl, setScreenshotUrl] = useState<string>()
  const [slots, setSlots] = useState<RecognizedSlot[]>([])
  const [error, setError] = useState<string>()
  const [loading, setLoading] = useState(false)
  const [selectedIds, setSelectedIds] = useState<number[]>([])
  const [snapshot, setSnapshot] = useState<Snapshot>(demoSnapshot)
  const [iconSignatures, setIconSignatures] = useState<IconSignature[]>([])
  const [tierCategory, setTierCategory] = useState<TierCategory>('all')
  const [tierQuery, setTierQuery] = useState('')
  const [pairQuery, setPairQuery] = useState('')
  const [excludeSameHero, setExcludeSameHero] = useState(false)
  const [pairSort, setPairSort] = useState<{ key: PairSortKey; direction: SortDirection }>({ key: 'synergy', direction: 'desc' })
  const [activePage, setActivePage] = useState<AppPage>('analysis')
  const [overlayVisibility, setOverlayVisibility] = useState<Record<OverlayKind, boolean>>({ recommendation: false, tier: false })
  const [draftStrategy, setDraftStrategy] = useState<DraftStrategyId>('tier-first')
  const [replayStep, setReplayStep] = useState(0)
  const [replayPlaying, setReplayPlaying] = useState(false)
  const [debugSlotIndex, setDebugSlotIndex] = useState<number>()
  const [manualSlotIndex, setManualSlotIndex] = useState<number>()
  const [uploadedFile, setUploadedFile] = useState<File>()
  const [imageSize, setImageSize] = useState<ImageSize>(DEFAULT_IMAGE_SIZE)
  const [calibrationOpen, setCalibrationOpen] = useState(false)
  const recognitionWorkerRef = useRef<Worker | undefined>(undefined)
  const recognitionRequestRef = useRef(0)
  const screenshotUrlRef = useRef<string | undefined>(undefined)
  const [layoutOverrides, setLayoutOverrides] = useState<Record<number, Rect>>(() => readStoredJson(storage, 'omg-layout-overrides-v1', {} as Record<number, Rect>))
  const layoutOverridesRef = useRef(layoutOverrides)
  const [dragState, setDragState] = useState<{ index: number; mode: 'move' | 'resize'; startX: number; startY: number; startRect: Rect }>()
  const overlayRef = useRef<SVGSVGElement>(null)
  const layoutFileRef = useRef<HTMLInputElement>(null)
  const pairTableRef = useRef<HTMLDivElement>(null)
  const [importedLayout, setImportedLayout] = useState<LayoutDocument | undefined>(() => {
    const saved = readStoredJson<unknown>(storage, 'omg-layout-file-v1', null)
    return parseLayoutDocument(saved) ?? undefined
  })

  useEffect(() => {
    fetch(appResourceUrl('/data/snapshots/latest.json'))
      .then((response) => response.ok ? response.json() as Promise<Snapshot> : Promise.reject(new Error('no local snapshot')))
      .then(setSnapshot)
      .catch(() => setError('本地 Windrun 快照加载失败，当前使用演示数据。'))
  }, [])

  useEffect(() => {
    fetch(appResourceUrl('/data/icon-signatures.json'))
      .then((response) => response.ok ? response.json() as Promise<{ signatures?: IconSignature[] }> : Promise.reject(new Error('no signatures')))
      .then((payload) => setIconSignatures(payload.signatures ?? []))
      .catch(() => setError('图标模板数据库加载失败，识别将使用颜色回退。'))
  }, [])

  useEffect(() => () => {
    recognitionRequestRef.current += 1
    recognitionWorkerRef.current?.terminate()
    if (screenshotUrlRef.current) URL.revokeObjectURL(screenshotUrlRef.current)
  }, [])

  const abilitiesById = useMemo(() => new Map(snapshot.abilities.map((ability) => [ability.id, ability])), [snapshot])
  const ability = useCallback((id: number) => abilitiesById.get(id), [abilitiesById])
  const deferredSlots = useDeferredValue(slots)
  const deferredSelectedIds = useDeferredValue(selectedIds)
  const candidateTierInfo = useMemo(() => {
    const tiers = new Map<number, { rank: number; tier: AbilityTier }>()
    for (const category of ['hero', 'ability', 'ultimate'] as const) {
      for (const entry of buildAbilityTierList(snapshot, category)) {
        tiers.set(entry.ability.id, { rank: entry.rank, tier: entry.tier })
      }
    }
    return tiers
  }, [snapshot])
  const candidatePools = useMemo<BuildCandidatePools>(() => {
    const pools = { heroIds: [] as number[], abilityIds: [] as number[], ultimateIds: [] as number[] }
    for (const slot of slots) {
      if (slot.selectedAbilityId === undefined) continue
      if (slot.category === 'hero') pools.heroIds.push(slot.selectedAbilityId)
      else if (slot.category === 'ability') pools.abilityIds.push(slot.selectedAbilityId)
      else pools.ultimateIds.push(slot.selectedAbilityId)
    }
    const sortByTier = (ids: number[]) => [...new Set(ids)].sort((left, right) => {
      const rankDifference = (candidateTierInfo.get(left)?.rank ?? Number.POSITIVE_INFINITY) - (candidateTierInfo.get(right)?.rank ?? Number.POSITIVE_INFINITY)
      if (rankDifference !== 0) return rankDifference
      return (abilitiesById.get(left)?.name ?? '').localeCompare(abilitiesById.get(right)?.name ?? '')
    })
    return {
      heroIds: sortByTier(pools.heroIds),
      abilityIds: sortByTier(pools.abilityIds),
      ultimateIds: sortByTier(pools.ultimateIds),
    }
  }, [abilitiesById, candidateTierInfo, slots])
  const deferredCandidatePools = useDeferredValue(candidatePools)
  const candidateIds = useMemo(
    () => [...new Set([...candidatePools.heroIds, ...candidatePools.abilityIds, ...candidatePools.ultimateIds])],
    [candidatePools],
  )
  useEffect(() => {
    setSelectedIds((current) => {
      const selectedCounts: Record<keyof BuildCandidatePools, number> = { heroIds: 0, abilityIds: 0, ultimateIds: 0 }
      const next = current.filter((id) => {
        const group = BUILD_PICK_GROUPS.find((item) => candidatePools[item.key].includes(id))
        if (!group || selectedCounts[group.key] >= group.limit) return false
        selectedCounts[group.key] += 1
        return true
      })
      return next.length === current.length ? current : next
    })
  }, [candidatePools])
  const layout = useMemo(
    () => buildScaledLayout(importedLayout ?? DEFAULT_LAYOUT_DOCUMENT, layoutOverrides, imageSize),
    [importedLayout, layoutOverrides, imageSize],
  )
  const recommendations = useMemo(
    () => recommendBuilds(deferredCandidatePools, deferredSelectedIds, snapshot),
    [deferredCandidatePools, deferredSelectedIds, snapshot],
  )
  const overlayState = useMemo<OverlayState>(() => ({
    candidatePools,
    locale,
    recommendations,
    selectedIds,
    tierCategory,
    tierQuery,
  }), [candidatePools, locale, recommendations, selectedIds, tierCategory, tierQuery])

  useEffect(() => {
    const channel = createOverlayChannel()
    if (!channel) return
    const publish = (kind: OverlayKind) => {
      if (!overlayVisibility[kind]) return
      writeOverlayState(kind, overlayState)
      channel.postMessage({ type: 'overlay-state', kind, state: overlayState } satisfies OverlayMessage)
    }
    channel.onmessage = (event: MessageEvent<OverlayMessage>) => {
      const message = event.data
      if (message?.type === 'overlay-ready') publish(message.kind)
    }
    publish('recommendation')
    publish('tier')
    return () => channel.close()
  }, [overlayState, overlayVisibility])
  const rankedDraftPoolInfo = useMemo(() => {
    const pool = buildRankedDraftPool(snapshot)
    const errors = validateInitialDraftPool(pool, snapshot.abilities)
    return { pool: errors.length === 0 ? pool : undefined, source: 'ranked snapshot pool', errors }
  }, [snapshot])
  const draftPoolInfo = useMemo(() => {
    if (activePage !== 'draft') return rankedDraftPoolInfo
    const confirmedPool: InitialDraftPool = {
      heroIds: deferredSlots.filter((slot) => slot.category === 'hero' && slot.selectedAbilityId !== undefined).map((slot) => slot.selectedAbilityId!),
      abilityIds: deferredSlots.filter((slot) => slot.category === 'ability' && slot.selectedAbilityId !== undefined).map((slot) => slot.selectedAbilityId!),
      ultimateIds: deferredSlots.filter((slot) => slot.category === 'ultimate' && slot.selectedAbilityId !== undefined).map((slot) => slot.selectedAbilityId!),
    }
    const confirmedErrors = validateInitialDraftPool(confirmedPool, snapshot.abilities)
    const errors = deferredSlots.length !== 60
      ? [`Confirm all 60 screenshot slots before replay (${deferredSlots.length}/60 ready).`]
      : !deferredSlots.every((slot) => slot.selectedAbilityId !== undefined)
        ? ['Confirm every screenshot candidate before replay.']
        : confirmedErrors
    if (errors.length === 0) {
      return { pool: confirmedPool, source: 'confirmed screenshot pool', errors: [] as string[] }
    }
    return { pool: undefined, source: 'confirmed screenshot pool', errors }
  }, [activePage, deferredSlots, rankedDraftPoolInfo, snapshot.abilities])
  const draftSimulation = useMemo(() => {
    if (activePage !== 'draft' || !draftPoolInfo.pool) return undefined
    try {
      return simulateDraft(draftPoolInfo.pool, snapshot, createDraftStrategyMap(draftStrategy))
    } catch {
      return undefined
    }
  }, [activePage, draftPoolInfo.pool, draftStrategy, snapshot])
  const draftFinalScores = useMemo(() => {
    if (!draftSimulation) return [] as Array<{ player: number; recommendation?: Recommendation }>
    return Array.from({ length: 10 }, (_, index) => {
      const player = index + 1
      return {
        player,
        recommendation: scoreDraftBuild(draftSimulation.finalState.picksByPlayer[player], snapshot),
      }
    })
  }, [draftSimulation, snapshot])
  const tierEntries = useMemo(() => activePage === 'database' ? buildAbilityTierList(snapshot, tierCategory) : [], [activePage, snapshot, tierCategory])
  const tierCategoryCounts = useMemo<Record<TierCategory, number>>(() => {
    return activePage === 'database' ? getTierCategoryCounts(snapshot) : { all: 0, ultimate: 0, hero: 0, ability: 0 }
  }, [activePage, snapshot])
  const filteredTierEntries = useMemo(() => {
    return filterTierEntries(tierEntries, tierQuery)
  }, [tierEntries, tierQuery])
  const tierGroups = useMemo(() => {
    const groups: Record<AbilityTier, TierEntry[]> = { S: [], A: [], B: [], C: [], D: [], E: [], F: [] }
    for (const entry of filteredTierEntries) groups[entry.tier].push(entry)
    return groups
  }, [filteredTierEntries])
  const pairEntries = useMemo(
    () => activePage === 'pairs' ? buildAbilityPairList(snapshot, { excludeSameHero }) : [],
    [activePage, excludeSameHero, snapshot],
  )
  const filteredPairEntries = useMemo(() => {
    const query = pairQuery.trim().toLowerCase()
    const matchingEntries = query
      ? pairEntries.filter((entry) => `${entry.abilityOne.name} ${entry.abilityOne.shortName} ${entry.abilityTwo.name} ${entry.abilityTwo.shortName}`.toLowerCase().includes(query))
      : pairEntries
    return [...matchingEntries].sort((left, right) => {
      const result = comparePairEntries(left, right, pairSort.key)
      if (result !== 0) return pairSort.direction === 'asc' ? result : -result
      return left.key.localeCompare(right.key)
    })
  }, [pairEntries, pairQuery, pairSort])
  const pairVirtualizer = useVirtualizer({
    count: filteredPairEntries.length,
    getScrollElement: () => pairTableRef.current,
    estimateSize: () => PAIR_ROW_HEIGHT,
    overscan: 8,
  })
  const virtualPairRows = pairVirtualizer.getVirtualItems()
  const pairTopSpacer = virtualPairRows[0]?.start ?? 0
  const pairBottomSpacer = virtualPairRows.length === 0
    ? 0
    : Math.max(0, pairVirtualizer.getTotalSize() - (virtualPairRows[virtualPairRows.length - 1]?.end ?? 0))

  useEffect(() => {
    pairVirtualizer.scrollToOffset(0)
  }, [excludeSameHero, pairQuery, pairSort])

  useEffect(() => {
    setReplayStep(0)
    setReplayPlaying(false)
  }, [draftSimulation?.treeId])

  useEffect(() => {
    if (!replayPlaying || !draftSimulation) return
    const maxStep = draftSimulation.frames.at(-1)?.step ?? 0
    const timer = window.setInterval(() => {
      setReplayStep((current) => {
        if (current >= maxStep) {
          setReplayPlaying(false)
          return current
        }
        return current + 1
      })
    }, 720)
    return () => window.clearInterval(timer)
  }, [draftSimulation, replayPlaying])

  async function handleUpload(file: File) {
    if (!isSupportedScreenshotFile(file)) {
      setError('仅支持 PNG、JPG 或 JPEG 格式的截图。')
      return
    }
    const requestId = recognitionRequestRef.current + 1
    recognitionRequestRef.current = requestId
    recognitionWorkerRef.current?.terminate()
    recognitionWorkerRef.current = undefined
    setUploadedFile(file)
    setError(undefined)
    setSlots([])
    setSelectedIds([])
    setManualSlotIndex(undefined)
    setCalibrationOpen(true)
    setLoading(true)
    const missingCapabilities = missingRuntimeCapabilities(runtimeCapabilities)
    if (missingCapabilities.length > 0) {
      setError(`当前运行环境不支持图片识别所需能力：${missingCapabilities.join('、')}`)
      setLoading(false)
      return
    }
    let bitmap: ImageBitmap | undefined
    let worker: Worker | undefined
    let timeoutId: number | undefined
    try {
      const decoded = await createImageBitmap(file)
      bitmap = decoded
      if (requestId !== recognitionRequestRef.current) {
        decoded.close()
        bitmap = undefined
        return
      }
      const dimensionError = validateScreenshotDimensions(decoded.width, decoded.height)
      if (dimensionError) {
        decoded.close()
        bitmap = undefined
        setError(dimensionError)
        setLoading(false)
        return
      }
      const nextImageSize = { width: decoded.width, height: decoded.height }
      const nextLayout = buildScaledLayout(importedLayout ?? DEFAULT_LAYOUT_DOCUMENT, layoutOverrides, nextImageSize)
      setImageSize(nextImageSize)
      if (screenshotUrlRef.current) URL.revokeObjectURL(screenshotUrlRef.current)
      const nextScreenshotUrl = URL.createObjectURL(file)
      screenshotUrlRef.current = nextScreenshotUrl
      setScreenshotUrl(nextScreenshotUrl)
      worker = new Worker(new URL('./workers/recognizer.worker.ts', import.meta.url), { type: 'module' })
      recognitionWorkerRef.current = worker
      const finishWorker = () => {
        if (timeoutId !== undefined) window.clearTimeout(timeoutId)
        if (recognitionWorkerRef.current === worker) recognitionWorkerRef.current = undefined
        worker?.terminate()
      }
      worker.onmessage = (event: MessageEvent<{ slots: RecognizedSlot[] }>) => {
        if (requestId !== recognitionRequestRef.current) {
          finishWorker()
          return
        }
        setSlots(event.data.slots)
        setDebugSlotIndex(0)
        setLoading(false)
        finishWorker()
      }
      worker.onerror = () => {
        if (requestId !== recognitionRequestRef.current) {
          finishWorker()
          return
        }
        setError('图标分析失败，请重新上传。')
        setLoading(false)
        finishWorker()
      }
      worker.postMessage({ image: decoded, abilities: snapshot.abilities, layout: nextLayout, signatures: iconSignatures }, [decoded])
      bitmap = undefined
      timeoutId = window.setTimeout(() => {
        if (requestId !== recognitionRequestRef.current) return
        setError('图标分析超时，请检查截图布局后重试。')
        setLoading(false)
        finishWorker()
      }, RECOGNITION_TIMEOUT_MS)
    } catch {
      bitmap?.close()
      if (timeoutId !== undefined) window.clearTimeout(timeoutId)
      if (recognitionWorkerRef.current === worker) recognitionWorkerRef.current = undefined
      worker?.terminate()
      if (requestId !== recognitionRequestRef.current) return
      setError('无法读取或分析此图片，请确认文件有效后重试。')
      setLoading(false)
    }
  }

  function resetLayout() {
    storage.removeItem('omg-layout-profile-v1')
    storage.removeItem('omg-layout-overrides-v1')
    storage.removeItem('omg-layout-file-v1')
    setLayoutOverrides({})
    layoutOverridesRef.current = {}
    setImportedLayout(undefined)
    toast.success('已恢复默认布局')
  }

  function saveLayout() {
    const payload: LayoutDocument = { version: 1, width: imageSize.width, height: imageSize.height, slots: layout }
    fileAdapter.downloadText(`omg-layout-${imageSize.width}x${imageSize.height}.json`, JSON.stringify(payload, null, 2), 'application/json')
    toast.success('布局 JSON 已开始导出')
  }

  async function loadLayout(file: File) {
    try {
      const parsed = parseLayoutDocument(JSON.parse(await fileAdapter.readText(file)))
      if (!parsed) throw new Error('invalid layout')
      setImportedLayout(parsed)
      setLayoutOverrides({})
      layoutOverridesRef.current = {}
      writeStoredJson(storage, 'omg-layout-file-v1', parsed)
      storage.removeItem('omg-layout-overrides-v1')
      setError(undefined)
      toast.success('布局文件已载入')
    } catch {
      setError('布局文件无效：需要正数尺寸、60 格且包含 hero / ability / ultimate 类别。')
      toast.error('布局文件无效')
    }
  }

  function imagePoint(event: ReactPointerEvent<SVGSVGElement | SVGRectElement | SVGCircleElement>) {
    const bounds = overlayRef.current?.getBoundingClientRect()
    if (!bounds) return { x: 0, y: 0 }
    return { x: ((event.clientX - bounds.left) / bounds.width) * imageSize.width, y: ((event.clientY - bounds.top) / bounds.height) * imageSize.height }
  }

  function startDrag(event: ReactPointerEvent<SVGRectElement | SVGCircleElement>, index: number, mode: 'move' | 'resize') {
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    const point = imagePoint(event)
    setDragState({ index, mode, startX: point.x, startY: point.y, startRect: layout[index].rect })
    setDebugSlotIndex(index)
  }

  function dragLayout(event: ReactPointerEvent<SVGSVGElement>) {
    if (!dragState) return
    const point = imagePoint(event)
    const deltaX = point.x - dragState.startX
    const deltaY = point.y - dragState.startY
    const start = dragState.startRect
    const rect: Rect = dragState.mode === 'move'
      ? { ...start, x: Math.round(start.x + deltaX), y: Math.round(start.y + deltaY) }
      : (() => {
          const startCrop = cropCenter(start)
          const cropWidth = Math.max(24, Math.round(startCrop.width + deltaX))
          const cropHeight = Math.max(24, Math.round(startCrop.height + deltaY))
          const width = Math.max(32, Math.round(cropWidth / MATCH_CROP_RATIO))
          const height = Math.max(32, Math.round(cropHeight / MATCH_CROP_RATIO))
          return {
            x: Math.round(startCrop.x - width * (1 - MATCH_CROP_RATIO) / 2),
            y: Math.round(startCrop.y - height * (1 - MATCH_CROP_RATIO) / 2),
            width,
            height,
          }
        })()
    const currentRect = clampRectToCanvas(rect, imageSize.width, imageSize.height)
    const sourceLayout = importedLayout ?? DEFAULT_LAYOUT_DOCUMENT
    const next = {
      ...layoutOverridesRef.current,
      [dragState.index]: scaleRect(currentRect, imageSize.width, imageSize.height, sourceLayout.width, sourceLayout.height),
    }
    layoutOverridesRef.current = next
    setLayoutOverrides(next)
  }

  function finishDrag() {
    writeStoredJson(storage, 'omg-layout-overrides-v1', layoutOverridesRef.current)
    setDragState(undefined)
  }

  function updateSlot(index: number, value: string) {
    const normalized = value.trim()
    const selectedAbilityId = /^-?\d+$/.test(normalized)
      ? Number(normalized)
      : [...abilitiesById.values()].find((item) => item.name.toLowerCase() === normalized.toLowerCase())?.id
    setSlots((current) => updateSlotSelection(current, index, selectedAbilityId))
  }

  function acceptSuggestions() {
    setSlots((current) => {
      let changed = false
      const next = current.map((slot) => {
        const selectedAbilityId = slot.candidates[0]?.abilityId
        if (slot.selectedAbilityId === selectedAbilityId) return slot
        changed = true
        return { ...slot, selectedAbilityId }
      })
      return changed ? next : current
    })
  }

  const handleManualOpenChange = useCallback((slotIndex: number, open: boolean) => {
    setManualSlotIndex(open ? slotIndex : undefined)
  }, [])

  const handleManualSelect = useCallback((slotIndex: number, abilityId: number) => {
    setSlots((current) => updateSlotSelection(current, slotIndex, abilityId))
    setManualSlotIndex(undefined)
  }, [])

  function toggleSelected(id: number) {
    const group = BUILD_PICK_GROUPS.find((item) => candidatePools[item.key].includes(id))
    if (!group) return
    setSelectedIds((current) => {
      if (current.includes(id)) return current.filter((item) => item !== id)
      const selectedInGroup = current.filter((item) => candidatePools[group.key].includes(item))
      return selectedInGroup.length < group.limit ? [...current, id] : current
    })
  }

  function sortPairEntries(key: PairSortKey) {
    setPairSort((current) => {
      if (current.key === key) return { key, direction: current.direction === 'asc' ? 'desc' : 'asc' }
      const direction: SortDirection = key === 'abilityOne' || key === 'abilityTwo' ? 'asc' : 'desc'
      return { key, direction }
    })
  }

  const debugSlot = useMemo(() => {
    if (debugSlotIndex === undefined) return undefined
    const recognized = slots.find((slot) => slot.index === debugSlotIndex)
    const currentLayout = layout[debugSlotIndex]
    if (!recognized || !currentLayout) return undefined
    return { ...recognized, rect: currentLayout.rect, crop: cropCenter(currentLayout.rect) }
  }, [debugSlotIndex, layout, slots])
  const expectedAbilityId = debugSlot ? goldenLabels[debugSlot.index] : undefined
  const expectedAbility = expectedAbilityId === undefined ? undefined : ability(expectedAbilityId)
  const expectedRank = debugSlot && expectedAbilityId !== undefined ? debugSlot.candidates.findIndex((candidate) => candidate.abilityId === expectedAbilityId) : -1
  const analysisSlots = useMemo(() => {
    const heroes = slots.filter((slot) => slot.category === 'hero')
    const abilities = slots.filter((slot) => slot.category === 'ability')
    const ultimates = slots.filter((slot) => slot.category === 'ultimate')
    const orderedUltimates = ULTIMATE_SLOT_ORDER.map((position) => ultimates[position]).filter((slot): slot is RecognizedSlot => slot !== undefined)
    const rowCount = Math.max(heroes.length, Math.ceil(abilities.length / 3), ultimates.length)

    return Array.from({ length: rowCount }, (_, row) => [
      heroes[row],
      abilities[row * 3],
      abilities[row * 3 + 1],
      abilities[row * 3 + 2],
      orderedUltimates[row],
    ]).flat().filter((slot): slot is RecognizedSlot => slot !== undefined)
  }, [slots])

  function updateReplayStep(step: number) {
    const maxStep = draftSimulation?.frames.at(-1)?.step ?? 0
    const nextStep = Math.max(0, Math.min(maxStep, Math.round(step)))
    setReplayStep(nextStep)
    if (nextStep >= maxStep) setReplayPlaying(false)
  }

  async function toggleOverlay(kind: OverlayKind) {
    const isOpen = overlayVisibility[kind]
    try {
      if (isDesktopRuntime()) {
        if (isOpen) await closeNativeOverlay(kind)
        else await openNativeOverlay(kind)
      }
      setOverlayVisibility((current) => ({ ...current, [kind]: !isOpen }))
    } catch (overlayError) {
      const message = overlayError instanceof Error ? overlayError.message : '无法打开置顶浮层'
      toast.error(message)
    }
  }

  return (
    <Tooltip.Provider delayDuration={250} skipDelayDuration={150}>
    <main className="mx-auto w-[min(720px,calc(100vw-24px))] pb-10 pt-[22px] text-text" data-testid="app-shell">
      <header className="grid gap-x-5 gap-y-3 border-b border-border pb-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
        <div>
          <p className="mb-1.5 text-xs font-bold uppercase tracking-[0.08em] text-accent">DOTA 2 / OMG</p>
          <h1 className="m-0 text-3xl font-semibold tracking-tight text-text">OMG-Draft-Seer</h1>
        </div>
        <nav className="order-3 col-span-full flex max-w-full gap-1 overflow-x-auto rounded-md border border-border bg-surface p-1 sm:order-2" aria-label="Main pages">
          {appPages.map((page) => {
            const Icon = page.icon
            const selected = activePage === page.id
            return <button
              key={page.id}
              type="button"
              className={cn(
                'inline-flex shrink-0 items-center gap-1.5 rounded px-3 py-2 text-sm font-medium text-text-muted transition-colors hover:bg-surface-hover hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
                selected && 'bg-accent text-canvas hover:bg-accent hover:text-canvas',
              )}
              aria-current={selected ? 'page' : undefined}
              data-testid={`nav-${page.id}`}
              onClick={() => setActivePage(page.id)}
            ><Icon size={15} />{t(page.labelKey)}</button>
          })}
        </nav>
        <div className="order-2 inline-flex items-center gap-2 text-sm text-text-muted sm:order-3 sm:justify-self-end">
          <span className="font-mono">Patch {snapshot.patch}</span>
          <span className="size-1.5 rounded-full bg-positive" />
          <span>{t('app.snapshot')}</span>
          <LanguageSwitcher />
        </div>
      </header>

      {(activePage === 'analysis' || activePage === 'layout') && <section className={`workspace ${activePage === 'analysis' ? 'analysis-workspace' : 'layout-workspace'} ${activePage === 'layout' && debugSlot ? 'has-debug-panel' : ''}`}>
        <div className="source-pane">
          <div className="section-heading">
            <div>
              <p className="eyebrow">01 / 截图</p>
              <h2>ABILITY POOL</h2>
            </div>
           </div>
          {activePage === 'layout' && <div className="layout-page-heading"><p className="eyebrow">02 / LAYOUT</p><h2>Layout Analysis</h2></div>}
          <input
            ref={inputRef}
            className="visually-hidden"
            data-testid="screenshot-input"
            type="file"
            accept={SCREENSHOT_FILE_ACCEPT}
            onChange={(event) => event.target.files?.[0] && handleUpload(event.target.files[0])}
          />
          {!screenshotUrl ? (
            activePage === 'analysis' ? <button className="upload-surface" onClick={() => inputRef.current?.click()}>
              <Upload size={25} />
              <span>导入截图</span>
              <small>PNG / JPG，默认布局按图片分辨率缩放</small>
            </button> : <div className="layout-empty"><LayoutPanelTop size={24} /><p>Upload a screenshot in Skill Analysis before calibrating the layout.</p></div>
          ) : (
            <div className="screenshot-frame">
              <img src={screenshotUrl} alt="已上传的 Dota 2 选技截图" />
              <svg
                ref={overlayRef}
                className={`layout-overlay ${activePage === 'layout' && calibrationOpen ? 'calibrating' : ''}`}
                viewBox={`0 0 ${imageSize.width} ${imageSize.height}`}
                aria-label="layout calibration overlay"
                onPointerMove={dragLayout}
                onPointerUp={finishDrag}
                onPointerCancel={finishDrag}
              >
                {layout.map((slot, index) => {
                  const matchCrop = cropCenter(slot.rect)
                  return <g key={index} onClick={() => setDebugSlotIndex(index)} className={`${slot.category} ${debugSlotIndex === index ? 'active' : ''}`}>
                    <rect className="match-frame" x={matchCrop.x} y={matchCrop.y} width={matchCrop.width} height={matchCrop.height} onPointerDown={(event) => activePage === 'layout' && calibrationOpen && startDrag(event, index, 'move')} />
                    <text x={matchCrop.x + 5} y={matchCrop.y + 15}>{slotLabel(index)}</text>
                    {activePage === 'layout' && calibrationOpen && <circle className="resize-handle" cx={matchCrop.x + matchCrop.width} cy={matchCrop.y + matchCrop.height} r="11" onPointerDown={(event) => startDrag(event, index, 'resize')} />}
                  </g>
                })}
              </svg>
              <button className="replace-shot" onClick={() => inputRef.current?.click()}><RefreshCw size={15} /> 更换</button>
            </div>
          )}
          {activePage === 'layout' && screenshotUrl && <section className="calibration-panel">
            <div className="calibration-heading">
              <span><Settings2 size={16} /> Layout calibration</span>
              <Tooltip.Root>
                <Tooltip.Trigger asChild>
                  <button className="icon-command" title="toggle layout calibration" aria-label="切换布局校准" onClick={() => setCalibrationOpen((current) => !current)}><Settings2 size={16} /></button>
                </Tooltip.Trigger>
                <Tooltip.Portal><Tooltip.Content className="app-tooltip" side="bottom" sideOffset={7}>切换布局校准<Tooltip.Arrow className="app-tooltip-arrow" width={12} height={6} /></Tooltip.Content></Tooltip.Portal>
              </Tooltip.Root>
            </div>
            {calibrationOpen && <>
              <p>Drag any frame to move it. Drag its bottom-right dot to resize it. Re-slice when all frames align. The versioned JSON layout is scaled to the uploaded image dimensions.</p>
              <input ref={layoutFileRef} className="visually-hidden" type="file" accept="application/json" onChange={(event) => event.target.files?.[0] && loadLayout(event.target.files[0])} />
              <div className="calibration-actions">
                <button onClick={() => layoutFileRef.current?.click()}><FolderOpen size={15} /> Load layout</button>
                <button onClick={saveLayout}><Download size={15} /> Save layout</button>
                <AlertDialog.Root>
                  <AlertDialog.Trigger asChild><button type="button" data-testid="layout-reset"><RotateCcw size={15} /> Reset</button></AlertDialog.Trigger>
                  <AlertDialog.Portal>
                    <AlertDialog.Overlay className="layout-reset-overlay" />
                    <AlertDialog.Content className="layout-reset-dialog">
                      <AlertDialog.Title>恢复默认布局？</AlertDialog.Title>
                      <AlertDialog.Description>这会清除已导入的布局文件和手动校准的位置，且无法撤销。</AlertDialog.Description>
                      <div className="layout-reset-actions">
                        <AlertDialog.Cancel asChild><button type="button">取消</button></AlertDialog.Cancel>
                        <AlertDialog.Action asChild><button className="layout-reset-confirm" type="button" onClick={resetLayout}>恢复默认</button></AlertDialog.Action>
                      </div>
                    </AlertDialog.Content>
                  </AlertDialog.Portal>
                </AlertDialog.Root>
                <button className="primary-action" disabled={!uploadedFile || loading} onClick={() => uploadedFile && handleUpload(uploadedFile)}><RefreshCw size={15} /> Re-slice</button>
              </div>
            </>}
          </section>}
          {error && <div className="notice error"><CircleAlert size={17} />{error}</div>}
          {loading && <div className="notice">正在切分 60 个候选格…</div>}

          {activePage === 'analysis' && slots.length > 0 && <ManualAbilityPool
            slots={analysisSlots}
            abilities={abilitiesById}
            manualSlotIndex={manualSlotIndex}
            onOpenChange={handleManualOpenChange}
            onSelect={handleManualSelect}
          />}
        </div>

        {activePage === 'layout' && debugSlot && (
          <aside className="layout-debug-pane">
            <section className="debug-panel">
              <div className="debug-heading"><span><Bug size={16} /> 分割与匹配调试</span><span>{debugSlot.matchMode === 'template' ? '模板匹配' : '颜色回退'} · {categoryLabel[debugSlot.category]} · {slotLabel(debugSlot.index)}</span></div>
              <div className="debug-body">
                {screenshotUrl && <DebugCropPreview imageUrl={screenshotUrl} crop={debugSlot.crop} />}
                <div className="debug-data">
                  <p>布局：x {debugSlot.rect.x}, y {debugSlot.rect.y}, {debugSlot.rect.width}×{debugSlot.rect.height}</p>
                  <p>中心裁剪：x {debugSlot.crop.x}, y {debugSlot.crop.y}, {debugSlot.crop.width}×{debugSlot.crop.height}</p>
                  {expectedAbility && <p className={expectedRank >= 0 ? 'golden-pass' : 'golden-fail'}>Golden: {expectedAbility.name} {expectedRank >= 0 ? `· top ${expectedRank + 1}` : '· not in top 10'}</p>}
                  <div className="debug-matches">
                    {debugSlot.candidates.slice(0, DEBUG_MATCH_CANDIDATES).map((candidate, index) => {
                      const item = ability(candidate.abilityId)
                      return <button key={candidate.abilityId} onClick={() => updateSlot(debugSlot.index, String(candidate.abilityId))}>
                        <span>{index + 1}</span><SkillIcon compact abilityId={candidate.abilityId} shortName={item?.shortName} name={item?.name} isHero={item?.isHero} />{item?.name ?? 'Unknown ability'}
                      </button>
                    })}
                  </div>
                </div>
              </div>
            </section>
          </aside>
        )}

        {activePage === 'analysis' && <aside className="analysis-pane">
          <div className="section-heading">
            <div>
              <p className="eyebrow">02 / 构筑</p>
              <h2>推荐方案</h2>
            </div>
            <div className="section-heading-actions">
              {slots.length > 0 && <button className="icon-command" data-testid="accept-suggestions" title="采用当前第一候选" onClick={acceptSuggestions}><Check size={17} /></button>}
              <OverlayToggleButton kind="recommendation" open={overlayVisibility.recommendation} onToggle={toggleOverlay} />
              <OverlayToggleButton kind="tier" open={overlayVisibility.tier} onToggle={toggleOverlay} />
              <Sparkles size={19} className="accent" />
            </div>
          </div>

          <fieldset className="control-group">
            <legend>锁定 Pick <span>{selectedIds.length}/5</span></legend>
            <div className="pick-choice-groups">
              {BUILD_PICK_GROUPS.map((group) => {
                const ids = candidatePools[group.key]
                const selectedCount = selectedIds.filter((id) => ids.includes(id)).length
                return <section className={`pick-choice-group ${group.key}`} key={group.key}>
                  <header><span>{group.label}</span><small>{selectedCount}/{group.limit}</small></header>
                  <div className="choice-list">
                    {ids.map((id) => {
                      const item = ability(id)
                      if (!item) return null
                      const tier = candidateTierInfo.get(id)?.tier
                      return <button key={id} className={selectedIds.includes(id) ? 'active-choice' : ''} onClick={() => toggleSelected(id)}><SkillIcon compact abilityId={id} shortName={item.shortName} name={item.name} isHero={item.isHero} /><span>{item.name}</span>{tier && <small className={`pick-tier tier-${tier.toLowerCase()}`}>{tier}</small>}</button>
                    })}
                    {ids.length === 0 && <p className="muted">暂无已确认候选</p>}
                  </div>
                </section>
              })}
              {candidateIds.length === 0 && <p className="muted">确认截图候选后生成完整五 Pick 构筑。</p>}
            </div>
          </fieldset>

          {recommendations.length > 0 ? (
            <div className="recommendations">
              <div className="next-pick">
                <span>建议下一手</span>
                <strong>{ability(recommendations[0].pickOrderIds.find((id) => !selectedIds.includes(id)) ?? recommendations[0].pickOrderIds[0])?.name}</strong>
              </div>
              {recommendations.map((recommendation, index) => (
                <article className="build-card" key={recommendation.abilityIds.join('-')}>
                  <div className="build-main">
                    <div className="build-detail">
                      <div className="build-header"><span>方案 {index + 1}</span></div>
                      <div className="build-abilities">{recommendation.pickOrderIds.map((id, pickIndex) => {
                        const item = ability(id)
                        return <span key={id} title={item?.name}><small>Pick {pickIndex + 1} · {pickRoleLabel(item)}</small><SkillIcon compact abilityId={id} shortName={item?.shortName} name={item?.name} isHero={item?.isHero} /><b>{item?.name}</b></span>
                      })}</div>
                    </div>
                    <dl className="build-stats">
                      <div><dt>Score</dt><dd>{recommendation.score.toFixed(1)}%</dd></div>
                      <div><dt>Base WR</dt><dd>{(recommendation.abilityWinRate * 100).toFixed(1)}%</dd></div>
                      <div className="build-pairs-stat" tabIndex={0} aria-label={`Synergy lift ${formatPairPercent(recommendation.synergy, true)}, logit delta ${formatLogitDelta(recommendation.logitSynergy)}, ${recommendation.effectiveInteractionCount} scoring interactions, ${recommendation.partialInteractions.length} partial triples not scored`}><dt>Synergy</dt><dd>{formatPairPercent(recommendation.synergy, true)}<small>Logit Δ {formatLogitDelta(recommendation.logitSynergy)} · {recommendation.effectiveInteractionCount} 组{recommendation.partialInteractions.length > 0 ? ` · 未计分 Triple ${recommendation.partialInteractions.length} 组` : ''}</small></dd><EffectiveInteractionsPopover interactions={recommendation.effectiveInteractions} partialInteractions={recommendation.partialInteractions} abilities={abilitiesById} /></div>
                      <div><dt>Avg Pick #</dt><dd>{recommendation.averagePickPosition.toFixed(1)}</dd></div>
                    </dl>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="empty-results"><FileImage size={24} /><p>确认至少 1 个英雄、3 个技能和 1 个终极后生成构筑。</p></div>
          )}
        </aside>}
      </section>}

      {activePage === 'draft' && <DraftReplayPage
        simulation={draftSimulation}
        snapshot={snapshot}
        abilities={abilitiesById}
        pool={draftPoolInfo.pool}
        poolSource={draftPoolInfo.source}
        poolError={draftPoolInfo.errors[0]}
        finalScores={draftFinalScores}
        activeStrategy={draftStrategy}
        onStrategyChange={setDraftStrategy}
        replayStep={replayStep}
        isPlaying={replayPlaying}
        onStepChange={updateReplayStep}
        onTogglePlaying={() => {
          if (!draftSimulation) return
          if (replayStep >= (draftSimulation.frames.at(-1)?.step ?? 0)) {
            setReplayStep(0)
            setReplayPlaying(true)
          } else {
            setReplayPlaying((current) => !current)
          }
        }}
      />}

      {activePage === 'database' && <section className="tier-page" aria-labelledby="tier-page-title">
        <div className="tier-page-header">
          <div>
            <p className="eyebrow">03 / ABILITY TIERS</p>
            <h2 id="tier-page-title">Ability Tier List</h2>
            <p className="tier-page-subtitle">Patch {snapshot.patch} · {tierCategoryCounts[tierCategory]} ranked entries</p>
          </div>
          <div className="tier-page-mark"><Layers size={21} aria-hidden="true" /><span>WIN RATE PERCENTILE</span><OverlayToggleButton kind="tier" open={overlayVisibility.tier} onToggle={toggleOverlay} /></div>
        </div>

        <div className="tier-toolbar">
          <div className="tier-tabs" role="tablist" aria-label="Ability tier categories">
            {TIER_CATEGORY_OPTIONS.map((tab) => {
              const selected = tierCategory === tab.id
              return <button
                key={tab.id}
                id={`tier-tab-${tab.id}`}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-controls={`tier-panel-${tab.id}`}
                className={selected ? 'selected' : ''}
                onClick={() => setTierCategory(tab.id)}
              >
                {tab.label}<span>{tierCategoryCounts[tab.id]}</span>
              </button>
            })}
          </div>
          <label className="tier-search">
            <Search size={15} aria-hidden="true" />
            <span className="visually-hidden">Search abilities</span>
            <input data-testid="tier-search" value={tierQuery} onChange={(event) => setTierQuery(event.target.value)} placeholder="Search abilities" />
          </label>
        </div>

        <div
          id={`tier-panel-${tierCategory}`}
          className="tier-list"
          role="tabpanel"
          aria-labelledby={`tier-tab-${tierCategory}`}
        >
          {TIER_ORDER.map((tier) => (
            <section className={`tier-row tier-row-${tier.toLowerCase()}`} key={tier} aria-label={`${tier} tier`}>
              <div className="tier-label"><strong>{tier}</strong><span className="tier-count">{tierGroups[tier].length}</span></div>
              <div className="tier-items">
                {tierGroups[tier].map((entry) => <TierAbilityCard key={entry.ability.id} entry={entry} />)}
                {tierGroups[tier].length === 0 && filteredTierEntries.length > 0 && <span className="tier-empty">No ranked entries</span>}
              </div>
            </section>
          ))}
          {filteredTierEntries.length === 0 && <div className="tier-no-results"><Search size={22} /><p>{tierQuery.trim() ? 'No abilities match your search.' : 'No ranked entries.'}</p></div>}
        </div>
      </section>}

      {activePage === 'pairs' && <section className="pairs-page" aria-labelledby="pairs-page-title">
        <div className="pairs-page-header">
          <div>
            <p className="eyebrow">04 / ABILITY PAIRS</p>
            <h2 id="pairs-page-title">Ability Pairs</h2>
            <p className="pairs-page-subtitle">Patch {snapshot.patch} · {filteredPairEntries.length.toLocaleString()} of {pairEntries.length.toLocaleString()} pairs</p>
          </div>
          <div className="pairs-page-mark"><GitFork size={21} aria-hidden="true" /><span>COMBINATION SYNERGY</span></div>
        </div>

        <div className="pairs-toolbar">
          <label className="pairs-search">
            <Search size={15} aria-hidden="true" />
            <span className="visually-hidden">Search ability pairs</span>
            <input data-testid="pairs-search" value={pairQuery} onChange={(event) => setPairQuery(event.target.value)} placeholder="Search ability pairs..." />
          </label>
          <div className="pairs-toolbar-actions">
            <span className="pairs-sample-note">Minimum 50 picks</span>
            <button className={`pairs-toggle ${excludeSameHero ? 'selected' : ''}`} type="button" aria-pressed={excludeSameHero} data-testid="pairs-exclude-same-hero" onClick={() => setExcludeSameHero((current) => !current)}>
              <Filter size={14} aria-hidden="true" /> Exclude Same Hero
            </button>
          </div>
        </div>

        <div
          ref={pairTableRef}
          className="pairs-table-scroll"
        >
          <table className="pairs-table">
            <thead>
              <tr>
                <th aria-sort={pairAriaSort(pairSort, 'abilityOne')}><PairSortButton label="Ability 1" sortKey="abilityOne" sort={pairSort} onSort={sortPairEntries} /></th>
                <th aria-sort={pairAriaSort(pairSort, 'winRateOne')}><PairSortButton label="WR 1" sortKey="winRateOne" sort={pairSort} onSort={sortPairEntries} /></th>
                <th aria-sort={pairAriaSort(pairSort, 'abilityTwo')}><PairSortButton label="Ability 2" sortKey="abilityTwo" sort={pairSort} onSort={sortPairEntries} /></th>
                <th aria-sort={pairAriaSort(pairSort, 'winRateTwo')}><PairSortButton label="WR 2" sortKey="winRateTwo" sort={pairSort} onSort={sortPairEntries} /></th>
                <th aria-sort={pairAriaSort(pairSort, 'pairWinRate')}><PairSortButton label="Pair WR" sortKey="pairWinRate" sort={pairSort} onSort={sortPairEntries} /></th>
                <th aria-sort={pairAriaSort(pairSort, 'synergy')}><PairSortButton label="Synergy" sortKey="synergy" sort={pairSort} onSort={sortPairEntries} /></th>
                <th aria-sort={pairAriaSort(pairSort, 'trueSynergy')}><PairSortButton label={<span>SYNERGY<sub className="pair-sort-subscript">True</sub></span>} sortKey="trueSynergy" sort={pairSort} onSort={sortPairEntries} title="Pair WR - sigmoid(logit(WR1) + logit(WR2))" /></th>
                <th><span className="pair-header-label">Hidden Triples <span className="pair-help" title="Third ability from a commonly drafted triplet. If pair (A,B) is often picked with C, and the triplet has similar pick counts, C is shown here. These pairs may have inflated synergy.">?</span></span></th>
              </tr>
            </thead>
            <tbody>
              {pairTopSpacer > 0 && <tr className="pair-virtual-spacer" aria-hidden="true"><td colSpan={8} style={{ height: pairTopSpacer }} /></tr>}
              {virtualPairRows.map((virtualRow) => {
                const entry = filteredPairEntries[virtualRow.index]
                if (!entry) return null
                return <tr key={entry.key}>
                  <td><PairAbilityCell ability={entry.abilityOne} /></td>
                  <td className="pair-stat-cell">{formatPairPercent(entry.winRateOne)}</td>
                  <td><PairAbilityCell ability={entry.abilityTwo} /></td>
                  <td className="pair-stat-cell">{formatPairPercent(entry.winRateTwo)}</td>
                  <td className="pair-stat-cell pair-pair-rate">{formatPairPercent(entry.pairWinRate)}</td>
                  <td className={`pair-stat-cell ${entry.synergy === undefined ? 'pair-muted' : entry.synergy >= 0 ? 'pair-positive' : 'pair-negative'}`}>{formatPairPercent(entry.synergy, true)}</td>
                  <td className={`pair-stat-cell ${entry.trueSynergy === undefined ? 'pair-muted' : entry.trueSynergy >= 0 ? 'pair-positive' : 'pair-negative'}`}>{formatPairPercent(entry.trueSynergy, true)}</td>
                  <td><HiddenTriplesCell entries={entry.hiddenTriples} /></td>
                </tr>
              })}
              {pairBottomSpacer > 0 && <tr className="pair-virtual-spacer" aria-hidden="true"><td colSpan={8} style={{ height: pairBottomSpacer }} /></tr>}
              {filteredPairEntries.length === 0 && <tr><td className="pairs-empty" colSpan={8}><Search size={22} /><p>{pairQuery.trim() ? 'No ability pairs match your search.' : 'No ability pairs found.'}</p></td></tr>}
            </tbody>
          </table>
        </div>
      </section>}

      {!isDesktopRuntime() && overlayVisibility.recommendation && <FloatingOverlay kind="recommendation" state={overlayState} snapshot={snapshot} abilities={abilitiesById} />}
      {!isDesktopRuntime() && overlayVisibility.tier && <FloatingOverlay kind="tier" state={overlayState} snapshot={snapshot} abilities={abilitiesById} />}
    </main>
    <Toaster position="bottom-right" theme="dark" visibleToasts={3} toastOptions={{ className: 'omg-toast', duration: 3500 }} />
    </Tooltip.Provider>
  )
}

export default function App() {
  const overlayKind = overlayKindFromLocation()
  return overlayKind ? <OverlayApp kind={overlayKind} /> : <MainApp />
}
