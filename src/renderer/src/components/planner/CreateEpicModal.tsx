/**
 * CreateEpicModal — form for creating a new task group (epic).
 * Fields: name (required), icon (single char), goal (optional).
 */
import { useEffect, useRef, useCallback, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Button } from '../ui/Button'
import { VARIANTS, SPRINGS, REDUCED_TRANSITION, useReducedMotion } from '../../lib/motion'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import { useRepoOptions } from '../../hooks/useRepoOptions'
import { useTaskGroups } from '../../stores/taskGroups'
import { EPIC_TEMPLATES, type EpicTemplate } from './epicTemplates'
import type { TaskGroup } from '../../../../shared/types'
import './CreateEpicModal.css'

interface CreateEpicModalProps {
  open: boolean
  onClose: () => void
}

const ACCENT_COLORS = [
  { name: 'Cyan', value: 'var(--bde-accent)' },
  { name: 'Pink', value: 'var(--bde-status-done)' },
  { name: 'Blue', value: 'var(--bde-status-review)' },
  { name: 'Purple', value: 'var(--bde-status-active)' },
  { name: 'Orange', value: 'var(--bde-warning)' },
  { name: 'Red', value: 'var(--bde-danger)' }
]

export function CreateEpicModal({ open, onClose }: CreateEpicModalProps): React.JSX.Element {
  const reduced = useReducedMotion()
  const repoOptions = useRepoOptions()
  const { createGroup, createGroupFromTemplate, selectGroup } = useTaskGroups()

  const [name, setName] = useState('')
  const [icon, setIcon] = useState('E')
  const [accentColor, setAccentColor] = useState('var(--bde-accent)')
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
      setAccentColor('var(--bde-accent)')
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
          repoOptions[0]?.label ?? ''
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
    repoOptions,
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
                <div className="prompt-modal__label prompt-modal__label--spaced">
                  Start from Template (optional)
                </div>
                <div className="planner-template-grid">
                  {EPIC_TEMPLATES.map((template) => (
                    <button
                      key={template.id}
                      type="button"
                      className="planner-template-card"
                      onClick={() => handleTemplateSelect(template)}
                    >
                      <div className="planner-template-card__icon">{template.icon}</div>
                      <div className="planner-template-card__name">{template.name}</div>
                      <div className="planner-template-card__description">
                        {template.description}
                      </div>
                      <div className="planner-template-card__meta">
                        {template.tasks.length} task{template.tasks.length !== 1 ? 's' : ''}
                      </div>
                    </button>
                  ))}
                </div>
              </>
            )}

            {selectedTemplate && (
              <div className="planner-selected-template-banner">
                <div className="planner-selected-template">
                  <div className="planner-selected-template__icon">{selectedTemplate.icon}</div>
                  <div className="planner-selected-template__details">
                    <div className="planner-selected-template__name">{selectedTemplate.name}</div>
                    <div className="planner-selected-template__description">
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
                    setAccentColor('var(--bde-accent)')
                    setGoal('')
                  }}
                >
                  Clear
                </Button>
              </div>
            )}

            {/* Name field */}
            <label className="prompt-modal__label" htmlFor="epic-name">
              Name <span className="planner-epic-form__required">*</span>
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
              className="prompt-modal__input planner-epic-form__icon-input"
              value={icon}
              onChange={handleIconChange}
              placeholder="E"
            />

            {/* Accent color picker */}
            <label className="prompt-modal__label">Accent Color</label>
            <div className="planner-color-picker">
              {ACCENT_COLORS.map((color) => (
                <button
                  key={color.value}
                  type="button"
                  onClick={() => setAccentColor(color.value)}
                  title={color.name}
                  className="planner-color-swatch"
                  style={{
                    background: color.value,
                    border:
                      accentColor === color.value
                        ? `2px solid ${color.value}`
                        : '1px solid var(--bde-border)',
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
