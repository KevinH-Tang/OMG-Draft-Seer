import type { Rect, SlotCategory } from '../types'

export const SUPPORTED_WIDTH = 2560
export const SUPPORTED_HEIGHT = 1440
export const MATCH_CROP_RATIO = 0.76

export interface FixedSlot {
  category: SlotCategory
  rect: Rect
}

export interface LayoutProfile {
  cellWidth: number
  cellHeight: number
  ultimateX: number
  ultimateY: number
  ultimateColumnGap: number
  ultimateRowGap: number
  boardY: number
  boardRowGap: number
  heroLeftX: number
  normalX: number
  normalColumnGap: number
  heroRightX: number
}

export const DEFAULT_LAYOUT_PROFILE: LayoutProfile = {
  cellWidth: 78,
  cellHeight: 78,
  ultimateX: 729,
  ultimateY: 162,
  ultimateColumnGap: 101,
  ultimateRowGap: 102,
  boardY: 364,
  boardRowGap: 92,
  heroLeftX: 652,
  normalX: 754,
  normalColumnGap: 101,
  heroRightX: 1339,
}

const rect = (x: number, y: number, profile: LayoutProfile): Rect => ({ x, y, width: profile.cellWidth, height: profile.cellHeight })

export function buildFixedSlotLayout(profile: LayoutProfile): FixedSlot[] {
  const boardRows = Array.from({ length: 6 }, (_, index) => profile.boardY + index * profile.boardRowGap)
  return [
    ...boardRows.flatMap((y) => [
      { category: 'hero' as const, rect: rect(profile.heroLeftX, y, profile) },
      { category: 'hero' as const, rect: rect(profile.heroRightX, y, profile) },
    ]),
    ...boardRows.flatMap((y) => Array.from({ length: 6 }, (_, index) => ({
      category: 'normal' as const,
      rect: rect(profile.normalX + index * profile.normalColumnGap, y, profile),
    }))),
    ...Array.from({ length: 2 }, (_, row) => Array.from({ length: 6 }, (_, column) => ({
      category: 'ultimate' as const,
      rect: rect(profile.ultimateX + column * profile.ultimateColumnGap, profile.ultimateY + row * profile.ultimateRowGap, profile),
    }))).flat(),
  ]
}

export const FIXED_SLOT_LAYOUT: readonly FixedSlot[] = buildFixedSlotLayout(DEFAULT_LAYOUT_PROFILE)

export const FIXED_SLOT_RECTS: readonly Rect[] = FIXED_SLOT_LAYOUT.map((slot) => slot.rect)

const ULTIMATE_SLOT_LABELS = ['U1', 'U3', 'U5', 'U6', 'U4', 'U2', 'U7', 'U9', 'U11', 'U12', 'U10', 'U8'] as const
export const ULTIMATE_SLOT_ORDER = [0, 5, 1, 4, 2, 3, 6, 11, 7, 10, 8, 9] as const

export function slotLabel(index: number): string {
  if (index >= 0 && index < 12) return `H${index + 1}`
  if (index >= 12 && index < 48) return `A${index - 11}`
  if (index >= 48 && index < 60) return ULTIMATE_SLOT_LABELS[index - 48]
  return String(index + 1)
}

export function validateScreenshotDimensions(width: number, height: number): string | null {
  if (width !== SUPPORTED_WIDTH || height !== SUPPORTED_HEIGHT) {
    return `首版仅支持 ${SUPPORTED_WIDTH}×${SUPPORTED_HEIGHT} 截图；当前图片为 ${width}×${height}。`
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

export function clampRectToCanvas(rect: Rect, canvasWidth = SUPPORTED_WIDTH, canvasHeight = SUPPORTED_HEIGHT): Rect {
  const width = Math.min(canvasWidth, Math.max(1, Math.round(rect.width)))
  const height = Math.min(canvasHeight, Math.max(1, Math.round(rect.height)))
  return {
    x: Math.min(Math.max(0, Math.round(rect.x)), canvasWidth - width),
    y: Math.min(Math.max(0, Math.round(rect.y)), canvasHeight - height),
    width,
    height,
  }
}
