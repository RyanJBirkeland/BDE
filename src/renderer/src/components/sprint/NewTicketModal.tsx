import { useState, useRef, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Button } from '../ui/Button'
import { ConfirmModal, useConfirm } from '../ui/ConfirmModal'
import { REPO_OPTIONS } from '../../lib/constants'
import { VARIANTS, SPRINGS, REDUCED_TRANSITION, useReducedMotion } from '../../lib/motion'
import { toast } from '../../stores/toasts'
import { DesignModeContent } from './DesignModeContent'
import { DEFAULT_TASK_TEMPLATES } from '../../../../shared/constants'
import type { TaskTemplate } from '../../../../shared/types'

type TicketMode = 'quick' | 'template' | 'design'

export type CreateTicketData = {
  title: string
  repo: string
  notes: string
  prompt: string
  spec: string | null
  priority: number
  template_name?: string
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
  { label: 'P5 Backlog', value: 5 },
] as const

const TEMPLATES: Record<string, { label: string; spec: string }> = {
  feature: {
    label: 'Feature',
    spec: `## Problem\n<!-- What's broken or missing and why it matters -->\n\n## Solution\n<!-- What will be built -->\n\n## Files to Change\n<!-- Explicit list -->\n\n## Out of Scope\n<!-- What is NOT being built in this PR -->`,
  },
  bugfix: {
    label: 'Bug Fix',
    spec: `## Bug Description\n<!-- What's broken -->\n\n## Root Cause\n<!-- Why it's broken (investigate before writing spec if unknown) -->\n\n## Fix\n<!-- Exact change needed -->\n\n## Files to Change\n\n## How to Test`,
  },
  refactor: {
    label: 'Refactor',
    spec: `## What's Being Refactored\n<!-- Current state and why it needs changing -->\n\n## Target State\n<!-- What it should look like after -->\n\n## Files to Change\n\n## Out of Scope`,
  },
  audit: {
    label: 'Audit',
    spec: `## Audit Scope\n<!-- What is being reviewed -->\n\n## Criteria\n<!-- What to look for -->\n\n## Deliverable\n<!-- What the agent should output: findings doc, fixed PR, etc -->`,
  },
  ux: {
    label: 'UX Polish',
    spec: `## UX Problem\n<!-- What's confusing or broken in the UI -->\n\n## Target Design\n<!-- ASCII wireframe or bullet description of desired state -->\n\n## Files to Change\n<!-- CSS + TSX files -->\n\n## Visual References\n<!-- See docs/visual-identity-spec.md -->`,
  },
  infra: {
    label: 'Infra',
    spec: `## Infrastructure Task\n<!-- What service/config/script is being set up or changed -->\n\n## Steps\n<!-- Ordered list -->\n\n## Verification\n<!-- How to confirm it worked -->`,
  },
  test: {
    label: 'Test Coverage',
    spec: `## Test Target\n<!-- What module/function/component needs test coverage -->\n\n## Current Coverage Gaps\n<!-- What's untested or under-tested -->\n\n## Test Cases\n<!-- List of specific scenarios to cover -->\n\n## Files to Change\n\n## Notes\n<!-- Mocking strategy, fixtures needed, etc -->`,
  },
  performance: {
    label: 'Performance',
    spec: `## Performance Problem\n<!-- What's slow or resource-heavy -->\n\n## Current Metrics\n<!-- Baseline numbers if available -->\n\n## Target\n<!-- Desired performance goal -->\n\n## Proposed Fix\n<!-- Optimization strategy -->\n\n## Files to Change\n\n## How to Measure`,
  },
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
  const [generating, setGenerating] = useState(false)
  const titleRef = useRef<HTMLInputElement>(null)
  const [taskTemplateNames, setTaskTemplateNames] = useState<string[]>([])
  const [taskTemplateName, setTaskTemplateName] = useState('')

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
      setGenerating(false)
      setTaskTemplateName('')
      setTimeout(() => titleRef.current?.focus(), 100)
    }
  }, [open])

  const handleClose = useCallback(async () => {
    if (mode === 'design') {
      const ok = await confirm({ message: 'Discard this design conversation?', confirmLabel: 'Discard' })
      if (ok) onClose()
      return
    }
    onClose()
  }, [mode, onClose, confirm])

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
    const hasUserContent = spec.trim() !== '' && spec !== (selectedTemplate ? TEMPLATES[selectedTemplate].spec : '')
    if (hasUserContent) {
      const ok = await confirm({ message: 'Replace your current spec content with this template?', confirmLabel: 'Replace' })
      if (!ok) return
    }
    setSelectedTemplate(key)
    setSpec(TEMPLATES[key].spec)
  }

  const handleAskPaul = async () => {
    if (!title.trim()) return
    setGenerating(true)
    try {
      const templateInstruction = selectedTemplate
        ? `\n\nIMPORTANT: Use the following template structure. Fill in each section with specific, technical content — do not remove or rename sections:\n\n${TEMPLATES[selectedTemplate].spec}`
        : ''

      const prompt = `You are a senior engineer writing a coding agent spec for BDE (Birkeland Development Environment).

Task title: "${title}"
Repo: ${repo}
Current notes: ${spec || '(none)'}${templateInstruction}

Write a complete, spec-ready prompt for a Claude Code agent to implement this task. Follow the spec format in memory/spec-template.md. Include: Problem, Solution, Data shapes (if applicable), Files to Change, Out of Scope. Be specific and technical. Output only the spec markdown, no commentary.`

      const result = (await window.api.invokeTool('sessions_send', {
        sessionKey: 'main',
        message: prompt,
        timeoutSeconds: 30,
      })) as {
        ok?: boolean
        result?: { content?: Array<{ type: string; text: string }> }
      } | null

      const text = result?.result?.content?.[0]?.text ?? ''
      if (!text) {
        toast.error('Paul returned an empty response — try again')
        return
      }
      setSpec(text)
    } catch {
      toast.error('Ask Paul failed — check your connection and try again')
    } finally {
      setGenerating(false)
    }
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
      >
        <div className="new-ticket-modal__header">
          <span className="new-ticket-modal__title text-gradient-aurora">NEW TICKET</span>
          <Button variant="icon" size="sm" onClick={handleClose} title="Close">
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
          <button
            className={`new-ticket-modal__tab ${mode === 'design' ? 'new-ticket-modal__tab--active' : ''}`}
            onClick={() => setMode('design')}
            type="button"
          >
            Design with Paul
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
                <label className="new-ticket-modal__label" htmlFor="task-template-select">Task Template</label>
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
              <p className="new-ticket-modal__quick-hint">
                Paul will write the spec in the background. Review it in SpecDrawer before launching.
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
                  <label className="new-ticket-modal__label" htmlFor="task-template-select-tpl">Task Template</label>
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

              <div className="new-ticket-modal__spec-header">
                <label className="new-ticket-modal__label">Spec</label>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleAskPaul}
                  disabled={generating || !title.trim()}
                >
                  {generating ? 'Generating...' : 'Ask Paul'}
                </Button>
              </div>
              <textarea
                className="new-ticket-modal__spec-editor"
                value={generating ? 'Paul is writing your spec...' : spec}
                onChange={(e) => setSpec(e.target.value)}
                disabled={generating}
                placeholder="Write your spec in markdown or pick a template above..."
                rows={10}
              />
            </>
          )}

          {mode === 'design' && (
            <DesignModeContent
              repo={repo}
              priority={priority}
              onSave={(args) => {
                onCreate({
                  title: args.title,
                  repo: args.repo,
                  notes: '',
                  prompt: args.prompt,
                  spec: args.spec,
                  priority: args.priority,
                })
                onClose()
              }}
            />
          )}

        </div>

        {mode !== 'design' && (
          <div className="new-ticket-modal__footer">
            <Button variant="ghost" size="sm" onClick={handleClose}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={handleSubmit}
              disabled={!title.trim()}
            >
              {mode === 'quick' ? 'Save — Paul writes the spec' : 'Save to Backlog'}
            </Button>
          </div>
        )}
      </motion.div>
    </>
      )}
    </AnimatePresence>
    </>
  )
}
