import type { InputHTMLAttributes, ReactNode } from 'react'
import { cn } from '../../lib/cn'

export interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: ReactNode
  hint?: ReactNode
}

export function Field({ className, hint, id, label, ...props }: FieldProps) {
  return <label className="grid gap-1.5 text-sm text-text" htmlFor={id}>
    <span className="flex items-baseline justify-between gap-3"><span>{label}</span>{hint && <small className="text-xs text-text-muted">{hint}</small>}</span>
    <input id={id} className={cn('min-h-9 rounded-md border border-border bg-surface-raised px-3 text-sm text-text outline-hidden placeholder:text-text-muted focus:border-accent focus:ring-2 focus:ring-accent/30', className)} {...props} />
  </label>
}
