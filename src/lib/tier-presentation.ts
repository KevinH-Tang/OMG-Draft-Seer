import type { AbilityTier } from '../core/tiers'

export const TIER_TEXT_CLASSES: Record<AbilityTier, string> = {
  S: 'text-warning',
  A: 'text-orange-400',
  B: 'text-positive',
  C: 'text-accent',
  D: 'text-text-muted',
  E: 'text-cyan-300',
  F: 'text-violet-300',
}

export const TIER_STROKE_COLORS: Record<AbilityTier, string> = {
  S: 'var(--color-warning)',
  A: '#fb923c',
  B: 'var(--color-positive)',
  C: 'var(--color-accent)',
  D: 'var(--color-text-muted)',
  E: '#67e8f9',
  F: '#c4b5fd',
}
