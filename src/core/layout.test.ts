import { describe, expect, it } from 'vitest'
import {
  clampRectToCanvas,
  cropCenter,
  DEFAULT_LAYOUT_DOCUMENT,
  FIXED_SLOT_LAYOUT,
  FIXED_SLOT_RECTS,
  parseLayoutDocument,
  scaleLayoutToCanvas,
  slotLabel,
  SUPPORTED_HEIGHT,
  SUPPORTED_WIDTH,
  ULTIMATE_SLOT_ORDER,
  validateScreenshotDimensions,
} from './layout'

describe('default screenshot layout', () => {
  it('contains 12 heroes, 36 abilities and 12 ultimate skills inside the image', () => {
    expect(DEFAULT_LAYOUT_DOCUMENT.width).toBe(SUPPORTED_WIDTH)
    expect(DEFAULT_LAYOUT_DOCUMENT.height).toBe(SUPPORTED_HEIGHT)
    expect(FIXED_SLOT_RECTS).toHaveLength(60)
    expect(
      FIXED_SLOT_LAYOUT.filter((slot) => slot.category === 'hero'),
    ).toHaveLength(12)
    expect(
      FIXED_SLOT_LAYOUT.filter((slot) => slot.category === 'ability'),
    ).toHaveLength(36)
    expect(
      FIXED_SLOT_LAYOUT.filter((slot) => slot.category === 'ultimate'),
    ).toHaveLength(12)
    for (const rect of FIXED_SLOT_RECTS) {
      expect(rect.x).toBeGreaterThanOrEqual(0)
      expect(rect.y).toBeGreaterThanOrEqual(0)
      expect(rect.x + rect.width).toBeLessThanOrEqual(SUPPORTED_WIDTH)
      expect(rect.y + rect.height).toBeLessThanOrEqual(SUPPORTED_HEIGHT)
    }
  })

  it('keeps the slot order stable for recognition and user confirmation', () => {
    expect(
      FIXED_SLOT_LAYOUT.slice(0, 12).every((slot) => slot.category === 'hero'),
    ).toBe(true)
    expect(
      FIXED_SLOT_LAYOUT.slice(12, 48).every(
        (slot) => slot.category === 'ability',
      ),
    ).toBe(true)
    expect(
      FIXED_SLOT_LAYOUT.slice(48).every((slot) => slot.category === 'ultimate'),
    ).toBe(true)
  })

  it('labels match boxes by category and physical ultimate position', () => {
    expect(slotLabel(0)).toBe('H1')
    expect(slotLabel(11)).toBe('H12')
    expect(slotLabel(12)).toBe('A1')
    expect(slotLabel(47)).toBe('A36')
    expect(
      Array.from({ length: 12 }, (_, index) => slotLabel(index + 48)),
    ).toEqual([
      'U1',
      'U3',
      'U5',
      'U6',
      'U4',
      'U2',
      'U7',
      'U9',
      'U11',
      'U12',
      'U10',
      'U8',
    ])
    expect(
      ULTIMATE_SLOT_ORDER.map((position) => slotLabel(position + 48)),
    ).toEqual([
      'U1',
      'U2',
      'U3',
      'U4',
      'U5',
      'U6',
      'U7',
      'U8',
      'U9',
      'U10',
      'U11',
      'U12',
    ])
  })

  it('accepts valid layout documents and rejects malformed imports', () => {
    expect(parseLayoutDocument(DEFAULT_LAYOUT_DOCUMENT)).toMatchObject({
      version: 1,
      width: 2560,
      height: 1440,
    })
    expect(
      parseLayoutDocument({ ...DEFAULT_LAYOUT_DOCUMENT, version: 2 }),
    ).toBeNull()
    expect(
      parseLayoutDocument({
        ...DEFAULT_LAYOUT_DOCUMENT,
        slots: DEFAULT_LAYOUT_DOCUMENT.slots.slice(0, 59),
      }),
    ).toBeNull()
    expect(
      parseLayoutDocument({
        ...DEFAULT_LAYOUT_DOCUMENT,
        slots: DEFAULT_LAYOUT_DOCUMENT.slots.map((slot) => ({
          ...slot,
          category: 'hero' as const,
        })),
      }),
    ).toBeNull()
    expect(
      parseLayoutDocument({
        ...DEFAULT_LAYOUT_DOCUMENT,
        slots: DEFAULT_LAYOUT_DOCUMENT.slots.map((slot, index) =>
          index === 0 ? { ...slot, rect: { ...slot.rect, x: -1 } } : slot,
        ),
      }),
    ).toBeNull()
    expect(
      parseLayoutDocument({
        ...DEFAULT_LAYOUT_DOCUMENT,
        slots: DEFAULT_LAYOUT_DOCUMENT.slots.map((slot, index) =>
          index === 12 ? { ...slot, category: 'normal' } : slot,
        ),
      }),
    ).toBeNull()
  })

  it('accepts positive integer input dimensions and rejects invalid dimensions', () => {
    expect(validateScreenshotDimensions(2560, 1440)).toBeNull()
    expect(validateScreenshotDimensions(1920, 1080)).toBeNull()
    expect(validateScreenshotDimensions(0, 1080)).not.toBeNull()
    expect(validateScreenshotDimensions(1920.5, 1080)).not.toBeNull()
  })

  it('scales the JSON layout to the input image dimensions', () => {
    const scaled = scaleLayoutToCanvas(
      FIXED_SLOT_LAYOUT,
      SUPPORTED_WIDTH,
      SUPPORTED_HEIGHT,
      1280,
      720,
    )

    expect(scaled[0]).toEqual({
      category: 'hero',
      rect: { x: 407, y: 224, width: 54, height: 40 },
    })
    expect(scaled).toHaveLength(60)
    for (const slot of scaled) {
      expect(slot.rect.x + slot.rect.width).toBeLessThanOrEqual(1280)
      expect(slot.rect.y + slot.rect.height).toBeLessThanOrEqual(720)
    }
  })

  it('crops the center without escaping its slot', () => {
    const crop = cropCenter({ x: 100, y: 200, width: 78, height: 78 })
    expect(crop).toEqual({ x: 109, y: 209, width: 59, height: 59 })
  })

  it('clamps imported and dragged rectangles to the screenshot canvas', () => {
    expect(
      clampRectToCanvas({ x: -20, y: 1430, width: 100, height: 30 }),
    ).toEqual({
      x: 0,
      y: 1410,
      width: 100,
      height: 30,
    })
    expect(
      clampRectToCanvas({ x: 0, y: 0, width: 9999, height: 9999 }),
    ).toEqual({
      x: 0,
      y: 0,
      width: SUPPORTED_WIDTH,
      height: SUPPORTED_HEIGHT,
    })
  })
})
