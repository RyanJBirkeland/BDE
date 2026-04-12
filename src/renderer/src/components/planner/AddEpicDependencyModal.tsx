/**
 * AddEpicDependencyModal — modal for adding a new epic dependency.
 * Filters out self-references, existing dependencies, and options that would create cycles.
 */
import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Button } from '../ui/Button'
import { SPRINGS, REDUCED_TRANSITION, useReducedMotion } from '../../lib/motion'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import type { TaskGroup, EpicDependency } from '../../../../shared/types'
import './EpicDependencySection.css'

export interface AddEpicDependencyModalProps {
  open: boolean
  onClose: () => void
  currentEpic: TaskGroup
  allGroups: TaskGroup[]
  onAdd: (dep: EpicDependency) => Promise<void>
}

/**
 * Client-side cycle detection — defense in depth.
 * Server-side validation is the authority; this is for UX only.
 */
function wouldCreateCycle(
  currentEpicId: string,
  proposedUpstreamId: string,
  allGroups: TaskGroup[]
): boolean {
  // Self-reference
  if (currentEpicId === proposedUpstreamId) return true

  // DFS from proposed upstream
  const visited = new Set<string>()

  function dfs(epicId: string): boolean {
    if (epicId === currentEpicId) return true
    if (visited.has(epicId)) return false
    visited.add(epicId)

    const epic = allGroups.find((g) => g.id === epicId)
    if (!epic?.depends_on) return false

    for (const dep of epic.depends_on) {
      if (dfs(dep.id)) return true
    }
    return false
  }

  return dfs(proposedUpstreamId)
}

export function AddEpicDependencyModal({
  open,
  onClose,
  currentEpic,
  allGroups,
  onAdd
}: AddEpicDependencyModalProps): React.JSX.Element {
  const reduced = useReducedMotion()
  const [selectedEpicId, setSelectedEpicId] = useState<string>('')
  const [condition, setCondition] = useState<EpicDependency['condition']>('on_success')
  const [submitting, setSubmitting] = useState(false)
  const dialogRef = useRef<HTMLDivElement>(null)
  const selectRef = useRef<HTMLSelectElement>(null)

  useFocusTrap(dialogRef, open)

  useEffect(() => {
    if (open) {
      setSelectedEpicId('')
      setCondition('on_success')
      setSubmitting(false)
      requestAnimationFrame(() => {
        selectRef.current?.focus()
      })
    }
  }, [open])

  const handleSubmit = useCallback(async () => {
    if (!selectedEpicId || submitting) return

    setSubmitting(true)
    try {
      await onAdd({ id: selectedEpicId, condition })
      onClose()
    } catch (err) {
      console.error('Failed to add epic dependency:', err)
    } finally {
      setSubmitting(false)
    }
  }, [selectedEpicId, condition, submitting, onAdd, onClose])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      } else if (e.key === 'Enter' && selectedEpicId) {
        e.preventDefault()
        void handleSubmit()
      }
    },
    [onClose, selectedEpicId, handleSubmit]
  )

  // Filter available epics
  const existingDepIds = useMemo(
    () => new Set((currentEpic.depends_on ?? []).map((d) => d.id)),
    [currentEpic.depends_on]
  )

  const epicOptions = useMemo(() => {
    return allGroups
      .filter((g) => g.id !== currentEpic.id) // Exclude self
      .map((g) => {
        const alreadyDepends = existingDepIds.has(g.id)
        const wouldCycle = !alreadyDepends && wouldCreateCycle(currentEpic.id, g.id, allGroups)
        const disabled = alreadyDepends || wouldCycle
        const reason = alreadyDepends
          ? 'Already a dependency'
          : wouldCycle
            ? 'Would create cycle'
            : null

        return { epic: g, disabled, reason }
      })
      .sort((a, b) => {
        // Enabled options first, then alphabetical
        if (a.disabled !== b.disabled) return a.disabled ? 1 : -1
        return a.epic.name.localeCompare(b.epic.name)
      })
  }, [allGroups, currentEpic.id, existingDepIds])

  if (!open) return <></>

  return (
    <AnimatePresence>
      <motion.div
        className="modal-overlay"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={reduced ? REDUCED_TRANSITION : { duration: 0.15 }}
        onClick={onClose}
      >
        <motion.div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="add-epic-dep-title"
          className="modal-dialog"
          initial={reduced ? {} : { scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={reduced ? {} : { scale: 0.9, opacity: 0 }}
          transition={reduced ? REDUCED_TRANSITION : SPRINGS.gentle}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={handleKeyDown}
        >
          <div className="modal-header">
            <h2 id="add-epic-dep-title" className="modal-title">
              Add Epic Dependency
            </h2>
          </div>

          <div className="modal-body">
            <div className="modal-field">
              <label htmlFor="epic-select" className="modal-label">
                Upstream Epic
              </label>
              <select
                ref={selectRef}
                id="epic-select"
                className="modal-select"
                value={selectedEpicId}
                onChange={(e) => setSelectedEpicId(e.target.value)}
              >
                <option value="">Select an epic...</option>
                {epicOptions.map(({ epic, disabled, reason }) => (
                  <option key={epic.id} value={epic.id} disabled={disabled} title={reason ?? ''}>
                    {epic.name} {reason ? `(${reason})` : ''}
                  </option>
                ))}
              </select>
            </div>

            <div className="modal-field">
              <fieldset className="modal-fieldset">
                <legend className="modal-label">Condition</legend>
                <div className="modal-radio-group">
                  <label className="modal-radio-label">
                    <input
                      type="radio"
                      name="condition"
                      value="on_success"
                      checked={condition === 'on_success'}
                      onChange={(e) => setCondition(e.target.value as EpicDependency['condition'])}
                    />
                    <span>On success</span>
                    <span className="modal-radio-hint">
                      All upstream tasks must complete successfully
                    </span>
                  </label>
                  <label className="modal-radio-label">
                    <input
                      type="radio"
                      name="condition"
                      value="always"
                      checked={condition === 'always'}
                      onChange={(e) => setCondition(e.target.value as EpicDependency['condition'])}
                    />
                    <span>Any outcome</span>
                    <span className="modal-radio-hint">
                      Unblock when all upstream tasks finish (success or failure)
                    </span>
                  </label>
                  <label className="modal-radio-label">
                    <input
                      type="radio"
                      name="condition"
                      value="manual"
                      checked={condition === 'manual'}
                      onChange={(e) => setCondition(e.target.value as EpicDependency['condition'])}
                    />
                    <span>Manual checkpoint</span>
                    <span className="modal-radio-hint">
                      Requires explicit &ldquo;Mark Complete&rdquo; action on upstream epic
                    </span>
                  </label>
                </div>
              </fieldset>
            </div>
          </div>

          <div className="modal-footer">
            <Button variant="ghost" onClick={onClose} disabled={submitting}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={() => void handleSubmit()}
              disabled={!selectedEpicId || submitting}
            >
              {submitting ? 'Adding...' : 'Add'}
            </Button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
