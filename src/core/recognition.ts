import type { Ability, IconCandidate, SlotCategory } from '../types'
import { matchesSlotCategory } from './ability-category'
import { MAX_MATCH_CANDIDATES } from './matching'

export type Rgb = readonly [number, number, number]

const RGB_CACHE = new Map<string, Rgb>()

export function hexToRgb(color: string): Rgb {
  const normalized = color.replace('#', '')
  const cached = RGB_CACHE.get(normalized)
  if (cached) return cached
  const rgb: Rgb = [
    Number.parseInt(normalized.slice(0, 2), 16),
    Number.parseInt(normalized.slice(2, 4), 16),
    Number.parseInt(normalized.slice(4, 6), 16),
  ]
  RGB_CACHE.set(normalized, rgb)
  return rgb
}

export function similarityFromRgb(source: Rgb, target: Rgb): number {
  const distance = Math.sqrt(source.reduce((sum, value, index) => sum + (value - target[index]) ** 2, 0))
  return Math.max(0, 1 - distance / 441.67)
}

export function rankByColor(source: Rgb, abilities: Ability[], category: SlotCategory): IconCandidate[] {
  return abilities
    .filter((ability) => ability.iconColor && matchesSlotCategory(ability, category))
    .map((ability) => ({ abilityId: ability.id, score: similarityFromRgb(source, hexToRgb(ability.iconColor)) }))
    .sort((left, right) => right.score - left.score)
    .slice(0, MAX_MATCH_CANDIDATES)
}

export function confidenceLabel(score: number): 'high' | 'medium' | 'low' {
  if (score >= 0.9) return 'high'
  if (score >= 0.75) return 'medium'
  return 'low'
}
