import { Loader2, MoreHorizontal } from 'lucide-react'
import { useEffect, useRef, useState, type JSX, type KeyboardEvent } from 'react'

interface Props {
  onMergeLocally: () => void
  onSquashMerge: () => void
  onCreatePR: () => void
  onRequestRevision: () => void
  onDiscard: () => void
  disabled?: boolean | undefined
  /** True while any review action IPC call is in flight. */
  loading?: boolean | undefined
}

/**
 * Kebab dropdown consolidating merge/discard/revision actions.
 * V2: 28×28 square trigger, V2 menu chrome (--surf-1 bg, --line border,
 * shadow 4px 12px black 12%).
 */
export function ApproveDropdown({
  onMergeLocally,
  onSquashMerge,
  onCreatePR,
  onRequestRevision,
  onDiscard,
  disabled = false,
  loading = false
}: Props): JSX.Element {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const wasOpenRef = useRef(false)

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent | globalThis.KeyboardEvent): void {
      if (e.key === 'Escape') setOpen(false)
    }
    function onClick(e: MouseEvent): void {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('keydown', onKey as EventListener)
    document.addEventListener('mousedown', onClick)
    return () => {
      document.removeEventListener('keydown', onKey as EventListener)
      document.removeEventListener('mousedown', onClick)
    }
  }, [open])

  // Focus first menuitem on open; return focus to trigger on close
  useEffect(() => {
    if (open) {
      const first = menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')
      first?.focus()
    } else if (wasOpenRef.current) {
      triggerRef.current?.focus()
    }
    wasOpenRef.current = open
  }, [open])

  function handleMenuKeyDown(e: KeyboardEvent<HTMLDivElement>): void {
    if (!menuRef.current) return
    const items = Array.from(
      menuRef.current.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')
    )
    const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement)
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      const next = items[(currentIndex + 1) % items.length]
      next?.focus()
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      const prev = items[(currentIndex - 1 + items.length) % items.length]
      prev?.focus()
    } else if (e.key === 'Home') {
      e.preventDefault()
      items[0]?.focus()
    } else if (e.key === 'End') {
      e.preventDefault()
      items[items.length - 1]?.focus()
    }
  }

  function run(fn: () => void): void {
    fn()
    setOpen(false)
  }

  return (
    <div style={{ position: 'relative' }} ref={rootRef}>
      {/* 28×28 square trigger — matches Prompt button */}
      <button
        type="button"
        ref={triggerRef}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 28,
          height: 28,
          background: 'transparent',
          border: '1px solid var(--line)',
          borderRadius: 'var(--r-md)',
          color: 'var(--fg-3)',
          cursor: 'pointer'
        }}
        disabled={disabled || loading}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-busy={loading || undefined}
        aria-label="More review actions"
        onClick={() => setOpen((v) => !v)}
      >
        {loading ? (
          <Loader2 size={14} style={{ animation: 'fleet-spin 1s linear infinite' }} />
        ) : (
          <MoreHorizontal size={14} />
        )}
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            right: 0,
            background: 'var(--surf-1)',
            border: '1px solid var(--line)',
            borderRadius: 'var(--r-md)',
            boxShadow: '0 4px 12px color-mix(in oklch, black 12%, transparent)',
            minWidth: 180,
            zIndex: 200,
            overflow: 'hidden'
          }}
          role="menu"
          ref={menuRef}
          onKeyDown={handleMenuKeyDown}
        >
          <MenuItem onClick={() => run(onMergeLocally)}>Merge Locally</MenuItem>
          <MenuItem onClick={() => run(onSquashMerge)}>Squash &amp; Merge</MenuItem>
          <MenuItem onClick={() => run(onCreatePR)}>Create PR</MenuItem>
          <hr style={{ margin: '4px 0', border: 'none', borderTop: '1px solid var(--line)' }} />
          <MenuItem onClick={() => run(onRequestRevision)}>Request Revision</MenuItem>
          <MenuItem onClick={() => run(onDiscard)} danger>
            Discard
          </MenuItem>
        </div>
      )}
    </div>
  )
}

function MenuItem({
  onClick,
  danger = false,
  children
}: {
  onClick: () => void
  danger?: boolean
  children: React.ReactNode
}): JSX.Element {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      style={{
        display: 'block',
        width: '100%',
        padding: 'var(--s-2) var(--s-3)',
        background: 'transparent',
        border: 'none',
        color: danger ? 'var(--st-failed)' : 'var(--fg-2)',
        fontSize: 'var(--t-sm)',
        textAlign: 'left',
        cursor: 'pointer'
      }}
      onMouseEnter={(e) => {
        ;(e.currentTarget as HTMLButtonElement).style.background = 'var(--surf-2)'
      }}
      onMouseLeave={(e) => {
        ;(e.currentTarget as HTMLButtonElement).style.background = 'transparent'
      }}
    >
      {children}
    </button>
  )
}
