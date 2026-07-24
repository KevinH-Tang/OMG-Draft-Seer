import { cva, type VariantProps } from 'class-variance-authority'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cn } from '../../lib/cn'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      tone: {
        primary: 'border-accent bg-accent text-canvas hover:bg-accent/90',
        secondary:
          'border-border bg-surface-raised text-text hover:bg-surface-hover',
        ghost:
          'border-transparent bg-transparent text-text-muted hover:bg-surface-hover hover:text-text',
        danger:
          'border-negative/60 bg-negative/15 text-negative hover:bg-negative/25',
      },
      size: {
        sm: 'min-h-8 px-2.5 py-1.5 text-xs',
        md: 'min-h-9',
        icon: 'size-9 p-0',
      },
    },
    defaultVariants: { tone: 'secondary', size: 'md' },
  },
)

export interface ButtonProps
  extends
    ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  children?: ReactNode
}

export function Button({
  className,
  tone,
  size,
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(buttonVariants({ tone, size }), className)}
      {...props}
    />
  )
}

export { buttonVariants }
