import { useState, useRef, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Button } from '../ui/Button'
import { ConfirmModal, useConfirm } from '../ui/ConfirmModal'
import { REPO_OPTIONS } from '../../lib/constants'
import { VARIANTS, SPRINGS, REDUCED_TRANSITION, useReducedMotion } from '../../lib/motion'
import { DEFAULT_TASK_TEMPLATES } from '../../../../shared/constants'
import type { TaskTemplate } from '../../../../shared/types'

type TicketMode = 'quick' | 'template'

export type CreateTicketData = {
  title: string
  repo: string
  notes: string
  prompt: string
  spec: string | null
  priority: number
  template_name?: string
  playground_enabled?: boolean
}

type NewTicketModalProps = {
  open: boolean
  onClose: () => void
  onCreate: (data: CreateTicketData) => void
}

const PRIORITY_OPTIONS = [
  { label: 'P1 Critical', value: 1 },
  { label: 'P2 High', value: 2 },
  { label: 'P3 Medium', value: 3 },
  { label: 'P4 Low', value: 4 },
  { label: 'P5 Backlog', value: 5 }
] as const

const TEMPLATES: Record<string, { label: string; spec: string }> = {
  feature: {
    label: 'Feature',
    spec: `## Problem\n<!-- What's broken or missing and why it matters -->\n\n## Solution\n<!-- What will be built -->\n\n## Files to Change\n<!-- Explicit list -->\n\n## Out of Scope\n<!-- What is NOT being built in this PR -->`
  },
  bugfix: {
    label: 'Bug Fix',
    spec: `## Bug Description\n<!-- What's broken -->\n\n## Root Cause\n<!-- Why it's broken (investigate before writing spec if unknown) -->\n\n## Fix\n<!-- Exact change needed -->\n\n## Files to Change\n\n## How to Test`
  },
  refactor: {
    label: 'Refactor',
    spec: `## What's Being Refactored\n<!-- Current state and why it needs changing -->\n\n## Target State\n<!-- What it should look like after -->\n\n## Files to Change\n\n## Out of Scope`
  },
  audit: {
    label: 'Audit',
    spec: `## Audit Scope\n<!-- What is being reviewed -->\n\n## Criteria\n<!-- What to look for -->\n\n## Deliverable\n<!-- What the agent should output: findings doc, fixed PR, etc -->`
  },
  ux: {
    label: 'UX Polish',
    spec: `## UX Problem\n<!-- What's confusing or broken in the UI -->\n\n## Target Design\n<!-- ASCII wireframe or bullet description of desired state -->\n\n## Files to Change\n<!-- CSS + TSX files -->\n\n## Visual References\n<!-- See docs/visual-identity-spec.md -->`
  },
  infra: {
    label: 'Infra',
    spec: `## Infrastructure Task\n<!-- What service/config/script is being set up or changed -->\n\n## Steps\n<!-- Ordered list -->\n\n## Verification\n<!-- How to confirm it worked -->`
  },
  test: {
    label: 'Test Coverage',
    spec: `## Test Target\n<!-- What module/function/component needs test coverage -->\n\n## Current Coverage Gaps\n<!-- What's untested or under-tested -->\n\n## Test Cases\n<!-- List of specific scenarios to cover -->\n\n## Files to Change\n\n## Notes\n<!-- Mocking strategy, fixtures needed, etc -->`
  },
  performance: {
    label: 'Performance',
    spec: `## Performance Problem\n<!-- What's slow or resource-heavy -->\n\n## Current Metrics\n<!-- Baseline numbers if available -->\n\n## Target\n<!-- Desired performance goal -->\n\n## Proposed Fix\n<!-- Optimization strategy -->\n\n## Files to Change\n\n## How to Measure`
  }
}

export function NewTicketModal({ open, onClose, onCreate }: NewTicketModalProps) {
  const { confirm, confirmProps } = useConfirm()
  const reduced = useReducedMotion()
  const [mode, setMode] = useState<TicketMode>('quick')
  const [title, setTitle] = useState('')
  const [repo, setRepo] = useState<string>(REPO_OPTIONS[0].label)
  const [priority, setPriority] = useState(3)
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null)
  const [spec, setSpec] = useState('')
  const titleRef = useRef<HTMLInputElement>(null)
  const [taskTemplateNames, setTaskTemplateNames] = useState<string[]>([])
  const [taskTemplateName, setTaskTemplateName] = useState('')
  const [playgroundEnabled, setPlaygroundEnabled] = useState(false)

  // Load task template names from settings
  useEffect(() => {
    window.api.settings.getJson('task.templates').then((raw) => {
      const templates = (Array.isArray(raw) ? raw : DEFAULT_TASK_TEMPLATES) as TaskTemplate[]
      setTaskTemplateNames(templates.map((t) => t.name))
    })
  }, [])

  useEffect(() => {
    if (open) {
      setMode('quick')
      setTitle('')
      setRepo(REPO_OPTIONS[0].label)
      setPriority(3)
      setSelectedTemplate(null)
      setSpec('')
      setTaskTemplateName('')
      setPlaygroundEnabled(false)
      setTimeout(() => titleRef.current?.focus(), 100)
    }
  }, [open])

  const handleClose = useCallback(() => {
    onClose()
  }, [onClose])

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        handleClose()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, handleClose])

  const handleSelectTemplate = async (key: string) => {
    if (selectedTemplate === key) {
      setSelectedTemplate(null)
      setSpec('')
      return
    }
    const hasUserContent =
      spec.trim() !== '' && spec !== (selectedTemplate ? TEMPLATES[selectedTemplate].spec : '')
    if (hasUserContent) {
      const ok = await confirm({
        message: 'Replace your current spec content with this template?',
        confirmLabel: 'Replace'
      })
      if (!ok) return
    }
    setSelectedTemplate(key)
    setSpec(TEMPLATES[key].spec)
  }

  const handleSubmit = () => {
    const trimmed = title.trim()
    if (!trimmed) return

    if (mode === 'quick') {
      onCreate({
        title: trimmed,
        repo,
        notes: '',
        prompt: trimmed,
        spec: null,
        priority: 3,
        template_name: taskTemplateName || undefined,
        playground_enabled: playgroundEnabled || undefined
      })
      onClose()
      return
    }

    // Template mode (existing behavior)
    onCreate({
      title: trimmed,
      repo,
      notes: '',
      prompt: spec || trimmed,
      spec: spec || null,
      priority,
      template_name: taskTemplateName || undefined,
      playground_enabled: playgroundEnabled || undefined
    })
    onClose()
  }

  return (
    <>
      <ConfirmModal {...confirmProps} />
      <AnimatePresence>
        {open && (
          <>
            <div className="new-ticket-overlay" onClick={handleClose} />
            <motion.div
              className="new-ticket-modal glass-modal elevation-3"
              variants={VARIANTS.scaleIn}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={reduced ? REDUCED_TRANSITION : SPRINGS.snappy}
              role="dialog"
              aria-modal="true"
              aria-labelledby="new-ticket-modal-title"
            >
              <div className="new-ticket-modal__header">
                <span
                  className="new-ticket-modal__title text-gradient-aurora"
                  id="new-ticket-modal-title"
                >
                  NEW TICKET
                </span>
                <Button
                  variant="icon"
                  size="sm"
                  onClick={handleClose}
                  title="Close"
                  aria-label="Close"
                >
                  &#x2715;
                </Button>
              </div>

              {/* Mode tabs */}
              <div className="new-ticket-modal__tabs">
                <button
                  className={`new-ticket-modal__tab ${mode === 'quick' ? 'new-ticket-modal__tab--active' : ''}`}
                  onClick={() => setMode('quick')}
                  type="button"
                >
                  Quick
                </button>
                <button
                  className={`new-ticket-modal__tab ${mode === 'template' ? 'new-ticket-modal__tab--active' : ''}`}
                  onClick={() => setMode('template')}
                  type="button"
                >
                  Template
                </button>
              </div>

              <div className="new-ticket-modal__body">
                {mode === 'quick' && (
                  <div className="new-ticket-modal__quick">
                    <div className="new-ticket-modal__field">
                      <label className="new-ticket-modal__label">What needs to happen? *</label>
                      <input
                        ref={titleRef}
                        className="sprint-tasks__input"
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleSubmit()
                        }}
                        placeholder='e.g. "Fix toast z-index above SpecDrawer"'
                        autoFocus
                      />
                    </div>
                    <div className="new-ticket-modal__field">
                      <label className="new-ticket-modal__label">Repo</label>
                      <select
                        className="sprint-tasks__select"
                        value={repo}
                        onChange={(e) => setRepo(e.target.value)}
                      >
                        {REPO_OPTIONS.map((r) => (
                          <option key={r.label} value={r.label}>
                            {r.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="new-ticket-modal__field">
                      <label className="new-ticket-modal__label" htmlFor="task-template-select">
                        Task Template
                      </label>
                      <select
                        id="task-template-select"
                        className="sprint-tasks__select"
                        value={taskTemplateName}
                        onChange={(e) => setTaskTemplateName(e.target.value)}
                      >
                        <option value="">None</option>
                        {taskTemplateNames.map((name) => (
                          <option key={name} value={name}>
                            {name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div
                      className="new-ticket-modal__field"
                      style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
                    >
                      <input
                        type="checkbox"
                        id="playground-enabled-quick"
                        checked={playgroundEnabled}
                        onChange={(e) => setPlaygroundEnabled(e.target.checked)}
                        style={{ cursor: 'pointer' }}
                      />
                      <label
                        htmlFor="playground-enabled-quick"
                        className="new-ticket-modal__label"
                        style={{ margin: 0, cursor: 'pointer' }}
                        title="Enable native HTML preview rendering for frontend work"
                      >
                        Dev Playground
                      </label>
                    </div>
                    <p className="new-ticket-modal__quick-hint">
                      Paul will write the spec in the background. Review it in SpecDrawer before
                      launching.
                    </p>
                  </div>
                )}

                {mode === 'template' && (
                  <>
                    <label className="new-ticket-modal__label">Title</label>
                    <input
                      ref={titleRef}
                      className="sprint-tasks__input"
                      placeholder='e.g. "Add recipe search to Feast onboarding"'
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault()
                          handleSubmit()
                        }
                      }}
                    />

                    <div className="new-ticket-modal__row">
                      <div className="new-ticket-modal__field">
                        <label className="new-ticket-modal__label">Repo</label>
                        <select
                          className="sprint-tasks__select"
                          value={repo}
                          onChange={(e) => setRepo(e.target.value)}
                        >
                          {REPO_OPTIONS.map((r) => (
                            <option key={r.label} value={r.label}>
                              {r.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="new-ticket-modal__field">
                        <label className="new-ticket-modal__label">Priority</label>
                        <select
                          className="sprint-tasks__select"
                          value={priority}
                          onChange={(e) => setPriority(Number(e.target.value))}
                        >
                          {PRIORITY_OPTIONS.map((p) => (
                            <option key={p.value} value={p.value}>
                              {p.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="new-ticket-modal__field">
                        <label
                          className="new-ticket-modal__label"
                          htmlFor="task-template-select-tpl"
                        >
                          Task Template
                        </label>
                        <select
                          id="task-template-select-tpl"
                          className="sprint-tasks__select"
                          value={taskTemplateName}
                          onChange={(e) => setTaskTemplateName(e.target.value)}
                        >
                          <option value="">None</option>
                          {taskTemplateNames.map((name) => (
                            <option key={name} value={name}>
                              {name}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div
                      className="new-ticket-modal__field"
                      style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
                    >
                      <input
                        type="checkbox"
                        id="playground-enabled-tpl"
                        checked={playgroundEnabled}
                        onChange={(e) => setPlaygroundEnabled(e.target.checked)}
                        style={{ cursor: 'pointer' }}
                      />
                      <label
                        htmlFor="playground-enabled-tpl"
                        className="new-ticket-modal__label"
                        style={{ margin: 0, cursor: 'pointer' }}
                        title="Enable native HTML preview rendering for frontend work"
                      >
                        Dev Playground
                      </label>
                    </div>

                    <label className="new-ticket-modal__label">Template</label>
                    <div className="new-ticket-modal__templates">
                      {Object.entries(TEMPLATES).map(([key, tmpl]) => (
                        <button
                          key={key}
                          className={`new-ticket-modal__chip ${selectedTemplate === key ? 'new-ticket-modal__chip--active' : ''}`}
                          onClick={() => handleSelectTemplate(key)}
                        >
                          {tmpl.label}
                        </button>
                      ))}
                    </div>

                    <label className="new-ticket-modal__label">Spec</label>
                    <textarea
                      className="new-ticket-modal__spec-editor"
                      value={spec}
                      onChange={(e) => setSpec(e.target.value)}
                      placeholder="Write your spec in markdown or pick a template above..."
                      rows={10}
                    />
                  </>
                )}
              </div>

              <div className="new-ticket-modal__footer">
                <Button variant="ghost" size="sm" onClick={handleClose}>
                  Cancel
                </Button>
                <Button variant="primary" size="sm" onClick={handleSubmit} disabled={!title.trim()}>
                  {mode === 'quick' ? 'Save — Paul writes the spec' : 'Save to Backlog'}
                </Button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  )
}
