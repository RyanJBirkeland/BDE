import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { toast } from '../../stores/toasts'
import { renderAgentMarkdown } from '../../lib/render-agent-markdown'

export interface SpecPanelProps {
  taskTitle: string
  spec: string
  onClose: () => void
  onSave: (newSpec: string) => void
}

export function SpecPanel({ taskTitle, spec, onClose, onSave }: SpecPanelProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(spec)
  const [saving, setSaving] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)

  // Sync draft when spec prop changes externally
  useEffect(() => {
    if (!editing) {
      setDraft(spec)
    }
  }, [spec, editing])

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (editing) {
          setEditing(false)
          setDraft(spec)
        } else {
          onClose()
        }
      }
    }
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [editing, spec, onClose])

  // Focus trap — keep Tab cycling within the panel
  useEffect(() => {
    const panel = panelRef.current
    if (!panel) return

    const focusable = panel.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    )
    if (focusable.length === 0) return

    const first = focusable[0]
    first.focus()

    const handleTab = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return
      // Re-query in case DOM changed (edit mode toggle)
      const current = panel.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      )
      if (current.length === 0) return
      const f = current[0]
      const l = current[current.length - 1]
      if (e.shiftKey && document.activeElement === f) {
        e.preventDefault()
        l.focus()
      } else if (!e.shiftKey && document.activeElement === l) {
        e.preventDefault()
        f.focus()
      }
    }

    panel.addEventListener('keydown', handleTab)
    return () => panel.removeEventListener('keydown', handleTab)
  }, [editing])

  const handleSave = async () => {
    setSaving(true)
    try {
      await onSave(draft)
      setEditing(false)
      toast.success('Spec saved')
    } catch (err) {
      toast.error(`Failed to save spec: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <AnimatePresence>
      <div className="spec-panel-overlay" onClick={onClose}>
        <motion.div
          ref={panelRef}
          className="spec-panel"
          data-testid="spec-panel"
          role="dialog"
          aria-modal="true"
          aria-label={`Spec — ${taskTitle}`}
          onClick={(e) => e.stopPropagation()}
          initial={{ x: '100%' }}
          animate={{ x: 0 }}
          exit={{ x: '100%' }}
          transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        >
          <div className="spec-panel__header">
            <div className="spec-panel__title">Spec — {taskTitle}</div>
            <button className="spec-panel__close" onClick={onClose}>×</button>
          </div>
          <div className="spec-panel__body">
            {editing ? (
              <textarea
                className="spec-panel__textarea"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
              />
            ) : (
              <div className="spec-panel__rendered">
                {renderAgentMarkdown(spec)}
              </div>
            )}
          </div>
          <div className="spec-panel__actions">
            {editing ? (
              <>
                <button
                  className="task-drawer__btn task-drawer__btn--primary"
                  onClick={handleSave}
                  disabled={saving}
                >
                  {saving ? 'Saving...' : 'Save'}
                </button>
                <button
                  className="task-drawer__btn task-drawer__btn--secondary"
                  onClick={() => {
                    setEditing(false)
                    setDraft(spec)
                  }}
                  disabled={saving}
                >
                  Cancel
                </button>
              </>
            ) : (
              <button
                className="task-drawer__btn task-drawer__btn--secondary"
                onClick={() => setEditing(true)}
              >
                Edit
              </button>
            )}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  )
}
