import { Check, ChevronDown, Loader2 } from 'lucide-react'
import { useEffect, useRef, useState, type JSX, type KeyboardEvent } from 'react'

interface Props {
  onMergeLocally: () => void
  onSquashMerge: () => void
  onCreatePR: () => void
  onRequestRevision: () => void
  onDiscard: () => void
  disabled?: boolean | undefined
  /** True while any review action IPC call is in flight. Shows a spinner and blocks re-click. */
  loading?: boolean | undefined
}

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
    <div className="cr-approve" ref={rootRef}>
      <button
        type="button"
        ref={triggerRef}
        className="cr-approve__trigger"
        disabled={disabled || loading}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-busy={loading || undefined}
        onClick={() => setOpen((v) => !v)}
      >
        {loading ? <Loader2 size={14} className="cr-approve__spinner" /> : <Check size={14} />}
        <span>Approve</span>
        {!loading && <ChevronDown size={12} />}
      </button>
      {open && (
        <div className="cr-approve__menu" role="menu" ref={menuRef} onKeyDown={handleMenuKeyDown}>
          <button type="button" role="menuitem" onClick={() => run(onMergeLocally)}>
            Merge Locally
          </button>
          <button type="button" role="menuitem" onClick={() => run(onSquashMerge)}>
            Squash & Merge
          </button>
          <button type="button" role="menuitem" onClick={() => run(onCreatePR)}>
            Create PR
          </button>
          <hr className="cr-approve__divider" />
          <button type="button" role="menuitem" onClick={() => run(onRequestRevision)}>
            Request Revision
          </button>
          <button
            type="button"
            role="menuitem"
            className="cr-approve__danger"
            onClick={() => run(onDiscard)}
          >
            Discard
          </button>
        </div>
      )}
    </div>
  )
}
