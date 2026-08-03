import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import * as Tooltip from '@radix-ui/react-tooltip'
import { MousePointer2Off, PanelTop, Pin, PinOff } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { demoSnapshot } from '../data/demoSnapshot'
import { isHeroAbility } from '../core/ability-category'
import { cropCenter, FIXED_SLOT_LAYOUT, type RuntimeSlot } from '../core/layout'
import { buildAbilityTierList, TIER_ORDER, type TierEntry } from '../core/tiers'
import i18n from '../i18n'
import {
  createOverlayChannel,
  canMarkOverlayReady,
  isDesktopRuntime,
  markNativeOverlayReady,
  readOverlayState,
  resizeNativeOverlay,
  scheduleOverlayReadyAfterPaint,
  scheduleOverlayReadyRetry,
  setNativeOverlayInteractionRegion,
  shouldObserveOverlayPanel,
  type OverlayKind,
  type OverlayMessage,
  type OverlayState,
} from '../platform/overlays'
import { appResourceUrl } from '../platform/resources'
import type { Ability, CombinationRecommendation, Snapshot } from '../types'
import { cn } from '../lib/cn'
import {
  formatLogitDelta,
  formatPairPercent,
} from '../lib/recommendation-format'
import { TIER_STROKE_COLORS, TIER_TEXT_CLASSES } from '../lib/tier-presentation'
import { CombinationAbilityIcons } from './CombinationAbilityIcons'
import { SkillIcon } from './SkillIcon'

const EMPTY_OVERLAY_STATE: OverlayState = {
  recognitionStatus: 'idle',
  candidatePools: { heroIds: [], abilityIds: [], ultimateIds: [] },
  combinationRecommendations: [],
  locale: 'zh-CN',
  tierCategory: 'all',
  tierQuery: '',
  layout: [...FIXED_SLOT_LAYOUT],
  layoutTiers: [],
  layoutViewport: { width: 2560, height: 1440 },
}

function normalizeOverlayState(state: OverlayState | undefined): OverlayState {
  return state
    ? {
        ...EMPTY_OVERLAY_STATE,
        ...state,
        combinationRecommendations: state.combinationRecommendations ?? [],
      }
    : EMPTY_OVERLAY_STATE
}

function restoreOverlayState(kind: OverlayKind): OverlayState {
  return normalizeOverlayState(readOverlayState(kind))
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
      : t('overlay.assistant')
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
        if (!tier) return null
        const stroke = TIER_STROKE_COLORS[tier]
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

function OverlayTierAbility({ entry }: { entry: TierEntry }) {
  const isHero = isHeroAbility(entry.ability)

  return (
    <div
      className="size-8"
      title={`${entry.ability.name} · ${entry.tier} · ${(entry.winRate * 100).toFixed(1)}% ${ui('common.winRate')}`}
    >
      <SkillIcon
        abilityId={entry.ability.id}
        shortName={entry.ability.shortName}
        name={entry.ability.name}
        isHero={isHero}
      />
    </div>
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
    () => buildAbilityTierList(snapshot, 'all'),
    [snapshot],
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
  const visibleEntries = useMemo(
    () =>
      candidateIds
        .map((id) => entriesById.get(id))
        .filter((entry): entry is TierEntry => entry !== undefined)
        .sort(
          (left, right) =>
            right.winRate - left.winRate || left.rank - right.rank,
        ),
    [candidateIds, entriesById],
  )
  const entriesByTier = useMemo(
    () =>
      TIER_ORDER.map((tier) => ({
        tier,
        entries: visibleEntries.filter((entry) => entry.tier === tier),
      })).filter((group) => group.entries.length > 0),
    [visibleEntries],
  )
  const emptyMessage =
    state.recognitionStatus === 'recognizing'
      ? ui('overlay.recognizingScreenshot')
      : state.recognitionStatus === 'error'
        ? ui('overlay.recognitionFailed')
        : state.recognitionStatus === 'idle'
          ? ui('overlay.waitingForScreenshot')
          : ui('common.noCandidates')

  return (
    <section className="mt-1" data-testid="overlay-tier-box">
      {entriesByTier.map(({ tier, entries: tierEntries }) => (
        <section
          className="grid grid-cols-[32px_minmax(0,1fr)] items-start gap-1 border-t border-border-subtle py-1.5 first:border-t-0"
          key={tier}
          aria-label={ui('tiers.tierLabel', { tier })}
        >
          <strong
            className={cn(
              'grid size-8 place-items-center border border-current bg-accent-soft text-base leading-none',
              TIER_TEXT_CLASSES[tier],
            )}
          >
            {tier}
          </strong>
          <div className="flex min-w-0 flex-wrap items-start gap-1">
            {tierEntries.map((entry) => (
              <OverlayTierAbility key={entry.ability.id} entry={entry} />
            ))}
          </div>
        </section>
      ))}
      {visibleEntries.length === 0 && (
        <p className="m-0 border-t border-border-subtle py-3 text-center text-[11px] text-text-muted">
          {emptyMessage}
        </p>
      )}
    </section>
  )
}

function OverlayCombinationContent({
  recommendations,
  abilities,
}: {
  recommendations: readonly CombinationRecommendation[]
  abilities: ReadonlyMap<number, Ability>
}) {
  return (
    <section
      className="mt-3 border-t border-border pt-2"
      data-testid="overlay-combination-recommendations"
    >
      <header className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-text">
          {ui('overlay.combinationRecommendations')}
        </span>
        <span className="font-mono text-[10px] text-text-muted">
          {ui('common.combinationWinRate')}
        </span>
      </header>
      {recommendations.length > 0 ? (
        <div
          className="mt-1.5 grid max-h-[465px] gap-1.5 overflow-y-auto overscroll-contain"
          data-testid="overlay-combination-recommendations-scroll"
          aria-label={ui('overlay.combinationRecommendations')}
        >
          {recommendations.map((recommendation, index) => (
            <article
              className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 border-b border-border-subtle pb-1.5 last:border-b-0 last:pb-0"
              key={`${recommendation.type}-${recommendation.abilityIds.join('-')}`}
            >
              <div className="grid min-w-0 gap-1">
                <span className="font-mono text-[9px] text-text-muted">
                  {index + 1} · {ui(`common.${recommendation.type}`)} ·{' '}
                  {recommendation.picks.toLocaleString()} {ui('common.games')}
                </span>
                <span
                  className="truncate"
                  title={recommendation.abilityIds
                    .map((id) => abilities.get(id)?.name ?? id)
                    .join(' + ')}
                >
                  <CombinationAbilityIcons
                    recommendation={recommendation}
                    abilities={abilities}
                    variant="compact"
                  />
                </span>
              </div>
              <div className="grid justify-items-end gap-0.5 font-mono text-[11px]">
                <strong className="text-text">
                  {recommendation.score.toFixed(1)}%
                </strong>
                <span
                  className={
                    recommendation.synergy >= 0
                      ? 'text-positive'
                      : 'text-negative'
                  }
                  title={`${ui('analysis.combinationSynergyHint')} — ${ui('common.logitDelta')} ${formatLogitDelta(recommendation.logitSynergy)}`}
                >
                  {formatPairPercent(recommendation.synergy, true)}
                </span>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <p className="mb-0 mt-2 text-[11px] text-text-muted">
          {ui('overlay.combinationEmpty')}
        </p>
      )}
    </section>
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
  return (
    <>
      {kind === 'recommendation' && (
        <div className="layout-overlay-layer" aria-label={t('overlay.layout')}>
          <LayoutOverlayView state={state} />
        </div>
      )}
      <aside
        className="pointer-events-none fixed left-3 top-3 z-[121] w-[min(372px,calc(100vw-24px))]"
        aria-label={isTier ? t('overlay.tier') : t('overlay.assistant')}
      >
        <div
          className="pointer-events-auto max-h-[calc(100vh-24px)] overflow-y-auto overscroll-contain rounded-md border border-border/75 bg-surface p-2.5 text-text shadow-panel"
          data-overlay-panel
        >
          <header className="flex items-center justify-between gap-2 border-b border-border pb-2">
            <h2 className="inline-flex items-center gap-1.5 text-sm">
              <PanelTop size={14} aria-hidden="true" />
              {isTier ? t('overlay.tier') : t('overlay.assistant')}
            </h2>
            <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap font-mono text-[10px] text-text-muted">
              <MousePointer2Off size={13} aria-hidden="true" />
              {t('overlay.passThrough')}
            </span>
          </header>
          <OverlayTierContent state={state} snapshot={snapshot} />
          {!isTier && state.recognitionStatus === 'ready' && (
            <OverlayCombinationContent
              recommendations={state.combinationRecommendations}
              abilities={abilities}
            />
          )}
        </div>
      </aside>
    </>
  )
}

export function OverlayApp({ kind }: { kind: OverlayKind }) {
  const { i18n: instance } = useTranslation()
  const [snapshot, setSnapshot] = useState<Snapshot>(demoSnapshot)
  const [state, setState] = useState<OverlayState>(() =>
    restoreOverlayState(kind),
  )
  const [snapshotSettled, setSnapshotSettled] = useState(false)
  const [contentSynchronized, setContentSynchronized] = useState(false)
  const contentReady = canMarkOverlayReady(snapshotSettled, contentSynchronized)

  useLayoutEffect(() => {
    document.documentElement.classList.add('overlay-document')
    return () => document.documentElement.classList.remove('overlay-document')
  }, [kind])

  useEffect(() => {
    let active = true
    fetch(appResourceUrl('/data/snapshots/latest.json'))
      .then((response) =>
        response.ok
          ? (response.json() as Promise<Snapshot>)
          : Promise.reject(new Error('no local snapshot')),
      )
      .then((nextSnapshot) => {
        if (active) setSnapshot(nextSnapshot)
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setSnapshotSettled(true)
      })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    const channel = createOverlayChannel()
    if (channel) {
      let retry = 0
      const requestState = () => {
        channel.postMessage({
          type: 'overlay-ready',
          kind,
        } satisfies OverlayMessage)
      }
      channel.onmessage = (event: MessageEvent<OverlayMessage>) => {
        const message = event.data
        if (message?.type === 'overlay-state' && message.kind === kind) {
          setState(normalizeOverlayState(message.state))
          setContentSynchronized(true)
          window.clearInterval(retry)
        }
      }
      requestState()
      retry = window.setInterval(requestState, 250)
      return () => {
        window.clearInterval(retry)
        channel.close()
      }
    }
  }, [kind])

  useEffect(() => {
    if (!isDesktopRuntime() || !contentReady) return
    let disposeRetry: () => void = () => undefined
    const disposePaint = scheduleOverlayReadyAfterPaint(() => {
      disposeRetry = scheduleOverlayReadyRetry(
        () => markNativeOverlayReady(kind),
        (error: unknown) => {
          console.error(`Failed to mark ${kind} overlay ready`, error)
        },
      )
    })
    return () => {
      disposePaint()
      disposeRetry()
    }
  }, [contentReady, kind])

  useEffect(() => {
    void instance.changeLanguage(state.locale)
  }, [instance, state.locale])

  useEffect(() => {
    if (
      !shouldObserveOverlayPanel(
        isDesktopRuntime(),
        kind,
        contentReady,
        typeof ResizeObserver !== 'undefined',
      )
    )
      return
    const panel = document.querySelector<HTMLElement>('[data-overlay-panel]')
    if (!panel) return

    let frame: number | undefined
    const resize = () => {
      if (frame !== undefined) window.cancelAnimationFrame(frame)
      frame = window.requestAnimationFrame(() => {
        frame = undefined
        if (kind === 'recommendation') {
          const rect = panel.getBoundingClientRect()
          void setNativeOverlayInteractionRegion(
            kind,
            Math.max(1, Math.ceil(rect.width)),
            Math.max(1, Math.ceil(rect.height)),
          ).catch(() => undefined)
        } else {
          const height = Math.max(1, Math.ceil(panel.scrollHeight + 24))
          void resizeNativeOverlay(kind, height).catch(() => undefined)
        }
      })
    }
    const observer = new ResizeObserver(resize)
    observer.observe(panel)
    resize()
    return () => {
      observer.disconnect()
      if (frame !== undefined) window.cancelAnimationFrame(frame)
    }
  }, [contentReady, kind])

  const abilitiesById = useMemo(
    () => new Map(snapshot.abilities.map((ability) => [ability.id, ability])),
    [snapshot],
  )
  return (
    <Tooltip.Provider delayDuration={250} skipDelayDuration={150}>
      <main className={`overlay-root overlay-root-${kind}`}>
        {contentReady && (
          <FloatingOverlay
            kind={kind}
            state={state}
            snapshot={snapshot}
            abilities={abilitiesById}
          />
        )}
      </main>
    </Tooltip.Provider>
  )
}
