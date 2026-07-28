import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import * as AlertDialog from '@radix-ui/react-alert-dialog'
import * as Tooltip from '@radix-ui/react-tooltip'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useTranslation } from 'react-i18next'
import {
  Bug,
  CircleCheck,
  CircleAlert,
  Download,
  FolderOpen,
  GitFork,
  Layers,
  LayoutPanelTop,
  Play,
  RefreshCw,
  RotateCcw,
  ScanSearch,
  Settings,
  Settings2,
  Sparkles,
  Upload,
} from 'lucide-react'
import { Toaster, toast } from 'sonner'
import { demoSnapshot } from './data/demoSnapshot'
import {
  clampRectToCanvas,
  cropCenter,
  DEFAULT_LAYOUT_DOCUMENT,
  MATCH_CROP_RATIO,
  parseLayoutDocument,
  scaleLayoutToCanvas,
  scaleRect,
  slotLabel,
  ULTIMATE_SLOT_ORDER,
  validateScreenshotDimensions,
  type LayoutDocument,
  type RuntimeSlot,
} from './core/layout'
import { buildProjectedLayout, quadBounds } from './core/projective-layout'
import { buildAbilityPairList, type AbilityPairEntry } from './core/pairs'
import {
  recommendAbilityCombinations,
  recommendAbilityPairs,
} from './core/combinations'
import {
  recommendBuilds,
  scoreDraftBuild,
  type BuildCandidatePools,
} from './core/recommendation'
import {
  buildRankedDraftPool,
  validateInitialDraftPool,
  type DraftStrategyId,
  type InitialDraftPool,
} from './core/draft-state'
import { createDraftStrategyMap, simulateDraft } from './core/draft-tree'
import {
  isSupportedScreenshotFile,
  SCREENSHOT_FILE_ACCEPT,
} from './core/screenshot-file'
import {
  buildAbilityTierList,
  filterTierEntries,
  getTierCategoryCounts,
  type AbilityTier,
  type TierCategory,
  type TierEntry,
} from './core/tiers'
import {
  detectRuntimeCapabilities,
  missingRuntimeCapabilities,
} from './platform/capabilities'
import { getBrowserFileAdapter } from './platform/files'
import {
  closeNativeOverlay,
  createOverlayChannel,
  isDesktopRuntime,
  listenMainWindowHidden,
  openNativeOverlay,
  overlayKindFromLocation,
  setNativeOverlayShortcut,
  writeOverlayState,
  type OverlayKind,
  type OverlayMessage,
  type OverlayRecognitionStatus,
  type OverlayState,
} from './platform/overlays'
import { appResourceUrl } from './platform/resources'
import {
  getBrowserStorage,
  readStoredJson,
  writeStoredJson,
} from './platform/storage'
import {
  DEFAULT_OVERLAY_SHORTCUT,
  isEditableEventTarget,
  isOverlayShortcutEvent,
  isOverlayShortcutKeyEvent,
  listenOverlayShortcut,
  readOverlayShortcut,
  readOverlayShortcutMode,
  writeOverlayShortcut,
  writeOverlayShortcutMode,
  type OverlayShortcutMode,
} from './platform/shortcuts'
import {
  BuildRecommendationsPage,
  BUILD_PICK_GROUPS,
} from './components/BuildRecommendationsPage'
import { DraftReplayPage } from './components/DraftReplayPage'
import { DebugCropPreview } from './components/DebugCropPreview'
import { ManualAbilityPool } from './components/ManualAbilityPool'
import { FloatingOverlay, OverlayApp } from './components/OverlayViews'
import {
  PairsPage,
  type PairSortKey,
  type SortDirection,
} from './components/PairsPage'
import { SkillIcon } from './components/SkillIcon'
import { SettingsPage, type LayoutMode } from './components/SettingsPage'
import { TierListPage } from './components/TierListPage'
import i18n, { toAppLocale } from './i18n'
import { cn } from './lib/cn'
import { TIER_TEXT_CLASSES } from './lib/tier-presentation'
import type {
  IconSignature,
  Recommendation,
  RecognizedSlot,
  Rect,
  SlotCategory,
  Snapshot,
} from './types'

const goldenLabels: Record<number, number> = { 6: -41, 50: 5342 }
type AppPage =
  'analysis' | 'build' | 'layout' | 'database' | 'pairs' | 'draft' | 'settings'

const appPages: Array<{
  id: AppPage
  labelKey:
    | 'nav.analysis'
    | 'nav.build'
    | 'nav.layout'
    | 'nav.database'
    | 'nav.pairs'
    | 'nav.draft'
  icon: typeof ScanSearch
}> = [
  { id: 'analysis', labelKey: 'nav.analysis', icon: ScanSearch },
  { id: 'build', labelKey: 'nav.build', icon: Sparkles },
  { id: 'layout', labelKey: 'nav.layout', icon: LayoutPanelTop },
  { id: 'database', labelKey: 'nav.database', icon: Layers },
  { id: 'pairs', labelKey: 'nav.pairs', icon: GitFork },
  { id: 'draft', labelKey: 'nav.draft', icon: Play },
]

const DEBUG_MATCH_CANDIDATES = 5
const RECOGNITION_TIMEOUT_MS = 30_000
const PAIR_ROW_HEIGHT = 52
const LAYOUT_MODE_STORAGE_KEY = 'omg-layout-mode-v1'

type ImageSize = Pick<LayoutDocument, 'width' | 'height'>

const DEFAULT_IMAGE_SIZE: ImageSize = {
  width: DEFAULT_LAYOUT_DOCUMENT.width,
  height: DEFAULT_LAYOUT_DOCUMENT.height,
}

function ui(key: string, options?: Record<string, unknown>): string {
  return i18n.t(key, options)
}

function categoryName(category: SlotCategory): string {
  return ui(`common.${category}`)
}

function buildScaledLayout(
  document: LayoutDocument,
  overrides: Record<number, Rect>,
  imageSize: ImageSize,
): RuntimeSlot[] {
  const sourceSlots = document.slots.map((slot, index) => ({
    ...slot,
    rect: overrides[index] ?? slot.rect,
  }))
  return scaleLayoutToCanvas(
    sourceSlots,
    document.width,
    document.height,
    imageSize.width,
    imageSize.height,
  )
}

function hasManualLayout(
  importedLayout: LayoutDocument | undefined,
  overrides: Record<number, Rect>,
): boolean {
  return importedLayout !== undefined || Object.keys(overrides).length > 0
}

function readLayoutMode(
  storage: ReturnType<typeof getBrowserStorage>,
): LayoutMode {
  return readStoredJson<unknown>(storage, LAYOUT_MODE_STORAGE_KEY, 'auto') ===
    'manual'
    ? 'manual'
    : 'auto'
}

function matchRect(slot: RuntimeSlot, imageSize: ImageSize): Rect {
  return slot.matchQuad
    ? clampRectToCanvas(
        quadBounds(slot.matchQuad),
        imageSize.width,
        imageSize.height,
      )
    : cropCenter(slot.rect)
}

function quadPointList(slot: RuntimeSlot): string | undefined {
  if (!slot.matchQuad) return undefined
  return [
    slot.matchQuad.topLeft,
    slot.matchQuad.topRight,
    slot.matchQuad.bottomRight,
    slot.matchQuad.bottomLeft,
  ]
    .map((point) => `${point.x},${point.y}`)
    .join(' ')
}

function updateSlotSelection(
  slots: RecognizedSlot[],
  index: number,
  selectedAbilityId: number | undefined,
): RecognizedSlot[] {
  let changed = false
  const next = slots.map((slot) => {
    if (slot.index !== index || slot.selectedAbilityId === selectedAbilityId)
      return slot
    changed = true
    return { ...slot, selectedAbilityId }
  })
  return changed ? next : slots
}

function collectCandidatePools(
  slots: readonly RecognizedSlot[],
  tierInfo: ReadonlyMap<number, { rank: number }>,
  abilitiesById: ReadonlyMap<number, { name: string }>,
  includeTopSuggestion = false,
): BuildCandidatePools {
  const pools: Record<keyof BuildCandidatePools, number[]> = {
    heroIds: [],
    abilityIds: [],
    ultimateIds: [],
  }
  for (const slot of slots) {
    const abilityId =
      slot.selectedAbilityId ??
      (includeTopSuggestion ? slot.candidates[0]?.abilityId : undefined)
    if (abilityId === undefined) continue
    if (slot.category === 'hero') pools.heroIds.push(abilityId)
    else if (slot.category === 'ability') pools.abilityIds.push(abilityId)
    else pools.ultimateIds.push(abilityId)
  }
  const sortByTier = (ids: number[]) =>
    [...new Set(ids)].sort((left, right) => {
      const rankDifference =
        (tierInfo.get(left)?.rank ?? Number.POSITIVE_INFINITY) -
        (tierInfo.get(right)?.rank ?? Number.POSITIVE_INFINITY)
      if (rankDifference !== 0) return rankDifference
      return (abilitiesById.get(left)?.name ?? '').localeCompare(
        abilitiesById.get(right)?.name ?? '',
      )
    })
  return {
    heroIds: sortByTier(pools.heroIds),
    abilityIds: sortByTier(pools.abilityIds),
    ultimateIds: sortByTier(pools.ultimateIds),
  }
}

function comparePairEntries(
  left: AbilityPairEntry,
  right: AbilityPairEntry,
  key: PairSortKey,
): number {
  if (key === 'abilityOne' || key === 'abilityTwo') {
    const leftAbility = key === 'abilityOne' ? left.abilityOne : left.abilityTwo
    const rightAbility =
      key === 'abilityOne' ? right.abilityOne : right.abilityTwo
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
  const [overlayRecognitionStatus, setOverlayRecognitionStatus] =
    useState<OverlayRecognitionStatus>('idle')
  const [selectedIds, setSelectedIds] = useState<number[]>([])
  const [snapshot, setSnapshot] = useState<Snapshot>(demoSnapshot)
  const [iconSignatures, setIconSignatures] = useState<IconSignature[]>([])
  const [tierCategory, setTierCategory] = useState<TierCategory>('all')
  const [tierQuery, setTierQuery] = useState('')
  const [pairQuery, setPairQuery] = useState('')
  const [excludeSameHero, setExcludeSameHero] = useState(false)
  const [pairSort, setPairSort] = useState<{
    key: PairSortKey
    direction: SortDirection
  }>({ key: 'synergy', direction: 'desc' })
  const [activePage, setActivePage] = useState<AppPage>('analysis')
  const [overlayVisibility, setOverlayVisibility] = useState<
    Record<OverlayKind, boolean>
  >({ recommendation: false, tier: false, layout: false })
  const [draftStrategy, setDraftStrategy] =
    useState<DraftStrategyId>('tier-first')
  const [replayStep, setReplayStep] = useState(0)
  const [replayPlaying, setReplayPlaying] = useState(false)
  const [debugSlotIndex, setDebugSlotIndex] = useState<number>()
  const [manualSlotIndex, setManualSlotIndex] = useState<number>()
  const [uploadedFile, setUploadedFile] = useState<File>()
  const [imageSize, setImageSize] = useState<ImageSize>(DEFAULT_IMAGE_SIZE)
  const [calibrationOpen, setCalibrationOpen] = useState(false)
  const [layoutMode, setLayoutMode] = useState<LayoutMode>(() =>
    readLayoutMode(storage),
  )
  const [overlayShortcutMode, setOverlayShortcutMode] =
    useState<OverlayShortcutMode>(() => readOverlayShortcutMode(storage))
  const [overlayShortcut, setOverlayShortcut] = useState(() =>
    readOverlayShortcut(storage),
  )
  const overlayShortcutHoldRef = useRef(false)
  const overlayShortcutOpenRef = useRef<Promise<boolean> | undefined>(undefined)
  const overlayShortcutRequestRef = useRef(0)
  const overlayRequestRef = useRef<Record<OverlayKind, number>>({
    recommendation: 0,
    tier: 0,
    layout: 0,
  })
  const overlayDesiredRef = useRef<Record<OverlayKind, boolean>>({
    recommendation: false,
    tier: false,
    layout: false,
  })
  const recommendationVisibleRef = useRef(false)
  const recognitionWorkerRef = useRef<Worker | undefined>(undefined)
  const recognitionRequestRef = useRef(0)
  const screenshotUrlRef = useRef<string | undefined>(undefined)
  const [layoutOverrides, setLayoutOverrides] = useState<Record<number, Rect>>(
    () =>
      readStoredJson(
        storage,
        'omg-layout-overrides-v1',
        {} as Record<number, Rect>,
      ),
  )
  const layoutOverridesRef = useRef(layoutOverrides)
  const [dragState, setDragState] = useState<{
    index: number
    mode: 'move' | 'resize'
    startX: number
    startY: number
    startRect: Rect
  }>()
  const overlayRef = useRef<SVGSVGElement>(null)
  const layoutFileRef = useRef<HTMLInputElement>(null)
  const pairTableRef = useRef<HTMLDivElement>(null)
  const [importedLayout, setImportedLayout] = useState<
    LayoutDocument | undefined
  >(() => {
    const saved = readStoredJson<unknown>(storage, 'omg-layout-file-v1', null)
    return parseLayoutDocument(saved) ?? undefined
  })
  const importedLayoutRef = useRef(importedLayout)

  useEffect(() => {
    fetch(appResourceUrl('/data/snapshots/latest.json'))
      .then((response) =>
        response.ok
          ? (response.json() as Promise<Snapshot>)
          : Promise.reject(new Error('no local snapshot')),
      )
      .then(setSnapshot)
      .catch(() => setError(t('errors.snapshotUnavailable')))
  }, [])

  useEffect(() => {
    fetch(appResourceUrl('/data/icon-signatures.json'))
      .then((response) =>
        response.ok
          ? (response.json() as Promise<{ signatures?: IconSignature[] }>)
          : Promise.reject(new Error('no signatures')),
      )
      .then((payload) => setIconSignatures(payload.signatures ?? []))
      .catch(() => setError(t('errors.signaturesUnavailable')))
  }, [])

  useEffect(
    () => () => {
      recognitionRequestRef.current += 1
      recognitionWorkerRef.current?.terminate()
      if (screenshotUrlRef.current)
        URL.revokeObjectURL(screenshotUrlRef.current)
    },
    [],
  )

  useEffect(() => {
    if (!isDesktopRuntime()) return
    const requested = overlayShortcut
    const requestId = ++overlayShortcutRequestRef.current
    void setNativeOverlayShortcut(requested, true).catch(
      async (shortcutError) => {
        if (overlayShortcutRequestRef.current !== requestId) return
        if (requested !== DEFAULT_OVERLAY_SHORTCUT) {
          try {
            await setNativeOverlayShortcut(DEFAULT_OVERLAY_SHORTCUT, true)
          } catch (fallbackError) {
            if (overlayShortcutRequestRef.current === requestId)
              reportShortcutError(fallbackError)
            return
          }
          if (overlayShortcutRequestRef.current !== requestId) return
          setOverlayShortcut(DEFAULT_OVERLAY_SHORTCUT)
          writeOverlayShortcut(storage, DEFAULT_OVERLAY_SHORTCUT)
        }
        reportShortcutError(shortcutError)
      },
    )
    // User-initiated changes register directly in updateOverlayShortcut.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storage])

  useEffect(() => {
    if (!isDesktopRuntime()) return
    let disposed = false
    let unlisten: (() => void) | undefined
    void listenMainWindowHidden(() => {
      for (const kind of ['recommendation', 'tier', 'layout'] as const) {
        overlayRequestRef.current[kind] += 1
        overlayDesiredRef.current[kind] = false
      }
      overlayShortcutHoldRef.current = false
      overlayShortcutOpenRef.current = undefined
      setOverlayVisibility({
        recommendation: false,
        tier: false,
        layout: false,
      })
    })
      .then((nextUnlisten) => {
        if (disposed) nextUnlisten()
        else unlisten = nextUnlisten
      })
      .catch(() => {
        // The desktop shell remains usable if this optional synchronization fails.
      })
    return () => {
      disposed = true
      unlisten?.()
    }
  }, [])

  const abilitiesById = useMemo(
    () => new Map(snapshot.abilities.map((ability) => [ability.id, ability])),
    [snapshot],
  )
  const ability = useCallback(
    (id: number) => abilitiesById.get(id),
    [abilitiesById],
  )
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
  const overlayTierInfo = useMemo(
    () =>
      new Map(
        buildAbilityTierList(snapshot, 'all').map((entry) => [
          entry.ability.id,
          entry,
        ]),
      ),
    [snapshot],
  )
  const candidatePools = useMemo<BuildCandidatePools>(() => {
    return collectCandidatePools(slots, candidateTierInfo, abilitiesById)
  }, [abilitiesById, candidateTierInfo, slots])
  const overlayCandidatePools = useMemo(
    () => collectCandidatePools(slots, candidateTierInfo, abilitiesById, true),
    [abilitiesById, candidateTierInfo, slots],
  )
  const deferredCandidatePools = useDeferredValue(candidatePools)
  const combinationCandidateIds = useMemo(
    () => [
      ...new Set([
        ...candidatePools.heroIds,
        ...candidatePools.abilityIds,
        ...candidatePools.ultimateIds,
        ...slots.flatMap((slot) =>
          slot.candidates.slice(0, 3).map((candidate) => candidate.abilityId),
        ),
      ]),
    ],
    [candidatePools, slots],
  )
  const deferredCombinationCandidateIds = useDeferredValue(
    combinationCandidateIds,
  )
  useEffect(() => {
    setSelectedIds((current) => {
      const selectedCounts: Record<keyof BuildCandidatePools, number> = {
        heroIds: 0,
        abilityIds: 0,
        ultimateIds: 0,
      }
      const next = current.filter((id) => {
        const group = BUILD_PICK_GROUPS.find((item) =>
          candidatePools[item.key].includes(id),
        )
        if (!group || selectedCounts[group.key] >= group.limit) return false
        selectedCounts[group.key] += 1
        return true
      })
      return next.length === current.length ? current : next
    })
  }, [candidatePools])
  const fixedLayout = useMemo(
    () =>
      buildScaledLayout(
        importedLayout ?? DEFAULT_LAYOUT_DOCUMENT,
        layoutOverrides,
        imageSize,
      ),
    [importedLayout, layoutOverrides, imageSize],
  )
  const layout = useMemo(
    () =>
      (layoutMode === 'auto' &&
        buildProjectedLayout(imageSize.width, imageSize.height)) ||
      fixedLayout,
    [fixedLayout, imageSize, layoutMode],
  )
  const layoutOverlaySlots = layout
  const overlayTopTenIds = useMemo(
    () =>
      new Set(
        [
          ...new Set([
            ...overlayCandidatePools.heroIds,
            ...overlayCandidatePools.abilityIds,
            ...overlayCandidatePools.ultimateIds,
          ]),
        ]
          .map((id) => overlayTierInfo.get(id))
          .filter((entry) => entry !== undefined)
          .sort((left, right) => left.rank - right.rank)
          .slice(0, 10)
          .map((entry) => entry.ability.id),
      ),
    [overlayCandidatePools, overlayTierInfo],
  )
  const layoutOverlayTiers = useMemo(
    () =>
      layoutOverlaySlots.map((_, index) => {
        const slot = slots[index]
        const abilityId =
          slot?.selectedAbilityId ?? slot?.candidates[0]?.abilityId
        return abilityId === undefined || !overlayTopTenIds.has(abilityId)
          ? null
          : (overlayTierInfo.get(abilityId)?.tier ?? null)
      }),
    [layoutOverlaySlots, overlayTierInfo, overlayTopTenIds, slots],
  )
  const recommendations = useMemo(
    () =>
      recommendBuilds(deferredCandidatePools, deferredSelectedIds, snapshot),
    [deferredCandidatePools, deferredSelectedIds, snapshot],
  )
  const combinationRecommendations = useMemo(
    () =>
      recommendAbilityCombinations(
        deferredCombinationCandidateIds,
        deferredSelectedIds,
        snapshot,
      ),
    [deferredCombinationCandidateIds, deferredSelectedIds, snapshot],
  )
  const overlayPairRecommendations = useMemo(
    () =>
      recommendAbilityPairs(
        deferredCombinationCandidateIds,
        deferredSelectedIds,
        snapshot,
      ),
    [deferredCombinationCandidateIds, deferredSelectedIds, snapshot],
  )
  const overlayState = useMemo<OverlayState>(
    () => ({
      recognitionStatus: overlayRecognitionStatus,
      candidatePools: overlayCandidatePools,
      combinationRecommendations,
      pairRecommendations: overlayPairRecommendations,
      locale,
      recommendations,
      selectedIds,
      tierCategory,
      tierQuery,
      layout: layoutOverlaySlots,
      layoutTiers: layoutOverlayTiers,
      layoutViewport: imageSize,
    }),
    [
      overlayRecognitionStatus,
      overlayCandidatePools,
      combinationRecommendations,
      overlayPairRecommendations,
      locale,
      recommendations,
      selectedIds,
      tierCategory,
      tierQuery,
      imageSize,
      layoutOverlaySlots,
      layoutOverlayTiers,
    ],
  )

  useEffect(() => {
    const channel = createOverlayChannel()
    if (!channel) return
    const publish = (kind: OverlayKind) => {
      if (!overlayVisibility[kind]) return
      writeOverlayState(kind, overlayState)
      channel.postMessage({
        type: 'overlay-state',
        kind,
        state: overlayState,
      } satisfies OverlayMessage)
    }
    channel.onmessage = (event: MessageEvent<OverlayMessage>) => {
      const message = event.data
      if (message?.type === 'overlay-ready') publish(message.kind)
    }
    publish('recommendation')
    publish('tier')
    publish('layout')
    return () => channel.close()
  }, [overlayState, overlayVisibility])
  const rankedDraftPoolInfo = useMemo(() => {
    const pool = buildRankedDraftPool(snapshot)
    const errors = validateInitialDraftPool(pool, snapshot.abilities)
    return {
      pool: errors.length === 0 ? pool : undefined,
      sourceKey: 'draft.sourceRanked' as const,
      errorKey:
        errors.length > 0 ? ('draft.incompletePool' as const) : undefined,
      errorValues: undefined,
    }
  }, [snapshot])
  const draftPoolInfo = useMemo(() => {
    if (activePage !== 'draft') return rankedDraftPoolInfo
    const confirmedPool: InitialDraftPool = {
      heroIds: deferredSlots
        .filter(
          (slot) =>
            slot.category === 'hero' && slot.selectedAbilityId !== undefined,
        )
        .map((slot) => slot.selectedAbilityId!),
      abilityIds: deferredSlots
        .filter(
          (slot) =>
            slot.category === 'ability' && slot.selectedAbilityId !== undefined,
        )
        .map((slot) => slot.selectedAbilityId!),
      ultimateIds: deferredSlots
        .filter(
          (slot) =>
            slot.category === 'ultimate' &&
            slot.selectedAbilityId !== undefined,
        )
        .map((slot) => slot.selectedAbilityId!),
    }
    const confirmedErrors = validateInitialDraftPool(
      confirmedPool,
      snapshot.abilities,
    )
    const errors =
      deferredSlots.length !== 60
        ? ['incomplete-slots']
        : !deferredSlots.every((slot) => slot.selectedAbilityId !== undefined)
          ? ['incomplete-candidates']
          : confirmedErrors
    if (errors.length === 0) {
      return {
        pool: confirmedPool,
        sourceKey: 'draft.sourceScreenshot' as const,
        errorKey: undefined,
        errorValues: undefined,
      }
    }
    return {
      pool: undefined,
      sourceKey: 'draft.sourceScreenshot' as const,
      errorKey:
        errors[0] === 'incomplete-slots'
          ? ('draft.incompleteSlots' as const)
          : errors[0] === 'incomplete-candidates'
            ? ('draft.incompleteCandidates' as const)
            : ('draft.incompletePool' as const),
      errorValues:
        errors[0] === 'incomplete-slots'
          ? { current: deferredSlots.length }
          : undefined,
    }
  }, [activePage, deferredSlots, rankedDraftPoolInfo, snapshot.abilities])
  const draftSimulation = useMemo(() => {
    if (activePage !== 'draft' || !draftPoolInfo.pool) return undefined
    try {
      return simulateDraft(
        draftPoolInfo.pool,
        snapshot,
        createDraftStrategyMap(draftStrategy),
      )
    } catch {
      return undefined
    }
  }, [activePage, draftPoolInfo.pool, draftStrategy, snapshot])
  const draftFinalScores = useMemo(() => {
    if (!draftSimulation)
      return [] as Array<{ player: number; recommendation?: Recommendation }>
    return Array.from({ length: 10 }, (_, index) => {
      const player = index + 1
      return {
        player,
        recommendation: scoreDraftBuild(
          draftSimulation.finalState.picksByPlayer[player],
          snapshot,
        ),
      }
    })
  }, [draftSimulation, snapshot])
  const tierEntries = useMemo(
    () =>
      activePage === 'database'
        ? buildAbilityTierList(snapshot, tierCategory)
        : [],
    [activePage, snapshot, tierCategory],
  )
  const tierCategoryCounts = useMemo<Record<TierCategory, number>>(() => {
    return activePage === 'database'
      ? getTierCategoryCounts(snapshot)
      : { all: 0, ultimate: 0, hero: 0, ability: 0 }
  }, [activePage, snapshot])
  const filteredTierEntries = useMemo(() => {
    return filterTierEntries(tierEntries, tierQuery)
  }, [tierEntries, tierQuery])
  const tierGroups = useMemo(() => {
    const groups: Record<AbilityTier, TierEntry[]> = {
      S: [],
      A: [],
      B: [],
      C: [],
      D: [],
      E: [],
      F: [],
    }
    for (const entry of filteredTierEntries) groups[entry.tier].push(entry)
    return groups
  }, [filteredTierEntries])
  const pairEntries = useMemo(
    () =>
      activePage === 'pairs'
        ? buildAbilityPairList(snapshot, { excludeSameHero })
        : [],
    [activePage, excludeSameHero, snapshot],
  )
  const filteredPairEntries = useMemo(() => {
    const query = pairQuery.trim().toLowerCase()
    const matchingEntries = query
      ? pairEntries.filter((entry) =>
          `${entry.abilityOne.name} ${entry.abilityOne.shortName} ${entry.abilityTwo.name} ${entry.abilityTwo.shortName}`
            .toLowerCase()
            .includes(query),
        )
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
  const pairBottomSpacer =
    virtualPairRows.length === 0
      ? 0
      : Math.max(
          0,
          pairVirtualizer.getTotalSize() -
            (virtualPairRows[virtualPairRows.length - 1]?.end ?? 0),
        )

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

  async function handleUpload(file: File, mode: LayoutMode = layoutMode) {
    if (!isSupportedScreenshotFile(file)) {
      setError(t('errors.unsupportedScreenshot'))
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
    setOverlayRecognitionStatus('recognizing')
    const missingCapabilities = missingRuntimeCapabilities(runtimeCapabilities)
    if (missingCapabilities.length > 0) {
      setError(
        t('errors.missingCapabilities', {
          capabilities: missingCapabilities.join(', '),
        }),
      )
      setOverlayRecognitionStatus('error')
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
      const dimensionError = validateScreenshotDimensions(
        decoded.width,
        decoded.height,
      )
      if (dimensionError) {
        decoded.close()
        bitmap = undefined
        setError(dimensionError)
        setOverlayRecognitionStatus('error')
        setLoading(false)
        return
      }
      const nextImageSize = { width: decoded.width, height: decoded.height }
      const manualLayout = buildScaledLayout(
        importedLayout ?? DEFAULT_LAYOUT_DOCUMENT,
        layoutOverrides,
        nextImageSize,
      )
      setImageSize(nextImageSize)
      if (screenshotUrlRef.current)
        URL.revokeObjectURL(screenshotUrlRef.current)
      const nextScreenshotUrl = URL.createObjectURL(file)
      screenshotUrlRef.current = nextScreenshotUrl
      setScreenshotUrl(nextScreenshotUrl)
      worker = new Worker(
        new URL('./workers/recognizer.worker.ts', import.meta.url),
        { type: 'module' },
      )
      recognitionWorkerRef.current = worker
      const finishWorker = () => {
        if (timeoutId !== undefined) window.clearTimeout(timeoutId)
        if (recognitionWorkerRef.current === worker)
          recognitionWorkerRef.current = undefined
        worker?.terminate()
      }
      worker.onmessage = (event: MessageEvent<{ slots: RecognizedSlot[] }>) => {
        if (requestId !== recognitionRequestRef.current) {
          finishWorker()
          return
        }
        setSlots(event.data.slots)
        setOverlayRecognitionStatus('ready')
        setDebugSlotIndex(0)
        setLoading(false)
        finishWorker()
      }
      worker.onerror = () => {
        if (requestId !== recognitionRequestRef.current) {
          finishWorker()
          return
        }
        setError(t('errors.recognitionFailed'))
        setOverlayRecognitionStatus('error')
        setLoading(false)
        finishWorker()
      }
      worker.postMessage(
        {
          image: decoded,
          abilities: snapshot.abilities,
          layout: mode === 'manual' ? manualLayout : undefined,
          signatures: iconSignatures,
        },
        [decoded],
      )
      bitmap = undefined
      timeoutId = window.setTimeout(() => {
        if (requestId !== recognitionRequestRef.current) return
        setError(t('errors.recognitionTimedOut'))
        setOverlayRecognitionStatus('error')
        setLoading(false)
        finishWorker()
      }, RECOGNITION_TIMEOUT_MS)
    } catch {
      bitmap?.close()
      if (timeoutId !== undefined) window.clearTimeout(timeoutId)
      if (recognitionWorkerRef.current === worker)
        recognitionWorkerRef.current = undefined
      worker?.terminate()
      if (requestId !== recognitionRequestRef.current) return
      setError(t('errors.unreadableScreenshot'))
      setOverlayRecognitionStatus('error')
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
    importedLayoutRef.current = undefined
    toast.success(t('layout.restored'))
  }

  function saveLayout() {
    const payload: LayoutDocument = {
      version: 1,
      width: imageSize.width,
      height: imageSize.height,
      slots: layout.map(({ category, rect }) => ({ category, rect })),
    }
    fileAdapter.downloadText(
      `omg-layout-${imageSize.width}x${imageSize.height}.json`,
      JSON.stringify(payload, null, 2),
      'application/json',
    )
    toast.success(t('layout.exportStarted'))
  }

  async function loadLayout(file: File) {
    try {
      const parsed = parseLayoutDocument(
        JSON.parse(await fileAdapter.readText(file)),
      )
      if (!parsed) throw new Error('invalid layout')
      setImportedLayout(parsed)
      importedLayoutRef.current = parsed
      setLayoutOverrides({})
      layoutOverridesRef.current = {}
      writeStoredJson(storage, 'omg-layout-file-v1', parsed)
      storage.removeItem('omg-layout-overrides-v1')
      setError(undefined)
      toast.success(t('layout.loaded'))
    } catch {
      setError(t('errors.invalidLayout'))
      toast.error(t('layout.invalidFile'))
    }
  }

  function imagePoint(
    event: ReactPointerEvent<
      SVGSVGElement | SVGRectElement | SVGPolygonElement | SVGCircleElement
    >,
  ) {
    const bounds = overlayRef.current?.getBoundingClientRect()
    if (!bounds) return { x: 0, y: 0 }
    return {
      x: ((event.clientX - bounds.left) / bounds.width) * imageSize.width,
      y: ((event.clientY - bounds.top) / bounds.height) * imageSize.height,
    }
  }

  function startDrag(
    event: ReactPointerEvent<
      SVGRectElement | SVGPolygonElement | SVGCircleElement
    >,
    index: number,
    mode: 'move' | 'resize',
  ) {
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    if (layoutMode !== 'manual') {
      setLayoutMode('manual')
      writeStoredJson(storage, LAYOUT_MODE_STORAGE_KEY, 'manual')
    }
    if (
      !hasManualLayout(importedLayoutRef.current, layoutOverridesRef.current)
    ) {
      const projectedBaseline: LayoutDocument = {
        version: 1,
        width: imageSize.width,
        height: imageSize.height,
        slots: layout.map(({ category, rect }) => ({ category, rect })),
      }
      importedLayoutRef.current = projectedBaseline
      setImportedLayout(projectedBaseline)
      writeStoredJson(storage, 'omg-layout-file-v1', projectedBaseline)
    }
    const point = imagePoint(event)
    setDragState({
      index,
      mode,
      startX: point.x,
      startY: point.y,
      startRect: layout[index].rect,
    })
    setDebugSlotIndex(index)
  }

  function dragLayout(event: ReactPointerEvent<SVGSVGElement>) {
    if (!dragState) return
    const point = imagePoint(event)
    const deltaX = point.x - dragState.startX
    const deltaY = point.y - dragState.startY
    const start = dragState.startRect
    const rect: Rect =
      dragState.mode === 'move'
        ? {
            ...start,
            x: Math.round(start.x + deltaX),
            y: Math.round(start.y + deltaY),
          }
        : (() => {
            const startCrop = cropCenter(start)
            const cropWidth = Math.max(24, Math.round(startCrop.width + deltaX))
            const cropHeight = Math.max(
              24,
              Math.round(startCrop.height + deltaY),
            )
            const width = Math.max(32, Math.round(cropWidth / MATCH_CROP_RATIO))
            const height = Math.max(
              32,
              Math.round(cropHeight / MATCH_CROP_RATIO),
            )
            return {
              x: Math.round(startCrop.x - (width * (1 - MATCH_CROP_RATIO)) / 2),
              y: Math.round(
                startCrop.y - (height * (1 - MATCH_CROP_RATIO)) / 2,
              ),
              width,
              height,
            }
          })()
    const currentRect = clampRectToCanvas(
      rect,
      imageSize.width,
      imageSize.height,
    )
    const sourceLayout = importedLayoutRef.current ?? DEFAULT_LAYOUT_DOCUMENT
    const next = {
      ...layoutOverridesRef.current,
      [dragState.index]: scaleRect(
        currentRect,
        imageSize.width,
        imageSize.height,
        sourceLayout.width,
        sourceLayout.height,
      ),
    }
    layoutOverridesRef.current = next
    setLayoutOverrides(next)
  }

  function finishDrag() {
    writeStoredJson(
      storage,
      'omg-layout-overrides-v1',
      layoutOverridesRef.current,
    )
    setDragState(undefined)
  }

  function updateLayoutMode(mode: LayoutMode) {
    setLayoutMode(mode)
    writeStoredJson(storage, LAYOUT_MODE_STORAGE_KEY, mode)
    if (uploadedFile) void handleUpload(uploadedFile, mode)
  }

  function updateOverlayShortcutMode(mode: OverlayShortcutMode) {
    setOverlayShortcutMode(mode)
    writeOverlayShortcutMode(storage, mode)
  }

  function reportShortcutError(shortcutError: unknown) {
    const message =
      shortcutError instanceof Error
        ? shortcutError.message
        : t('errors.overlayShortcutUnavailable')
    toast.error(message)
  }

  async function updateOverlayShortcut(shortcut: string) {
    const normalized = shortcut.trim()
    if (!normalized || normalized === overlayShortcut) return
    const requestId = ++overlayShortcutRequestRef.current
    try {
      if (isDesktopRuntime()) await setNativeOverlayShortcut(normalized, true)
      if (overlayShortcutRequestRef.current !== requestId) return
      setOverlayShortcut(normalized)
      writeOverlayShortcut(storage, normalized)
    } catch (shortcutError) {
      if (overlayShortcutRequestRef.current !== requestId) return
      reportShortcutError(shortcutError)
    }
  }

  function updateSlot(index: number, value: string) {
    const normalized = value.trim()
    const selectedAbilityId = /^-?\d+$/.test(normalized)
      ? Number(normalized)
      : [...abilitiesById.values()].find(
          (item) => item.name.toLowerCase() === normalized.toLowerCase(),
        )?.id
    setSlots((current) =>
      updateSlotSelection(current, index, selectedAbilityId),
    )
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

  const handleManualOpenChange = useCallback(
    (slotIndex: number, open: boolean) => {
      setManualSlotIndex(open ? slotIndex : undefined)
    },
    [],
  )

  const handleManualSelect = useCallback(
    (slotIndex: number, abilityId: number) => {
      setSlots((current) => updateSlotSelection(current, slotIndex, abilityId))
      setManualSlotIndex(undefined)
    },
    [],
  )

  function toggleSelected(id: number) {
    const group = BUILD_PICK_GROUPS.find((item) =>
      candidatePools[item.key].includes(id),
    )
    if (!group) return
    setSelectedIds((current) => {
      if (current.includes(id)) return current.filter((item) => item !== id)
      const selectedInGroup = current.filter((item) =>
        candidatePools[group.key].includes(item),
      )
      return selectedInGroup.length < group.limit ? [...current, id] : current
    })
  }

  function sortPairEntries(key: PairSortKey) {
    setPairSort((current) => {
      if (current.key === key)
        return { key, direction: current.direction === 'asc' ? 'desc' : 'asc' }
      const direction: SortDirection =
        key === 'abilityOne' || key === 'abilityTwo' ? 'asc' : 'desc'
      return { key, direction }
    })
  }

  const debugSlot = useMemo(() => {
    if (debugSlotIndex === undefined) return undefined
    const recognized = slots.find((slot) => slot.index === debugSlotIndex)
    const currentLayout = layout[debugSlotIndex]
    if (!recognized || !currentLayout) return undefined
    return {
      ...recognized,
      rect: currentLayout.rect,
      crop: matchRect(currentLayout, imageSize),
      matchQuad: currentLayout.matchQuad,
    }
  }, [debugSlotIndex, imageSize, layout, slots])
  const expectedAbilityId = debugSlot
    ? goldenLabels[debugSlot.index]
    : undefined
  const expectedAbility =
    expectedAbilityId === undefined ? undefined : ability(expectedAbilityId)
  const expectedRank =
    debugSlot && expectedAbilityId !== undefined
      ? debugSlot.candidates.findIndex(
          (candidate) => candidate.abilityId === expectedAbilityId,
        )
      : -1
  const analysisSlots = useMemo(() => {
    const heroes = slots.filter((slot) => slot.category === 'hero')
    const abilities = slots.filter((slot) => slot.category === 'ability')
    const ultimates = slots.filter((slot) => slot.category === 'ultimate')
    const orderedUltimates = ULTIMATE_SLOT_ORDER.map(
      (position) => ultimates[position],
    ).filter((slot): slot is RecognizedSlot => slot !== undefined)
    const rowCount = Math.max(
      heroes.length,
      Math.ceil(abilities.length / 3),
      ultimates.length,
    )

    return Array.from({ length: rowCount }, (_, row) => [
      heroes[row],
      abilities[row * 3],
      abilities[row * 3 + 1],
      abilities[row * 3 + 2],
      orderedUltimates[row],
    ])
      .flat()
      .filter((slot): slot is RecognizedSlot => slot !== undefined)
  }, [slots])

  function updateReplayStep(step: number) {
    const maxStep = draftSimulation?.frames.at(-1)?.step ?? 0
    const nextStep = Math.max(0, Math.min(maxStep, Math.round(step)))
    setReplayStep(nextStep)
    if (nextStep >= maxStep) setReplayPlaying(false)
  }

  async function setOverlayOpen(kind: OverlayKind, open: boolean) {
    const requestId = ++overlayRequestRef.current[kind]
    overlayDesiredRef.current[kind] = open
    try {
      let opened = open
      if (isDesktopRuntime()) {
        if (open) {
          writeOverlayState(kind, overlayState)
          opened = await openNativeOverlay(
            kind,
            kind === 'layout' || kind === 'recommendation'
              ? imageSize
              : undefined,
          )
        } else await closeNativeOverlay(kind)
      }
      if (overlayRequestRef.current[kind] !== requestId) {
        if (opened && !overlayDesiredRef.current[kind] && isDesktopRuntime())
          void closeNativeOverlay(kind).catch(() => undefined)
        return false
      }
      if (open && !opened) {
        overlayDesiredRef.current[kind] = false
        return false
      }
      setOverlayVisibility((current) =>
        current[kind] === open ? current : { ...current, [kind]: open },
      )
      return true
    } catch (overlayError) {
      if (overlayRequestRef.current[kind] !== requestId) return false
      overlayDesiredRef.current[kind] = !open
      const message =
        overlayError instanceof Error
          ? overlayError.message
          : t('errors.overlayOpen')
      toast.error(message)
      return false
    }
  }

  async function toggleOverlay(kind: OverlayKind) {
    return setOverlayOpen(kind, !overlayDesiredRef.current[kind])
  }

  function releaseHeldRecommendationOverlay() {
    if (!overlayShortcutHoldRef.current) return
    overlayShortcutHoldRef.current = false
    const pendingOpen = overlayShortcutOpenRef.current
    if (pendingOpen) {
      void pendingOpen.then((opened) => {
        if (opened && !overlayShortcutHoldRef.current)
          void setOverlayOpen('recommendation', false)
      })
      return
    }
    void setOverlayOpen('recommendation', false)
  }

  function trackHeldRecommendationOpen(opening: Promise<boolean>) {
    overlayShortcutOpenRef.current = opening
    void opening.then(() => {
      if (overlayShortcutOpenRef.current === opening)
        overlayShortcutOpenRef.current = undefined
    })
  }

  useEffect(() => {
    recommendationVisibleRef.current = overlayVisibility.recommendation
  }, [overlayVisibility.recommendation])

  useEffect(() => {
    if (overlayShortcutMode !== 'hold') releaseHeldRecommendationOverlay()

    const desktopRuntime = isDesktopRuntime()

    const handleShortcutState = (state: 'pressed' | 'released') => {
      if (state === 'released') {
        if (overlayShortcutMode !== 'hold') return
        if (!overlayShortcutHoldRef.current) return
        releaseHeldRecommendationOverlay()
        return
      }

      if (overlayShortcutMode === 'hold') {
        if (recommendationVisibleRef.current) return
        if (overlayShortcutHoldRef.current) return
        if (overlayShortcutOpenRef.current) {
          overlayShortcutHoldRef.current = true
          return
        }
        overlayShortcutHoldRef.current = true
        trackHeldRecommendationOpen(setOverlayOpen('recommendation', true))
        return
      }
      void setOverlayOpen('recommendation', !recommendationVisibleRef.current)
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        !isOverlayShortcutEvent(event, overlayShortcut) ||
        event.repeat ||
        event.defaultPrevented ||
        isEditableEventTarget(event.target)
      )
        return
      event.preventDefault()
      handleShortcutState('pressed')
    }

    const handleKeyUp = (event: KeyboardEvent) => {
      if (
        overlayShortcutMode !== 'hold' ||
        !overlayShortcutHoldRef.current ||
        !isOverlayShortcutKeyEvent(event, overlayShortcut)
      )
        return
      event.preventDefault()
      handleShortcutState('released')
    }

    let unlistenDesktopShortcut: (() => void) | undefined
    let effectActive = true
    const handleFocusLoss = () => {
      if (overlayShortcutMode === 'hold') releaseHeldRecommendationOverlay()
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') handleFocusLoss()
    }

    if (desktopRuntime) {
      void listenOverlayShortcut(handleShortcutState)
        .then((unlisten) => {
          if (effectActive) unlistenDesktopShortcut = unlisten
          else unlisten()
        })
        .catch(() => undefined)
    } else {
      window.addEventListener('keydown', handleKeyDown)
      window.addEventListener('keyup', handleKeyUp)
      window.addEventListener('blur', handleFocusLoss)
      document.addEventListener('visibilitychange', handleVisibilityChange)
    }
    return () => {
      effectActive = false
      unlistenDesktopShortcut?.()
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
      window.removeEventListener('blur', handleFocusLoss)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [overlayShortcut, overlayShortcutMode])

  useEffect(
    () => () => {
      releaseHeldRecommendationOverlay()
    },
    [],
  )

  return (
    <Tooltip.Provider delayDuration={250} skipDelayDuration={150}>
      <main
        className="mx-auto flex min-h-screen w-full max-w-full flex-col px-6 pb-6 pt-4 text-text"
        data-testid="app-shell"
      >
        {activePage !== 'settings' && (
          <header className="border-b border-border pb-3">
            <div className="flex w-full items-center justify-between gap-8">
              <div className="flex min-w-0 items-center gap-3">
                <h1 className="m-0 text-[22px] font-semibold text-text">
                  <a
                    className="rounded-sm transition-colors hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                    href="https://github.com/KevinH-Tang/OMG-Draft-Seer"
                    rel="noreferrer"
                    target="_blank"
                  >
                    OMG Draft Seer
                  </a>
                </h1>
                <Tooltip.Root>
                  <Tooltip.Trigger asChild>
                    <button
                      className="grid size-8 shrink-0 place-items-center rounded text-text-muted transition-colors hover:bg-surface-hover hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                      type="button"
                      aria-label={t('settings.title')}
                      data-testid="open-settings"
                      onClick={() => setActivePage('settings')}
                    >
                      <Settings aria-hidden="true" size={15} />
                    </button>
                  </Tooltip.Trigger>
                  <Tooltip.Portal>
                    <Tooltip.Content
                      className="z-50 rounded-sm border border-border bg-surface px-2 py-1.5 text-[11px] text-text shadow-panel"
                      side="bottom"
                      sideOffset={7}
                    >
                      {t('settings.title')}
                    </Tooltip.Content>
                  </Tooltip.Portal>
                </Tooltip.Root>
              </div>
              <nav
                className="flex w-fit shrink-0 gap-1 rounded-md border border-border bg-surface-raised p-1"
                aria-label={t('app.mainPages')}
              >
                {appPages.map((page) => {
                  const Icon = page.icon
                  const selected = activePage === page.id
                  return (
                    <Tooltip.Root key={page.id}>
                      <Tooltip.Trigger asChild>
                        <button
                          type="button"
                          className={cn(
                            'grid size-8 place-items-center rounded-sm text-text-muted transition-colors hover:bg-surface-hover hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
                            selected &&
                              'bg-surface-hover text-text shadow-[0_1px_2px_rgb(0_0_0_/_0.35)] hover:bg-surface-hover hover:text-text',
                          )}
                          aria-current={selected ? 'page' : undefined}
                          aria-label={t(page.labelKey)}
                          data-testid={`nav-${page.id}`}
                          onClick={() => setActivePage(page.id)}
                        >
                          <Icon aria-hidden="true" size={15} />
                        </button>
                      </Tooltip.Trigger>
                      <Tooltip.Portal>
                        <Tooltip.Content
                          className="z-50 rounded-sm border border-border bg-surface px-2 py-1.5 text-[11px] text-text shadow-panel"
                          side="bottom"
                          sideOffset={7}
                        >
                          {t(page.labelKey)}
                        </Tooltip.Content>
                      </Tooltip.Portal>
                    </Tooltip.Root>
                  )
                })}
              </nav>
            </div>
          </header>
        )}

        {(activePage === 'analysis' || activePage === 'layout') && (
          <section
            className={cn(
              'grid gap-5 pt-5',
              activePage === 'layout' &&
                'xl:grid-cols-[minmax(0,1fr)_520px] xl:items-start',
            )}
          >
            <div className="min-w-0">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="eyebrow">{t('analysis.screenshotStep')}</p>
                </div>
              </div>
              {activePage === 'layout' && (
                <div className="mt-5 border-t border-border-subtle pt-[18px]">
                  <p className="eyebrow">{t('layout.step')}</p>
                  <h2>{t('layout.title')}</h2>
                </div>
              )}
              <input
                ref={inputRef}
                className="sr-only"
                data-testid="screenshot-input"
                type="file"
                accept={SCREENSHOT_FILE_ACCEPT}
                onChange={(event) =>
                  event.target.files?.[0] && handleUpload(event.target.files[0])
                }
              />
              {!screenshotUrl ? (
                activePage === 'analysis' ? (
                  <button
                    className="mt-[18px] grid min-h-[245px] w-full place-content-center place-items-center gap-2 rounded-md border border-dashed border-border-strong bg-surface text-center text-text-muted transition-colors hover:border-accent hover:bg-surface-raised"
                    onClick={() => inputRef.current?.click()}
                  >
                    <Upload size={25} />
                    <span>{t('analysis.uploadScreenshot')}</span>
                    <small>{t('analysis.uploadHint')}</small>
                  </button>
                ) : (
                  <div className="mt-[18px] grid min-h-[245px] place-content-center gap-2 rounded-md border border-dashed border-border-strong bg-surface px-5 text-center text-text-muted">
                    <LayoutPanelTop size={24} />
                    <p className="m-0 max-w-[290px] text-[13px] leading-5">
                      {t('layout.empty')}
                    </p>
                  </div>
                )
              ) : (
                <div className="mt-[18px] grid items-start gap-2 min-[600px]:grid-cols-[minmax(0,1fr)_auto]">
                  <div
                    className="relative min-w-0 overflow-hidden rounded-sm border border-border bg-canvas"
                    data-testid="screenshot-frame"
                  >
                    <img
                      className="block h-auto w-full"
                      src={screenshotUrl}
                      alt={t('analysis.uploadedScreenshotAlt')}
                    />
                    <svg
                      ref={overlayRef}
                      className={cn(
                        'layout-overlay',
                        activePage === 'layout' &&
                          calibrationOpen &&
                          'calibrating',
                        activePage !== 'layout' && 'pointer-events-none',
                      )}
                      viewBox={`0 0 ${imageSize.width} ${imageSize.height}`}
                      aria-label={t('layout.calibration')}
                      onPointerMove={dragLayout}
                      onPointerUp={finishDrag}
                      onPointerCancel={finishDrag}
                    >
                      {layout.map((slot, index) => {
                        const matchCrop = matchRect(slot, imageSize)
                        const matchPoints = quadPointList(slot)
                        return (
                          <g
                            key={index}
                            onClick={() => {
                              if (activePage === 'layout') {
                                setDebugSlotIndex(index)
                              }
                            }}
                            className={`${slot.category} ${debugSlotIndex === index ? 'active' : ''}`}
                          >
                            {matchPoints ? (
                              <polygon
                                className="match-frame"
                                points={matchPoints}
                                onPointerDown={(event) =>
                                  activePage === 'layout' &&
                                  calibrationOpen &&
                                  startDrag(event, index, 'move')
                                }
                              />
                            ) : (
                              <rect
                                className="match-frame"
                                x={matchCrop.x}
                                y={matchCrop.y}
                                width={matchCrop.width}
                                height={matchCrop.height}
                                onPointerDown={(event) =>
                                  activePage === 'layout' &&
                                  calibrationOpen &&
                                  startDrag(event, index, 'move')
                                }
                              />
                            )}
                            <text x={matchCrop.x + 5} y={matchCrop.y + 15}>
                              {slotLabel(index)}
                            </text>
                            {activePage === 'layout' && calibrationOpen && (
                              <circle
                                className="resize-handle"
                                cx={matchCrop.x + matchCrop.width}
                                cy={matchCrop.y + matchCrop.height}
                                r="11"
                                onPointerDown={(event) =>
                                  startDrag(event, index, 'resize')
                                }
                              />
                            )}
                          </g>
                        )
                      })}
                    </svg>
                  </div>
                  <div className="grid shrink-0 content-start gap-2 min-[600px]:justify-items-end">
                    <Tooltip.Root>
                      <Tooltip.Trigger asChild>
                        <button
                          className="grid size-8 place-items-center self-start rounded-sm border border-border-strong bg-surface-raised text-text hover:border-accent hover:bg-accent-soft min-[600px]:justify-self-end"
                          type="button"
                          title={t('analysis.replaceScreenshot')}
                          aria-label={t('analysis.replaceScreenshot')}
                          onClick={() => inputRef.current?.click()}
                        >
                          <RefreshCw size={17} />
                        </button>
                      </Tooltip.Trigger>
                      <Tooltip.Portal>
                        <Tooltip.Content
                          className="z-50 rounded-sm border border-border bg-surface px-2 py-1.5 text-[11px] text-text shadow-panel"
                          side="right"
                          sideOffset={7}
                        >
                          {t('analysis.replaceScreenshot')}
                          <Tooltip.Arrow
                            className="fill-surface"
                            width={12}
                            height={6}
                          />
                        </Tooltip.Content>
                      </Tooltip.Portal>
                    </Tooltip.Root>
                    {activePage === 'analysis' && slots.length > 0 && (
                      <Tooltip.Root>
                        <Tooltip.Trigger asChild>
                          <button
                            className="grid size-8 place-items-center self-start rounded-sm border border-border-strong bg-surface-raised text-text hover:border-accent hover:bg-accent-soft min-[600px]:justify-self-end"
                            data-testid="accept-suggestions"
                            type="button"
                            title={t('analysis.confirm')}
                            aria-label={t('analysis.confirm')}
                            onClick={acceptSuggestions}
                          >
                            <CircleCheck size={17} />
                          </button>
                        </Tooltip.Trigger>
                        <Tooltip.Portal>
                          <Tooltip.Content
                            className="z-50 rounded-sm border border-border bg-surface px-2 py-1.5 text-[11px] text-text shadow-panel"
                            side="right"
                            sideOffset={7}
                          >
                            {t('analysis.confirm')}
                            <Tooltip.Arrow
                              className="fill-surface"
                              width={12}
                              height={6}
                            />
                          </Tooltip.Content>
                        </Tooltip.Portal>
                      </Tooltip.Root>
                    )}
                  </div>
                </div>
              )}
              {activePage === 'layout' && screenshotUrl && (
                <section className="mt-3 border border-border bg-surface">
                  <div className="flex items-center justify-between gap-3 px-2.5 py-2 text-xs text-text">
                    <span className="inline-flex items-center gap-1.5">
                      <Settings2 size={16} /> {t('layout.calibration')}
                    </span>
                    <Tooltip.Root>
                      <Tooltip.Trigger asChild>
                        <button
                          className="grid size-8 place-items-center rounded-sm border border-border-strong bg-surface-raised text-text transition-colors hover:border-accent hover:bg-accent-soft"
                          title={t('layout.toggleCalibration')}
                          aria-label={t('layout.toggleCalibration')}
                          onClick={() =>
                            setCalibrationOpen((current) => !current)
                          }
                        >
                          <Settings2 size={16} />
                        </button>
                      </Tooltip.Trigger>
                      <Tooltip.Portal>
                        <Tooltip.Content
                          className="z-50 rounded-sm border border-border bg-surface px-2 py-1.5 text-[11px] text-text shadow-panel"
                          side="bottom"
                          sideOffset={7}
                        >
                          {t('layout.toggleCalibration')}
                          <Tooltip.Arrow
                            className="fill-surface"
                            width={12}
                            height={6}
                          />
                        </Tooltip.Content>
                      </Tooltip.Portal>
                    </Tooltip.Root>
                  </div>
                  {calibrationOpen && (
                    <>
                      <p className="m-0 px-2.5 pb-2.5 text-xs text-text-muted">
                        {t('layout.instructions')}
                      </p>
                      <input
                        ref={layoutFileRef}
                        className="sr-only"
                        type="file"
                        accept="application/json"
                        onChange={(event) =>
                          event.target.files?.[0] &&
                          loadLayout(event.target.files[0])
                        }
                      />
                      <div className="flex flex-wrap justify-end gap-2 px-2.5 pb-2.5">
                        <button
                          className="inline-flex items-center gap-1 rounded-sm border border-border-strong bg-surface-raised px-2 py-1.5 text-xs text-text hover:border-accent hover:bg-accent-soft"
                          onClick={() => layoutFileRef.current?.click()}
                        >
                          <FolderOpen size={15} /> {t('layout.load')}
                        </button>
                        <button
                          className="inline-flex items-center gap-1 rounded-sm border border-border-strong bg-surface-raised px-2 py-1.5 text-xs text-text hover:border-accent hover:bg-accent-soft"
                          onClick={saveLayout}
                        >
                          <Download size={15} /> {t('layout.save')}
                        </button>
                        <AlertDialog.Root>
                          <AlertDialog.Trigger asChild>
                            <button
                              className="inline-flex items-center gap-1 rounded-sm border border-border-strong bg-surface-raised px-2 py-1.5 text-xs text-text hover:border-accent hover:bg-accent-soft"
                              type="button"
                              data-testid="layout-reset"
                            >
                              <RotateCcw size={15} /> {t('layout.reset')}
                            </button>
                          </AlertDialog.Trigger>
                          <AlertDialog.Portal>
                            <AlertDialog.Overlay className="fixed inset-0 z-[90] bg-canvas/75" />
                            <AlertDialog.Content
                              className="fixed left-1/2 top-1/2 z-[91] w-[min(420px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 rounded-md border border-border bg-surface p-[18px] text-text shadow-panel"
                              data-testid="layout-reset-dialog"
                            >
                              <AlertDialog.Title className="m-0 text-[17px] font-semibold">
                                {t('layout.resetTitle')}
                              </AlertDialog.Title>
                              <AlertDialog.Description className="mb-0 mt-2 text-[13px] leading-5 text-text-muted">
                                {t('layout.resetDescription')}
                              </AlertDialog.Description>
                              <div className="mt-[18px] flex justify-end gap-2">
                                <AlertDialog.Cancel asChild>
                                  <button
                                    className="rounded-sm border border-border-strong bg-surface-raised px-3 py-1.5 text-xs text-text hover:border-accent hover:bg-accent-soft"
                                    type="button"
                                  >
                                    {t('layout.cancel')}
                                  </button>
                                </AlertDialog.Cancel>
                                <AlertDialog.Action asChild>
                                  <button
                                    className="rounded-sm border border-negative/60 bg-negative/15 px-3 py-1.5 text-xs text-negative hover:bg-negative/25"
                                    type="button"
                                    onClick={resetLayout}
                                  >
                                    {t('layout.reset')}
                                  </button>
                                </AlertDialog.Action>
                              </div>
                            </AlertDialog.Content>
                          </AlertDialog.Portal>
                        </AlertDialog.Root>
                        <button
                          className="inline-flex items-center gap-1 rounded-sm border border-accent bg-accent px-2 py-1.5 text-xs text-canvas hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-50"
                          disabled={!uploadedFile || loading}
                          onClick={() =>
                            uploadedFile && handleUpload(uploadedFile)
                          }
                        >
                          <RefreshCw size={15} /> {t('layout.reslice')}
                        </button>
                      </div>
                    </>
                  )}
                </section>
              )}
              {error && (
                <div className="mt-3 flex items-center gap-2 text-sm text-negative">
                  <CircleAlert size={17} />
                  {error}
                </div>
              )}
              {loading && (
                <div className="mt-3 flex items-center gap-2 text-sm text-text-muted">
                  {t('analysis.slicing')}
                </div>
              )}

              {activePage === 'analysis' && slots.length > 0 && (
                <ManualAbilityPool
                  slots={analysisSlots}
                  abilities={abilitiesById}
                  manualSlotIndex={manualSlotIndex}
                  onOpenChange={handleManualOpenChange}
                  onSelect={handleManualSelect}
                />
              )}
            </div>

            {activePage === 'layout' && debugSlot && (
              <aside className="min-w-0">
                <section className="border border-border bg-surface">
                  <div className="flex flex-wrap justify-between gap-2 border-b border-border px-3 py-2 text-xs text-text">
                    <span className="inline-flex items-center gap-1.5">
                      <Bug size={16} /> {t('layout.debug')}
                    </span>
                    <span className="text-text-muted">
                      {debugSlot.matchMode === 'template'
                        ? t('layout.templateMatch')
                        : t('layout.colorFallback')}{' '}
                      · {categoryName(debugSlot.category)} ·{' '}
                      {slotLabel(debugSlot.index)}
                    </span>
                  </div>
                  <div className="grid items-start gap-3 p-3 min-[601px]:grid-cols-[240px_minmax(0,1fr)]">
                    {screenshotUrl && (
                      <DebugCropPreview
                        imageUrl={screenshotUrl}
                        crop={debugSlot.crop}
                      />
                    )}
                    <div className="min-w-0">
                      <p className="mb-1 font-mono text-[11px] text-text-muted">
                        {t('layout.layout')}：x {debugSlot.rect.x}, y{' '}
                        {debugSlot.rect.y}, {debugSlot.rect.width}×
                        {debugSlot.rect.height}
                      </p>
                      <p className="mb-1 font-mono text-[11px] text-text-muted">
                        {t('layout.centerCrop')}：x {debugSlot.crop.x}, y{' '}
                        {debugSlot.crop.y}, {debugSlot.crop.width}×
                        {debugSlot.crop.height}
                      </p>
                      {expectedAbility && (
                        <p
                          className={cn(
                            'mb-1 font-mono text-[11px] font-bold',
                            expectedRank >= 0
                              ? 'text-positive'
                              : 'text-negative',
                          )}
                        >
                          {t('layout.goldenCandidate', {
                            name: expectedAbility.name,
                            result:
                              expectedRank >= 0
                                ? t('layout.goldenTop', {
                                    rank: expectedRank + 1,
                                  })
                                : t('layout.goldenNotRanked'),
                          })}
                        </p>
                      )}
                      <div className="mt-2 grid gap-1">
                        {debugSlot.candidates
                          .slice(0, DEBUG_MATCH_CANDIDATES)
                          .map((candidate, index) => {
                            const item = ability(candidate.abilityId)
                            return (
                              <button
                                className="flex min-w-0 items-center gap-1.5 border border-border bg-surface-raised px-1.5 py-1 text-left text-[11px] text-text hover:border-accent hover:bg-accent-soft"
                                key={candidate.abilityId}
                                onClick={() =>
                                  updateSlot(
                                    debugSlot.index,
                                    String(candidate.abilityId),
                                  )
                                }
                              >
                                <span className="w-3 text-text-muted">
                                  {index + 1}
                                </span>
                                <SkillIcon
                                  compact
                                  abilityId={candidate.abilityId}
                                  shortName={item?.shortName}
                                  name={item?.name}
                                  isHero={item?.isHero}
                                />
                                {item?.name ?? t('common.unknownAbility')}
                              </button>
                            )
                          })}
                      </div>
                    </div>
                  </div>
                </section>
              </aside>
            )}
          </section>
        )}

        {activePage === 'build' && (
          <BuildRecommendationsPage
            candidatePools={candidatePools}
            candidateTierInfo={candidateTierInfo}
            selectedIds={selectedIds}
            combinationRecommendations={combinationRecommendations}
            recommendations={recommendations}
            abilities={abilitiesById}
            assistantOverlayOpen={overlayVisibility.recommendation}
            onToggleSelected={toggleSelected}
            onToggleOverlay={toggleOverlay}
          />
        )}

        {activePage === 'draft' && (
          <DraftReplayPage
            simulation={draftSimulation}
            snapshot={snapshot}
            abilities={abilitiesById}
            pool={draftPoolInfo.pool}
            poolSourceKey={draftPoolInfo.sourceKey}
            poolErrorKey={draftPoolInfo.errorKey}
            poolErrorValues={draftPoolInfo.errorValues}
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
          />
        )}

        {activePage === 'database' && (
          <TierListPage
            snapshot={snapshot}
            category={tierCategory}
            categoryCounts={tierCategoryCounts}
            query={tierQuery}
            groups={tierGroups}
            filteredEntryCount={filteredTierEntries.length}
            overlayOpen={overlayVisibility.recommendation}
            onCategoryChange={setTierCategory}
            onQueryChange={setTierQuery}
            onToggleOverlay={toggleOverlay}
          />
        )}

        {activePage === 'pairs' && (
          <PairsPage
            snapshot={snapshot}
            entries={pairEntries}
            filteredEntries={filteredPairEntries}
            query={pairQuery}
            excludeSameHero={excludeSameHero}
            sort={pairSort}
            tableRef={pairTableRef}
            virtualRows={virtualPairRows}
            topSpacer={pairTopSpacer}
            bottomSpacer={pairBottomSpacer}
            onQueryChange={setPairQuery}
            onExcludeSameHeroToggle={() =>
              setExcludeSameHero((current) => !current)
            }
            onSort={sortPairEntries}
          />
        )}

        {activePage === 'settings' && (
          <SettingsPage
            layoutMode={layoutMode}
            overlayShortcut={overlayShortcut}
            overlayShortcutMode={overlayShortcutMode}
            onBack={() => setActivePage('analysis')}
            onLayoutModeChange={updateLayoutMode}
            onOverlayShortcutChange={updateOverlayShortcut}
            onOverlayShortcutModeChange={updateOverlayShortcutMode}
          />
        )}

        {!isDesktopRuntime() && overlayVisibility.recommendation && (
          <FloatingOverlay
            kind="recommendation"
            state={overlayState}
            snapshot={snapshot}
            abilities={abilitiesById}
          />
        )}
      </main>
      <Toaster
        position="bottom-right"
        theme="dark"
        visibleToasts={3}
        toastOptions={{ className: 'omg-toast', duration: 3500 }}
      />
    </Tooltip.Provider>
  )
}

export default function App() {
  const overlayKind = overlayKindFromLocation()
  return overlayKind ? <OverlayApp kind={overlayKind} /> : <MainApp />
}
