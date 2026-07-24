/// <reference lib="webworker" />
import { clampRectToCanvas, cropCenter, type FixedSlot } from '../core/layout'
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
  layout: FixedSlot[]
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
  const { image, abilities, layout, signatures } = event.data
  const templates =
    signatures.length > 0 ? decodeTemplateSignatures(signatures) : undefined
  const canvas = new OffscreenCanvas(image.width, image.height)
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('无法创建离屏画布')
  context.drawImage(image, 0, 0)
  const slots: RecognizedSlot[] = layout.map(({ rect, category }, index) => {
    const safeRect = clampRectToCanvas(rect, image.width, image.height)
    const crop = cropCenter(safeRect)
    const pixels = context.getImageData(crop.x, crop.y, crop.width, crop.height)
    const cropSignature = signatureFromRgba(
      pixels.data,
      crop.width,
      crop.height,
    )
    return {
      index,
      category,
      rect: safeRect,
      crop,
      candidates: templates
        ? rankByTemplate(cropSignature, abilities, category, templates)
        : rankByColor(meanColor(pixels.data), abilities, category),
      matchMode: templates ? 'template' : 'color-fallback',
    }
  })
  image.close()
  self.postMessage({ slots })
}
