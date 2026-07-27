import {
  CircleAlert,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Timer,
  Users,
} from 'lucide-react'
import {
  DRAFT_PICK_QUOTAS,
  DRAFT_POOL_SIZES,
  playerDraftCategoryCounts,
  remainingPoolCounts,
  type DraftState,
  type DraftStrategyId,
  type InitialDraftPool,
} from '../core/draft-state'
import type {
  DraftReplayFrame,
  DraftSimulationResult,
} from '../core/draft-tree'
import { positionsForPlayer, turnAt } from '../core/draft-turns'
import type { RankedDraftCandidate } from '../core/draft-strategy'
import i18n from '../i18n'
import { cn } from '../lib/cn'
import {
  formatLogitDelta,
  formatPairPercent,
} from '../lib/recommendation-format'
import type { Ability, Recommendation, SlotCategory, Snapshot } from '../types'
import { RecommendationInteractionsPopover } from './RecommendationInteractionsPopover'
import { SkillIcon } from './SkillIcon'
import { PageHeader } from './ui'

function ui(key: string, options?: Record<string, unknown>): string {
  return i18n.t(key, options)
}

function DraftStrategyBadge({ strategy }: { strategy: DraftStrategyId }) {
  const isTier = strategy === 'tier-first'
  return (
    <span
      className={cn(
        'inline-flex min-h-[18px] items-center gap-1 border border-border bg-surface-raised px-1.5 py-0.5 font-mono text-[9px] text-text-muted whitespace-nowrap',
        !isTier && 'border-violet-300/50 bg-violet-300/10 text-violet-300',
      )}
    >
      <span
        className="grid size-[13px] place-items-center border border-current text-[8px]"
        aria-hidden="true"
      >
        {isTier ? 'T' : 'P'}
      </span>
      {isTier ? ui('draft.tierFirst') : ui('draft.pairFirst')}
    </span>
  )
}

function DraftPlayerRow({
  player,
  strategy,
  state,
  side,
  currentGlobalPick,
  abilities,
}: {
  player: number
  strategy: DraftStrategyId
  state: DraftState
  side: 'radiant' | 'dire'
  currentGlobalPick?: number
  abilities: ReadonlyMap<number, Ability>
}) {
  const positions = positionsForPlayer(player)
  const picks = state.picksByPlayer[player] ?? []
  const categoryCounts = playerDraftCategoryCounts(state, player)
  const remainingLabels = [
    ...Array.from(
      { length: Math.max(0, DRAFT_PICK_QUOTAS.hero - categoryCounts.hero) },
      () => 'H',
    ),
    ...Array.from(
      {
        length: Math.max(0, DRAFT_PICK_QUOTAS.ability - categoryCounts.ability),
      },
      () => 'S',
    ),
    ...Array.from(
      {
        length: Math.max(
          0,
          DRAFT_PICK_QUOTAS.ultimate - categoryCounts.ultimate,
        ),
      },
      () => 'U',
    ),
  ]
  const isCurrentPlayer = positions.includes(currentGlobalPick ?? -1)
  const displayPlayer = side === 'dire' ? player - 5 : player
  const playerNumber = (
    <span
      className={cn(
        'inline-flex size-6 shrink-0 items-center justify-center rounded-full font-mono text-[13px] font-bold',
        side === 'radiant'
          ? 'bg-positive-soft text-positive'
          : 'bg-negative-soft text-negative',
      )}
      aria-label={`${ui('draft.player')} ${player}`}
    >
      {displayPlayer}
    </span>
  )
  const pickSlots = (
    <div className="flex min-w-0 flex-1">
      <div className="grid w-max max-w-full grid-cols-5 gap-1">
        {positions.map((globalPick, index) => {
          const abilityId = picks[index]
          const item =
            abilityId === undefined ? undefined : abilities.get(abilityId)
          const isCurrent = currentGlobalPick === globalPick
          const pendingLabel = remainingLabels[index - picks.length]
          const ariaLabel = item
            ? `${ui('analysis.pick', { number: index + 1 })}, ${item.name}`
            : `${ui('analysis.pick', { number: index + 1 })}, ${pendingLabel ?? '—'}`
          return (
            <div
              className={cn(
                'relative grid size-[50px] place-items-center rounded-sm border border-border-strong bg-surface-hover p-0.5 [&_.skill-icon]:size-[46px]',
                item ? 'bg-surface-hover' : 'border-dashed bg-canvas',
                isCurrent &&
                  'border-accent bg-accent-soft shadow-[inset_0_0_0_1px_rgb(96_165_250_/_0.2)]',
              )}
              key={globalPick}
              title={item?.name}
              aria-label={ariaLabel}
            >
              {item ? (
                <>
                  <SkillIcon
                    compact
                    abilityId={item.id}
                    shortName={item.shortName}
                    name={item.name}
                    isHero={item.isHero}
                  />
                  <span className="absolute -bottom-1 -right-0.5 grid size-[17px] place-items-center rounded-full border border-border-strong bg-canvas font-mono text-[8px] text-text-muted">
                    {globalPick}
                  </span>
                </>
              ) : (
                <span
                  className={cn(
                    'font-mono text-xs font-bold text-text-muted',
                    isCurrent && 'text-accent',
                  )}
                >
                  {pendingLabel ?? '—'}
                </span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
  return (
    <article
      className={cn(
        'flex min-w-0 min-h-16 items-center gap-1.5 rounded-sm border border-border bg-surface p-1',
        side === 'dire' && 'flex-row-reverse',
        isCurrentPlayer &&
          'border-accent bg-accent-soft shadow-[inset_0_0_0_1px_rgb(96_165_250_/_0.2)',
      )}
    >
      {playerNumber}
      {pickSlots}
    </article>
  )
}

function DraftPoolSection({
  category,
  label,
  ids,
  remainingIds,
  abilities,
}: {
  category: SlotCategory
  label: string
  ids: readonly number[]
  remainingIds: readonly number[]
  abilities: ReadonlyMap<number, Ability>
}) {
  const remaining = new Set(remainingIds)
  return (
    <section
      className={cn(
        'min-w-0 rounded-sm border border-border bg-surface p-1.5',
        category === 'ability'
          ? 'w-80 max-w-full max-[700px]:w-full'
          : 'w-24 max-[700px]:w-full',
      )}
    >
      <header className="mb-1 flex items-center justify-between gap-1.5 font-mono text-[9px] font-bold text-text">
        <span>{label}</span>
        <strong
          className="min-w-7 text-right text-[10px]"
          aria-label={ui('draft.available', {
            count: remaining.size,
            total: ids.length,
          })}
        >
          {remaining.size}/{ids.length}
        </strong>
      </header>
      <div
        className={cn(
          'grid min-w-0 justify-items-center gap-[3px]',
          category === 'ability'
            ? 'flex w-[308px] max-w-full flex-wrap content-start justify-start gap-1 max-[700px]:grid max-[700px]:w-auto max-[700px]:grid-cols-6'
            : 'grid-cols-2 justify-between max-[700px]:grid-cols-6',
        )}
      >
        {ids.map((id) => {
          const item = abilities.get(id)
          if (!item) return null
          const available = remaining.has(id)
          const itemLabel = available
            ? item.name
            : `${item.name} · ${ui('common.picked')}`
          return (
            <span
              className={cn(
                'inline-flex size-[38px] shrink-0 items-center justify-center transition-[filter,opacity] hover:brightness-125 [&_.skill-icon]:size-[38px] [&_.skill-icon]:border [&_.skill-icon]:border-border-strong',
                category === 'ability' && 'size-12 [&_.skill-icon]:size-11',
                !available && 'opacity-25 grayscale',
              )}
              key={id}
              title={itemLabel}
              aria-label={itemLabel}
            >
              <SkillIcon
                compact
                abilityId={item.id}
                shortName={item.shortName}
                name={item.name}
                isHero={item.isHero}
              />
            </span>
          )
        })}
      </div>
    </section>
  )
}

function DraftTopCandidates({
  candidates,
  turn,
  strategy,
  abilities,
}: {
  candidates: readonly RankedDraftCandidate[]
  turn: DraftReplayFrame['turn']
  strategy: DraftStrategyId
  abilities: ReadonlyMap<number, Ability>
}) {
  return (
    <section
      className="mx-0.5 mt-2 border border-border bg-surface-raised"
      aria-labelledby="draft-top-candidates-title"
    >
      <header className="flex items-center justify-between gap-2 border-b border-border px-2 py-1.5">
        <div className="grid min-w-0 gap-0.5">
          <span
            className="font-mono text-[9px] font-bold text-accent"
            id="draft-top-candidates-title"
          >
            {ui('draft.topOptions')}
          </span>
          <small className="text-[9px] text-text-muted">
            {ui('draft.position', { position: turn.globalPick })} · P
            {turn.player} {ui('analysis.pick', { number: turn.playerPick })}
          </small>
        </div>
        <DraftStrategyBadge strategy={strategy} />
      </header>
      <div className="grid grid-cols-2 gap-px p-[3px]">
        {candidates.map((candidate) => {
          const item = abilities.get(candidate.abilityId)
          if (!item) return null
          const pairScore = candidate.pairProfile.topValues[0]
          return (
            <article
              className="grid min-h-[31px] min-w-0 grid-cols-[19px_26px_minmax(0,1fr)_auto] items-center gap-1 border border-transparent px-1 py-0.5 hover:border-accent hover:bg-accent-soft"
              key={candidate.abilityId}
              title={item.name}
            >
              <span className="text-right font-mono text-[9px] text-text-muted">
                {String(candidate.rank).padStart(2, '0')}
              </span>
              <SkillIcon
                compact
                abilityId={item.id}
                shortName={item.shortName}
                name={item.name}
                isHero={item.isHero}
              />
              <div className="grid min-w-0 gap-px">
                <strong className="truncate font-mono text-[9px] text-text">
                  {item.shortName}
                </strong>
                <small className="whitespace-nowrap text-[8px] text-text-muted">
                  {candidate.tier ?? '—'} ·{' '}
                  {(candidate.individualWinRate * 100).toFixed(1)}%{' '}
                  {ui('common.winRate')}
                </small>
              </div>
              <div className="grid justify-items-end gap-px">
                <strong className="font-mono text-[9px] text-positive">
                  {pairScore === undefined
                    ? '—'
                    : `${(pairScore * 100).toFixed(1)}%`}
                </strong>
                <small className="whitespace-nowrap text-[8px] text-text-muted">
                  {candidate.avgPickPosition === undefined
                    ? `${ui('common.averagePick')} —`
                    : `${ui('common.averagePick')} ${candidate.avgPickPosition.toFixed(1)}`}
                </small>
              </div>
            </article>
          )
        })}
      </div>
    </section>
  )
}

function DraftFinalScoreTable({
  scores,
  strategyByPlayer,
  abilities,
}: {
  scores: ReadonlyArray<{ player: number; recommendation?: Recommendation }>
  strategyByPlayer: Record<number, DraftStrategyId>
  abilities: ReadonlyMap<number, Ability>
}) {
  return (
    <section
      className="mt-[22px] border-t border-border-subtle pt-4"
      aria-labelledby="draft-final-score-title"
    >
      <div className="flex flex-col items-start justify-between gap-2 min-[601px]:flex-row">
        <div>
          <p className="eyebrow">{ui('draft.finalScore')}</p>
          <h3
            className="m-0 text-[17px] font-semibold text-text"
            id="draft-final-score-title"
          >
            {ui('draft.completeBuilds')}
          </h3>
          <p className="mb-0 mt-2 text-xs text-text-muted">
            {ui('draft.sameMetrics')}
          </p>
        </div>
        <span className="whitespace-nowrap font-mono text-[11px] text-text-muted">
          {ui('draft.scored', {
            count: scores.filter((entry) => entry.recommendation).length,
          })}
        </span>
      </div>
      <div className="mt-3 overflow-x-auto border border-border bg-surface">
        <div className="min-w-[1030px]">
          <div className="grid min-h-[35px] grid-cols-[92px_280px_82px_82px_minmax(170px,1fr)_90px] items-center gap-3 border-b border-border-strong bg-surface-raised px-3 font-mono text-[10px] text-text-muted">
            <span>{ui('draft.player')}</span>
            <span>{ui('draft.build')}</span>
            <span>{ui('common.score')}</span>
            <span>{ui('common.baseWinRate')}</span>
            <span>{ui('common.synergy')}</span>
            <span>{ui('common.averagePick')}</span>
          </div>
          {scores.map(({ player, recommendation }) =>
            recommendation ? (
              <article
                className="grid min-h-16 grid-cols-[92px_280px_82px_82px_minmax(170px,1fr)_90px] items-center gap-3 border-b border-border-subtle px-3 text-text last:border-b-0 hover:bg-surface-hover"
                key={player}
              >
                <div className="grid justify-items-start gap-1">
                  <strong className="font-mono text-sm">P{player}</strong>
                  <DraftStrategyBadge strategy={strategyByPlayer[player]} />
                </div>
                <div className="flex items-center gap-1">
                  {recommendation.pickOrderIds.map((id, index) => {
                    const item = abilities.get(id)
                    return (
                      <span
                        className="relative grid size-9 place-items-center border border-border-strong bg-surface-raised [&_.skill-icon]:size-[30px]"
                        key={id}
                        title={`${index + 1}. ${item?.name ?? id}`}
                      >
                        <small className="absolute left-0.5 top-0.5 z-2 font-mono text-[8px] text-text-muted">
                          {index + 1}
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
                <strong className="font-mono text-sm text-text-strong">
                  {recommendation.score.toFixed(1)}%
                </strong>
                <span className="font-mono text-xs text-text">
                  {(recommendation.abilityWinRate * 100).toFixed(1)}%
                </span>
                <div
                  className="group relative grid min-w-[132px] cursor-help gap-0.5"
                  tabIndex={0}
                  aria-label={ui('analysis.synergyAria', {
                    synergy: formatPairPercent(recommendation.synergy, true),
                    delta: formatLogitDelta(recommendation.logitSynergy),
                    interactions: recommendation.effectiveInteractionCount,
                    partial: 0,
                  })}
                >
                  <strong
                    className={cn(
                      'font-mono text-xs',
                      recommendation.synergy >= 0
                        ? 'text-positive'
                        : 'text-negative',
                    )}
                  >
                    {formatPairPercent(recommendation.synergy, true)}
                  </strong>
                  <small className="font-mono text-[9px] text-text-muted">
                    {ui('common.logitDelta')}{' '}
                    {formatLogitDelta(recommendation.logitSynergy)} ·{' '}
                    {ui('draft.interactionGroups', {
                      count: recommendation.effectiveInteractionCount,
                    })}
                  </small>
                  <RecommendationInteractionsPopover
                    interactions={recommendation.effectiveInteractions}
                    partialInteractions={recommendation.partialInteractions}
                    abilities={abilities}
                  />
                </div>
                <span className="font-mono text-xs text-text">
                  {recommendation.averagePickPosition.toFixed(1)}
                </span>
              </article>
            ) : (
              <article
                className="grid min-h-16 grid-cols-[92px_1fr] items-center gap-3 border-b border-border-subtle px-3 text-xs text-warning last:border-b-0"
                key={player}
              >
                <div className="grid justify-items-start gap-1">
                  <strong className="font-mono text-sm text-text">
                    P{player}
                  </strong>
                  <DraftStrategyBadge strategy={strategyByPlayer[player]} />
                </div>
                <span>{ui('draft.incompleteBuild')}</span>
              </article>
            ),
          )}
        </div>
      </div>
    </section>
  )
}

function DraftTeamPanel({
  side,
  state,
  simulation,
  currentGlobalPick,
  abilities,
}: {
  side: 'radiant' | 'dire'
  state: DraftState
  simulation: DraftSimulationResult
  currentGlobalPick?: number
  abilities: ReadonlyMap<number, Ability>
}) {
  const firstPlayer = side === 'radiant' ? 1 : 6
  const sideLabel = side === 'radiant' ? ui('draft.radiant') : ui('draft.dire')
  return (
    <section
      className="grid min-w-0 gap-1"
      aria-label={`${sideLabel} ${ui('draft.title')} ${ui('draft.build')}`}
    >
      <h3
        className={cn(
          'm-0 flex items-baseline justify-between gap-2 px-0.5 text-xs font-bold tracking-[0.04em]',
          side === 'radiant' ? 'text-positive' : 'text-negative',
        )}
      >
        {sideLabel}{' '}
        <span className="font-mono text-[9px] font-normal tracking-normal text-text-muted">
          {ui('draft.players')}
        </span>
      </h3>
      {Array.from({ length: 5 }, (_, index) => firstPlayer + index).map(
        (player) => (
          <DraftPlayerRow
            key={player}
            player={player}
            side={side}
            strategy={simulation.strategyByPlayer[player]}
            state={state}
            currentGlobalPick={currentGlobalPick}
            abilities={abilities}
          />
        ),
      )}
    </section>
  )
}

export interface DraftReplayPageProps {
  simulation?: DraftSimulationResult
  snapshot: Snapshot
  abilities: ReadonlyMap<number, Ability>
  pool?: InitialDraftPool
  poolSourceKey: 'draft.sourceRanked' | 'draft.sourceScreenshot'
  poolErrorKey?:
    | 'draft.incompleteSlots'
    | 'draft.incompleteCandidates'
    | 'draft.incompletePool'
  poolErrorValues?: Record<string, number>
  finalScores: ReadonlyArray<{
    player: number
    recommendation?: Recommendation
  }>
  activeStrategy: DraftStrategyId
  onStrategyChange: (strategy: DraftStrategyId) => void
  replayStep: number
  isPlaying: boolean
  onStepChange: (step: number) => void
  onTogglePlaying: () => void
}

export function DraftReplayPage({
  simulation,
  snapshot,
  abilities,
  pool,
  poolSourceKey,
  poolErrorKey,
  poolErrorValues,
  finalScores,
  activeStrategy,
  onStrategyChange,
  replayStep,
  isPlaying,
  onStepChange,
  onTogglePlaying,
}: DraftReplayPageProps) {
  if (!simulation || !pool) {
    return (
      <section
        className="mt-6 border-t border-border-subtle pt-5"
        aria-labelledby="draft-page-title"
      >
        <PageHeader
          titleId="draft-page-title"
          eyebrow={ui('draft.step')}
          title={ui('draft.title')}
          aside={
            <>
              <Play size={21} aria-hidden="true" />
              <span>{ui('draft.playersPicks')}</span>
            </>
          }
        />
        <div className="mt-[18px] grid min-h-[300px] place-items-center gap-2 rounded-md border border-dashed border-border-strong bg-surface px-6 text-center text-text-muted">
          <CircleAlert size={25} />
          <h3 className="m-0 text-[15px] text-text">
            {ui('draft.poolUnavailable')}
          </h3>
          <p className="m-0 max-w-[430px] text-xs leading-5">
            {poolErrorKey
              ? ui(poolErrorKey, poolErrorValues)
              : ui('draft.incompletePool', DRAFT_POOL_SIZES)}
          </p>
        </div>
      </section>
    )
  }

  const frame: DraftReplayFrame =
    simulation.frames[Math.min(replayStep, simulation.frames.length - 1)] ??
    simulation.frames[0]
  const state = frame.state
  const currentStep = frame.step
  const currentEvent = frame.event
  const currentAbility =
    currentEvent?.abilityId === undefined
      ? undefined
      : abilities.get(currentEvent.abilityId)
  const counts = remainingPoolCounts(state)
  const totalPool =
    pool.heroIds.length + pool.abilityIds.length + pool.ultimateIds.length
  const maxStep = simulation.frames.at(-1)?.step ?? 0
  const nextTurn =
    currentStep < maxStep && currentStep < 50
      ? turnAt(currentStep + 1)
      : undefined
  const currentPairProfile = currentEvent?.pairProfile
  const currentStrategy =
    simulation.strategyByPlayer[frame.turn.player] ?? 'tier-first'
  const currentRationale =
    currentEvent?.policy === 'pair-first'
      ? currentEvent.pairScore === undefined
        ? ui('draft.pairFallback')
        : ui('draft.pairRationale', {
            count: currentPairProfile?.optionCount ?? 0,
          })
      : ui('draft.tierRationale')

  return (
    <section
      className="mt-6 border-t border-border-subtle pt-5"
      aria-labelledby="draft-page-title"
    >
      <PageHeader
        titleId="draft-page-title"
        eyebrow={ui('draft.step')}
        title={ui('draft.title')}
        description={
          <>
            {ui('common.patch')} {snapshot.patch} · {ui(poolSourceKey)} ·{' '}
            {ui('draft.finalLoadout')}
          </>
        }
        aside={
          <>
            <Users size={21} aria-hidden="true" />
            <span>{ui('draft.playersPicks')}</span>
          </>
        }
      />

      <DraftFinalScoreTable
        scores={finalScores}
        strategyByPlayer={simulation.strategyByPlayer}
        abilities={abilities}
      />

      <div className="mt-6 grid gap-3 border border-border bg-surface p-3 min-[701px]:grid-cols-[minmax(250px,1fr)_minmax(220px,.8fr)_auto] min-[701px]:items-center">
        <div className="flex min-w-0 items-center gap-3">
          <span className="shrink-0 font-mono text-[10px] font-bold tracking-[0.04em] text-accent">
            {ui('draft.allPlayers')}
          </span>
          <div className="flex flex-wrap gap-1">
            {Array.from({ length: 10 }, (_, index) => (
              <span
                className="grid min-w-[31px] h-6 place-items-center border border-border bg-surface-raised font-mono text-[11px] text-text-muted"
                key={index + 1}
              >
                P{index + 1}
              </span>
            ))}
          </div>
        </div>
        <div
          className="inline-flex min-w-0 border border-border-strong bg-surface-raised"
          role="tablist"
          aria-label={ui('draft.pickStrategy')}
        >
          {(['tier-first', 'pair-first'] as const).map((strategy) => (
            <button
              type="button"
              role="tab"
              aria-selected={activeStrategy === strategy}
              data-testid={`draft-strategy-${strategy}`}
              className={cn(
                'min-h-7 border-r border-border-strong bg-transparent px-2.5 py-1 font-mono text-[10px] font-bold text-text-muted last:border-r-0 hover:bg-surface-hover hover:text-text',
                activeStrategy === strategy && 'bg-accent-soft text-text',
              )}
              key={strategy}
              onClick={() => onStrategyChange(strategy)}
            >
              {strategy === 'tier-first'
                ? ui('draft.tierFirst')
                : ui('draft.pairFirst')}
            </button>
          ))}
        </div>
        <div className="inline-flex items-center justify-start gap-2 font-mono text-[10px] text-text-muted min-[701px]:justify-end">
          <span className="size-1.5 rounded-full bg-positive" />{' '}
          {ui('draft.allPlayers')} ·{' '}
          {simulation.unresolved
            ? ui('draft.incomplete')
            : ui('draft.complete')}
        </div>
      </div>

      <div className="mt-[18px] grid gap-2 xl:grid-cols-[minmax(310px,1fr)_600px_minmax(310px,1fr)] xl:items-start">
        <DraftTeamPanel
          side="radiant"
          state={state}
          simulation={simulation}
          currentGlobalPick={nextTurn?.globalPick}
          abilities={abilities}
        />

        <section
          className="w-full max-w-full overflow-x-auto rounded-sm border border-border bg-surface p-2.5 xl:w-[600px]"
          aria-label={ui('analysis.abilityPool')}
        >
          <header className="flex items-start justify-between gap-2 border-b border-border px-0.5 pb-2">
            <div>
              <p className="eyebrow mb-0.5 text-[9px]">
                {ui('analysis.abilityPool')}
              </p>
              <strong className="font-mono text-base text-text">
                {counts.total}
                <small className="font-mono text-[9px] font-normal text-text-muted">
                  {' '}
                  / {totalPool} {ui('common.available')}
                </small>
              </strong>
            </div>
            <div className="grid min-w-0 justify-items-end gap-0.5 text-right">
              <span className="font-mono text-[10px] font-bold text-accent">
                {nextTurn
                  ? `P${nextTurn.player} · ${ui('analysis.pick', { number: nextTurn.playerPick })}`
                  : ui('draft.draftComplete')}
              </span>
              <small className="max-w-[150px] truncate text-[9px] text-text-muted">
                {currentAbility
                  ? ui('draft.lastPicked', { name: currentAbility.name })
                  : ui('draft.ready')}
              </small>
            </div>
          </header>
          {currentEvent && (
            <div
              className="mx-0.5 mt-2 grid gap-0.5 border border-border bg-surface-raised px-2 py-1.5 text-[9px] text-text-muted"
              title={currentRationale}
            >
              <div className="flex min-w-0 items-baseline justify-between gap-2">
                <strong className="shrink-0 font-mono text-accent">
                  {currentEvent.policy === 'pair-first'
                    ? ui('draft.pairFirst')
                    : ui('draft.tierFirst')}
                </strong>
                <span className="truncate text-right">{currentRationale}</span>
              </div>
              {currentEvent.pairScore !== undefined && (
                <span className="font-mono text-[10px] font-bold text-positive">
                  {ui('draft.pairWinRate')}{' '}
                  {(currentEvent.pairScore * 100).toFixed(1)}%
                </span>
              )}
              {currentPairProfile && (
                <small className="truncate text-[9px]">
                  {ui('draft.topOptions')}{' '}
                  {currentPairProfile.topValues
                    .map((value) => `${(value * 100).toFixed(1)}%`)
                    .join(' · ')}{' '}
                  ·{' '}
                  {ui('draft.connected', {
                    count: currentPairProfile.optionCount,
                  })}
                </small>
              )}
            </div>
          )}
          <DraftTopCandidates
            candidates={frame.candidates}
            turn={frame.turn}
            strategy={currentStrategy}
            abilities={abilities}
          />
          <div className="grid w-[524px] min-w-[524px] grid-cols-[96px_320px_96px] items-start gap-1.5 pt-2.5 max-[700px]:w-full max-[700px]:min-w-0 max-[700px]:grid-cols-1">
            <DraftPoolSection
              category="ultimate"
              label={ui('common.ultimates')}
              ids={pool.ultimateIds}
              remainingIds={state.remainingByCategory.ultimateIds}
              abilities={abilities}
            />
            <DraftPoolSection
              category="ability"
              label={ui('common.abilities')}
              ids={pool.abilityIds}
              remainingIds={state.remainingByCategory.abilityIds}
              abilities={abilities}
            />
            <DraftPoolSection
              category="hero"
              label={ui('common.heroes')}
              ids={pool.heroIds}
              remainingIds={state.remainingByCategory.heroIds}
              abilities={abilities}
            />
          </div>
          <section
            className="mt-2.5 grid gap-2 border-t border-border bg-transparent pt-2.5 min-[701px]:grid-cols-[auto_minmax(0,1fr)]"
            aria-label={ui('draft.title')}
          >
            <div className="flex items-center gap-1">
              <button
                type="button"
                className="inline-flex min-h-[30px] items-center justify-center rounded-sm border border-border-strong bg-surface-raised px-2 py-1 text-xs text-text hover:border-accent hover:bg-accent-soft"
                title={ui('draft.restart')}
                aria-label={ui('draft.restart')}
                onClick={() => onStepChange(0)}
              >
                <SkipBack size={16} />
              </button>
              <button
                type="button"
                className="inline-flex min-h-[30px] min-w-[65px] items-center justify-center gap-1 rounded-sm border border-accent bg-accent-soft px-2 py-1 text-xs text-text hover:bg-accent/20"
                onClick={onTogglePlaying}
                aria-label={isPlaying ? ui('draft.pause') : ui('draft.play')}
              >
                {isPlaying ? <Pause size={16} /> : <Play size={16} />}
                <span>{isPlaying ? ui('draft.pause') : ui('draft.play')}</span>
              </button>
              <button
                type="button"
                className="inline-flex min-h-[30px] items-center justify-center rounded-sm border border-border-strong bg-surface-raised px-2 py-1 text-xs text-text hover:border-accent hover:bg-accent-soft"
                title={ui('draft.nextPick')}
                aria-label={ui('draft.nextPick')}
                onClick={() => onStepChange(Math.min(maxStep, currentStep + 1))}
              >
                <SkipForward size={16} />
              </button>
            </div>
            <div className="min-w-0">
              <div className="mb-0.5 flex items-center gap-2 font-mono text-[10px] text-text-muted">
                <strong className="text-text">
                  {ui('analysis.pick', {
                    number: String(currentStep).padStart(2, '0'),
                  })}
                </strong>
                <span>
                  {currentStep === 0
                    ? ui('draft.lobby')
                    : ui('draft.round', {
                        round:
                          currentEvent?.turn.round ??
                          frame.state.history.at(-1)?.turn.round ??
                          1,
                      })}
                </span>
                <span className="ml-auto">
                  {currentStep} / {maxStep}
                </span>
              </div>
              <input
                className="block h-3.5 w-full cursor-pointer accent-accent"
                type="range"
                min="0"
                max={maxStep}
                step="1"
                value={currentStep}
                aria-label={ui('draft.replayPosition')}
                onChange={(event) => onStepChange(Number(event.target.value))}
              />
              <div
                className="flex justify-between font-mono text-[9px] text-text-muted"
                aria-hidden="true"
              >
                {[1, 2, 3, 4, 5].map((round) => (
                  <span key={round}>R{round}</span>
                ))}
              </div>
            </div>
            <div className="col-span-full inline-flex items-center justify-center gap-1.5 pt-0.5 text-[10px] text-text-muted">
              <Timer className="text-accent" size={15} />
              <span>
                {nextTurn
                  ? ui('draft.choosing', { player: nextTurn.player })
                  : ui('draft.complete')}
              </span>
            </div>
          </section>
        </section>

        <DraftTeamPanel
          side="dire"
          state={state}
          simulation={simulation}
          currentGlobalPick={nextTurn?.globalPick}
          abilities={abilities}
        />
      </div>
    </section>
  )
}
