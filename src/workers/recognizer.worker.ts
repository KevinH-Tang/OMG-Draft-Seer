/// <reference lib="webworker" />
import { clampRectToCanvas, cropCenter, type RuntimeSlot } from '../core/layout'
import { buildProjectedLayout, quadBounds } from '../core/projective-layout'
import {
  buildColorMatcher,
  rankByColor,
  type ColorMatcher,
  type Rgb,
} from '../core/recognition'
import {
  buildTemplateMatcher,
  decodeTemplateSignatures,
  rankByTemplate,
  signatureFromQuad,
  signatureFromRgba,
  type TemplateMatcher,
} from '../core/template-matching'
import type { Ability, RecognizedSlot } from '../types'
import type {
  RecognitionWorkerRequest,
  RecognitionWorkerResponse,
  RecognitionWorkerTimings,
} from './recognizer-protocol'

interface RecognitionState {
  abilities: Ability[]
  templateMatcher?: TemplateMatcher
  colorMatcher?: ColorMatcher
  initializeMs: number
  warm: boolean
}

let state: RecognitionState | undefined

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

self.onmessage = (event: MessageEvent<RecognitionWorkerRequest>) => {
  try {
    if (event.data.type === 'initialize') initialize(event.data)
    else recognize(event.data)
  } catch (error: unknown) {
    const response: RecognitionWorkerResponse = {
      type: 'error',
      requestId:
        event.data.type === 'recognize' ? event.data.requestId : undefined,
      error: error instanceof Error ? error.message : 'Recognition failed',
    }
    self.postMessage(response)
  }
}

function initialize(
  request: Extract<RecognitionWorkerRequest, { type: 'initialize' }>,
): void {
  const startedAt = performance.now()
  const templates =
    request.signatures.length > 0
      ? decodeTemplateSignatures(request.signatures)
      : undefined
  state = {
    abilities: request.abilities,
    templateMatcher: templates
      ? buildTemplateMatcher(request.abilities, templates)
      : undefined,
    colorMatcher: templates ? undefined : buildColorMatcher(request.abilities),
    initializeMs: performance.now() - startedAt,
    warm: false,
  }
  self.postMessage({
    type: 'initialized',
    initializeMs: state.initializeMs,
  } satisfies RecognitionWorkerResponse)
}

function recognize(
  request: Extract<RecognitionWorkerRequest, { type: 'recognize' }>,
): void {
  const current = state
  if (!current) throw new Error('Recognition worker is not initialized')
  const { image, layout, requestId } = request
  const startedAt = performance.now()
  let drawMs = 0
  let layoutMs = 0
  let readbackMs = 0
  let signatureMs = 0
  let matchMs = 0
  try {
    const canvas = new OffscreenCanvas(image.width, image.height)
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error('Unable to create offscreen canvas')
    let stageStartedAt = performance.now()
    context.drawImage(image, 0, 0)
    drawMs = performance.now() - stageStartedAt

    stageStartedAt = performance.now()
    const projectedLayout = layout
      ? undefined
      : buildProjectedLayout(image.width, image.height)
    const activeLayout: RuntimeSlot[] | undefined = layout ?? projectedLayout
    if (!activeLayout) throw new Error('Unable to build projected layout')
    layoutMs = performance.now() - stageStartedAt
    const layoutSource = layout ? 'manual' : 'projected'
    const slots: RecognizedSlot[] = activeLayout.map((slot, index) => {
      const safeRect = clampRectToCanvas(slot.rect, image.width, image.height)
      const crop = slot.matchQuad
        ? clampRectToCanvas(
            quadBounds(slot.matchQuad),
            image.width,
            image.height,
          )
        : cropCenter(safeRect)
      stageStartedAt = performance.now()
      const pixels = context.getImageData(
        crop.x,
        crop.y,
        crop.width,
        crop.height,
      )
      readbackMs += performance.now() - stageStartedAt
      stageStartedAt = performance.now()
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
      signatureMs += performance.now() - stageStartedAt
      stageStartedAt = performance.now()
      const candidates = current.templateMatcher
        ? rankByTemplate(
            cropSignature,
            current.abilities,
            slot.category,
            current.templateMatcher,
          )
        : rankByColor(
            meanColor(pixels.data),
            current.abilities,
            slot.category,
            current.colorMatcher,
          )
      matchMs += performance.now() - stageStartedAt

      return {
        index,
        category: slot.category,
        rect: safeRect,
        crop,
        matchQuad: slot.matchQuad,
        candidates,
        matchMode: current.templateMatcher ? 'template' : 'color-fallback',
        layoutSource,
      }
    })
    const timings: RecognitionWorkerTimings = {
      initializeMs: current.warm ? 0 : current.initializeMs,
      drawMs,
      layoutMs,
      readbackMs,
      signatureMs,
      matchMs,
      totalMs: performance.now() - startedAt,
      warm: current.warm,
    }
    current.warm = true
    self.postMessage({
      type: 'result',
      requestId,
      slots,
      timings,
    } satisfies RecognitionWorkerResponse)
  } finally {
    image.close()
  }
}
