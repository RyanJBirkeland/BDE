import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { toast } from '../../stores/toasts'

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

  // Sync draft when spec prop changes externally
  useEffect(() => {
    if (!editing) {
      setDraft(spec)
    }
  }, [spec, editing])

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
          className="spec-panel"
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
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                style={{
                  width: '100%',
                  height: '100%',
                  background: 'transparent',
                  border: '1px solid var(--neon-purple-border)',
                  borderRadius: '6px',
                  color: 'var(--neon-text-muted)',
                  fontFamily: 'var(--bde-font-code)',
                  fontSize: '12px',
                  padding: '12px',
                  resize: 'none',
                  outline: 'none'
                }}
              />
            ) : (
              <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0 }}>
                {spec}
              </pre>
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
