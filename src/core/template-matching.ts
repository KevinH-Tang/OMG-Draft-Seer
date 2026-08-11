import type {
  Ability,
  IconCandidate,
  IconSignature,
  Quad,
  SlotCategory,
} from '../types'
import { matchesSlotCategory } from './ability-category'
import { MAX_MATCH_CANDIDATES } from './matching'

export const TEMPLATE_SIZE = 16
export const TEMPLATE_COARSE_SIZE = 4
export const TEMPLATE_COARSE_CANDIDATES = 32
export const TEMPLATE_EDGE_RERANK_CANDIDATES = 16

const STRUCTURE_WEIGHT = 0.41
const EDGE_WEIGHT = 0.35
const COLOR_WEIGHT = 0.24

export interface CropSignature {
  luma: Uint8Array
  meanRgb: [number, number, number]
}

interface Homography {
  x0: number
  x1: number
  x2: number
  y0: number
  y1: number
  y2: number
  denominatorX: number
  denominatorY: number
}

export interface ImageTransform {
  name: string
  shiftX?: number
  shiftY?: number
  rotationDegrees?: number
}

export const TEMPLATE_TRANSFORMS: readonly ImageTransform[] = [
  { name: 'base' },
  { name: 'right-4px', shiftX: 4 },
  { name: 'left-4px', shiftX: -4 },
  { name: 'down-4px', shiftY: 4 },
  { name: 'up-4px', shiftY: -4 },
  { name: 'cw-5deg', rotationDegrees: 5 },
  { name: 'ccw-5deg', rotationDegrees: -5 },
]

export function signatureFromRgba(
  data: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  transform?: ImageTransform,
): CropSignature {
  const luma = new Uint8Array(TEMPLATE_SIZE * TEMPLATE_SIZE)
  const squareSize = Math.min(width, height)
  const offsetX = Math.floor((width - squareSize) / 2)
  const offsetY = Math.floor((height - squareSize) / 2)
  const shiftX = transform?.shiftX ?? 0
  const shiftY = transform?.shiftY ?? 0
  const angle = -((transform?.rotationDegrees ?? 0) * Math.PI) / 180
  const cosine = Math.cos(angle)
  const sine = Math.sin(angle)
  const center = squareSize / 2
  let red = 0
  let green = 0
  let blue = 0
  for (let y = 0; y < TEMPLATE_SIZE; y += 1) {
    for (let x = 0; x < TEMPLATE_SIZE; x += 1) {
      const targetX = ((x + 0.5) * squareSize) / TEMPLATE_SIZE - center - shiftX
      const targetY = ((y + 0.5) * squareSize) / TEMPLATE_SIZE - center - shiftY
      const sourceX = Math.floor(
        offsetX + center + cosine * targetX - sine * targetY,
      )
      const sourceY = Math.floor(
        offsetY + center + sine * targetX + cosine * targetY,
      )
      if (
        sourceX < offsetX ||
        sourceX >= offsetX + squareSize ||
        sourceY < offsetY ||
        sourceY >= offsetY + squareSize
      )
        continue
      const offset = (sourceY * width + sourceX) * 4
      const r = data[offset]
      const g = data[offset + 1]
      const b = data[offset + 2]
      luma[y * TEMPLATE_SIZE + x] = Math.round(
        r * 0.2126 + g * 0.7152 + b * 0.0722,
      )
      red += r
      green += g
      blue += b
    }
  }
  const samples = TEMPLATE_SIZE * TEMPLATE_SIZE
  return {
    luma,
    meanRgb: [
      Math.round(red / samples),
      Math.round(green / samples),
      Math.round(blue / samples),
    ],
  }
}

function solveQuadHomography(quad: Quad): Homography {
  const points = [
    quad.topLeft,
    quad.topRight,
    quad.bottomRight,
    quad.bottomLeft,
  ]
  const destinations: [number, number][] = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ]
  const matrix: number[][] = []
  const values: number[] = []

  points.forEach((point, index) => {
    const [u, v] = destinations[index]
    matrix.push([u, v, 1, 0, 0, 0, -point.x * u, -point.x * v])
    values.push(point.x)
    matrix.push([0, 0, 0, u, v, 1, -point.y * u, -point.y * v])
    values.push(point.y)
  })

  for (let column = 0; column < 8; column += 1) {
    let pivot = column
    for (let row = column + 1; row < 8; row += 1) {
      if (Math.abs(matrix[row][column]) > Math.abs(matrix[pivot][column]))
        pivot = row
    }
    if (Math.abs(matrix[pivot][column]) < 1e-8)
      throw new Error('Invalid quadrilateral')

    ;[matrix[column], matrix[pivot]] = [matrix[pivot], matrix[column]]
    ;[values[column], values[pivot]] = [values[pivot], values[column]]
    const divisor = matrix[column][column]
    for (let index = column; index < 8; index += 1)
      matrix[column][index] /= divisor
    values[column] /= divisor

    for (let row = 0; row < 8; row += 1) {
      if (row === column) continue
      const factor = matrix[row][column]
      for (let index = column; index < 8; index += 1)
        matrix[row][index] -= factor * matrix[column][index]
      values[row] -= factor * values[column]
    }
  }

  return {
    x0: values[0],
    x1: values[1],
    x2: values[2],
    y0: values[3],
    y1: values[4],
    y2: values[5],
    denominatorX: values[6],
    denominatorY: values[7],
  }
}

function sampleBilinear(
  data: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
): [number, number, number] {
  const clampedX = Math.min(width - 1, Math.max(0, x))
  const clampedY = Math.min(height - 1, Math.max(0, y))
  const left = Math.floor(clampedX)
  const top = Math.floor(clampedY)
  const right = Math.min(width - 1, left + 1)
  const bottom = Math.min(height - 1, top + 1)
  const horizontal = clampedX - left
  const vertical = clampedY - top
  const topLeft = (top * width + left) * 4
  const topRight = (top * width + right) * 4
  const bottomLeft = (bottom * width + left) * 4
  const bottomRight = (bottom * width + right) * 4
  const inverseHorizontal = 1 - horizontal
  const inverseVertical = 1 - vertical

  const red =
    (data[topLeft] * inverseHorizontal + data[topRight] * horizontal) *
      inverseVertical +
    (data[bottomLeft] * inverseHorizontal + data[bottomRight] * horizontal) *
      vertical
  const green =
    (data[topLeft + 1] * inverseHorizontal + data[topRight + 1] * horizontal) *
      inverseVertical +
    (data[bottomLeft + 1] * inverseHorizontal +
      data[bottomRight + 1] * horizontal) *
      vertical
  const blue =
    (data[topLeft + 2] * inverseHorizontal + data[topRight + 2] * horizontal) *
      inverseVertical +
    (data[bottomLeft + 2] * inverseHorizontal +
      data[bottomRight + 2] * horizontal) *
      vertical

  return [red, green, blue]
}

export function signatureFromQuad(
  data: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  quad: Quad,
  offsetX = 0,
  offsetY = 0,
): CropSignature {
  const homography = solveQuadHomography(quad)
  const luma = new Uint8Array(TEMPLATE_SIZE * TEMPLATE_SIZE)
  let red = 0
  let green = 0
  let blue = 0

  for (let y = 0; y < TEMPLATE_SIZE; y += 1) {
    for (let x = 0; x < TEMPLATE_SIZE; x += 1) {
      const u = (x + 0.5) / TEMPLATE_SIZE
      const v = (y + 0.5) / TEMPLATE_SIZE
      const denominator =
        homography.denominatorX * u + homography.denominatorY * v + 1
      const sourceX =
        (homography.x0 * u + homography.x1 * v + homography.x2) / denominator -
        offsetX
      const sourceY =
        (homography.y0 * u + homography.y1 * v + homography.y2) / denominator -
        offsetY
      const [sampleRed, sampleGreen, sampleBlue] = sampleBilinear(
        data,
        width,
        height,
        sourceX,
        sourceY,
      )
      luma[y * TEMPLATE_SIZE + x] = Math.round(
        sampleRed * 0.2126 + sampleGreen * 0.7152 + sampleBlue * 0.0722,
      )
      red += sampleRed
      green += sampleGreen
      blue += sampleBlue
    }
  }

  const samples = TEMPLATE_SIZE * TEMPLATE_SIZE
  return {
    luma,
    meanRgb: [
      Math.round(red / samples),
      Math.round(green / samples),
      Math.round(blue / samples),
    ],
  }
}

export function structuralSimilarity(
  left: Uint8Array,
  right: Uint8Array,
): number {
  let leftMean = 0
  let rightMean = 0
  for (let index = 0; index < left.length; index += 1) {
    leftMean += left[index]
    rightMean += right[index]
  }
  leftMean /= left.length
  rightMean /= right.length
  let numerator = 0
  let leftEnergy = 0
  let rightEnergy = 0
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index] - leftMean
    const b = right[index] - rightMean
    numerator += a * b
    leftEnergy += a * a
    rightEnergy += b * b
  }
  if (leftEnergy === 0 || rightEnergy === 0) return 0
  return Math.max(0, (numerator / Math.sqrt(leftEnergy * rightEnergy) + 1) / 2)
}

export function colorSimilarity(
  left: [number, number, number],
  right: [number, number, number],
): number {
  const distance = Math.sqrt(
    left.reduce((sum, value, index) => sum + (value - right[index]) ** 2, 0),
  )
  return Math.max(0, 1 - distance / 441.67)
}

function edgeLuma(luma: Uint8Array): Uint8Array {
  const size = Math.sqrt(luma.length)
  const edges = new Uint8Array(luma.length)
  if (!Number.isInteger(size) || size < 3) return edges

  for (let y = 1; y < size - 1; y += 1) {
    for (let x = 1; x < size - 1; x += 1) {
      const index = y * size + x
      const horizontal =
        -luma[index - size - 1] +
        luma[index - size + 1] -
        2 * luma[index - 1] +
        2 * luma[index + 1] -
        luma[index + size - 1] +
        luma[index + size + 1]
      const vertical =
        -luma[index - size - 1] -
        2 * luma[index - size] -
        luma[index - size + 1] +
        luma[index + size - 1] +
        2 * luma[index + size] +
        luma[index + size + 1]
      edges[index] = Math.min(255, Math.hypot(horizontal, vertical) / 4)
    }
  }
  return edges
}

export function templateScore(
  crop: CropSignature,
  template: { luma: Uint8Array; meanRgb: [number, number, number] },
): number {
  return (
    structuralSimilarity(crop.luma, template.luma) * STRUCTURE_WEIGHT +
    structuralSimilarity(edgeLuma(crop.luma), edgeLuma(template.luma)) *
      EDGE_WEIGHT +
    colorSimilarity(crop.meanRgb, template.meanRgb) * COLOR_WEIGHT
  )
}

export type DecodedTemplate = {
  luma: Uint8Array
  meanRgb: [number, number, number]
}

interface PreparedTemplate {
  template: DecodedTemplate
  meanLuma: number
  centeredEnergy: number
  edge: PreparedLuma
  coarse: PreparedLuma
}

interface PreparedLuma {
  luma: Uint8Array
  meanLuma: number
  centeredEnergy: number
}

interface TemplateCandidate {
  abilityId: number
  templates: readonly PreparedTemplate[]
}

interface ScoredTemplateCandidate {
  entry: TemplateCandidate
  score: number
}

export interface TemplateMatcher {
  candidatesByCategory: Readonly<
    Record<SlotCategory, readonly TemplateCandidate[]>
  >
}

const TEMPLATE_MATCHER_CACHE = new WeakMap<
  Map<number, DecodedTemplate[]>,
  WeakMap<Ability[], TemplateMatcher>
>()

export function decodeTemplateSignatures(
  signatures: IconSignature[],
): Map<number, DecodedTemplate[]> {
  const templates = new Map<number, DecodedTemplate[]>()
  signatures.forEach((signature) => {
    const binary = atob(signature.luma)
    const luma = Uint8Array.from(binary, (character) => character.charCodeAt(0))
    const current = templates.get(signature.abilityId) ?? []
    current.push({ luma, meanRgb: signature.meanRgb })
    templates.set(signature.abilityId, current)
  })
  return templates
}

function prepareLuma(luma: Uint8Array): PreparedLuma {
  let meanLuma = 0
  for (const value of luma) meanLuma += value
  meanLuma /= luma.length

  let centeredEnergy = 0
  for (const value of luma) {
    const centered = value - meanLuma
    centeredEnergy += centered * centered
  }
  return { luma, meanLuma, centeredEnergy }
}

function downsampleLuma(luma: Uint8Array): Uint8Array {
  const downsampled = new Uint8Array(
    TEMPLATE_COARSE_SIZE * TEMPLATE_COARSE_SIZE,
  )
  const blockSize = TEMPLATE_SIZE / TEMPLATE_COARSE_SIZE
  for (let targetY = 0; targetY < TEMPLATE_COARSE_SIZE; targetY += 1) {
    for (let targetX = 0; targetX < TEMPLATE_COARSE_SIZE; targetX += 1) {
      let total = 0
      for (let y = 0; y < blockSize; y += 1) {
        for (let x = 0; x < blockSize; x += 1) {
          const sourceX = targetX * blockSize + x
          const sourceY = targetY * blockSize + y
          total += luma[sourceY * TEMPLATE_SIZE + sourceX]
        }
      }
      downsampled[targetY * TEMPLATE_COARSE_SIZE + targetX] = Math.round(
        total / (blockSize * blockSize),
      )
    }
  }
  return downsampled
}

function prepareTemplate(template: DecodedTemplate): PreparedTemplate {
  const prepared = prepareLuma(template.luma)
  return {
    template,
    meanLuma: prepared.meanLuma,
    centeredEnergy: prepared.centeredEnergy,
    edge: prepareLuma(edgeLuma(template.luma)),
    coarse: prepareLuma(downsampleLuma(template.luma)),
  }
}

export function buildTemplateMatcher(
  abilities: Ability[],
  templates: Map<number, DecodedTemplate[]>,
): TemplateMatcher {
  const byAbilities = TEMPLATE_MATCHER_CACHE.get(templates)
  const cached = byAbilities?.get(abilities)
  if (cached) return cached

  const candidatesByCategory: Record<SlotCategory, TemplateCandidate[]> = {
    hero: [],
    ability: [],
    ultimate: [],
  }
  for (const ability of abilities) {
    const decoded = templates.get(ability.id)
    if (!decoded || decoded.length === 0) continue
    const category = (['hero', 'ability', 'ultimate'] as const).find((value) =>
      matchesSlotCategory(ability, value),
    )
    if (!category) continue
    candidatesByCategory[category].push({
      abilityId: ability.id,
      templates: decoded.map(prepareTemplate),
    })
  }

  const matcher: TemplateMatcher = { candidatesByCategory }
  const entries = byAbilities ?? new WeakMap<Ability[], TemplateMatcher>()
  entries.set(abilities, matcher)
  if (!byAbilities) TEMPLATE_MATCHER_CACHE.set(templates, entries)
  return matcher
}

function cropLumaStatistics(luma: Uint8Array): {
  meanLuma: number
  centeredEnergy: number
} {
  let meanLuma = 0
  for (const value of luma) meanLuma += value
  meanLuma /= luma.length

  let centeredEnergy = 0
  for (const value of luma) {
    const centered = value - meanLuma
    centeredEnergy += centered * centered
  }
  return { meanLuma, centeredEnergy }
}

function preparedStructuralSimilarity(
  crop: CropSignature,
  cropStats: { meanLuma: number; centeredEnergy: number },
  template: PreparedTemplate,
): number {
  if (
    cropStats.centeredEnergy === 0 ||
    template.centeredEnergy === 0 ||
    crop.luma.length !== template.template.luma.length
  )
    return 0

  let numerator = 0
  for (let index = 0; index < crop.luma.length; index += 1) {
    numerator +=
      (crop.luma[index] - cropStats.meanLuma) *
      (template.template.luma[index] - template.meanLuma)
  }
  return Math.max(
    0,
    (numerator / Math.sqrt(cropStats.centeredEnergy * template.centeredEnergy) +
      1) /
      2,
  )
}

function preparedTemplateScore(
  crop: CropSignature,
  cropStats: { meanLuma: number; centeredEnergy: number },
  cropEdge: PreparedLuma,
  template: PreparedTemplate,
): number {
  return (
    preparedStructuralSimilarity(crop, cropStats, template) * STRUCTURE_WEIGHT +
    preparedLumaSimilarity(cropEdge, template.edge) * EDGE_WEIGHT +
    colorSimilarity(crop.meanRgb, template.template.meanRgb) * COLOR_WEIGHT
  )
}

function preparedBaseTemplateScore(
  crop: CropSignature,
  cropStats: { meanLuma: number; centeredEnergy: number },
  template: PreparedTemplate,
): number {
  return (
    preparedStructuralSimilarity(crop, cropStats, template) * 0.76 +
    colorSimilarity(crop.meanRgb, template.template.meanRgb) * COLOR_WEIGHT
  )
}

function insertTopCandidate(
  candidates: IconCandidate[],
  candidate: IconCandidate,
  limit = MAX_MATCH_CANDIDATES,
): void {
  if (!Number.isFinite(candidate.score)) return
  let index = 0
  while (
    index < candidates.length &&
    candidates[index].score >= candidate.score
  )
    index += 1
  if (index >= limit && candidates.length >= limit) return
  candidates.splice(index, 0, candidate)
  if (candidates.length > limit) candidates.pop()
}

function preparedLumaSimilarity(
  left: PreparedLuma,
  right: PreparedLuma,
): number {
  if (
    left.centeredEnergy === 0 ||
    right.centeredEnergy === 0 ||
    left.luma.length !== right.luma.length
  )
    return 0
  let numerator = 0
  for (let index = 0; index < left.luma.length; index += 1) {
    numerator +=
      (left.luma[index] - left.meanLuma) * (right.luma[index] - right.meanLuma)
  }
  return Math.max(
    0,
    (numerator / Math.sqrt(left.centeredEnergy * right.centeredEnergy) + 1) / 2,
  )
}

function shortlistTemplateCandidates(
  crop: CropSignature,
  entries: readonly TemplateCandidate[],
  limit: number,
): Set<number> | undefined {
  if (entries.length <= limit) return undefined
  const cropCoarse = prepareLuma(downsampleLuma(crop.luma))
  const candidates: IconCandidate[] = []
  for (const entry of entries) {
    let score = Number.NEGATIVE_INFINITY
    for (const template of entry.templates) {
      score = Math.max(
        score,
        preparedLumaSimilarity(cropCoarse, template.coarse) * 0.76 +
          colorSimilarity(crop.meanRgb, template.template.meanRgb) * 0.24,
      )
    }
    insertTopCandidate(candidates, { abilityId: entry.abilityId, score }, limit)
  }
  return new Set(candidates.map((candidate) => candidate.abilityId))
}

function rankPreparedTemplates(
  crop: CropSignature,
  entries: readonly TemplateCandidate[],
  shortlist?: ReadonlySet<number>,
  useEdgeReranking = false,
): IconCandidate[] {
  const cropStats = cropLumaStatistics(crop.luma)
  if (!useEdgeReranking) {
    const candidates: IconCandidate[] = []
    for (const entry of entries) {
      if (shortlist && !shortlist.has(entry.abilityId)) continue
      let score = Number.NEGATIVE_INFINITY
      for (const template of entry.templates)
        score = Math.max(
          score,
          preparedBaseTemplateScore(crop, cropStats, template),
        )
      insertTopCandidate(candidates, { abilityId: entry.abilityId, score })
    }
    return candidates
  }

  const rerankCandidates: ScoredTemplateCandidate[] = shortlist
    ? entries
        .filter((entry) => shortlist.has(entry.abilityId))
        .map((entry) => ({ entry, score: 0 }))
    : []
  if (!shortlist) {
    for (const entry of entries) {
      let score = Number.NEGATIVE_INFINITY
      for (const template of entry.templates)
        score = Math.max(
          score,
          preparedBaseTemplateScore(crop, cropStats, template),
        )
      let index = 0
      while (
        index < rerankCandidates.length &&
        rerankCandidates[index].score >= score
      )
        index += 1
      if (
        index >= TEMPLATE_EDGE_RERANK_CANDIDATES &&
        rerankCandidates.length >= TEMPLATE_EDGE_RERANK_CANDIDATES
      )
        continue
      rerankCandidates.splice(index, 0, { entry, score })
      if (rerankCandidates.length > TEMPLATE_EDGE_RERANK_CANDIDATES)
        rerankCandidates.pop()
    }
  }

  const cropEdge = prepareLuma(edgeLuma(crop.luma))
  const candidates: IconCandidate[] = []
  for (const { entry } of rerankCandidates) {
    let score = Number.NEGATIVE_INFINITY
    for (const template of entry.templates)
      score = Math.max(
        score,
        preparedTemplateScore(crop, cropStats, cropEdge, template),
      )
    insertTopCandidate(candidates, { abilityId: entry.abilityId, score })
  }
  return candidates
}

export function rankByTemplate(
  crop: CropSignature,
  abilities: Ability[],
  category: SlotCategory,
  templates: Map<number, DecodedTemplate[]> | TemplateMatcher,
): IconCandidate[] {
  const matcher =
    templates instanceof Map
      ? buildTemplateMatcher(abilities, templates)
      : templates
  const entries = matcher.candidatesByCategory[category]
  const useEdgeReranking = category === 'ability'
  return rankPreparedTemplates(
    crop,
    entries,
    shortlistTemplateCandidates(
      crop,
      entries,
      useEdgeReranking
        ? TEMPLATE_EDGE_RERANK_CANDIDATES
        : TEMPLATE_COARSE_CANDIDATES,
    ),
    useEdgeReranking,
  )
}

export function rankByTemplateExhaustive(
  crop: CropSignature,
  abilities: Ability[],
  category: SlotCategory,
  templates: Map<number, DecodedTemplate[]> | TemplateMatcher,
): IconCandidate[] {
  const matcher =
    templates instanceof Map
      ? buildTemplateMatcher(abilities, templates)
      : templates
  return rankPreparedTemplates(
    crop,
    matcher.candidatesByCategory[category],
    undefined,
    category === 'ability',
  )
}
