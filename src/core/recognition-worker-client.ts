import type { FixedSlot } from './layout'
import type { Ability, IconSignature, RecognizedSlot } from '../types'
import type {
  RecognitionWorkerRequest,
  RecognitionWorkerResponse,
  RecognitionWorkerTimings,
} from '../workers/recognizer-protocol'

interface WorkerLike {
  onmessage: ((event: MessageEvent<RecognitionWorkerResponse>) => void) | null
  onerror: ((event: ErrorEvent) => void) | null
  postMessage(
    message: RecognitionWorkerRequest,
    transfer?: Transferable[],
  ): void
  terminate(): void
}

interface RecognitionResult {
  slots: RecognizedSlot[]
  timings: RecognitionWorkerTimings
}

interface PendingRecognition {
  requestId: number
  resolve: (result: RecognitionResult) => void
  reject: (error: Error) => void
}

export class RecognitionWorkerClient {
  private worker: WorkerLike | undefined
  private abilities: Ability[] = []
  private signatures: IconSignature[] = []
  private pending: PendingRecognition | undefined

  constructor(private readonly createWorker: () => WorkerLike) {}

  initialize(abilities: Ability[], signatures: IconSignature[]): void {
    if (this.abilities === abilities && this.signatures === signatures) {
      this.ensureWorker()
      return
    }
    this.abilities = abilities
    this.signatures = signatures
    this.restartWorker('Recognition data changed')
  }

  recognize(
    requestId: number,
    image: ImageBitmap,
    layout?: FixedSlot[],
  ): Promise<RecognitionResult> {
    if (this.pending) this.restartWorker('Recognition superseded')
    const worker = this.ensureWorker()
    return new Promise((resolve, reject) => {
      this.pending = { requestId, resolve, reject }
      worker.postMessage({ type: 'recognize', requestId, image, layout }, [
        image,
      ])
    })
  }

  cancel(requestId: number): void {
    if (this.pending?.requestId !== requestId) return
    this.restartWorker('Recognition cancelled')
  }

  dispose(): void {
    this.rejectPending('Recognition worker disposed')
    this.worker?.terminate()
    this.worker = undefined
  }

  private ensureWorker(): WorkerLike {
    if (this.worker) return this.worker
    const worker = this.createWorker()
    worker.onmessage = (event) => this.handleMessage(event.data)
    worker.onerror = () => {
      this.rejectPending('Recognition worker failed')
      worker.terminate()
      if (this.worker === worker) this.worker = undefined
    }
    worker.postMessage({
      type: 'initialize',
      abilities: this.abilities,
      signatures: this.signatures,
    })
    this.worker = worker
    return worker
  }

  private handleMessage(message: RecognitionWorkerResponse): void {
    if (message.type === 'initialized') return
    if (message.type === 'error') {
      if (
        message.requestId !== undefined &&
        message.requestId !== this.pending?.requestId
      )
        return
      this.rejectPending(message.error)
      return
    }
    if (message.requestId !== this.pending?.requestId) return
    const pending = this.pending
    this.pending = undefined
    pending.resolve({ slots: message.slots, timings: message.timings })
  }

  private restartWorker(reason: string): void {
    this.rejectPending(reason)
    this.worker?.terminate()
    this.worker = undefined
    this.ensureWorker()
  }

  private rejectPending(reason: string): void {
    const pending = this.pending
    if (!pending) return
    this.pending = undefined
    pending.reject(new Error(reason))
  }
}
