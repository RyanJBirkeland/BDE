import { useCallback, useRef, useEffect, useImperativeHandle, forwardRef } from 'react'

type TextareaProps = {
  value: string
  onChange: (v: string) => void
  onKeyDown?: ((e: React.KeyboardEvent<HTMLTextAreaElement>) => void) | undefined
  placeholder?: string | undefined
  disabled?: boolean | undefined
  className?: string | undefined
  'aria-label'?: string
  maxHeight?: number | undefined
  resize?: 'none' | 'vertical' | undefined
  variant?: 'default' | 'code' | undefined
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  {
    value,
    onChange,
    onKeyDown,
    placeholder,
    disabled = false,
    className,
    'aria-label': ariaLabel,
    maxHeight,
    resize = 'none',
    variant = 'default'
  },
  forwardedRef
) {
  const innerRef = useRef<HTMLTextAreaElement>(null)

  useImperativeHandle(forwardedRef, () => innerRef.current as HTMLTextAreaElement)

  const autoResize = useCallback(() => {
    const el = innerRef.current
    if (!el) return
    el.style.height = 'auto'
    const next = maxHeight ? Math.min(el.scrollHeight, maxHeight) : el.scrollHeight
    el.style.height = `${next}px`
  }, [maxHeight])

  useEffect(() => {
    autoResize()
  }, [value, autoResize])

  const classes = ['bde-textarea', variant === 'code' && 'bde-textarea--code', className]
    .filter(Boolean)
    .join(' ')

  const style = resize === 'vertical' ? { resize: 'vertical' as const } : undefined

  return (
    <textarea
      ref={innerRef}
      className={classes}
      style={style}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={onKeyDown}
      placeholder={placeholder}
      disabled={disabled}
      rows={1}
      aria-label={ariaLabel}
    />
  )
})
