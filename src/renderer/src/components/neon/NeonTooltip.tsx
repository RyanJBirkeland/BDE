// src/renderer/src/components/neon/NeonTooltip.tsx
import { useState, useRef, useCallback, useEffect, useId, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

interface NeonTooltipProps {
  label: string
  shortcut?: string | undefined
  delay?: number | undefined
  children: ReactNode
}

export function NeonTooltip({
  label,
  shortcut,
  delay = 300,
  children
}: NeonTooltipProps): React.JSX.Element {
  const [visible, setVisible] = useState(false)
  const [position, setPosition] = useState({ top: 0, left: 0 })
  const triggerRef = useRef<HTMLDivElement>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const tooltipId = useId()

  const updatePosition = useCallback(() => {
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect()
      setPosition({
        top: rect.top + rect.height / 2 - 14,
        left: rect.right + 8
      })
    }
  }, [])

  const show = useCallback(() => {
    timerRef.current = setTimeout(() => {
      updatePosition()
      setVisible(true)
    }, delay)
  }, [delay, updatePosition])

  const hide = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    setVisible(false)
  }, [])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') hide()
    },
    [hide]
  )

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    },
    []
  )

  return (
    <>
      <div
        ref={triggerRef}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        onKeyDown={handleKeyDown}
        aria-describedby={visible ? tooltipId : undefined}
        style={{ display: 'contents' }}
      >
        {children}
      </div>
      {visible &&
        createPortal(
          <div
            id={tooltipId}
            className="neon-tooltip"
            style={{ top: position.top, left: position.left }}
            role="tooltip"
          >
            {label}
            {shortcut && <span className="neon-tooltip__shortcut">{shortcut}</span>}
          </div>,
          document.body
        )}
    </>
  )
}
