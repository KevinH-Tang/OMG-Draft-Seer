import type { ButtonProps } from './Button'
import { Button } from './Button'

export function IconButton({
  'aria-label': ariaLabel,
  title,
  ...props
}: ButtonProps) {
  return (
    <Button
      size="icon"
      tone="ghost"
      aria-label={ariaLabel ?? title}
      title={title}
      {...props}
    />
  )
}
