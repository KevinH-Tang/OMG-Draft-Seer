export interface StorageAdapter {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

const unavailableStorage: StorageAdapter = {
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
}

export function getBrowserStorage(): StorageAdapter {
  try {
    if (typeof window === 'undefined') return unavailableStorage
    const storage = window.localStorage
    const probeKey = '__omg_storage_probe__'
    storage.setItem(probeKey, '1')
    storage.removeItem(probeKey)
    return storage
  } catch {
    return unavailableStorage
  }
}

export function readStoredJson<T>(storage: StorageAdapter, key: string, fallback: T): T {
  try {
    const value = storage.getItem(key)
    return value === null ? fallback : JSON.parse(value) as T
  } catch {
    return fallback
  }
}

export function writeStoredJson(storage: StorageAdapter, key: string, value: unknown): void {
  try {
    storage.setItem(key, JSON.stringify(value))
  } catch {
    // Persistence is optional; the current session can continue without it.
  }
}
