import { useEffect, useMemo, useState } from 'react'
import * as Tooltip from '@radix-ui/react-tooltip'
import { MousePointer2Off, PanelTop, Pin, PinOff, Sparkles } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { demoSnapshot } from '../data/demoSnapshot'
import { isHeroAbility } from '../core/ability-category'
import { cropCenter, FIXED_SLOT_LAYOUT, type RuntimeSlot } from '../core/layout'
import {
  buildAbilityTierList,
  filterTierEntries,
  TIER_ORDER,
  type AbilityTier,
  type TierEntry,
} from '../core/tiers'
import i18n from '../i18n'
import {
  createOverlayChannel,
  overlayKindFromLocation,
  readOverlayState,
  type OverlayKind,
  type OverlayMessage,
  type OverlayState,
} from '../platform/overlays'
import { appResourceUrl } from '../platform/resources'
import type { Ability, Snapshot } from '../types'
import { cn } from '../lib/cn'
import { formatPairPercent } from '../lib/recommendation-format'
import { TIER_STROKE_COLORS, TIER_TEXT_CLASSES } from '../lib/tier-presentation'
import { SkillIcon } from './SkillIcon'

const EMPTY_OVERLAY_STATE: OverlayState = {
  candidatePools: { heroIds: [], abilityIds: [], ultimateIds: [] },
  locale: 'zh-CN',
  recommendations: [],
  selectedIds: [],
  tierCategory: 'all',
  tierQuery: '',
  layout: [...FIXED_SLOT_LAYOUT],
  layoutTiers: [],
  layoutViewport: { width: 2560, height: 1440 },
}

function ui(key: string, options?: Record<string, unknown>): string {
  return i18n.t(key, options)
}

export function OverlayToggleButton({
  kind,
  open,
  onToggle,
}: {
  kind: OverlayKind
  open: boolean
  onToggle: (kind: OverlayKind) => void
}) {
  const { t } = useTranslation()
  const isTier = kind === 'tier'
  const isLayout = kind === 'layout'
  const label = isTier
    ? t('overlay.tier')
    : isLayout
      ? t('overlay.layout')
      : t('overlay.recommendation')
  const Icon = open ? PinOff : Pin

  return (
    <button
      className={cn(
        'grid size-8 place-items-center rounded-sm border border-transparent bg-transparent text-text-muted hover:border-accent hover:bg-accent-soft hover:text-text',
        open && 'border-accent bg-accent-soft text-text',
      )}
      type="button"
      aria-pressed={open}
      aria-label={`${open ? t('common.close') : t('common.open')} ${label}`}
      title={`${open ? t('common.close') : t('common.open')} ${label}`}
      data-testid={`overlay-toggle-${kind}`}
      onClick={() => onToggle(kind)}
    >
      <Icon size={15} aria-hidden="true" />
    </button>
  )
}

function LayoutOverlayView({ state }: { state: OverlayState }) {
  const { t } = useTranslation()
  const layout: readonly RuntimeSlot[] = state.layout ?? FIXED_SLOT_LAYOUT
  const layoutTiers = state.layoutTiers ?? []
  const viewport = state.layoutViewport ?? { width: 2560, height: 1440 }

  return (
    <svg
      className="layout-overlay-screen"
      viewBox={`0 0 ${viewport.width} ${viewport.height}`}
      preserveAspectRatio="none"
      aria-label={t('overlay.layout')}
      data-testid="layout-overlay"
    >
      {layout.map((slot, index) => {
        const tier = layoutTiers[index]
        const stroke = tier
          ? TIER_STROKE_COLORS[tier]
          : 'var(--color-border-strong)'
        const matchCrop = cropCenter(slot.rect)
        const matchPoints = slot.matchQuad
          ? [
              slot.matchQuad.topLeft,
              slot.matchQuad.topRight,
              slot.matchQuad.bottomRight,
              slot.matchQuad.bottomLeft,
            ]
              .map((point) => `${point.x},${point.y}`)
              .join(' ')
          : undefined

        return (
          <g key={index} className="layout-overlay-slot">
            <rect
              className="layout-overlay-inner-frame"
              x={slot.rect.x}
              y={slot.rect.y}
              width={slot.rect.width}
              height={slot.rect.height}
            />
            {matchPoints ? (
              <polygon
                className="layout-overlay-outer-frame"
                points={matchPoints}
                stroke={stroke}
              />
            ) : (
              <rect
                className="layout-overlay-outer-frame"
                x={matchCrop.x}
                y={matchCrop.y}
                width={matchCrop.width}
                height={matchCrop.height}
                stroke={stroke}
              />
            )}
          </g>
        )
      })}
    </svg>
  )
}

function OverlayTierCard({ entry }: { entry: TierEntry }) {
  const isHero = isHeroAbility(entry.ability)

  return (
    <span
      className="grid min-w-0 place-items-center [&_.skill-icon]:size-9 [&_.skill-icon]:border [&_.skill-icon]:border-border-strong [&_.skill-icon]:opacity-60"
      title={`${entry.ability.name} · ${entry.tier} · ${(entry.winRate * 100).toFixed(1)}% ${ui('common.winRate')}`}
    >
      <SkillIcon
        abilityId={entry.ability.id}
        shortName={entry.ability.shortName}
        name={entry.ability.name}
        isHero={isHero}
      />
    </span>
  )
}

function OverlayTierContent({
  state,
  snapshot,
}: {
  state: OverlayState
  snapshot: Snapshot
}) {
  const entries = useMemo(
    () =>
      filterTierEntries(
        buildAbilityTierList(snapshot, state.tierCategory),
        state.tierQuery,
      ),
    [snapshot, state.tierCategory, state.tierQuery],
  )
  const entriesById = useMemo(
    () => new Map(entries.map((entry) => [entry.ability.id, entry])),
    [entries],
  )
  const candidateIds = useMemo(
    () => [
      ...new Set([
        ...state.candidatePools.heroIds,
        ...state.candidatePools.abilityIds,
        ...state.candidatePools.ultimateIds,
      ]),
    ],
    [state.candidatePools],
  )
  const visibleEntries = useMemo(() => {
    const candidates = candidateIds
      .map((id) => entriesById.get(id))
      .filter((entry): entry is TierEntry => entry !== undefined)
    return candidates.length > 0 ? candidates : entries.slice(0, 36)
  }, [candidateIds, entries, entriesById])
  const groups = useMemo(() => {
    const grouped: Record<AbilityTier, TierEntry[]> = {
      S: [],
      A: [],
      B: [],
      C: [],
      D: [],
      E: [],
      F: [],
    }
    for (const entry of visibleEntries) grouped[entry.tier].push(entry)
    return grouped
  }, [visibleEntries])
  const sourceLabel = candidateIds.some((id) => entriesById.has(id))
    ? ui('overlay.currentCandidates')
    : ui('overlay.globalTop')

  return (
    <>
      <div className="flex items-center gap-2 py-1.5 font-mono text-[10px] text-text-muted">
        <span>{sourceLabel}</span>
        <strong className="text-text">
          {ui('overlay.items', { count: visibleEntries.length })}
        </strong>
        <span className="ml-auto">
          {ui('common.patch')} {snapshot.patch}
        </span>
      </div>
      <div className="grid gap-1">
        {TIER_ORDER.map(
          (tier) =>
            groups[tier].length > 0 && (
              <section
                className="grid grid-cols-[22px_minmax(0,1fr)] items-start gap-1.5 border-t border-border-subtle pt-1"
                key={tier}
              >
                <span
                  className={cn(
                    'grid size-[22px] place-items-center border border-current bg-accent-soft font-mono text-[13px] font-bold',
                    TIER_TEXT_CLASSES[tier],
                  )}
                >
                  {tier}
                </span>
                <div className="grid min-w-0 grid-cols-7 gap-1">
                  {groups[tier].map((entry) => (
                    <OverlayTierCard key={entry.ability.id} entry={entry} />
                  ))}
                </div>
              </section>
            ),
        )}
      </div>
    </>
  )
}

function OverlayRecommendationContent({
  state,
  abilities,
}: {
  state: OverlayState
  abilities: ReadonlyMap<number, Ability>
}) {
  const firstRecommendation = state.recommendations[0]
  const nextPickId =
    firstRecommendation?.pickOrderIds.find(
      (id) => !state.selectedIds.includes(id),
    ) ?? firstRecommendation?.pickOrderIds[0]
  const nextPick =
    nextPickId === undefined ? undefined : abilities.get(nextPickId)

  return (
    <>
      <div className="mt-2 grid gap-0.5 border-l-[3px] border-accent bg-accent-soft px-2.5 py-2">
        <span className="text-xs text-text-muted">
          {ui('overlay.nextPick')}
        </span>
        <strong className="truncate text-[17px] text-text">
          {nextPick?.name ?? ui('overlay.missingBuild')}
        </strong>
        <small className="font-mono text-[10px] text-text-muted">
          {ui('overlay.lockedAndRanked', {
            locked: state.selectedIds.length,
            count: state.recommendations.length,
          })}
        </small>
      </div>
      {state.recommendations.slice(0, 3).map((recommendation, index) => (
        <article
          className="mt-2 grid gap-1.5 border-t border-border pt-2"
          key={recommendation.abilityIds.join('-')}
        >
          <header className="flex items-center justify-between text-xs text-text-muted">
            <span>{ui('analysis.plan', { number: index + 1 })}</span>
            <strong className="font-mono text-base text-text">
              {recommendation.score.toFixed(1)}%
            </strong>
          </header>
          <div className="grid grid-cols-5 gap-1">
            {recommendation.pickOrderIds.map((id, pickIndex) => {
              const item = abilities.get(id)
              return (
                <span
                  className="relative grid min-w-0 justify-items-center text-[9px] text-text-muted [&_.skill-icon]:size-9 [&_.skill-icon]:border [&_.skill-icon]:border-border-strong [&_.skill-icon]:opacity-60"
                  key={id}
                  title={item?.name}
                >
                  <small className="absolute left-0.5 top-0 z-2 font-mono">
                    {pickIndex + 1}
                  </small>
                  <SkillIcon
                    compact
                    abilityId={item?.id}
                    shortName={item?.shortName}
                    name={item?.name}
                    isHero={item?.isHero}
                  />
                </span>
              )
            })}
          </div>
          <div className="flex flex-wrap justify-between gap-2 font-mono text-[10px] text-text-muted">
            <span>
              {ui('common.baseWinRate')}{' '}
              <b className="text-text">
                {(recommendation.abilityWinRate * 100).toFixed(1)}%
              </b>
            </span>
            <span>
              {ui('common.synergy')}{' '}
              <b
                className={
                  recommendation.synergy >= 0
                    ? 'text-positive'
                    : 'text-negative'
                }
              >
                {formatPairPercent(recommendation.synergy, true)}
              </b>
            </span>
            <span>
              {ui('common.averagePick')}{' '}
              <b className="text-text">
                {recommendation.averagePickPosition.toFixed(1)}
              </b>
            </span>
          </div>
        </article>
      ))}
      {state.recommendations.length === 0 && (
        <div className="grid justify-items-center gap-2 px-3 pb-3 pt-8 text-center text-xs text-text-muted">
          <Sparkles className="text-accent" size={22} />
          <span>{ui('overlay.noBuilds')}</span>
        </div>
      )}
    </>
  )
}

export function FloatingOverlay({
  kind,
  state,
  snapshot,
  abilities,
}: {
  kind: OverlayKind
  state: OverlayState
  snapshot: Snapshot
  abilities: ReadonlyMap<number, Ability>
}) {
  const { t } = useTranslation()
  if (kind === 'layout') {
    return (
      <div className="layout-overlay-layer" aria-label={t('overlay.layout')}>
        <LayoutOverlayView state={state} />
      </div>
    )
  }
  const isTier = kind === 'tier'
  const nativeOverlay = overlayKindFromLocation() !== undefined

  return (
    <aside
      className={cn(
        'pointer-events-none',
        nativeOverlay
          ? 'm-3 w-auto'
          : cn(
              'fixed bottom-4 z-[120] w-[min(356px,calc(50vw-24px))] max-[760px]:inset-x-3 max-[760px]:w-auto',
              kind === 'recommendation'
                ? 'left-4 max-[760px]:bottom-[calc(50%+8px)]'
                : 'right-4 max-[760px]:bottom-3',
            ),
      )}
      aria-label={isTier ? t('overlay.tier') : t('overlay.recommendation')}
    >
      <div className="max-h-[min(720px,calc(100vh-32px))] overflow-hidden rounded-md border border-border/75 bg-surface/85 p-2.5 text-text shadow-panel">
        <header className="flex items-start justify-between gap-2 border-b border-border pb-2">
          <div>
            <p className="eyebrow mb-1 flex items-center gap-1 text-[10px]">
              <PanelTop size={13} aria-hidden="true" />{' '}
              {isTier
                ? t('overlay.pinnedTier')
                : t('overlay.pinnedRecommendation')}
            </p>
            <h2 className="text-[19px]">
              {isTier ? t('overlay.tier') : t('overlay.recommendation')}
            </h2>
          </div>
          <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap font-mono text-[10px] text-text-muted">
            <MousePointer2Off size={13} aria-hidden="true" />
            {t('overlay.passThrough')}
          </span>
        </header>
        {isTier ? (
          <OverlayTierContent state={state} snapshot={snapshot} />
        ) : (
          <OverlayRecommendationContent state={state} abilities={abilities} />
        )}
      </div>
    </aside>
  )
}

export function OverlayApp({ kind }: { kind: OverlayKind }) {
  const { i18n: instance } = useTranslation()
  const [snapshot, setSnapshot] = useState<Snapshot>(demoSnapshot)
  const [state, setState] = useState<OverlayState>(
    () => readOverlayState(kind) ?? EMPTY_OVERLAY_STATE,
  )

  useEffect(() => {
    document.documentElement.classList.add('overlay-document')
    return () => document.documentElement.classList.remove('overlay-document')
  }, [])

  useEffect(() => {
    fetch(appResourceUrl('/data/snapshots/latest.json'))
      .then((response) =>
        response.ok
          ? (response.json() as Promise<Snapshot>)
          : Promise.reject(new Error('no local snapshot')),
      )
      .then(setSnapshot)
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    const channel = createOverlayChannel()
    if (!channel) return
    channel.onmessage = (event: MessageEvent<OverlayMessage>) => {
      const message = event.data
      if (message?.type === 'overlay-state' && message.kind === kind)
        setState(message.state)
    }
    channel.postMessage({
      type: 'overlay-ready',
      kind,
    } satisfies OverlayMessage)
    return () => channel.close()
  }, [kind])

  useEffect(() => {
    void instance.changeLanguage(state.locale)
  }, [instance, state.locale])

  const abilitiesById = useMemo(
    () => new Map(snapshot.abilities.map((ability) => [ability.id, ability])),
    [snapshot],
  )
  return (
    <Tooltip.Provider delayDuration={250} skipDelayDuration={150}>
      <main className={`overlay-root overlay-root-${kind}`}>
        <FloatingOverlay
          kind={kind}
          state={state}
          snapshot={snapshot}
          abilities={abilitiesById}
        />
      </main>
    </Tooltip.Provider>
  )
}
