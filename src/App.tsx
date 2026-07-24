import {
  memo,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import * as AlertDialog from '@radix-ui/react-alert-dialog'
import * as Popover from '@radix-ui/react-popover'
import * as Tooltip from '@radix-ui/react-tooltip'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useTranslation } from 'react-i18next'
import {
  Bug,
  Check,
  CircleAlert,
  Download,
  FileImage,
  FolderOpen,
  GitFork,
  Layers,
  LayoutPanelTop,
  Play,
  RefreshCw,
  RotateCcw,
  ScanSearch,
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
  type FixedSlot,
  type LayoutDocument,
} from './core/layout'
import { buildAbilityPairList, type AbilityPairEntry } from './core/pairs'
import {
  BUILD_PICK_LIMITS,
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
import { isHeroAbility } from './core/ability-category'
import {
  detectRuntimeCapabilities,
  missingRuntimeCapabilities,
} from './platform/capabilities'
import { getBrowserFileAdapter } from './platform/files'
import {
  closeNativeOverlay,
  createOverlayChannel,
  isDesktopRuntime,
  openNativeOverlay,
  overlayKindFromLocation,
  writeOverlayState,
  type OverlayKind,
  type OverlayMessage,
  type OverlayState,
} from './platform/overlays'
import { appResourceUrl } from './platform/resources'
import {
  getBrowserStorage,
  readStoredJson,
  writeStoredJson,
} from './platform/storage'
import { LanguageSwitcher } from './components/LanguageSwitcher'
import { DraftReplayPage } from './components/DraftReplayPage'
import {
  FloatingOverlay,
  OverlayApp,
  OverlayToggleButton,
} from './components/OverlayViews'
import {
  PairsPage,
  type PairSortKey,
  type SortDirection,
} from './components/PairsPage'
import { RecommendationInteractionsPopover } from './components/RecommendationInteractionsPopover'
import { SkillIcon } from './components/SkillIcon'
import { TierListPage } from './components/TierListPage'
import i18n, { toAppLocale } from './i18n'
import { cn } from './lib/cn'
import {
  formatLogitDelta,
  formatPairPercent,
} from './lib/recommendation-format'
import type {
  Ability,
  IconSignature,
  Recommendation,
  RecognizedSlot,
  Rect,
  SlotCategory,
  Snapshot,
} from './types'

const goldenLabels: Record<number, number> = { 6: -41, 50: 5342 }
type AppPage = 'analysis' | 'layout' | 'database' | 'pairs' | 'draft'

const appPages: Array<{
  id: AppPage
  labelKey:
    'nav.analysis' | 'nav.layout' | 'nav.database' | 'nav.pairs' | 'nav.draft'
  icon: typeof ScanSearch
}> = [
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
const BUILD_PICK_GROUPS: Array<{
  key: keyof BuildCandidatePools
  labelKey: 'common.hero' | 'common.ability' | 'common.ultimate'
  limit: number
}> = [
  { key: 'heroIds', labelKey: 'common.hero', limit: BUILD_PICK_LIMITS.hero },
  {
    key: 'abilityIds',
    labelKey: 'common.ability',
    limit: BUILD_PICK_LIMITS.ability,
  },
  {
    key: 'ultimateIds',
    labelKey: 'common.ultimate',
    limit: BUILD_PICK_LIMITS.ultimate,
  },
]

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
): FixedSlot[] {
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

const ABILITY_POOL_GROUPS: Array<{
  category: SlotCategory
  labelKey: 'common.ultimates' | 'common.abilities' | 'common.heroes'
}> = [
  { category: 'ultimate', labelKey: 'common.ultimates' },
  { category: 'ability', labelKey: 'common.abilities' },
  { category: 'hero', labelKey: 'common.heroes' },
]

const MANUAL_POOL_SECTION_WIDTH: Record<SlotCategory, string> = {
  hero: 'w-24 max-[560px]:w-full',
  ability: 'w-80 max-w-full max-[560px]:w-full',
  ultimate: 'w-24 max-[560px]:w-full',
}

const MANUAL_POOL_ITEM_SIZE: Record<SlotCategory, string> = {
  hero: 'size-[38px] max-[560px]:size-full max-[560px]:max-w-[38px] max-[560px]:aspect-square [&_.skill-icon]:size-[38px] max-[560px]:[&_.skill-icon]:size-[min(38px,100%)]',
  ability:
    'size-12 max-[560px]:size-full max-[560px]:max-w-[38px] max-[560px]:aspect-square [&_.skill-icon]:size-11 max-[560px]:[&_.skill-icon]:size-[min(38px,100%)]',
  ultimate:
    'size-[38px] max-[560px]:size-full max-[560px]:max-w-[38px] max-[560px]:aspect-square [&_.skill-icon]:size-[38px] max-[560px]:[&_.skill-icon]:size-[min(38px,100%)]',
}

const PICK_TIER_CLASSES: Record<AbilityTier, string> = {
  S: 'text-warning',
  A: 'text-orange-400',
  B: 'text-positive',
  C: 'text-accent',
  D: 'text-text-muted',
  E: 'text-cyan-300',
  F: 'text-violet-300',
}

const ManualAbilitySlot = memo(function ManualAbilitySlot({
  slot,
  abilities,
  isOpen,
  onOpenChange,
  onSelect,
}: {
  slot: RecognizedSlot
  abilities: ReadonlyMap<number, Ability>
  isOpen: boolean
  onOpenChange: (slotIndex: number, open: boolean) => void
  onSelect: (slotIndex: number, abilityId: number) => void
}) {
  const { t } = useTranslation()
  const best = slot.candidates[0]
  const bestAbility =
    best === undefined ? undefined : abilities.get(best.abilityId)
  const selectedAbility =
    slot.selectedAbilityId === undefined
      ? undefined
      : abilities.get(slot.selectedAbilityId)
  const displayedAbility = selectedAbility ?? bestAbility
  const confirmed = slot.selectedAbilityId !== undefined
  const slotName = displayedAbility?.name ?? t('common.unknownAbility')

  return (
    <Popover.Root
      open={isOpen}
      onOpenChange={(open) => onOpenChange(slot.index, open)}
    >
      <Popover.Trigger asChild>
        <button
          type="button"
          className={cn(
            'relative inline-flex shrink-0 items-center justify-center rounded-sm border border-transparent p-0 text-inherit transition-[filter] hover:brightness-125 focus-visible:border-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent [&_.skill-icon]:shrink-0 [&_.skill-icon]:overflow-hidden [&_.skill-icon]:rounded-sm [&_.skill-icon]:border [&_.skill-icon]:border-border-strong',
            MANUAL_POOL_ITEM_SIZE[slot.category],
            confirmed &&
              '[&_.skill-icon]:border-positive [&_.skill-icon]:shadow-[inset_0_0_0_1px_rgb(74_222_128_/_0.4)]',
          )}
          title={`${slotLabel(slot.index)} · ${slotName} · ${confirmed ? t('common.confirmed') : t('common.suggestion')}`}
          aria-label={`${slotLabel(slot.index)}，${slotName}，${confirmed ? t('common.confirmed') : t('common.suggestion')}，${t('analysis.selectCandidate')}`}
        >
          <SkillIcon
            abilityId={displayedAbility?.id}
            shortName={displayedAbility?.shortName}
            name={displayedAbility?.name}
            isHero={displayedAbility?.isHero}
          />
          <span className="absolute -bottom-1 -right-0.5 z-2 grid size-[17px] place-items-center rounded-full border border-border-strong bg-canvas font-mono text-[8px] text-text-muted">
            {slotLabel(slot.index)}
          </span>
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="z-[80] grid w-[max(300px,var(--radix-popover-trigger-width))] max-w-[calc(100vw-16px)] max-h-[min(380px,var(--radix-popper-available-height))] gap-1 overflow-y-auto rounded-sm border border-border bg-surface p-1 shadow-panel"
          side="bottom"
          align="start"
          sideOffset={5}
          collisionPadding={8}
        >
          {slot.candidates.map((candidate, index) => {
            const item = abilities.get(candidate.abilityId)
            if (!item) return null
            return (
              <button
                type="button"
                className="flex min-w-0 items-center gap-2 border border-border bg-surface-raised px-1.5 py-1 text-left text-xs text-text transition-colors hover:border-accent hover:bg-accent-soft focus-visible:border-accent focus-visible:bg-accent-soft focus-visible:outline-hidden"
                key={candidate.abilityId}
                onClick={() => onSelect(slot.index, candidate.abilityId)}
              >
                <span className="w-4 shrink-0 text-center font-mono text-[11px] text-text-muted">
                  {index + 1}
                </span>
                <SkillIcon
                  abilityId={item.id}
                  shortName={item.shortName}
                  name={item.name}
                  isHero={item.isHero}
                />
                <span className="min-w-0 truncate">{item.name}</span>
              </button>
            )
          })}
          {slot.candidates.length === 0 && (
            <span className="p-2 text-xs text-text-muted">
              {t('common.noCandidates')}
            </span>
          )}
          <Popover.Arrow className="fill-surface" width={12} height={6} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
})

const ManualAbilityPool = memo(function ManualAbilityPool({
  slots,
  abilities,
  manualSlotIndex,
  onOpenChange,
  onSelect,
}: {
  slots: readonly RecognizedSlot[]
  abilities: ReadonlyMap<number, Ability>
  manualSlotIndex?: number
  onOpenChange: (slotIndex: number, open: boolean) => void
  onSelect: (slotIndex: number, abilityId: number) => void
}) {
  const { t } = useTranslation()
  return (
    <div
      className="mt-[17px] grid w-[524px] max-w-full grid-cols-[96px_320px_96px] items-start gap-1.5 max-[560px]:w-full max-[560px]:grid-cols-1"
      aria-label={t('analysis.manualValidation')}
    >
      {ABILITY_POOL_GROUPS.map(({ category, labelKey }) => {
        const categorySlots = slots.filter((slot) => slot.category === category)
        const confirmedCount = categorySlots.filter(
          (slot) => slot.selectedAbilityId !== undefined,
        ).length
        return (
          <section
            className={cn(
              'min-w-0 rounded-sm border border-border bg-surface-raised p-1.5',
              MANUAL_POOL_SECTION_WIDTH[category],
            )}
            key={category}
            aria-labelledby={`manual-pool-${category}`}
          >
            <header className="mb-1 flex items-center justify-between gap-1.5 font-mono text-[9px] font-bold text-text">
              <span id={`manual-pool-${category}`}>{t(labelKey)}</span>
              <strong
                aria-label={t('analysis.confirmedCount', {
                  current: confirmedCount,
                  total: categorySlots.length,
                })}
              >
                {confirmedCount}/{categorySlots.length}
              </strong>
            </header>
            <div
              className={cn(
                'grid min-w-0 justify-items-center gap-[3px]',
                category === 'ability'
                  ? 'flex w-[308px] max-w-full flex-wrap content-start justify-start gap-1 max-[560px]:grid max-[560px]:w-auto max-[560px]:grid-cols-6 max-[560px]:justify-items-stretch'
                  : 'grid-cols-2 justify-between max-[560px]:grid-cols-6 max-[560px]:justify-items-stretch',
              )}
            >
              {categorySlots.map((slot) => (
                <ManualAbilitySlot
                  key={slot.index}
                  slot={slot}
                  abilities={abilities}
                  isOpen={manualSlotIndex === slot.index}
                  onOpenChange={onOpenChange}
                  onSelect={onSelect}
                />
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
})

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

function pickRoleLabel(ability: Ability | undefined): string {
  if (!ability) return ui('common.ability')
  if (isHeroAbility(ability)) return ui('common.hero')
  return ability.isUltimate ? ui('common.ultimate') : ui('common.ability')
}

function DebugCropPreview({
  imageUrl,
  crop,
}: {
  imageUrl: string
  crop: Rect
}) {
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
    const right = Math.min(
      image.naturalWidth,
      Math.ceil(currentCrop.x + currentCrop.width + DEBUG_CONTEXT_PADDING),
    )
    const bottom = Math.min(
      image.naturalHeight,
      Math.ceil(currentCrop.y + currentCrop.height + DEBUG_CONTEXT_PADDING),
    )
    const sourceWidth = Math.max(1, right - left)
    const sourceHeight = Math.max(1, bottom - top)
    const scale = Math.min(
      DEBUG_PREVIEW_SIZE / sourceWidth,
      DEBUG_PREVIEW_SIZE / sourceHeight,
    )
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
    context.drawImage(
      image,
      left,
      top,
      sourceWidth,
      sourceHeight,
      offsetX,
      offsetY,
      drawWidth,
      drawHeight,
    )
    context.strokeStyle = '#ffefad'
    context.lineWidth = DEBUG_BORDER_WIDTH
    context.strokeRect(
      offsetX + (currentCrop.x - left) * scale + 0.5,
      offsetY + (currentCrop.y - top) * scale + 0.5,
      currentCrop.width * scale,
      currentCrop.height * scale,
    )
  }

  return (
    <canvas
      ref={canvasRef}
      className="block size-60 max-w-full border border-border-strong [image-rendering:pixelated] max-[600px]:justify-self-center"
      width={DEBUG_PREVIEW_SIZE}
      height={DEBUG_PREVIEW_SIZE}
      aria-label={ui('layout.cropPreview')}
    />
  )
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
  const [pairSort, setPairSort] = useState<{
    key: PairSortKey
    direction: SortDirection
  }>({ key: 'synergy', direction: 'desc' })
  const [activePage, setActivePage] = useState<AppPage>('analysis')
  const [overlayVisibility, setOverlayVisibility] = useState<
    Record<OverlayKind, boolean>
  >({ recommendation: false, tier: false })
  const [draftStrategy, setDraftStrategy] =
    useState<DraftStrategyId>('tier-first')
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
  const candidatePools = useMemo<BuildCandidatePools>(() => {
    const pools = {
      heroIds: [] as number[],
      abilityIds: [] as number[],
      ultimateIds: [] as number[],
    }
    for (const slot of slots) {
      if (slot.selectedAbilityId === undefined) continue
      if (slot.category === 'hero') pools.heroIds.push(slot.selectedAbilityId)
      else if (slot.category === 'ability')
        pools.abilityIds.push(slot.selectedAbilityId)
      else pools.ultimateIds.push(slot.selectedAbilityId)
    }
    const sortByTier = (ids: number[]) =>
      [...new Set(ids)].sort((left, right) => {
        const rankDifference =
          (candidateTierInfo.get(left)?.rank ?? Number.POSITIVE_INFINITY) -
          (candidateTierInfo.get(right)?.rank ?? Number.POSITIVE_INFINITY)
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
  }, [abilitiesById, candidateTierInfo, slots])
  const deferredCandidatePools = useDeferredValue(candidatePools)
  const candidateIds = useMemo(
    () => [
      ...new Set([
        ...candidatePools.heroIds,
        ...candidatePools.abilityIds,
        ...candidatePools.ultimateIds,
      ]),
    ],
    [candidatePools],
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
  const layout = useMemo(
    () =>
      buildScaledLayout(
        importedLayout ?? DEFAULT_LAYOUT_DOCUMENT,
        layoutOverrides,
        imageSize,
      ),
    [importedLayout, layoutOverrides, imageSize],
  )
  const recommendations = useMemo(
    () =>
      recommendBuilds(deferredCandidatePools, deferredSelectedIds, snapshot),
    [deferredCandidatePools, deferredSelectedIds, snapshot],
  )
  const overlayState = useMemo<OverlayState>(
    () => ({
      candidatePools,
      locale,
      recommendations,
      selectedIds,
      tierCategory,
      tierQuery,
    }),
    [
      candidatePools,
      locale,
      recommendations,
      selectedIds,
      tierCategory,
      tierQuery,
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

  async function handleUpload(file: File) {
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
    const missingCapabilities = missingRuntimeCapabilities(runtimeCapabilities)
    if (missingCapabilities.length > 0) {
      setError(
        t('errors.missingCapabilities', {
          capabilities: missingCapabilities.join(', '),
        }),
      )
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
        setLoading(false)
        return
      }
      const nextImageSize = { width: decoded.width, height: decoded.height }
      const nextLayout = buildScaledLayout(
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
        setLoading(false)
        finishWorker()
      }
      worker.postMessage(
        {
          image: decoded,
          abilities: snapshot.abilities,
          layout: nextLayout,
          signatures: iconSignatures,
        },
        [decoded],
      )
      bitmap = undefined
      timeoutId = window.setTimeout(() => {
        if (requestId !== recognitionRequestRef.current) return
        setError(t('errors.recognitionTimedOut'))
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
    toast.success(t('layout.restored'))
  }

  function saveLayout() {
    const payload: LayoutDocument = {
      version: 1,
      width: imageSize.width,
      height: imageSize.height,
      slots: layout,
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
    event: ReactPointerEvent<SVGSVGElement | SVGRectElement | SVGCircleElement>,
  ) {
    const bounds = overlayRef.current?.getBoundingClientRect()
    if (!bounds) return { x: 0, y: 0 }
    return {
      x: ((event.clientX - bounds.left) / bounds.width) * imageSize.width,
      y: ((event.clientY - bounds.top) / bounds.height) * imageSize.height,
    }
  }

  function startDrag(
    event: ReactPointerEvent<SVGRectElement | SVGCircleElement>,
    index: number,
    mode: 'move' | 'resize',
  ) {
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
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
    const sourceLayout = importedLayout ?? DEFAULT_LAYOUT_DOCUMENT
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
      crop: cropCenter(currentLayout.rect),
    }
  }, [debugSlotIndex, layout, slots])
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

  async function toggleOverlay(kind: OverlayKind) {
    const isOpen = overlayVisibility[kind]
    try {
      if (isDesktopRuntime()) {
        if (isOpen) await closeNativeOverlay(kind)
        else await openNativeOverlay(kind)
      }
      setOverlayVisibility((current) => ({ ...current, [kind]: !isOpen }))
    } catch (overlayError) {
      const message =
        overlayError instanceof Error
          ? overlayError.message
          : t('errors.overlayOpen')
      toast.error(message)
    }
  }

  return (
    <Tooltip.Provider delayDuration={250} skipDelayDuration={150}>
      <main
        className="mx-auto w-[min(720px,calc(100vw-24px))] pb-10 pt-[22px] text-text"
        data-testid="app-shell"
      >
        <header className="grid gap-x-5 gap-y-3 border-b border-border pb-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <div>
            <p className="mb-1.5 text-xs font-bold uppercase tracking-[0.08em] text-accent">
              DOTA 2 / OMG
            </p>
            <h1 className="m-0 text-3xl font-semibold tracking-tight text-text">
              OMG-Draft-Seer
            </h1>
          </div>
          <nav
            className="order-3 col-span-full flex max-w-full gap-1 overflow-x-auto rounded-md border border-border bg-surface p-1 sm:order-2"
            aria-label={t('app.mainPages')}
          >
            {appPages.map((page) => {
              const Icon = page.icon
              const selected = activePage === page.id
              return (
                <button
                  key={page.id}
                  type="button"
                  className={cn(
                    'inline-flex shrink-0 items-center gap-1.5 rounded px-3 py-2 text-sm font-medium text-text-muted transition-colors hover:bg-surface-hover hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
                    selected &&
                      'bg-accent text-canvas hover:bg-accent hover:text-canvas',
                  )}
                  aria-current={selected ? 'page' : undefined}
                  data-testid={`nav-${page.id}`}
                  onClick={() => setActivePage(page.id)}
                >
                  <Icon size={15} />
                  {t(page.labelKey)}
                </button>
              )
            })}
          </nav>
          <div className="order-2 inline-flex items-center gap-2 text-sm text-text-muted sm:order-3 sm:justify-self-end">
            <span className="font-mono">
              {t('common.patch')} {snapshot.patch}
            </span>
            <span className="size-1.5 rounded-full bg-positive" />
            <span>{t('app.snapshot')}</span>
            <LanguageSwitcher />
          </div>
        </header>

        {(activePage === 'analysis' || activePage === 'layout') && (
          <section className="grid gap-5 pt-5">
            <div className="min-w-0">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="eyebrow">{t('analysis.screenshotStep')}</p>
                  <h2>{t('analysis.abilityPool')}</h2>
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
                    className="mt-[18px] grid min-h-[245px] w-full place-content-center gap-2 rounded-md border border-dashed border-border-strong bg-surface text-text-muted transition-colors hover:border-accent hover:bg-surface-raised"
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
                <div className="relative mt-[18px] overflow-hidden rounded-sm border border-border bg-canvas">
                  <img
                    className="block h-auto w-full"
                    src={screenshotUrl}
                    alt={t('analysis.uploadedScreenshotAlt')}
                  />
                  <svg
                    ref={overlayRef}
                    className={`layout-overlay ${activePage === 'layout' && calibrationOpen ? 'calibrating' : ''}`}
                    viewBox={`0 0 ${imageSize.width} ${imageSize.height}`}
                    aria-label={t('layout.calibration')}
                    onPointerMove={dragLayout}
                    onPointerUp={finishDrag}
                    onPointerCancel={finishDrag}
                  >
                    {layout.map((slot, index) => {
                      const matchCrop = cropCenter(slot.rect)
                      return (
                        <g
                          key={index}
                          onClick={() => setDebugSlotIndex(index)}
                          className={`${slot.category} ${debugSlotIndex === index ? 'active' : ''}`}
                        >
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
                  <button
                    className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-sm border border-border-strong bg-surface/95 px-2 py-1.5 text-xs text-text hover:bg-surface-raised"
                    onClick={() => inputRef.current?.click()}
                  >
                    <RefreshCw size={15} /> {t('analysis.replaceScreenshot')}
                  </button>
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
                            <AlertDialog.Content className="fixed left-1/2 top-1/2 z-[91] w-[min(420px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 rounded-md border border-border bg-surface p-[18px] text-text shadow-panel">
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

            {activePage === 'analysis' && (
              <aside className="min-w-0 border-t border-border-subtle pt-5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="eyebrow">{t('analysis.buildStep')}</p>
                    <h2>{t('analysis.recommendations')}</h2>
                  </div>
                  <div className="flex flex-wrap justify-end gap-2">
                    {slots.length > 0 && (
                      <button
                        className="grid size-8 place-items-center rounded-sm border border-border-strong bg-surface-raised text-text hover:border-accent hover:bg-accent-soft"
                        data-testid="accept-suggestions"
                        title={t('analysis.acceptSuggestions')}
                        aria-label={t('analysis.acceptSuggestions')}
                        onClick={acceptSuggestions}
                      >
                        <Check size={17} />
                      </button>
                    )}
                    <OverlayToggleButton
                      kind="recommendation"
                      open={overlayVisibility.recommendation}
                      onToggle={toggleOverlay}
                    />
                    <OverlayToggleButton
                      kind="tier"
                      open={overlayVisibility.tier}
                      onToggle={toggleOverlay}
                    />
                    <Sparkles size={19} className="text-accent" />
                  </div>
                </div>

                <fieldset className="mt-[22px] border-0 p-0">
                  <legend className="mb-2 text-sm text-text">
                    {t('analysis.lockPick')}{' '}
                    <span className="text-text-muted">
                      {selectedIds.length}/5
                    </span>
                  </legend>
                  <div className="grid gap-3">
                    {BUILD_PICK_GROUPS.map((group) => {
                      const ids = candidatePools[group.key]
                      const selectedCount = selectedIds.filter((id) =>
                        ids.includes(id),
                      ).length
                      return (
                        <section className="grid gap-1.5" key={group.key}>
                          <header className="flex items-center justify-between text-xs font-bold text-text">
                            <span>{t(group.labelKey)}</span>
                            <small className="font-mono font-normal text-text-muted">
                              {selectedCount}/{group.limit}
                            </small>
                          </header>
                          <div className="flex flex-wrap gap-1.5">
                            {ids.map((id) => {
                              const item = ability(id)
                              if (!item) return null
                              const tier = candidateTierInfo.get(id)?.tier
                              return (
                                <button
                                  key={id}
                                  className={cn(
                                    'inline-flex min-w-0 items-center gap-1.5 rounded-sm border border-border bg-surface-raised px-2 py-1.5 text-[13px] text-text hover:border-accent hover:bg-accent-soft [&>span:not(.skill-icon)]:max-w-[130px] [&>span:not(.skill-icon)]:truncate',
                                    selectedIds.includes(id) &&
                                      'border-accent bg-accent-soft',
                                  )}
                                  onClick={() => toggleSelected(id)}
                                >
                                  <SkillIcon
                                    compact
                                    abilityId={id}
                                    shortName={item.shortName}
                                    name={item.name}
                                    isHero={item.isHero}
                                  />
                                  <span>{item.name}</span>
                                  {tier && (
                                    <small
                                      className={cn(
                                        'grid size-4 place-items-center border border-current font-mono text-[10px] font-bold',
                                        PICK_TIER_CLASSES[tier],
                                      )}
                                    >
                                      {tier}
                                    </small>
                                  )}
                                </button>
                              )
                            })}
                            {ids.length === 0 && (
                              <p className="my-1 text-[13px] text-text-muted">
                                {t('analysis.noConfirmedCandidates')}
                              </p>
                            )}
                          </div>
                        </section>
                      )
                    })}
                    {candidateIds.length === 0 && (
                      <p className="my-1 text-[13px] text-text-muted">
                        {t('analysis.confirmForBuild')}
                      </p>
                    )}
                  </div>
                </fieldset>

                {recommendations.length > 0 ? (
                  <div className="mt-5">
                    <div className="border-l-[3px] border-accent bg-accent-soft p-4">
                      <span className="mb-1 block text-[13px] text-text-muted">
                        {t('analysis.nextPick')}
                      </span>
                      <strong className="text-[19px] text-text-strong">
                        {
                          ability(
                            recommendations[0].pickOrderIds.find(
                              (id) => !selectedIds.includes(id),
                            ) ?? recommendations[0].pickOrderIds[0],
                          )?.name
                        }
                      </strong>
                    </div>
                    {recommendations.map((recommendation, index) => (
                      <article
                        className="border-b border-border-subtle py-[18px]"
                        key={recommendation.abilityIds.join('-')}
                      >
                        <div className="grid items-center gap-4 min-[761px]:grid-cols-[minmax(0,1fr)_auto]">
                          <div>
                            <div className="flex items-center gap-2 text-xs text-text-muted">
                              <span>
                                {t('analysis.plan', { number: index + 1 })}
                              </span>
                            </div>
                            <div className="mt-3 flex flex-wrap gap-2">
                              {recommendation.pickOrderIds.map(
                                (id, pickIndex) => {
                                  const item = ability(id)
                                  return (
                                    <span
                                      className="relative inline-flex min-h-[52px] items-center gap-1.5 bg-surface px-2 pb-1 pt-4 text-xs text-text"
                                      key={id}
                                      title={item?.name}
                                    >
                                      <small className="absolute left-2 top-0.5 text-[9px] text-text-muted">
                                        {t('analysis.pick', {
                                          number: pickIndex + 1,
                                        })}{' '}
                                        · {pickRoleLabel(item)}
                                      </small>
                                      <SkillIcon
                                        compact
                                        abilityId={id}
                                        shortName={item?.shortName}
                                        name={item?.name}
                                        isHero={item?.isHero}
                                      />
                                      <b className="max-w-[132px] truncate font-medium">
                                        {item?.name}
                                      </b>
                                    </span>
                                  )
                                },
                              )}
                            </div>
                          </div>
                          <dl className="m-0 grid grid-cols-2 gap-3 min-[601px]:grid-cols-4 min-[761px]:grid-cols-4">
                            <div className="grid min-w-16 gap-1">
                              <dt className="whitespace-nowrap text-[11px] text-text-muted">
                                {t('common.score')}
                              </dt>
                              <dd className="m-0 grid gap-0.5 whitespace-nowrap font-mono text-[15px] font-bold text-text-strong">
                                {recommendation.score.toFixed(1)}%
                              </dd>
                            </div>
                            <div className="grid min-w-16 gap-1">
                              <dt className="whitespace-nowrap text-[11px] text-text-muted">
                                {t('common.baseWinRate')}
                              </dt>
                              <dd className="m-0 grid gap-0.5 whitespace-nowrap font-mono text-[15px] font-bold text-text-strong">
                                {(recommendation.abilityWinRate * 100).toFixed(
                                  1,
                                )}
                                %
                              </dd>
                            </div>
                            <div
                              className="group relative grid min-w-16 cursor-help gap-1 rounded-sm focus-visible:outline focus-visible:outline-accent focus-visible:outline-offset-2"
                              tabIndex={0}
                              aria-label={t('analysis.synergyAria', {
                                synergy: formatPairPercent(
                                  recommendation.synergy,
                                  true,
                                ),
                                delta: formatLogitDelta(
                                  recommendation.logitSynergy,
                                ),
                                interactions:
                                  recommendation.effectiveInteractionCount,
                                partial:
                                  recommendation.partialInteractions.length,
                              })}
                            >
                              <dt className="whitespace-nowrap text-[11px] text-text-muted">
                                {t('common.synergy')}
                              </dt>
                              <dd className="m-0 grid gap-0.5 whitespace-nowrap font-mono text-[15px] font-bold text-text-strong">
                                {formatPairPercent(
                                  recommendation.synergy,
                                  true,
                                )}
                                <small className="text-[10px] font-normal text-text-muted">
                                  {t('common.logitDelta')}{' '}
                                  {formatLogitDelta(
                                    recommendation.logitSynergy,
                                  )}{' '}
                                  ·{' '}
                                  {t('draft.interactionGroups', {
                                    count:
                                      recommendation.effectiveInteractionCount,
                                  })}
                                  {recommendation.partialInteractions.length > 0
                                    ? ` · ${t('analysis.partialInteractions')} ${recommendation.partialInteractions.length}`
                                    : ''}
                                </small>
                              </dd>
                              <RecommendationInteractionsPopover
                                interactions={
                                  recommendation.effectiveInteractions
                                }
                                partialInteractions={
                                  recommendation.partialInteractions
                                }
                                abilities={abilitiesById}
                              />
                            </div>
                            <div className="grid min-w-16 gap-1">
                              <dt className="whitespace-nowrap text-[11px] text-text-muted">
                                {t('common.averagePick')}
                              </dt>
                              <dd className="m-0 grid gap-0.5 whitespace-nowrap font-mono text-[15px] font-bold text-text-strong">
                                {recommendation.averagePickPosition.toFixed(1)}
                              </dd>
                            </div>
                          </dl>
                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <div className="mt-[26px] grid min-h-[190px] place-content-center justify-items-center rounded-md border border-dashed border-border-strong bg-surface text-center text-text-muted">
                    <FileImage size={24} />
                    <p className="mb-0 mt-2.5 max-w-[220px] text-[13px]">
                      {t('analysis.buildRequirement')}
                    </p>
                  </div>
                )}
              </aside>
            )}
          </section>
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
            overlayOpen={overlayVisibility.tier}
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

        {!isDesktopRuntime() && overlayVisibility.recommendation && (
          <FloatingOverlay
            kind="recommendation"
            state={overlayState}
            snapshot={snapshot}
            abilities={abilitiesById}
          />
        )}
        {!isDesktopRuntime() && overlayVisibility.tier && (
          <FloatingOverlay
            kind="tier"
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
