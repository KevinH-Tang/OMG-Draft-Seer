import { describe, expect, it } from 'vitest'
import { confidenceLabel, hexToRgb, rankByColor, similarityFromRgb } from './recognition'
import { MAX_MATCH_CANDIDATES } from './matching'
import { demoSnapshot } from '../data/demoSnapshot'

describe('color fallback recognition', () => {
  it('converts colors and gives an exact signature full confidence', () => {
    expect(hexToRgb('#3ab0d2')).toEqual([58, 176, 210])
    expect(similarityFromRgb([58, 176, 210], [58, 176, 210])).toBe(1)
    expect(confidenceLabel(0.91)).toBe('high')
    expect(confidenceLabel(0.8)).toBe('medium')
    expect(confidenceLabel(0.4)).toBe('low')
  })

  it('puts the nearest reference first and returns up to ten options', () => {
    const ranked = rankByColor([58, 176, 210], demoSnapshot.abilities, 'ability')
    expect(ranked).toHaveLength(Math.min(MAX_MATCH_CANDIDATES, 7))
    expect(ranked[0]).toMatchObject({ abilityId: 5048, score: 1 })
  })
})
