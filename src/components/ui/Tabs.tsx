import { cn } from '../../lib/cn'

export interface TabOption<T extends string> {
  id: T
  label: string
}

export interface TabsProps<T extends string> {
  ariaLabel: string
  options: readonly TabOption<T>[]
  value: T
  onValueChange: (value: T) => void
  className?: string
}

export function Tabs<T extends string>({ ariaLabel, options, value, onValueChange, className }: TabsProps<T>) {
  return <div className={cn('inline-flex max-w-full gap-1 overflow-x-auto rounded-md border border-border bg-surface-raised p-1', className)} role="tablist" aria-label={ariaLabel}>
    {options.map((option) => <button
      type="button"
      role="tab"
      aria-selected={value === option.id}
      className={cn('shrink-0 rounded px-2.5 py-1.5 text-xs font-medium text-text-muted transition-colors hover:text-text focus-visible:outline-2 focus-visible:outline-accent', value === option.id && 'bg-accent text-canvas')}
      key={option.id}
      onClick={() => onValueChange(option.id)}
    >
      {option.label}
    </button>)}
  </div>
}
