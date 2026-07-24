import { cva, type VariantProps } from 'class-variance-authority'
import type { HTMLAttributes } from 'react'
import { cn } from '../../lib/cn'

const badgeVariants = cva('inline-flex items-center rounded border px-1.5 py-0.5 font-mono text-[10px] font-bold tracking-wide', {
  variants: {
    tone: {
      neutral: 'border-border bg-surface-raised text-text-muted',
      accent: 'border-accent/50 bg-accent/10 text-accent',
      positive: 'border-positive/50 bg-positive/10 text-positive',
      warning: 'border-warning/50 bg-warning/10 text-warning',
      negative: 'border-negative/50 bg-negative/10 text-negative',
    },
  },
  defaultVariants: { tone: 'neutral' },
})

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />
}
