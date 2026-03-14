import { useCallback, useRef, useEffect } from 'react'

type TextareaProps = {
  value: string
  onChange: (v: string) => void
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void
  placeholder?: string
  disabled?: boolean
  className?: string
}

export function Textarea({
  value,
  onChange,
  onKeyDown,
  placeholder,
  disabled = false,
  className,
}: TextareaProps) {
  const ref = useRef<HTMLTextAreaElement>(null)

  const resize = useCallback(() => {
    const el = ref.current
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
      ref={ref}
      className={classes}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={onKeyDown}
      placeholder={placeholder}
      disabled={disabled}
      rows={1}
    />
  )
}
