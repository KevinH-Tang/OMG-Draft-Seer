export function memoizeByKey<K extends object, SK, V>(
  cache: WeakMap<K, Map<SK, V>>,
  key: K,
  subKey: SK,
  compute: () => V,
): V {
  const bySubKey = cache.get(key)
  if (bySubKey?.has(subKey)) return bySubKey.get(subKey) as V

  const value = compute()
  const entries = bySubKey ?? new Map<SK, V>()
  entries.set(subKey, value)
  if (!bySubKey) cache.set(key, entries)
  return value
}
