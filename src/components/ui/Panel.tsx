import type { HTMLAttributes } from 'react'
import { cn } from '../../lib/cn'

export function Panel({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return (
    <section
      className={cn(
        'rounded-lg border border-border bg-surface p-4 shadow-panel',
        className,
      )}
      {...props}
    />
  )
}
