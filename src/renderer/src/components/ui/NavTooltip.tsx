// src/renderer/src/components/ui/NavTooltip.tsx
import { useState, useRef, useCallback, useEffect, useId, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

interface NavTooltipProps {
  label: string
  description: string
  shortcut?: string | undefined
  delay?: number | undefined
  children: ReactNode
}

export function NavTooltip({
  label,
  description,
  shortcut,
  delay = 300,
  children
}: NavTooltipProps): React.JSX.Element {
  const [visible, setVisible] = useState(false)
  const [position, setPosition] = useState({ top: 0, left: 0 })
  const triggerRef = useRef<HTMLDivElement>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const tooltipId = useId()

  const updatePosition = useCallback(() => {
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect()
      setPosition({
        top: rect.top + rect.height / 2 - 20,
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
            className="nav-tooltip"
            style={{ top: position.top, left: position.left }}
            role="tooltip"
          >
            <div className="nav-tooltip__header">
              {label}
              {shortcut && <span className="nav-tooltip__shortcut">{shortcut}</span>}
            </div>
            <div className="nav-tooltip__description">{description}</div>
          </div>,
          document.body
        )}
    </>
  )
}
