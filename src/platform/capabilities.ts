export interface RuntimeCapabilities {
  createImageBitmap: boolean
  worker: boolean
  offscreenCanvas: boolean
}

export function detectRuntimeCapabilities(): RuntimeCapabilities {
  const runtime = globalThis as typeof globalThis & {
    createImageBitmap?: unknown
    OffscreenCanvas?: unknown
    Worker?: unknown
  }
  return {
    createImageBitmap: typeof runtime.createImageBitmap === 'function',
    worker: typeof runtime.Worker === 'function',
    offscreenCanvas: typeof runtime.OffscreenCanvas === 'function',
  }
}

export function missingRuntimeCapabilities(
  capabilities: RuntimeCapabilities,
): string[] {
  return [
    !capabilities.createImageBitmap ? 'createImageBitmap' : undefined,
    !capabilities.worker ? 'Web Worker' : undefined,
    !capabilities.offscreenCanvas ? 'OffscreenCanvas' : undefined,
  ].filter((value): value is string => value !== undefined)
}
