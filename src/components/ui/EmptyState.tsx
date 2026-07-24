import type { ReactNode } from 'react'

export function EmptyState({
  icon,
  children,
}: {
  icon?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="grid min-h-36 place-items-center gap-3 rounded-lg border border-dashed border-border bg-surface px-5 py-8 text-center text-sm text-text-muted">
      {icon && <span className="text-accent">{icon}</span>}
      <div>{children}</div>
    </div>
  )
}
