import { describe, expect, it } from 'vitest'
import { decodeTemplateSignatures, rankByTemplate, signatureFromRgba, structuralSimilarity, TEMPLATE_TRANSFORMS, templateScore } from './template-matching'
import type { Ability, SlotCategory } from '../types'

function rgba(pixels: Array<[number, number, number]>): Uint8ClampedArray {
  return new Uint8ClampedArray(pixels.flatMap(([red, green, blue]) => [red, green, blue, 255]))
}

describe('template matching', () => {
  it('keeps all required crop perturbations in the template bank', () => {
    expect(TEMPLATE_TRANSFORMS.map((transform) => transform.name)).toEqual([
      'base',
      'right-4px',
      'left-4px',
      'down-4px',
      'up-4px',
      'cw-5deg',
      'ccw-5deg',
    ])
  })

  it('creates a stable luminance signature from image pixels', () => {
    const source = rgba([[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 255]])
    const signature = signatureFromRgba(source, 2, 2)
    expect(signature.luma).toHaveLength(256)
    expect(signature.meanRgb).toEqual([128, 128, 128])
  })

  it('crops a non-square source around its pixel center', () => {
    const width = 4
    const height = 6
    const source = new Uint8ClampedArray(width * height * 4)
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const offset = (y * width + x) * 4
        const centerPixel = y >= 1 && y < 5
        source[offset] = centerPixel ? 0 : 255
        source[offset + 1] = centerPixel ? 255 : 0
        source[offset + 2] = 0
        source[offset + 3] = 255
      }
    }

    const signature = signatureFromRgba(source, width, height)
    expect(signature.meanRgb).toEqual([0, 255, 0])
  })

  it('ranks an identical template above a structurally different template', () => {
    const left = new Uint8Array([0, 40, 180, 255])
    const right = new Uint8Array([255, 180, 40, 0])
    expect(structuralSimilarity(left, left)).toBeCloseTo(1)
    const crop = { luma: left, meanRgb: [90, 100, 110] as [number, number, number] }
    expect(templateScore(crop, { luma: left, meanRgb: [90, 100, 110] })).toBeGreaterThan(templateScore(crop, { luma: right, meanRgb: [240, 20, 30] }))
  })

  it('decodes persisted signatures into per-ability template variants', () => {
    const luma = new Uint8Array(256).fill(42)
    const encoded = btoa(String.fromCharCode(...luma))
    const templates = decodeTemplateSignatures([{ abilityId: 7, variant: 'base', luma: encoded, meanRgb: [1, 2, 3] }])

    expect(templates.get(7)).toEqual([{ luma, meanRgb: [1, 2, 3] }])
  })

  it('returns the correct top-1 candidate for every required perturbation', () => {
    const abilities: Ability[] = [
      { id: 1, name: 'Target', shortName: 'target', isHero: false, isUltimate: false, iconColor: '#000000' },
      { id: 2, name: 'Distractor', shortName: 'distractor', isHero: false, isUltimate: false, iconColor: '#ffffff' },
    ]
    const category: SlotCategory = 'ability'
    const template = (value: number) => ({ luma: new Uint8Array(256).fill(value), meanRgb: [value, value, value] as [number, number, number] })
    const templates = new Map([
      [1, TEMPLATE_TRANSFORMS.map((_, index) => template(20 + index * 10))],
      [2, TEMPLATE_TRANSFORMS.map(() => template(220))],
    ])

    TEMPLATE_TRANSFORMS.forEach((_, index) => {
      const [top] = rankByTemplate(template(20 + index * 10), abilities, category, templates)
      expect(top?.abilityId).toBe(1)
    })
  })
})
