import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { toast } from '../../stores/toasts'
import { renderAgentMarkdown } from '../../lib/render-agent-markdown'
import { useFocusTrap } from '../../hooks/useFocusTrap'

export interface SpecPanelProps {
  taskTitle: string
  spec: string
  onClose: () => void
  onSave: (newSpec: string) => void
}

export function SpecPanel({ taskTitle, spec, onClose, onSave }: SpecPanelProps): React.JSX.Element {
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
    const handleEscape = (e: KeyboardEvent): void => {
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
  useFocusTrap(panelRef, true)

  const handleSave = async (): Promise<void> => {
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
            <button className="spec-panel__close" onClick={onClose}>
              ×
            </button>
          </div>
          <div className="spec-panel__body">
            {editing ? (
              <textarea
                className="spec-panel__textarea"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
              />
            ) : (
              <div className="spec-panel__rendered">{renderAgentMarkdown(spec)}</div>
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
