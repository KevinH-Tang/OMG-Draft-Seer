import type { ReactNode } from 'react'
import { Check } from 'lucide-react'
import { cn } from '../../lib/cn'

export interface SegmentedControlOption<T extends string> {
  value: T
  label: ReactNode
  description?: ReactNode
  testId?: string
}

export interface SegmentedControlProps<T extends string> {
  ariaLabel: string
  options: readonly SegmentedControlOption<T>[]
  value: T
  onValueChange: (value: T) => void
  testId?: string
  fullWidth?: boolean
  className?: string
}

export function SegmentedControl<T extends string>({
  ariaLabel,
  options,
  value,
  onValueChange,
  testId,
  fullWidth = false,
  className,
}: SegmentedControlProps<T>) {
  return (
    <div
      className={cn(
        'grid max-w-full gap-1 rounded-md border border-border bg-surface-raised p-1',
        fullWidth ? 'w-full' : 'inline-grid',
        className,
      )}
      style={{
        gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))`,
      }}
      role="group"
      aria-label={ariaLabel}
      data-testid={testId}
    >
      {options.map((option) => {
        const selected = option.value === value
        return (
          <button
            className={cn(
              'grid min-h-11 min-w-0 grid-cols-[minmax(0,1fr)_14px] items-center gap-1 rounded-sm border px-2.5 py-1.5 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent',
              selected
                ? 'border-accent bg-accent-soft text-text'
                : 'border-transparent text-text-muted hover:border-border hover:bg-surface-hover hover:text-text',
            )}
            type="button"
            aria-pressed={selected}
            data-testid={option.testId}
            key={option.value}
            onClick={() => onValueChange(option.value)}
          >
            <span className="min-w-0 leading-tight">
              <span className="block text-xs font-semibold">
                {option.label}
              </span>
              {option.description && (
                <span className="mt-0.5 block text-[10px] text-text-muted">
                  {option.description}
                </span>
              )}
            </span>
            <span
              className="grid size-3.5 place-items-center"
              aria-hidden="true"
            >
              {selected && <Check size={13} strokeWidth={2.5} />}
            </span>
          </button>
        )
      })}
    </div>
  )
}
