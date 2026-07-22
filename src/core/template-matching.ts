import type { Ability, IconCandidate, IconSignature, SlotCategory } from '../types'
import { matchesSlotCategory } from './ability-category'
import { MAX_MATCH_CANDIDATES } from './matching'

export const TEMPLATE_SIZE = 16

export interface CropSignature {
  luma: Uint8Array
  meanRgb: [number, number, number]
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

export function signatureFromRgba(data: Uint8ClampedArray | Uint8Array, width: number, height: number, transform?: ImageTransform): CropSignature {
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
      const targetX = (x + 0.5) * squareSize / TEMPLATE_SIZE - center - shiftX
      const targetY = (y + 0.5) * squareSize / TEMPLATE_SIZE - center - shiftY
      const sourceX = Math.floor(offsetX + center + cosine * targetX - sine * targetY)
      const sourceY = Math.floor(offsetY + center + sine * targetX + cosine * targetY)
      if (sourceX < offsetX || sourceX >= offsetX + squareSize || sourceY < offsetY || sourceY >= offsetY + squareSize) continue
      const offset = (sourceY * width + sourceX) * 4
      const r = data[offset]
      const g = data[offset + 1]
      const b = data[offset + 2]
      luma[y * TEMPLATE_SIZE + x] = Math.round(r * 0.2126 + g * 0.7152 + b * 0.0722)
      red += r
      green += g
      blue += b
    }
  }
  const samples = TEMPLATE_SIZE * TEMPLATE_SIZE
  return { luma, meanRgb: [Math.round(red / samples), Math.round(green / samples), Math.round(blue / samples)] }
}

export function structuralSimilarity(left: Uint8Array, right: Uint8Array): number {
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

export function colorSimilarity(left: [number, number, number], right: [number, number, number]): number {
  const distance = Math.sqrt(left.reduce((sum, value, index) => sum + (value - right[index]) ** 2, 0))
  return Math.max(0, 1 - distance / 441.67)
}

export function templateScore(crop: CropSignature, template: { luma: Uint8Array; meanRgb: [number, number, number] }): number {
  return structuralSimilarity(crop.luma, template.luma) * 0.76 + colorSimilarity(crop.meanRgb, template.meanRgb) * 0.24
}

export type DecodedTemplate = { luma: Uint8Array; meanRgb: [number, number, number] }

export function decodeTemplateSignatures(signatures: IconSignature[]): Map<number, DecodedTemplate[]> {
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
    .filter((ability) => matchesSlotCategory(ability, category) && templates.has(ability.id))
    .map((ability) => ({ abilityId: ability.id, score: Math.max(...templates.get(ability.id)!.map((template) => templateScore(crop, template))) }))
    .sort((left, right) => right.score - left.score)
    .slice(0, MAX_MATCH_CANDIDATES)
}
