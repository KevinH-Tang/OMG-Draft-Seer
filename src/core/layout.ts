import defaultLayoutJson from '../../omg-layout-2560x1440.json'
import type { Rect, SlotCategory } from '../types'

export const SUPPORTED_WIDTH = 2560
export const SUPPORTED_HEIGHT = 1440
export const MATCH_CROP_RATIO = 0.76

export interface FixedSlot {
  category: SlotCategory
  rect: Rect
}

export interface LayoutDocument {
  version: 1
  width: number
  height: number
  slots: FixedSlot[]
}

const SLOT_CATEGORIES: readonly SlotCategory[] = ['hero', 'ability', 'ultimate']
const SLOT_CATEGORY_COUNTS: Record<SlotCategory, number> = {
  hero: 12,
  ability: 36,
  ultimate: 12,
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isSlotCategory(value: unknown): value is SlotCategory {
  return (
    typeof value === 'string' && SLOT_CATEGORIES.includes(value as SlotCategory)
  )
}

function isRectWithinCanvas(
  rect: Rect,
  width: number,
  height: number,
): boolean {
  return (
    Number.isFinite(rect.x) &&
    Number.isFinite(rect.y) &&
    Number.isFinite(rect.width) &&
    Number.isFinite(rect.height) &&
    rect.x >= 0 &&
    rect.y >= 0 &&
    rect.width > 0 &&
    rect.height > 0 &&
    rect.x + rect.width <= width &&
    rect.y + rect.height <= height
  )
}

export function parseLayoutDocument(value: unknown): LayoutDocument | null {
  if (!isRecord(value) || value.version !== 1) return null
  const width = value.width
  const height = value.height
  if (
    typeof width !== 'number' ||
    typeof height !== 'number' ||
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width <= 0 ||
    height <= 0
  )
    return null
  if (!Array.isArray(value.slots) || value.slots.length !== 60) return null

  const slots: FixedSlot[] = []
  for (const item of value.slots) {
    if (
      !isRecord(item) ||
      !isSlotCategory(item.category) ||
      !isRecord(item.rect)
    )
      return null
    const rect: Rect = {
      x: Number(item.rect.x),
      y: Number(item.rect.y),
      width: Number(item.rect.width),
      height: Number(item.rect.height),
    }
    if (!isRectWithinCanvas(rect, width, height)) return null
    slots.push({ category: item.category, rect })
  }

  const categoryCounts = slots.reduce<Record<SlotCategory, number>>(
    (counts, slot) => {
      counts[slot.category] += 1
      return counts
    },
    { hero: 0, ability: 0, ultimate: 0 },
  )
  if (
    SLOT_CATEGORIES.some(
      (category) => categoryCounts[category] !== SLOT_CATEGORY_COUNTS[category],
    )
  )
    return null

  return { version: 1, width, height, slots }
}

const parsedDefaultLayout = parseLayoutDocument(defaultLayoutJson)
if (!parsedDefaultLayout) throw new Error('Invalid default OMG layout document')

export const DEFAULT_LAYOUT_DOCUMENT: LayoutDocument = parsedDefaultLayout
export const FIXED_SLOT_LAYOUT: readonly FixedSlot[] =
  DEFAULT_LAYOUT_DOCUMENT.slots

export const FIXED_SLOT_RECTS: readonly Rect[] = FIXED_SLOT_LAYOUT.map(
  (slot) => slot.rect,
)

const ULTIMATE_SLOT_LABELS = [
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
] as const
export const ULTIMATE_SLOT_ORDER = [
  0, 5, 1, 4, 2, 3, 6, 11, 7, 10, 8, 9,
] as const

export function slotLabel(index: number): string {
  if (index >= 0 && index < 12) return `H${index + 1}`
  if (index >= 12 && index < 48) return `A${index - 11}`
  if (index >= 48 && index < 60) return ULTIMATE_SLOT_LABELS[index - 48]
  return String(index + 1)
}

export function validateScreenshotDimensions(
  width: number,
  height: number,
): string | null {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return `图片尺寸无效：当前图片为 ${width}×${height}。`
  }
  return null
}

export function cropCenter(rect: Rect, ratio = MATCH_CROP_RATIO): Rect {
  const insetX = (rect.width * (1 - ratio)) / 2
  const insetY = (rect.height * (1 - ratio)) / 2
  return {
    x: Math.round(rect.x + insetX),
    y: Math.round(rect.y + insetY),
    width: Math.round(rect.width * ratio),
    height: Math.round(rect.height * ratio),
  }
}

export function clampRectToCanvas(
  rect: Rect,
  canvasWidth = SUPPORTED_WIDTH,
  canvasHeight = SUPPORTED_HEIGHT,
): Rect {
  const width = Math.min(canvasWidth, Math.max(1, Math.round(rect.width)))
  const height = Math.min(canvasHeight, Math.max(1, Math.round(rect.height)))
  return {
    x: Math.min(Math.max(0, Math.round(rect.x)), canvasWidth - width),
    y: Math.min(Math.max(0, Math.round(rect.y)), canvasHeight - height),
    width,
    height,
  }
}

export function scaleRect(
  rect: Rect,
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
): Rect {
  return clampRectToCanvas(
    {
      x: (rect.x * targetWidth) / sourceWidth,
      y: (rect.y * targetHeight) / sourceHeight,
      width: (rect.width * targetWidth) / sourceWidth,
      height: (rect.height * targetHeight) / sourceHeight,
    },
    targetWidth,
    targetHeight,
  )
}

export function scaleLayoutToCanvas(
  layout: readonly FixedSlot[],
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
): FixedSlot[] {
  return layout.map((slot) => ({
    category: slot.category,
    rect: scaleRect(
      slot.rect,
      sourceWidth,
      sourceHeight,
      targetWidth,
      targetHeight,
    ),
  }))
}
