import type { ReactNode } from 'react'

type InputProps = {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  prefix?: ReactNode
  suffix?: ReactNode
  disabled?: boolean
  className?: string
  'aria-label'?: string
}

export function Input({
  value,
  onChange,
  placeholder,
  prefix,
  suffix,
  disabled = false,
  className,
  'aria-label': ariaLabel
}: InputProps) {
  const classes = [
    'bde-input',
    prefix && 'bde-input--has-prefix',
    suffix && 'bde-input--has-suffix',
    className
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className={classes}>
      {prefix && <span className="bde-input__prefix">{prefix}</span>}
      <input
        className="bde-input__field"
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        aria-label={ariaLabel}
      />
      {suffix && <span className="bde-input__suffix">{suffix}</span>}
    </div>
  )
}
