import { describe, expect, it } from 'vitest'
import { projectAbilityDraftResourceSlots } from './dota2-ability-draft-resource-layout'
import { buildProjectedLayout } from './projective-layout'

const VALIDATED_RESOLUTIONS = [
  [1834, 786],
  [1920, 1080],
  [1920, 1200],
  [1920, 1440],
  [2560, 1440],
] as const

describe('resource-projected layout', () => {
  it('projects all slots inside validated resolutions', () => {
    for (const [width, height] of VALIDATED_RESOLUTIONS) {
      const layout = buildProjectedLayout(width, height)

      expect(layout, `${width}x${height}`).toBeDefined()
      expect(layout, `${width}x${height}`).toHaveLength(60)
      expect(
        layout!.filter((slot) => slot.category === 'hero'),
        `${width}x${height}`,
      ).toHaveLength(12)
      expect(
        layout!.filter((slot) => slot.category === 'ability'),
        `${width}x${height}`,
      ).toHaveLength(36)
      expect(
        layout!.filter((slot) => slot.category === 'ultimate'),
        `${width}x${height}`,
      ).toHaveLength(12)
      for (const slot of layout!) {
        expect(slot.matchQuad, `${width}x${height}`).toBeDefined()
        expect(slot.rect.x).toBeGreaterThanOrEqual(0)
        expect(slot.rect.y).toBeGreaterThanOrEqual(0)
        expect(slot.rect.x + slot.rect.width).toBeLessThanOrEqual(width)
        expect(slot.rect.y + slot.rect.height).toBeLessThanOrEqual(height)
      }
    }
  })

  it('uses height scaling for 4:3 and wider viewports', () => {
    const reference = projectAbilityDraftResourceSlots(2560, 1440)[12]
    const wide = projectAbilityDraftResourceSlots(3440, 1440)[12]
    const scaled = projectAbilityDraftResourceSlots(1920, 1080)[12]

    expect(
      wide.matchQuad.topLeft.x - reference.matchQuad.topLeft.x,
    ).toBeCloseTo(440, 9)
    expect(wide.matchQuad.topLeft.y).toBeCloseTo(
      reference.matchQuad.topLeft.y,
      9,
    )
    expect(scaled.matchQuad.topLeft.x).toBeCloseTo(
      960 + (reference.matchQuad.topLeft.x - 1280) * 0.75,
      9,
    )
    expect(scaled.matchQuad.topLeft.y).toBeCloseTo(
      540 + (reference.matchQuad.topLeft.y - 720) * 0.75,
      9,
    )
  })

  it('centers a 4:3 viewport inside narrower screenshots', () => {
    const reference = projectAbilityDraftResourceSlots(2560, 1440)[12]
    const narrow = projectAbilityDraftResourceSlots(1280, 1024)[12]

    expect(narrow.matchQuad.topLeft.x).toBeCloseTo(
      640 + (reference.matchQuad.topLeft.x - 1280) * (960 / 1440),
      9,
    )
    expect(narrow.matchQuad.topLeft.y).toBeCloseTo(
      512 + (reference.matchQuad.topLeft.y - 720) * (960 / 1440),
      9,
    )
  })

  it('rejects invalid dimensions so callers can use the fixed fallback', () => {
    expect(buildProjectedLayout(0, 1440)).toBeUndefined()
    expect(buildProjectedLayout(1920.5, 1080)).toBeUndefined()
  })
})
