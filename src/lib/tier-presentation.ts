import type { AbilityTier } from '../core/tiers'

export const TIER_COLORS: Record<AbilityTier, string> = {
  S: '#ff7f7f',
  A: '#ffbf7f',
  B: '#ffdf7f',
  C: '#ffff7f',
  D: '#bfff7f',
  E: '#7fbfff',
  F: '#bf7fbf',
}

export const TIER_TEXT_CLASSES: Record<AbilityTier, string> = {
  S: 'text-[#ff7f7f]',
  A: 'text-[#ffbf7f]',
  B: 'text-[#ffdf7f]',
  C: 'text-[#ffff7f]',
  D: 'text-[#bfff7f]',
  E: 'text-[#7fbfff]',
  F: 'text-[#bf7fbf]',
}

export const TIER_STROKE_COLORS = TIER_COLORS
