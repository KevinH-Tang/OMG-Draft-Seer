export function formatPairPercent(
  value: number | undefined,
  signed = false,
): string {
  if (value === undefined || !Number.isFinite(value)) return '—'
  const percent = value * 100
  return `${signed && percent > 0 ? '+' : ''}${percent.toFixed(1)}%`
}

export function formatLogitDelta(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return '—'
  return `${value > 0 ? '+' : ''}${value.toFixed(2)}`
}
