/**
 * CreateEpicModal — form for creating a new task group (epic).
 * Fields: name (required), icon (single char), goal (optional).
 */
import { useEffect, useRef, useCallback, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Button } from '../ui/Button'
import { VARIANTS, SPRINGS, REDUCED_TRANSITION, useReducedMotion } from '../../lib/motion'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import { useTaskGroups } from '../../stores/taskGroups'
import { EPIC_TEMPLATES, type EpicTemplate } from './epicTemplates'
import { tokens } from '../../design-system/tokens'
import type { TaskGroup } from '../../../../shared/types'

interface CreateEpicModalProps {
  open: boolean
  onClose: () => void
}

const ACCENT_COLORS = [
  { name: 'Cyan', value: tokens.neon.cyan },
  { name: 'Pink', value: tokens.neon.pink },
  { name: 'Blue', value: tokens.neon.blue },
  { name: 'Purple', value: tokens.neon.purple },
  { name: 'Orange', value: tokens.neon.orange },
  { name: 'Red', value: tokens.neon.red }
]

export function CreateEpicModal({ open, onClose }: CreateEpicModalProps): React.JSX.Element {
  const reduced = useReducedMotion()
  const { createGroup, createGroupFromTemplate, selectGroup } = useTaskGroups()

  const [name, setName] = useState('')
  const [icon, setIcon] = useState('E')
  const [accentColor, setAccentColor] = useState(tokens.neon.cyan)
  const [goal, setGoal] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [selectedTemplate, setSelectedTemplate] = useState<EpicTemplate | null>(null)

  const nameRef = useRef<HTMLInputElement>(null)
  const iconRef = useRef<HTMLInputElement>(null)
  const goalRef = useRef<HTMLTextAreaElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)

  useFocusTrap(dialogRef, open)

  useEffect(() => {
    if (open) {
      // Reset form on open
      setName('')
      setIcon('E')
      setAccentColor(tokens.neon.cyan)
      setGoal('')
      setSubmitting(false)
      setSelectedTemplate(null)
      // Focus name input
      requestAnimationFrame(() => {
        nameRef.current?.focus()
      })
    }
  }, [open])

  const handleTemplateSelect = useCallback((template: EpicTemplate) => {
    setSelectedTemplate(template)
    setName(template.name)
    setIcon(template.icon)
    setGoal(template.goal)
  }, [])

  const handleSubmit = useCallback(async () => {
    if (!name.trim()) return
    if (submitting) return

    setSubmitting(true)
    try {
      let newGroup: TaskGroup | null = null

      if (selectedTemplate) {
        // Create group from template (includes tasks)
        newGroup = await createGroupFromTemplate(
          {
            name: name.trim(),
            icon: icon.trim() || selectedTemplate.icon,
            accent_color: accentColor,
            goal: goal.trim() || selectedTemplate.goal,
            tasks: selectedTemplate.tasks
          },
          'BDE' // Default to BDE repo
        )
      } else {
        // Create empty group
        newGroup = await createGroup({
          name: name.trim(),
          icon: icon.trim() || 'E',
          accent_color: accentColor,
          goal: goal.trim() || undefined
        })
      }

      if (newGroup) {
        // Select the newly created group
        selectGroup(newGroup.id)
        onClose()
      }
    } finally {
      setSubmitting(false)
    }
  }, [
    name,
    icon,
    accentColor,
    goal,
    submitting,
    selectedTemplate,
    createGroup,
    createGroupFromTemplate,
    selectGroup,
    onClose
  ])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        if (!submitting) onClose()
      } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        e.stopPropagation()
        handleSubmit()
      }
    },
    [onClose, handleSubmit, submitting]
  )

  // Enforce single-char icon
  const handleIconChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const val = e.target.value
    // Take only the last character (supports multi-char paste)
    if (val.length > 0) {
      setIcon(val.slice(-1))
    } else {
      setIcon('')
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          <div className="prompt-modal__overlay" onClick={submitting ? undefined : onClose} />
          <motion.div
            ref={dialogRef}
            className="prompt-modal glass-modal elevation-3"
            variants={VARIANTS.scaleIn}
            initial="initial"
            animate="animate"
            exit="exit"
            transition={reduced ? REDUCED_TRANSITION : SPRINGS.snappy}
            onKeyDown={handleKeyDown}
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-epic-modal-title"
          >
            <div className="prompt-modal__title" id="create-epic-modal-title">
              New Epic
            </div>

            <div className="prompt-modal__message">
              Create a new task group to organize related work.
            </div>

            {/* Template selection */}
            {!selectedTemplate && (
              <>
                <div className="prompt-modal__label" style={{ marginTop: '16px' }}>
                  Start from Template (optional)
                </div>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(2, 1fr)',
                    gap: '12px',
                    marginBottom: '20px'
                  }}
                >
                  {EPIC_TEMPLATES.map((template) => (
                    <button
                      key={template.id}
                      type="button"
                      className="planner-template-card"
                      onClick={() => handleTemplateSelect(template)}
                    >
                      <div style={{ fontSize: '24px', marginBottom: '6px' }}>{template.icon}</div>
                      <div style={{ fontWeight: 600, marginBottom: '4px' }}>{template.name}</div>
                      <div style={{ fontSize: '12px', opacity: 0.7, lineHeight: '1.4' }}>
                        {template.description}
                      </div>
                      <div style={{ fontSize: '11px', opacity: 0.5, marginTop: '6px' }}>
                        {template.tasks.length} task{template.tasks.length !== 1 ? 's' : ''}
                      </div>
                    </button>
                  ))}
                </div>
              </>
            )}

            {selectedTemplate && (
              <div
                style={{
                  padding: '12px',
                  background: 'var(--bde-surface)',
                  border: '1px solid var(--bde-accent)',
                  borderRadius: '6px',
                  marginBottom: '16px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <div style={{ fontSize: '24px' }}>{selectedTemplate.icon}</div>
                  <div>
                    <div style={{ fontWeight: 600 }}>{selectedTemplate.name}</div>
                    <div style={{ fontSize: '12px', opacity: 0.7 }}>
                      {selectedTemplate.tasks.length} task
                      {selectedTemplate.tasks.length !== 1 ? 's' : ''}
                    </div>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setSelectedTemplate(null)
                    setName('')
                    setIcon('E')
                    setAccentColor(tokens.neon.cyan)
                    setGoal('')
                  }}
                >
                  Clear
                </Button>
              </div>
            )}

            {/* Name field */}
            <label className="prompt-modal__label" htmlFor="epic-name">
              Name <span style={{ color: 'var(--bde-danger)' }}>*</span>
            </label>
            <input
              ref={nameRef}
              id="epic-name"
              type="text"
              className="prompt-modal__input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Agent System Overhaul"
              aria-required="true"
            />

            {/* Icon field */}
            <label className="prompt-modal__label" htmlFor="epic-icon">
              Icon
            </label>
            <input
              ref={iconRef}
              id="epic-icon"
              type="text"
              className="prompt-modal__input"
              value={icon}
              onChange={handleIconChange}
              placeholder="E"
              style={{ width: '60px', textAlign: 'center' }}
            />

            {/* Accent color picker */}
            <label className="prompt-modal__label">Accent Color</label>
            <div
              style={{
                display: 'flex',
                gap: '8px',
                flexWrap: 'wrap',
                marginBottom: '8px'
              }}
            >
              {ACCENT_COLORS.map((color) => (
                <button
                  key={color.value}
                  type="button"
                  onClick={() => setAccentColor(color.value)}
                  title={color.name}
                  style={{
                    width: '32px',
                    height: '32px',
                    borderRadius: '4px',
                    background: color.value,
                    border:
                      accentColor === color.value
                        ? `2px solid ${color.value}`
                        : '1px solid var(--bde-border)',
                    boxShadow: accentColor === color.value ? `0 0 12px ${color.value}40` : 'none',
                    cursor: 'pointer',
                    transition: 'all 150ms ease',
                    opacity: accentColor === color.value ? 1 : 0.6
                  }}
                  aria-label={`Select ${color.name} accent color`}
                  aria-pressed={accentColor === color.value}
                />
              ))}
            </div>

            {/* Goal field */}
            <label className="prompt-modal__label" htmlFor="epic-goal">
              Goal (optional)
            </label>
            <textarea
              ref={goalRef}
              id="epic-goal"
              className="prompt-modal__textarea"
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              placeholder="Brief description of this epic's purpose"
              rows={4}
            />

            <div className="prompt-modal__hint">Press Cmd+Enter to create, Escape to cancel</div>

            <div className="prompt-modal__actions">
              <Button variant="ghost" size="sm" onClick={onClose} disabled={submitting}>
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={handleSubmit}
                disabled={!name.trim() || submitting}
              >
                {submitting ? 'Creating...' : 'Create Epic'}
              </Button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
