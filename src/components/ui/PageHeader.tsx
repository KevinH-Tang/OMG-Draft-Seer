import type { ReactNode } from 'react'

export interface PageHeaderProps {
  titleId: string
  eyebrow: ReactNode
  title: ReactNode
  description?: ReactNode
  aside?: ReactNode
}

export function PageHeader({
  titleId,
  eyebrow,
  title,
  description,
  aside,
}: PageHeaderProps) {
  return (
    <div className="flex flex-col items-start justify-between gap-3 min-[601px]:flex-row">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h2 id={titleId}>{title}</h2>
        {description && (
          <p className="mb-0 mt-2 text-xs text-text-muted">{description}</p>
        )}
      </div>
      {aside && (
        <div className="inline-flex items-center gap-2 text-[11px] font-bold tracking-[0.08em] text-accent">
          {aside}
        </div>
      )}
    </div>
  )
}
