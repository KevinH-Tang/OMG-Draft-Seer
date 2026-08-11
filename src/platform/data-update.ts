import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import type { Snapshot } from '../types'
import { isDesktopRuntime } from './overlays'

export const WINDRUN_SNAPSHOT_UPDATED_EVENT =
  'omg-draft-seer-windrun-snapshot-updated'

function invokeDataCommand<T>(command: string): Promise<T> {
  const internals =
    typeof window === 'undefined' ? undefined : window.__TAURI_INTERNALS__
  if (!internals) {
    return Promise.reject(
      new Error('Windrun data updates are only available in the desktop app.'),
    )
  }
  return internals.invoke<T>(command, {})
}

export function getUserWindrunSnapshot(): Promise<Snapshot | null> {
  return invokeDataCommand<Snapshot | null>('get_user_windrun_snapshot')
}

export function updateWindrunSnapshot(): Promise<Snapshot> {
  return invokeDataCommand<Snapshot>('update_windrun_snapshot')
}

export async function loadRuntimeSnapshot(
  bundledUrl: string,
  signal?: AbortSignal,
): Promise<Snapshot> {
  if (isDesktopRuntime()) {
    try {
      const userSnapshot = await getUserWindrunSnapshot()
      if (userSnapshot) return userSnapshot
    } catch (error) {
      console.warn('Unable to load the saved Windrun snapshot', error)
    }
  }
  const response = await fetch(bundledUrl, { signal })
  if (!response.ok) throw new Error('no local snapshot')
  return response.json() as Promise<Snapshot>
}

export function listenWindrunSnapshotUpdated(
  handler: (snapshot: Snapshot) => void,
): Promise<UnlistenFn> {
  if (!isDesktopRuntime()) return Promise.resolve(() => undefined)
  return listen(WINDRUN_SNAPSHOT_UPDATED_EVENT, () => {
    void getUserWindrunSnapshot()
      .then((snapshot) => {
        if (snapshot) handler(snapshot)
      })
      .catch((error: unknown) => {
        console.error('Unable to reload the updated Windrun snapshot', error)
      })
  })
}
