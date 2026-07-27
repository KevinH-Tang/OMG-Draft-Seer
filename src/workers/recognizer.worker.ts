/// <reference lib="webworker" />
import {
  clampRectToCanvas,
  cropCenter,
  type FixedSlot,
  type RuntimeSlot,
} from '../core/layout'
import { buildProjectedLayout, quadBounds } from '../core/projective-layout'
import { rankByColor, type Rgb } from '../core/recognition'
import {
  decodeTemplateSignatures,
  rankByTemplate,
  signatureFromRgba,
} from '../core/template-matching'
import type { Ability, IconSignature, RecognizedSlot } from '../types'

interface Request {
  image: ImageBitmap
  abilities: Ability[]
  layout?: FixedSlot[]
  fallbackLayout: FixedSlot[]
  signatures: IconSignature[]
}

function meanColor(data: Uint8ClampedArray): Rgb {
  let red = 0
  let green = 0
  let blue = 0
  const pixels = data.length / 4
  for (let index = 0; index < data.length; index += 4) {
    red += data[index]
    green += data[index + 1]
    blue += data[index + 2]
  }
  return [
    Math.round(red / pixels),
    Math.round(green / pixels),
    Math.round(blue / pixels),
  ]
}

self.onmessage = async (event: MessageEvent<Request>) => {
  const { image, abilities, layout, fallbackLayout, signatures } = event.data
  const templates =
    signatures.length > 0 ? decodeTemplateSignatures(signatures) : undefined
  const canvas = new OffscreenCanvas(image.width, image.height)
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('无法创建离屏画布')
  context.drawImage(image, 0, 0)
  const projectedLayout = layout
    ? undefined
    : buildProjectedLayout(image.width, image.height)
  const activeLayout: RuntimeSlot[] =
    layout ?? projectedLayout ?? fallbackLayout
  const layoutSource = layout
    ? 'manual'
    : projectedLayout
      ? 'projected'
      : 'fixed-fallback'
  const slots: RecognizedSlot[] = activeLayout.map((slot, index) => {
    const safeRect = clampRectToCanvas(slot.rect, image.width, image.height)
    const crop = slot.matchQuad
      ? clampRectToCanvas(quadBounds(slot.matchQuad), image.width, image.height)
      : cropCenter(safeRect)
    const pixels = context.getImageData(crop.x, crop.y, crop.width, crop.height)
    const cropSignature = signatureFromRgba(
      pixels.data,
      pixels.width,
      pixels.height,
    )
    return {
      index,
      category: slot.category,
      rect: safeRect,
      crop,
      matchQuad: slot.matchQuad,
      candidates: templates
        ? rankByTemplate(cropSignature, abilities, slot.category, templates)
        : rankByColor(meanColor(pixels.data), abilities, slot.category),
      matchMode: templates ? 'template' : 'color-fallback',
      layoutSource,
    }
  })
  image.close()
  self.postMessage({ slots })
}
