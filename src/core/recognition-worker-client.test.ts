import { describe, expect, it, vi } from 'vitest'
import { RecognitionWorkerClient } from './recognition-worker-client'
import type { RecognitionWorkerResponse } from '../workers/recognizer-protocol'
import type { Ability, IconSignature } from '../types'

class FakeWorker {
  onmessage: ((event: MessageEvent<RecognitionWorkerResponse>) => void) | null =
    null
  onerror: ((event: ErrorEvent) => void) | null = null
  messages: unknown[] = []
  terminate = vi.fn()

  postMessage(message: unknown): void {
    this.messages.push(message)
  }

  respond(message: RecognitionWorkerResponse): void {
    this.onmessage?.({
      data: message,
    } as MessageEvent<RecognitionWorkerResponse>)
  }
}

describe('recognition worker client', () => {
  it('keeps one worker and initializes it only when data changes', async () => {
    const worker = new FakeWorker()
    const client = new RecognitionWorkerClient(() => worker)
    const abilities: Ability[] = []
    const signatures: IconSignature[] = []
    client.initialize(abilities, signatures)
    client.initialize(abilities, signatures)
    expect(worker.messages).toHaveLength(1)

    const image = { close: vi.fn() } as unknown as ImageBitmap
    const resultPromise = client.recognize(1, image)
    expect(worker.messages).toHaveLength(2)
    worker.respond({
      type: 'result',
      requestId: 1,
      slots: [],
      timings: {
        initializeMs: 1,
        drawMs: 2,
        layoutMs: 3,
        readbackMs: 4,
        signatureMs: 5,
        matchMs: 6,
        totalMs: 7,
        warm: false,
      },
    })
    await expect(resultPromise).resolves.toMatchObject({ slots: [] })

    const secondImage = { close: vi.fn() } as unknown as ImageBitmap
    const secondResult = client.recognize(2, secondImage)
    expect(worker.messages).toHaveLength(3)
    worker.respond({
      type: 'result',
      requestId: 2,
      slots: [],
      timings: {
        initializeMs: 0,
        drawMs: 1,
        layoutMs: 1,
        readbackMs: 1,
        signatureMs: 1,
        matchMs: 1,
        totalMs: 5,
        warm: true,
      },
    })
    await expect(secondResult).resolves.toMatchObject({ slots: [] })
    expect(worker.terminate).not.toHaveBeenCalled()

    client.initialize(abilities, [
      { abilityId: 1, luma: '', meanRgb: [0, 0, 0] },
    ])
    expect(worker.terminate).toHaveBeenCalledTimes(1)
  })

  it('can initialize again after StrictMode-style disposal', () => {
    const firstWorker = new FakeWorker()
    const secondWorker = new FakeWorker()
    const createWorker = vi
      .fn<() => FakeWorker>()
      .mockReturnValueOnce(firstWorker)
      .mockReturnValueOnce(secondWorker)
    const client = new RecognitionWorkerClient(createWorker)
    const abilities: Ability[] = []
    const signatures: IconSignature[] = []

    client.initialize(abilities, signatures)
    client.dispose()
    client.initialize(abilities, signatures)

    expect(firstWorker.terminate).toHaveBeenCalledTimes(1)
    expect(secondWorker.messages).toEqual([
      { type: 'initialize', abilities, signatures },
    ])
  })
})
