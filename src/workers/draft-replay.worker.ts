/// <reference lib="webworker" />
import { simulateDraft, type DraftSimulationResult } from '../core/draft-tree'
import type { DraftStrategyId, InitialDraftPool } from '../core/draft-state'
import type { Snapshot } from '../types'

interface Request {
  pool: InitialDraftPool
  snapshot: Snapshot
  strategyByPlayer: Record<number, DraftStrategyId>
}

interface Response {
  result?: DraftSimulationResult
  error?: string
}

self.onmessage = (event: MessageEvent<Request>) => {
  try {
    self.postMessage({
      result: simulateDraft(
        event.data.pool,
        event.data.snapshot,
        event.data.strategyByPlayer,
      ),
    } satisfies Response)
  } catch (error: unknown) {
    self.postMessage({
      error: error instanceof Error ? error.message : 'Draft simulation failed',
    } satisfies Response)
  }
}
