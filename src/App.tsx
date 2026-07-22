import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react'
import * as AlertDialog from '@radix-ui/react-alert-dialog'
import * as Tooltip from '@radix-ui/react-tooltip'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ArrowDownUp, Bug, Check, ChevronDown, ChevronUp, CircleAlert, Download, FileImage, Filter, FolderOpen, GitFork, Layers, LayoutPanelTop, RefreshCw, RotateCcw, ScanSearch, Search, Settings2, Sparkles, Upload } from 'lucide-react'
import { Toaster, toast } from 'sonner'
import { demoSnapshot } from './data/demoSnapshot'
import { clampRectToCanvas, cropCenter, DEFAULT_LAYOUT_DOCUMENT, MATCH_CROP_RATIO, parseLayoutDocument, scaleLayoutToCanvas, scaleRect, slotLabel, ULTIMATE_SLOT_ORDER, validateScreenshotDimensions, type FixedSlot, type LayoutDocument } from './core/layout'
import { buildAbilityPairList, type AbilityPairEntry } from './core/pairs'
import { BUILD_PICK_LIMITS, recommendBuilds, type BuildCandidatePools } from './core/recommendation'
import { buildAbilityTierList, matchesTierCategory, TIER_CATEGORY_OPTIONS, TIER_ORDER, type AbilityTier, type TierCategory, type TierEntry } from './core/tiers'
import { isHeroAbility } from './core/ability-category'
import { detectRuntimeCapabilities, missingRuntimeCapabilities } from './platform/capabilities'
import { getBrowserFileAdapter } from './platform/files'
import { appResourceUrl, localAbilityIconUrl, remoteAbilityIconUrl } from './platform/resources'
import { getBrowserStorage, readStoredJson, writeStoredJson } from './platform/storage'
import type { Ability, IconSignature, RecommendationInteraction, RecognizedSlot, Rect, Snapshot } from './types'

const categoryLabel = { hero: '英雄', normal: '普通', ultimate: '终极' } as const
const goldenLabels: Record<number, number> = { 6: -41, 50: 5342 }
type AppPage = 'analysis' | 'layout' | 'database' | 'pairs'
type PairSortKey = 'abilityOne' | 'winRateOne' | 'abilityTwo' | 'winRateTwo' | 'pairWinRate' | 'synergy'
type SortDirection = 'asc' | 'desc'

const appPages: Array<{ id: AppPage; label: string; icon: typeof ScanSearch }> = [
  { id: 'analysis', label: '截图上传技能分析', icon: ScanSearch },
  { id: 'layout', label: 'Layout 分析', icon: LayoutPanelTop },
  { id: 'database', label: 'Tier List', icon: Layers },
  { id: 'pairs', label: 'Ability Pairs', icon: GitFork },
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
  { key: 'normalIds', label: '普通技能', limit: BUILD_PICK_LIMITS.normal },
  { key: 'ultimateIds', label: '终极技能', limit: BUILD_PICK_LIMITS.ultimate },
]

type ImageSize = Pick<LayoutDocument, 'width' | 'height'>

const DEFAULT_IMAGE_SIZE: ImageSize = {
  width: DEFAULT_LAYOUT_DOCUMENT.width,
  height: DEFAULT_LAYOUT_DOCUMENT.height,
}

function buildScaledLayout(document: LayoutDocument, overrides: Record<number, Rect>, imageSize: ImageSize): FixedSlot[] {
  const sourceSlots = document.slots.map((slot, index) => ({
    ...slot,
    rect: overrides[index] ?? slot.rect,
  }))
  return scaleLayoutToCanvas(sourceSlots, document.width, document.height, imageSize.width, imageSize.height)
}

function SkillIcon({ abilityId, shortName, name, isHero, compact = false, catalog = false }: { abilityId?: number; shortName?: string; name?: string; isHero?: boolean; compact?: boolean; catalog?: boolean }) {
  const resolvedIsHero = abilityId === undefined ? Boolean(isHero) : isHeroAbility({ id: abilityId, isHero })
  const localUrl = shortName ? localAbilityIconUrl(abilityId, shortName, resolvedIsHero) : undefined
  const fallbackUrl = shortName ? remoteAbilityIconUrl(shortName, resolvedIsHero) : undefined
  const fallbackLabel = Array.from(name ?? shortName ?? '?').slice(0, 2).join('').toUpperCase()
  return (
    <span className={`skill-icon ${compact ? 'compact' : ''} ${catalog ? 'catalog' : ''}`} style={{ background: 'transparent' }}>
      <span className="skill-icon-fallback" aria-hidden="true">{fallbackLabel}</span>
      {shortName && <img src={localUrl ?? fallbackUrl} alt={name ?? ''} loading="lazy" onError={(event) => {
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
}

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
  return ability.isUltimate ? '终极' : '普通'
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

function PairSortButton({ label, sortKey, sort, onSort }: { label: string; sortKey: PairSortKey; sort: { key: PairSortKey; direction: SortDirection }; onSort: (key: PairSortKey) => void }) {
  const selected = sort.key === sortKey
  const Icon = selected ? sort.direction === 'asc' ? ChevronUp : ChevronDown : ArrowDownUp
  return <button className={`pair-sort-button ${selected ? 'selected' : ''}`} type="button" onClick={() => onSort(sortKey)}>
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

function EffectiveInteractionsPopover({ interactions, abilities }: { interactions: RecommendationInteraction[]; abilities: Map<number, Ability> }) {
  if (interactions.length === 0) return <div className="build-pairs-popover">当前构筑没有可信的独立互动。</div>

  return <div className="build-pairs-popover">
    {interactions.map((interaction) => {
      return <div className="build-effective-interaction" key={`${interaction.type}-${interaction.abilityIds.join('-')}`} title={`${interaction.type === 'pair' ? 'Pair' : 'Triple'} · 原始 ${formatPairPercent(interaction.rawSynergy, true)} · ${interaction.picks.toLocaleString()} 场`}>
        <span className="build-interaction-icons">{interaction.abilityIds.map((id, index) => {
          const ability = abilities.get(id)
          return <span className="build-interaction-icon" key={id}>{index > 0 && <span className="build-pair-plus">+</span>}<SkillIcon compact abilityId={ability?.id} shortName={ability?.shortName} name={ability?.name} isHero={ability?.isHero} /></span>
        })}</span>
        <strong className={interaction.synergy >= 0 ? 'positive' : 'negative'}>{formatPairPercent(interaction.synergy, true)}</strong>
      </div>
    })}
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

export default function App() {
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
  const [debugSlotIndex, setDebugSlotIndex] = useState<number>()
  const [manualSlotIndex, setManualSlotIndex] = useState<number>()
  const [manualPickerPosition, setManualPickerPosition] = useState<{ top: number; left: number; width: number }>()
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
    const parsed = parseLayoutDocument(saved)
    if (parsed) return parsed
    if (saved && typeof saved === 'object' && 'slots' in saved) {
      const legacy = saved as { slots?: unknown }
      return parseLayoutDocument({ version: 1, ...DEFAULT_IMAGE_SIZE, slots: legacy.slots }) ?? undefined
    }
    return undefined
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

  useEffect(() => {
    if (manualSlotIndex === undefined) return
    const close = () => closeManualPicker()
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [manualSlotIndex])

  const candidateTierInfo = useMemo(() => {
    const tiers = new Map<number, { rank: number; tier: AbilityTier }>()
    for (const category of ['heroes', 'abilities', 'ultimates'] as const) {
      for (const entry of buildAbilityTierList(snapshot, category)) {
        tiers.set(entry.ability.id, { rank: entry.rank, tier: entry.tier })
      }
    }
    return tiers
  }, [snapshot])
  const candidatePools = useMemo<BuildCandidatePools>(() => {
    const pools = { heroIds: [] as number[], normalIds: [] as number[], ultimateIds: [] as number[] }
    for (const slot of slots) {
      if (slot.selectedAbilityId === undefined) continue
      if (slot.category === 'hero') pools.heroIds.push(slot.selectedAbilityId)
      else if (slot.category === 'normal') pools.normalIds.push(slot.selectedAbilityId)
      else pools.ultimateIds.push(slot.selectedAbilityId)
    }
    const sortByTier = (ids: number[]) => [...new Set(ids)].sort((left, right) => {
      const rankDifference = (candidateTierInfo.get(left)?.rank ?? Number.POSITIVE_INFINITY) - (candidateTierInfo.get(right)?.rank ?? Number.POSITIVE_INFINITY)
      if (rankDifference !== 0) return rankDifference
      return (snapshot.abilities.find((ability) => ability.id === left)?.name ?? '').localeCompare(snapshot.abilities.find((ability) => ability.id === right)?.name ?? '')
    })
    return {
      heroIds: sortByTier(pools.heroIds),
      normalIds: sortByTier(pools.normalIds),
      ultimateIds: sortByTier(pools.ultimateIds),
    }
  }, [candidateTierInfo, slots, snapshot])
  const candidateIds = useMemo(
    () => [...new Set([...candidatePools.heroIds, ...candidatePools.normalIds, ...candidatePools.ultimateIds])],
    [candidatePools],
  )
  useEffect(() => {
    setSelectedIds((current) => {
      const selectedCounts: Record<keyof BuildCandidatePools, number> = { heroIds: 0, normalIds: 0, ultimateIds: 0 }
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
  const abilitiesById = useMemo(() => new Map(snapshot.abilities.map((ability) => [ability.id, ability])), [snapshot])
  const recommendations = useMemo(
    () => recommendBuilds(candidatePools, selectedIds, snapshot),
    [candidatePools, selectedIds, snapshot],
  )
  const tierEntries = useMemo(() => buildAbilityTierList(snapshot, tierCategory), [snapshot, tierCategory])
  const tierCategoryCounts = useMemo<Record<TierCategory, number>>(() => {
    const counts: Record<TierCategory, number> = { all: 0, ultimates: 0, heroes: 0, abilities: 0 }
    const rankedIds = new Set(snapshot.abilityStats.filter((stats) => stats.picks > 0).map((stats) => stats.abilityId))
    for (const item of snapshot.abilities) {
      if (!rankedIds.has(item.id)) continue
      for (const category of TIER_CATEGORY_OPTIONS) {
        if (matchesTierCategory(item, category.id)) counts[category.id] += 1
      }
    }
    return counts
  }, [snapshot])
  const filteredTierEntries = useMemo(() => {
    const query = tierQuery.trim().toLowerCase()
    if (!query) return tierEntries
    return tierEntries.filter((entry) => `${entry.ability.name} ${entry.ability.shortName}`.toLowerCase().includes(query))
  }, [tierEntries, tierQuery])
  const tierGroups = useMemo(() => {
    const groups: Record<AbilityTier, TierEntry[]> = { S: [], A: [], B: [], C: [], D: [], E: [], F: [] }
    for (const entry of filteredTierEntries) groups[entry.tier].push(entry)
    return groups
  }, [filteredTierEntries])
  const pairEntries = useMemo(
    () => buildAbilityPairList(snapshot, { excludeSameHero }),
    [excludeSameHero, snapshot],
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

  const ability = (id: number) => snapshot.abilities.find((item) => item.id === id)

  async function handleUpload(file: File) {
    const requestId = recognitionRequestRef.current + 1
    recognitionRequestRef.current = requestId
    recognitionWorkerRef.current?.terminate()
    recognitionWorkerRef.current = undefined
    setUploadedFile(file)
    setError(undefined)
    setSlots([])
    setSelectedIds([])
    setManualSlotIndex(undefined)
    setManualPickerPosition(undefined)
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
    const payload = { version: 1, width: imageSize.width, height: imageSize.height, slots: layout }
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
      setError('布局文件无效：需要正数尺寸、60 格且包含 hero / normal / ultimate 类别。')
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
      : snapshot.abilities.find((item) => item.name.toLowerCase() === normalized.toLowerCase())?.id
    setSlots((current) => current.map((slot) => slot.index === index ? { ...slot, selectedAbilityId } : slot))
  }

  function closeManualPicker() {
    setManualSlotIndex(undefined)
    setManualPickerPosition(undefined)
  }

  function scheduleManualPickerClose(index: number) {
    window.setTimeout(() => {
      setManualSlotIndex((current) => {
        if (current !== index) return current
        setManualPickerPosition(undefined)
        return undefined
      })
    }, 0)
  }

  function openManualPicker(input: HTMLInputElement, index: number) {
    const bounds = input.getBoundingClientRect()
    const width = Math.min(420, Math.max(bounds.width, 300))
    setManualSlotIndex(index)
    setManualPickerPosition({
      top: Math.max(8, Math.min(bounds.bottom + 4, window.innerHeight - 388)),
      left: Math.max(8, Math.min(bounds.left, window.innerWidth - width - 8)),
      width,
    })
  }

  function openManualPickerFromLabel(event: ReactMouseEvent<HTMLLabelElement>, index: number) {
    const input = event.currentTarget.querySelector('input')
    if (!input) return
    input.focus()
    openManualPicker(input, index)
  }

  function acceptSuggestions() {
    setSlots((current) => current.map((slot) => ({ ...slot, selectedAbilityId: slot.candidates[0]?.abilityId })))
  }

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
  const manualSlot = useMemo(
    () => manualSlotIndex === undefined ? undefined : slots.find((slot) => slot.index === manualSlotIndex),
    [manualSlotIndex, slots],
  )
  const expectedAbilityId = debugSlot ? goldenLabels[debugSlot.index] : undefined
  const expectedAbility = expectedAbilityId === undefined ? undefined : ability(expectedAbilityId)
  const expectedRank = debugSlot && expectedAbilityId !== undefined ? debugSlot.candidates.findIndex((candidate) => candidate.abilityId === expectedAbilityId) : -1
  const analysisSlots = useMemo(() => {
    const heroes = slots.filter((slot) => slot.category === 'hero')
    const normals = slots.filter((slot) => slot.category === 'normal')
    const ultimates = slots.filter((slot) => slot.category === 'ultimate')
    const orderedUltimates = ULTIMATE_SLOT_ORDER.map((position) => ultimates[position]).filter((slot): slot is RecognizedSlot => slot !== undefined)
    const rowCount = Math.max(heroes.length, Math.ceil(normals.length / 3), ultimates.length)

    return Array.from({ length: rowCount }, (_, row) => [
      heroes[row],
      normals[row * 3],
      normals[row * 3 + 1],
      normals[row * 3 + 2],
      orderedUltimates[row],
    ]).flat().filter((slot): slot is RecognizedSlot => slot !== undefined)
  }, [slots])

  return (
    <Tooltip.Provider delayDuration={250} skipDelayDuration={150}>
    <main className="shell">
      <header className="app-header">
        <div>
          <p className="eyebrow">DOTA 2 / OMG</p>
          <h1>OMG-Draft-Seer</h1>
        </div>
        <nav className="page-tabs" aria-label="Main pages">
          {appPages.map((page) => {
            const Icon = page.icon
            const selected = activePage === page.id
            return <button
              key={page.id}
              type="button"
              className={selected ? 'selected' : ''}
              aria-current={selected ? 'page' : undefined}
              onClick={() => setActivePage(page.id)}
            ><Icon size={15} />{page.label}</button>
          })}
        </nav>
        <div className="snapshot-meta">
          <span>Patch {snapshot.patch}</span>
          <span className="status-dot" />
          <span>本地快照</span>
        </div>
      </header>

      {(activePage === 'analysis' || activePage === 'layout') && <section className={`workspace ${activePage === 'analysis' ? 'analysis-workspace' : 'layout-workspace'} ${activePage === 'layout' && debugSlot ? 'has-debug-panel' : ''}`}>
        <div className="source-pane">
          <div className="section-heading">
            <div>
              <p className="eyebrow">01 / 截图</p>
              <h2>候选技能池</h2>
            </div>
           </div>
          {activePage === 'layout' && <div className="layout-page-heading"><p className="eyebrow">02 / LAYOUT</p><h2>Layout Analysis</h2></div>}
          <input
            ref={inputRef}
            className="visually-hidden"
            type="file"
            accept="image/png,image/jpeg"
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
                  <AlertDialog.Trigger asChild><button type="button"><RotateCcw size={15} /> Reset</button></AlertDialog.Trigger>
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

          {activePage === 'analysis' && slots.length > 0 && (
            <div className="slot-grid-scroll">
              <div className="slot-grid-header" aria-hidden="true">
                <span className="hero">英雄</span>
                <span className="normal">技能1</span>
                <span className="normal">技能2</span>
                <span className="normal">技能3</span>
                <span className="ultimate">终极技能</span>
              </div>
              <div className="slot-grid">
              {analysisSlots.map((slot) => {
                const best = slot.candidates[0]
                const bestAbility = best && ability(best.abilityId)
                const selectedAbility = slot.selectedAbilityId !== undefined ? ability(slot.selectedAbilityId) : undefined
                const displayedAbility = selectedAbility ?? bestAbility
                return (
                  <div className="skill-slot-group" key={slot.index}>
                    <label className={`skill-slot ${slot.selectedAbilityId !== undefined ? 'confirmed' : ''}`} onClick={(event) => openManualPickerFromLabel(event, slot.index)}>
                      <span className="slot-index">{slotLabel(slot.index)}</span>
                      <SkillIcon abilityId={displayedAbility?.id} shortName={displayedAbility?.shortName} name={displayedAbility?.name} isHero={displayedAbility?.isHero} />
                      <input
                        readOnly
                        value={selectedAbility?.name ?? ''}
                        placeholder={bestAbility?.name ?? '未知'}
                        onFocus={(event) => openManualPicker(event.currentTarget, slot.index)}
                        onClick={(event) => openManualPicker(event.currentTarget, slot.index)}
                        onBlur={() => scheduleManualPickerClose(slot.index)}
                      />
                    </label>
                  </div>
                )
              })}
              </div>
            </div>
          )}
          {manualSlot && manualPickerPosition && <div
            className="manual-candidates manual-candidates-floating"
            style={{ top: manualPickerPosition.top, left: manualPickerPosition.left, width: manualPickerPosition.width }}
          >
            {manualSlot.candidates.map((candidate, index) => {
              const item = ability(candidate.abilityId)
              if (!item) return null
              return <button
                type="button"
                className="manual-candidate"
                key={candidate.abilityId}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  updateSlot(manualSlot.index, String(candidate.abilityId))
                  closeManualPicker()
                }}
              >
                <span className="candidate-rank">{index + 1}</span>
                <SkillIcon abilityId={item.id} shortName={item.shortName} name={item.name} isHero={item.isHero} />
                <span className="candidate-name">{item.name}</span>
              </button>
            })}
          </div>}
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
              {slots.length > 0 && <button className="icon-command" title="采用当前第一候选" onClick={acceptSuggestions}><Check size={17} /></button>}
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
                      <div><dt>Win Rate</dt><dd>{(recommendation.abilityWinRate * 100).toFixed(1)}%</dd></div>
                      <div className="build-pairs-stat" tabIndex={0} aria-label={`Synergy ${recommendation.synergy >= 0 ? '+' : ''}${(recommendation.synergy * 100).toFixed(1)} percent, ${recommendation.effectiveInteractionCount} independent interactions`}><dt>Synergy</dt><dd>{recommendation.synergy > 0 ? '+' : ''}{(recommendation.synergy * 100).toFixed(1)}%<small>有效 {recommendation.effectiveInteractionCount} 组</small></dd><EffectiveInteractionsPopover interactions={recommendation.effectiveInteractions} abilities={abilitiesById} /></div>
                      <div><dt>Avg Pick #</dt><dd>{recommendation.averagePickPosition.toFixed(1)}</dd></div>
                    </dl>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="empty-results"><FileImage size={24} /><p>确认至少 1 个英雄、3 个普通技能和 1 个终极技能后生成构筑。</p></div>
          )}
        </aside>}
      </section>}

      {activePage === 'database' && <section className="tier-page" aria-labelledby="tier-page-title">
        <div className="tier-page-header">
          <div>
            <p className="eyebrow">03 / ABILITY TIERS</p>
            <h2 id="tier-page-title">Ability Tier List</h2>
            <p className="tier-page-subtitle">Patch {snapshot.patch} · {tierCategoryCounts[tierCategory]} ranked entries</p>
          </div>
          <div className="tier-page-mark"><Layers size={21} aria-hidden="true" /><span>WIN RATE PERCENTILE</span></div>
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
            <input value={tierQuery} onChange={(event) => setTierQuery(event.target.value)} placeholder="Search abilities" />
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
            <input value={pairQuery} onChange={(event) => setPairQuery(event.target.value)} placeholder="Search ability pairs..." />
          </label>
          <div className="pairs-toolbar-actions">
            <span className="pairs-sample-note">Minimum 50 picks</span>
            <button className={`pairs-toggle ${excludeSameHero ? 'selected' : ''}`} type="button" aria-pressed={excludeSameHero} onClick={() => setExcludeSameHero((current) => !current)}>
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
                <th><span className="pair-header-label">Hidden Triples <span className="pair-help" title="Third abilities from comparable triplet data. These can explain inflated pair synergy.">?</span></span></th>
              </tr>
            </thead>
            <tbody>
              {pairTopSpacer > 0 && <tr className="pair-virtual-spacer" aria-hidden="true"><td colSpan={7} style={{ height: pairTopSpacer }} /></tr>}
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
                  <td><HiddenTriplesCell entries={entry.hiddenTriples} /></td>
                </tr>
              })}
              {pairBottomSpacer > 0 && <tr className="pair-virtual-spacer" aria-hidden="true"><td colSpan={7} style={{ height: pairBottomSpacer }} /></tr>}
              {filteredPairEntries.length === 0 && <tr><td className="pairs-empty" colSpan={7}><Search size={22} /><p>{pairQuery.trim() ? 'No ability pairs match your search.' : 'No ability pairs found.'}</p></td></tr>}
            </tbody>
          </table>
        </div>
      </section>}
    </main>
    <Toaster position="bottom-right" theme="dark" visibleToasts={3} toastOptions={{ className: 'omg-toast', duration: 3500 }} />
    </Tooltip.Provider>
  )
}
