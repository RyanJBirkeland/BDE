import type { HTMLInputTypeAttribute, ReactNode } from 'react'

type InputProps = {
  value: string
  onChange: (v: string) => void
  placeholder?: string | undefined
  prefix?: ReactNode | undefined
  suffix?: ReactNode | undefined
  disabled?: boolean | undefined
  className?: string | undefined
  'aria-label'?: string
  type?: HTMLInputTypeAttribute | undefined
  invalid?: boolean | undefined
  error?: string | undefined
  required?: boolean | undefined
  'aria-describedby'?: string
}

export function Input({
  value,
  onChange,
  placeholder,
  prefix,
  suffix,
  disabled = false,
  className,
  'aria-label': ariaLabel,
  type = 'text',
  invalid = false,
  error,
  required = false,
  'aria-describedby': ariaDescribedby
}: InputProps): React.JSX.Element {
  const classes = [
    'bde-input',
    prefix && 'bde-input--has-prefix',
    suffix && 'bde-input--has-suffix',
    invalid && 'bde-input--invalid',
    className
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <>
      <div className={classes}>
        {prefix && <span className="bde-input__prefix">{prefix}</span>}
        <input
          className="bde-input__field"
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          aria-label={ariaLabel}
          aria-invalid={invalid}
          aria-required={required}
          aria-describedby={ariaDescribedby}
        />
        {suffix && <span className="bde-input__suffix">{suffix}</span>}
      </div>
      {error && <span className="bde-input__error">{error}</span>}
    </>
  )
}
