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
  signatureFromQuad,
  signatureFromRgba,
} from '../core/template-matching'
import type { Ability, IconSignature, RecognizedSlot } from '../types'

interface Request {
  image: ImageBitmap
  abilities: Ability[]
  layout?: FixedSlot[]
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

self.onmessage = (event: MessageEvent<Request>) => {
  void handleRecognitionRequest(event.data).catch((error: unknown) => {
    // A throw inside this async handler only rejects its own promise, which
    // nothing awaits — re-throwing from a timer callback turns it back into
    // an uncaught exception so it reaches the owning Worker's `error` event
    // (and thus `worker.onerror` in App.tsx) instead of vanishing silently.
    setTimeout(() => {
      throw error
    })
  })
}

async function handleRecognitionRequest(request: Request): Promise<void> {
  const { image, abilities, layout, signatures } = request
  const templates =
    signatures.length > 0 ? decodeTemplateSignatures(signatures) : undefined
  const canvas = new OffscreenCanvas(image.width, image.height)
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('无法创建离屏画布')
  context.drawImage(image, 0, 0)
  const projectedLayout = layout
    ? undefined
    : buildProjectedLayout(image.width, image.height)
  const activeLayout: RuntimeSlot[] | undefined = layout ?? projectedLayout
  if (!activeLayout) {
    image.close()
    throw new Error('无法生成资源投影布局')
  }
  const layoutSource = layout ? 'manual' : 'projected'
  const slots: RecognizedSlot[] = activeLayout.map((slot, index) => {
    const safeRect = clampRectToCanvas(slot.rect, image.width, image.height)
    const crop = slot.matchQuad
      ? clampRectToCanvas(quadBounds(slot.matchQuad), image.width, image.height)
      : cropCenter(safeRect)
    const pixels = context.getImageData(crop.x, crop.y, crop.width, crop.height)
    const cropSignature = slot.matchQuad
      ? signatureFromQuad(
          pixels.data,
          pixels.width,
          pixels.height,
          slot.matchQuad,
          crop.x,
          crop.y,
        )
      : signatureFromRgba(pixels.data, pixels.width, pixels.height)
    const candidates = templates
      ? rankByTemplate(cropSignature, abilities, slot.category, templates)
      : rankByColor(meanColor(pixels.data), abilities, slot.category)

    return {
      index,
      category: slot.category,
      rect: safeRect,
      crop,
      matchQuad: slot.matchQuad,
      candidates,
      matchMode: templates ? 'template' : 'color-fallback',
      layoutSource,
    }
  })
  image.close()
  self.postMessage({ slots })
}
