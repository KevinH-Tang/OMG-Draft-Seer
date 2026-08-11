import type { FixedSlot } from '../core/layout'
import type { Ability, IconSignature, RecognizedSlot } from '../types'

export interface RecognitionWorkerTimings {
  initializeMs: number
  drawMs: number
  layoutMs: number
  readbackMs: number
  signatureMs: number
  matchMs: number
  totalMs: number
  warm: boolean
}

export type RecognitionWorkerRequest =
  | {
      type: 'initialize'
      abilities: Ability[]
      signatures: IconSignature[]
    }
  | {
      type: 'recognize'
      requestId: number
      image: ImageBitmap
      layout?: FixedSlot[]
    }

export type RecognitionWorkerResponse =
  | { type: 'initialized'; initializeMs: number }
  | {
      type: 'result'
      requestId: number
      slots: RecognizedSlot[]
      timings: RecognitionWorkerTimings
    }
  | { type: 'error'; requestId?: number; error: string }
