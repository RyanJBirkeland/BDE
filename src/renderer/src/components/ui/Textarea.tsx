import { useCallback, useRef, useEffect, useImperativeHandle, forwardRef } from 'react'

type TextareaProps = {
  value: string
  onChange: (v: string) => void
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void
  placeholder?: string
  disabled?: boolean
  className?: string
  'aria-label'?: string
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { value, onChange, onKeyDown, placeholder, disabled = false, className, 'aria-label': ariaLabel },
  forwardedRef
) {
  const innerRef = useRef<HTMLTextAreaElement>(null)

  useImperativeHandle(forwardedRef, () => innerRef.current as HTMLTextAreaElement)

  const resize = useCallback(() => {
    const el = innerRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [])

  useEffect(() => {
    resize()
  }, [value, resize])

  const classes = ['bde-textarea', className].filter(Boolean).join(' ')

  return (
    <textarea
      ref={innerRef}
      className={classes}
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
