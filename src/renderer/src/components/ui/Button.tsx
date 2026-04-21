import { forwardRef, type ReactNode } from 'react'

type ButtonProps = {
  variant?: 'primary' | 'ghost' | 'danger' | 'icon' | undefined
  size?: 'sm' | 'md' | 'lg' | undefined
  loading?: boolean | undefined
  disabled?: boolean | undefined
  onClick?: (() => void) | undefined
  children: ReactNode
  title?: string | undefined
  className?: string | undefined
  type?: 'button' | 'submit' | 'reset' | undefined
  'aria-label'?: string
  'aria-pressed'?: boolean | 'true' | 'false' | 'mixed'
  'aria-expanded'?: boolean | 'true' | 'false'
  'aria-controls'?: string
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'ghost',
    size = 'md',
    loading = false,
    disabled = false,
    onClick,
    children,
    title,
    className,
    type,
    'aria-label': ariaLabel,
    'aria-pressed': ariaPressed,
    'aria-expanded': ariaExpanded,
    'aria-controls': ariaControls
  },
  ref
) {
  const classes = [
    'bde-btn',
    `bde-btn--${variant}`,
    `bde-btn--${size}`,
    loading && 'bde-btn--loading',
    className
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <button
      ref={ref}
      className={classes}
      onClick={onClick}
      disabled={disabled || loading}
      title={title}
      type={type}
      aria-label={ariaLabel}
      aria-pressed={ariaPressed}
      aria-expanded={ariaExpanded}
      aria-controls={ariaControls}
      aria-busy={loading || undefined}
    >
      {loading && <span className="bde-btn__spinner" aria-hidden="true" />}
      {children}
    </button>
  )
})
