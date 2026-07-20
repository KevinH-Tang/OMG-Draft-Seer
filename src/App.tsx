import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { Bug, Check, CircleAlert, Database, Download, FileImage, FolderOpen, LayoutPanelTop, RefreshCw, RotateCcw, ScanSearch, Settings2, Sparkles, Upload } from 'lucide-react'
import { demoSnapshot } from './data/demoSnapshot'
import { buildFixedSlotLayout, clampRectToCanvas, cropCenter, DEFAULT_LAYOUT_PROFILE, MATCH_CROP_RATIO, slotLabel, SUPPORTED_HEIGHT, SUPPORTED_WIDTH, ULTIMATE_SLOT_ORDER, validateScreenshotDimensions, type FixedSlot, type LayoutProfile } from './core/layout'
import { recommendBuilds } from './core/recommendation'
import { localAbilityIconUrl, remoteAbilityIconUrl } from './core/icon-path'
import type { IconSignature, RecognizedSlot, Rect, Snapshot } from './types'

const categoryLabel = { hero: '英雄', normal: '普通', ultimate: '终极' } as const
const goldenLabels: Record<number, number> = { 6: -41, 50: 5342 }
type IconCatalogCategory = 'ultimate' | 'hero' | 'normal'
type AppPage = 'analysis' | 'layout' | 'database'

const appPages: Array<{ id: AppPage; label: string; icon: typeof ScanSearch }> = [
  { id: 'analysis', label: '截图上传技能分析', icon: ScanSearch },
  { id: 'layout', label: 'Layout 分析', icon: LayoutPanelTop },
  { id: 'database', label: '数据库', icon: Database },
]

const iconCatalogTabs: Array<{ id: IconCatalogCategory; label: string }> = [
  { id: 'ultimate', label: 'Ultimates' },
  { id: 'hero', label: 'Heroes' },
  { id: 'normal', label: 'Abilities' },
]

const calibrationGroups: Array<{ title: string; fields: Array<[keyof LayoutProfile, string]> }> = [
  { title: 'Tile', fields: [['cellWidth', 'width'], ['cellHeight', 'height']] },
  { title: 'Ultimate 2x6', fields: [['ultimateX', 'x'], ['ultimateY', 'y'], ['ultimateColumnGap', 'column gap'], ['ultimateRowGap', 'row gap']] },
  { title: 'Board 6 rows', fields: [['boardY', 'y'], ['boardRowGap', 'row gap'], ['heroLeftX', 'left hero x'], ['normalX', 'normal x'], ['normalColumnGap', 'normal gap'], ['heroRightX', 'right hero x']] },
]

const DEBUG_CONTEXT_PADDING = 12
const DEBUG_PREVIEW_SIZE = 240
const DEBUG_BORDER_WIDTH = 2
const DEBUG_MATCH_CANDIDATES = 5

function isRectWithinCanvas(rect: Rect | undefined): rect is Rect {
  if (!rect) return false
  return Number.isFinite(rect.x) && Number.isFinite(rect.y)
    && Number.isFinite(rect.width) && Number.isFinite(rect.height)
    && rect.x >= 0 && rect.y >= 0 && rect.width > 0 && rect.height > 0
    && rect.x + rect.width <= SUPPORTED_WIDTH && rect.y + rect.height <= SUPPORTED_HEIGHT
}

function SkillIcon({ abilityId, shortName, name, color, isHero, compact = false, catalog = false }: { abilityId?: number; shortName?: string; name?: string; color?: string; isHero?: boolean; compact?: boolean; catalog?: boolean }) {
  const localUrl = shortName ? localAbilityIconUrl(abilityId, shortName, isHero) : undefined
  const fallbackUrl = shortName ? remoteAbilityIconUrl(shortName, isHero) : undefined
  return (
    <span className={`skill-icon ${compact ? 'compact' : ''} ${catalog ? 'catalog' : ''}`} style={{ background: 'transparent' }}>
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
  const inputRef = useRef<HTMLInputElement>(null)
  const [screenshotUrl, setScreenshotUrl] = useState<string>()
  const [slots, setSlots] = useState<RecognizedSlot[]>([])
  const [error, setError] = useState<string>()
  const [loading, setLoading] = useState(false)
  const [selectedIds, setSelectedIds] = useState<number[]>([])
  const [snapshot, setSnapshot] = useState<Snapshot>(demoSnapshot)
  const [iconSignatures, setIconSignatures] = useState<IconSignature[]>([])
  const [iconDatabaseReady, setIconDatabaseReady] = useState(false)
  const [iconCatalogCategory, setIconCatalogCategory] = useState<IconCatalogCategory>('ultimate')
  const [activePage, setActivePage] = useState<AppPage>('analysis')
  const [debugSlotIndex, setDebugSlotIndex] = useState<number>()
  const [manualSlotIndex, setManualSlotIndex] = useState<number>()
  const [manualPickerPosition, setManualPickerPosition] = useState<{ top: number; left: number; width: number }>()
  const [uploadedFile, setUploadedFile] = useState<File>()
  const [calibrationOpen, setCalibrationOpen] = useState(false)
  const [layoutProfile, setLayoutProfile] = useState<LayoutProfile>(() => {
    try {
      const saved = localStorage.getItem('omg-layout-profile-v1')
      return saved ? { ...DEFAULT_LAYOUT_PROFILE, ...JSON.parse(saved) } : DEFAULT_LAYOUT_PROFILE
    } catch {
      return DEFAULT_LAYOUT_PROFILE
    }
  })
  const [layoutOverrides, setLayoutOverrides] = useState<Record<number, Rect>>(() => {
    try {
      return JSON.parse(localStorage.getItem('omg-layout-overrides-v1') ?? '{}') as Record<number, Rect>
    } catch {
      return {}
    }
  })
  const layoutOverridesRef = useRef(layoutOverrides)
  const [dragState, setDragState] = useState<{ index: number; mode: 'move' | 'resize'; startX: number; startY: number; startRect: Rect }>()
  const overlayRef = useRef<SVGSVGElement>(null)
  const layoutFileRef = useRef<HTMLInputElement>(null)
  const [importedLayout, setImportedLayout] = useState<FixedSlot[] | undefined>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('omg-layout-file-v1') ?? 'null') as { slots?: FixedSlot[] } | null
      return saved?.slots?.length === 60 ? saved.slots : undefined
    } catch {
      return undefined
    }
  })

  useEffect(() => {
    fetch('/data/snapshots/latest.json')
      .then((response) => response.ok ? response.json() as Promise<Snapshot> : Promise.reject(new Error('no local snapshot')))
      .then(setSnapshot)
      .catch(() => setError('本地 Windrun 快照加载失败，当前使用演示数据。'))
  }, [])

  useEffect(() => {
    fetch('/data/icon-signatures.json')
      .then((response) => response.ok ? response.json() as Promise<{ signatures?: IconSignature[] }> : Promise.reject(new Error('no signatures')))
      .then((payload) => setIconSignatures(payload.signatures ?? []))
      .catch(() => setError('图标模板数据库加载失败，识别将使用颜色回退。'))
      .finally(() => setIconDatabaseReady(true))
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

  const candidateIds = useMemo(
    () => slots.flatMap((slot) => slot.selectedAbilityId ? [slot.selectedAbilityId] : []),
    [slots],
  )
  const layout = useMemo(
    () => (importedLayout ?? buildFixedSlotLayout(layoutProfile)).map((slot, index) => ({ ...slot, rect: clampRectToCanvas(layoutOverrides[index] ?? slot.rect) })),
    [importedLayout, layoutOverrides, layoutProfile],
  )
  const recommendations = useMemo(
    () => recommendBuilds(candidateIds, selectedIds, snapshot),
    [candidateIds, selectedIds, snapshot],
  )
  const iconCatalog = useMemo(() => {
    const signedAbilityIds = new Set(iconSignatures.map((signature) => signature.abilityId))
    const signedAbilities = snapshot.abilities.filter((item) => signedAbilityIds.has(item.id))
    return {
      ultimate: signedAbilities.filter((item) => !item.isHero && item.isUltimate),
      hero: signedAbilities.filter((item) => item.isHero),
      normal: signedAbilities.filter((item) => !item.isHero && !item.isUltimate),
    }
  }, [iconSignatures, snapshot.abilities])
  const ability = (id: number) => snapshot.abilities.find((item) => item.id === id)

  async function handleUpload(file: File) {
    setUploadedFile(file)
    setError(undefined)
    setSlots([])
    setSelectedIds([])
    setManualSlotIndex(undefined)
    setManualPickerPosition(undefined)
    setCalibrationOpen(true)
    setLoading(true)
    let bitmap: ImageBitmap | undefined
    let worker: Worker | undefined
    try {
      const decoded = await createImageBitmap(file)
      bitmap = decoded
      const dimensionError = validateScreenshotDimensions(decoded.width, decoded.height)
    if (dimensionError) {
      decoded.close()
      bitmap = undefined
      setError(dimensionError)
      setLoading(false)
      return
    }
    if (screenshotUrl) URL.revokeObjectURL(screenshotUrl)
    setScreenshotUrl(URL.createObjectURL(file))
    worker = new Worker(new URL('./workers/recognizer.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (event: MessageEvent<{ slots: RecognizedSlot[] }>) => {
      setSlots(event.data.slots)
      setDebugSlotIndex(0)
      setLoading(false)
      worker?.terminate()
    }
    worker.onerror = () => {
      setError('图标分析失败，请重新上传。')
      setLoading(false)
      worker?.terminate()
    }
    worker.postMessage({ image: decoded, abilities: snapshot.abilities, layout, signatures: iconSignatures }, [decoded])
    bitmap = undefined
    } catch {
      bitmap?.close()
      worker?.terminate()
      setError('无法读取或分析此图片，请确认文件有效后重试。')
      setLoading(false)
    }
  }

  function updateLayoutField(field: keyof LayoutProfile, value: string) {
    const numericValue = Number(value)
    if (!Number.isFinite(numericValue)) return
    setLayoutProfile((current) => {
      const next = { ...current, [field]: numericValue }
      localStorage.setItem('omg-layout-profile-v1', JSON.stringify(next))
      return next
    })
  }

  function resetLayout() {
    localStorage.removeItem('omg-layout-profile-v1')
    localStorage.removeItem('omg-layout-overrides-v1')
    localStorage.removeItem('omg-layout-file-v1')
    setLayoutProfile(DEFAULT_LAYOUT_PROFILE)
    setLayoutOverrides({})
    layoutOverridesRef.current = {}
    setImportedLayout(undefined)
  }

  function saveLayout() {
    const payload = { version: 1, width: SUPPORTED_WIDTH, height: SUPPORTED_HEIGHT, slots: layout }
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url
    link.download = 'omg-layout-2560x1440.json'
    link.click()
    URL.revokeObjectURL(url)
  }

  async function loadLayout(file: File) {
    try {
      const parsed = JSON.parse(await file.text()) as { version?: number; width?: number; height?: number; slots?: FixedSlot[] }
      const validSlots = parsed.version === 1 && parsed.width === SUPPORTED_WIDTH && parsed.height === SUPPORTED_HEIGHT && parsed.slots?.length === 60
        && parsed.slots.every((slot) => ['hero', 'normal', 'ultimate'].includes(slot.category)
          && isRectWithinCanvas(slot.rect))
      if (!validSlots || !parsed.slots) throw new Error('invalid layout')
      setImportedLayout(parsed.slots)
      setLayoutOverrides({})
      layoutOverridesRef.current = {}
      localStorage.setItem('omg-layout-file-v1', JSON.stringify(parsed))
      localStorage.removeItem('omg-layout-overrides-v1')
      setError(undefined)
    } catch {
      setError('布局文件无效：需要 2560×1440、60 格且包含 hero / normal / ultimate 类别。')
    }
  }

  function imagePoint(event: ReactPointerEvent<SVGSVGElement | SVGRectElement | SVGCircleElement>) {
    const bounds = overlayRef.current?.getBoundingClientRect()
    if (!bounds) return { x: 0, y: 0 }
    return { x: ((event.clientX - bounds.left) / bounds.width) * SUPPORTED_WIDTH, y: ((event.clientY - bounds.top) / bounds.height) * SUPPORTED_HEIGHT }
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
    const next = { ...layoutOverridesRef.current, [dragState.index]: clampRectToCanvas(rect) }
    layoutOverridesRef.current = next
    setLayoutOverrides(next)
  }

  function finishDrag() {
    localStorage.setItem('omg-layout-overrides-v1', JSON.stringify(layoutOverridesRef.current))
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
    setSelectedIds((current) => current.includes(id)
      ? current.filter((item) => item !== id)
      : current.length < 3 ? [...current, id] : current)
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
    <main className="shell">
      <header className="app-header">
        <div>
          <p className="eyebrow">DOTA 2 / OMG</p>
          <h1>Pick 分析台</h1>
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

      {activePage !== 'database' && <section className={`workspace ${activePage === 'analysis' ? 'analysis-workspace' : 'layout-workspace'} ${activePage === 'layout' && debugSlot ? 'has-debug-panel' : ''}`}>
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
              <small>{SUPPORTED_WIDTH} × {SUPPORTED_HEIGHT} PNG / JPG</small>
            </button> : <div className="layout-empty"><LayoutPanelTop size={24} /><p>Upload a screenshot in Skill Analysis before calibrating the layout.</p></div>
          ) : (
            <div className="screenshot-frame">
              <img src={screenshotUrl} alt="已上传的 Dota 2 选技截图" />
              <svg
                ref={overlayRef}
                className={`layout-overlay ${activePage === 'layout' && calibrationOpen ? 'calibrating' : ''}`}
                viewBox={`0 0 ${SUPPORTED_WIDTH} ${SUPPORTED_HEIGHT}`}
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
              <button className="icon-command" title="toggle layout calibration" onClick={() => setCalibrationOpen((current) => !current)}><Settings2 size={16} /></button>
            </div>
            {calibrationOpen && <>
              <p>Drag any frame to move it. Drag its bottom-right dot to resize it. Re-slice when all frames align.</p>
              <details className="advanced-calibration">
                <summary>Advanced numeric controls</summary>
                <div className="calibration-groups">
                  {calibrationGroups.map((group) => <div className="calibration-group" key={group.title}>
                    <strong>{group.title}</strong>
                    {group.fields.map(([field, label]) => <label key={field}>{label}<input type="number" value={layoutProfile[field]} onChange={(event) => updateLayoutField(field, event.target.value)} /></label>)}
                  </div>)}
                </div>
              </details>
              <input ref={layoutFileRef} className="visually-hidden" type="file" accept="application/json" onChange={(event) => event.target.files?.[0] && loadLayout(event.target.files[0])} />
              <div className="calibration-actions">
                <button onClick={() => layoutFileRef.current?.click()}><FolderOpen size={15} /> Load layout</button>
                <button onClick={saveLayout}><Download size={15} /> Save layout</button>
                <button onClick={resetLayout}><RotateCcw size={15} /> Reset</button>
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
                      <SkillIcon abilityId={displayedAbility?.id} shortName={displayedAbility?.shortName} name={displayedAbility?.name} color={displayedAbility?.iconColor} isHero={displayedAbility?.isHero} />
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
                <SkillIcon abilityId={item.id} shortName={item.shortName} name={item.name} color={item.iconColor} isHero={item.isHero} />
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
                        <span>{index + 1}</span><SkillIcon compact abilityId={candidate.abilityId} shortName={item?.shortName} name={item?.name} color={item?.iconColor} isHero={item?.isHero} />{item?.name ?? 'Unknown ability'}
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
            <legend>已选技能 <span>{selectedIds.length}/3</span></legend>
            <div className="choice-list">
              {[...new Set(candidateIds)].map((id) => {
                const item = ability(id)
                if (!item) return null
                return <button key={id} className={selectedIds.includes(id) ? 'active-choice' : ''} onClick={() => toggleSelected(id)}><SkillIcon compact abilityId={id} shortName={item.shortName} name={item.name} color={item.iconColor} isHero={item.isHero} />{item.name}</button>
              })}
              {candidateIds.length === 0 && <p className="muted">确认候选技能后在此选择已选项。</p>}
            </div>
          </fieldset>

          {recommendations.length > 0 ? (
            <div className="recommendations">
              <div className="next-pick">
                <span>建议下一手</span>
                <strong>{ability(recommendations[0].abilityIds.find((id) => !selectedIds.includes(id)) ?? recommendations[0].abilityIds[0])?.name}</strong>
              </div>
              {recommendations.map((recommendation, index) => (
                <article className="build-card" key={recommendation.abilityIds.join('-')}>
                  <div className="build-main">
                    <div className="build-detail">
                      <div className="build-header"><span>方案 {index + 1}</span></div>
                      <div className="build-abilities">{recommendation.abilityIds.map((id) => <span key={id} title={ability(id)?.name}><SkillIcon compact abilityId={id} shortName={ability(id)?.shortName} name={ability(id)?.name} color={ability(id)?.iconColor} isHero={ability(id)?.isHero} />{ability(id)?.name}</span>)}</div>
                    </div>
                    <dl className="build-stats">
                      <div><dt>Score</dt><dd>{recommendation.score.toFixed(1)}</dd></div>
                      <div><dt>Ability WR</dt><dd>{(recommendation.abilityWinRate * 100).toFixed(1)}%</dd></div>
                      <div><dt>Synergy</dt><dd>{recommendation.synergy > 0 ? '+' : ''}{(recommendation.synergy * 100).toFixed(1)}%</dd></div>
                      <div><dt>Avg Pick #</dt><dd>{recommendation.averagePickPosition.toFixed(1)}</dd></div>
                    </dl>
                  </div>
                  {recommendation.reasons.length > 3 && <p className="build-note">{recommendation.reasons.slice(3).join(' · ')}</p>}
                </article>
              ))}
            </div>
          ) : (
            <div className="empty-results"><FileImage size={24} /><p>确认至少 4 个候选技能后生成构筑。</p></div>
          )}
        </aside>}
      </section>}

      {activePage === 'database' && <section className="icon-database" aria-labelledby="icon-database-title">
        <div className="icon-database-header">
          <div>
            <p className="eyebrow">03 / ICON DATABASE</p>
            <h2 id="icon-database-title">Icon Database</h2>
          </div>
          <Database size={19} className="accent" aria-hidden="true" />
        </div>
        <div className="catalog-tabs" role="tablist" aria-label="Icon database categories">
          {iconCatalogTabs.map((tab) => {
            const selected = iconCatalogCategory === tab.id
            return <button
              key={tab.id}
              id={`icon-catalog-tab-${tab.id}`}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={`icon-catalog-panel-${tab.id}`}
              className={selected ? 'selected' : ''}
              onClick={() => setIconCatalogCategory(tab.id)}
            >
              {tab.label}<span>{iconCatalog[tab.id].length}</span>
            </button>
          })}
        </div>
        <div
          id={`icon-catalog-panel-${iconCatalogCategory}`}
          className="catalog-grid"
          role="tabpanel"
          aria-labelledby={`icon-catalog-tab-${iconCatalogCategory}`}
        >
          {!iconDatabaseReady && <p className="catalog-state">Loading icon database...</p>}
          {iconDatabaseReady && iconCatalog[iconCatalogCategory].length === 0 && <p className="catalog-state">No signed icons are available in this category.</p>}
          {iconCatalog[iconCatalogCategory].map((item) => (
            <article className="catalog-item" key={item.id} title={`${item.name} (${item.shortName})`}>
              <SkillIcon catalog abilityId={item.id} shortName={item.shortName} name={item.name} color={item.iconColor} isHero={item.isHero} />
              <span>{item.name}</span>
            </article>
          ))}
        </div>
      </section>}
    </main>
  )
}
