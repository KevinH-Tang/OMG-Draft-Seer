import type { HTMLAttributes } from 'react'
import { cn } from '../../lib/cn'

export function Toolbar({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface p-3',
        className,
      )}
      {...props}
    />
  )
}
