import type { Ability, IconCandidate, SlotCategory } from '../types'
import { matchesSlotCategory } from './ability-category'
import { MAX_MATCH_CANDIDATES } from './matching'

export type Rgb = readonly [number, number, number]

const RGB_CACHE = new Map<string, Rgb>()
const COLOR_MATCHER_CACHE = new WeakMap<Ability[], ColorMatcher>()

interface ColorCandidate {
  abilityId: number
  color: Rgb
}

export interface ColorMatcher {
  candidatesByCategory: Readonly<
    Record<SlotCategory, readonly ColorCandidate[]>
  >
}

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
  const distance = Math.sqrt(
    source.reduce((sum, value, index) => sum + (value - target[index]) ** 2, 0),
  )
  return Math.max(0, 1 - distance / 441.67)
}

export function buildColorMatcher(abilities: Ability[]): ColorMatcher {
  const cached = COLOR_MATCHER_CACHE.get(abilities)
  if (cached) return cached

  const candidatesByCategory: Record<SlotCategory, ColorCandidate[]> = {
    hero: [],
    ability: [],
    ultimate: [],
  }
  for (const ability of abilities) {
    if (!ability.iconColor) continue
    const category = (['hero', 'ability', 'ultimate'] as const).find((value) =>
      matchesSlotCategory(ability, value),
    )
    if (!category) continue
    candidatesByCategory[category].push({
      abilityId: ability.id,
      color: hexToRgb(ability.iconColor),
    })
  }

  const matcher = { candidatesByCategory }
  COLOR_MATCHER_CACHE.set(abilities, matcher)
  return matcher
}

function insertTopCandidate(
  candidates: IconCandidate[],
  candidate: IconCandidate,
): void {
  if (!Number.isFinite(candidate.score)) return
  let index = 0
  while (
    index < candidates.length &&
    candidates[index].score >= candidate.score
  )
    index += 1
  if (
    index >= MAX_MATCH_CANDIDATES &&
    candidates.length >= MAX_MATCH_CANDIDATES
  )
    return
  candidates.splice(index, 0, candidate)
  if (candidates.length > MAX_MATCH_CANDIDATES) candidates.pop()
}

export function rankByColor(
  source: Rgb,
  abilities: Ability[],
  category: SlotCategory,
  matcher = buildColorMatcher(abilities),
): IconCandidate[] {
  const candidates: IconCandidate[] = []
  for (const entry of matcher.candidatesByCategory[category]) {
    insertTopCandidate(candidates, {
      abilityId: entry.abilityId,
      score: similarityFromRgb(source, entry.color),
    })
  }
  return candidates
}

export function confidenceLabel(score: number): 'high' | 'medium' | 'low' {
  if (score >= 0.9) return 'high'
  if (score >= 0.75) return 'medium'
  return 'low'
}
