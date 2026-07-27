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

export function templateScore(
  crop: CropSignature,
  template: { luma: Uint8Array; meanRgb: [number, number, number] },
): number {
  return (
    structuralSimilarity(crop.luma, template.luma) * 0.76 +
    colorSimilarity(crop.meanRgb, template.meanRgb) * 0.24
  )
}

export type DecodedTemplate = {
  luma: Uint8Array
  meanRgb: [number, number, number]
}

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

export function rankByTemplate(
  crop: CropSignature,
  abilities: Ability[],
  category: SlotCategory,
  templates: Map<number, DecodedTemplate[]>,
): IconCandidate[] {
  return abilities
    .filter(
      (ability) =>
        matchesSlotCategory(ability, category) && templates.has(ability.id),
    )
    .map((ability) => ({
      abilityId: ability.id,
      score: Math.max(
        ...templates
          .get(ability.id)!
          .map((template) => templateScore(crop, template)),
      ),
    }))
    .sort((left, right) => right.score - left.score)
    .slice(0, MAX_MATCH_CANDIDATES)
}
