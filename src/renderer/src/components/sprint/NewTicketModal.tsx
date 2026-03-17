import { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Button } from '../ui/Button'
import { REPO_OPTIONS } from '../../lib/constants'
import { VARIANTS, SPRINGS, REDUCED_TRANSITION, useReducedMotion } from '../../lib/motion'

type NewTicketModalProps = {
  open: boolean
  onClose: () => void
  onCreate: (data: {
    title: string
    repo: string
    description: string
    spec: string
    priority: number
  }) => void
}

const PRIORITY_OPTIONS = [
  { label: 'Low', value: 2 },
  { label: 'Medium', value: 1 },
  { label: 'High', value: 0 },
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
}

export function NewTicketModal({ open, onClose, onCreate }: NewTicketModalProps) {
  const reduced = useReducedMotion()
  const [title, setTitle] = useState('')
  const [repo, setRepo] = useState<string>(REPO_OPTIONS[0].label)
  const [priority, setPriority] = useState(1)
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null)
  const [spec, setSpec] = useState('')
  const [generating, setGenerating] = useState(false)
  const titleRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setTitle('')
      setRepo(REPO_OPTIONS[0].label)
      setPriority(1)
      setSelectedTemplate(null)
      setSpec('')
      setGenerating(false)
      setTimeout(() => titleRef.current?.focus(), 100)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  const handleSelectTemplate = (key: string) => {
    if (selectedTemplate === key) {
      setSelectedTemplate(null)
      setSpec('')
      return
    }
    setSelectedTemplate(key)
    setSpec(TEMPLATES[key].spec)
  }

  const handleAskPaul = async () => {
    if (!title.trim()) return
    setGenerating(true)
    try {
      const prompt = `You are a senior engineer writing a coding agent spec for BDE (Birkeland Development Environment).

Task title: "${title}"
Repo: ${repo}
Current notes: ${spec || '(none)'}

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
      if (text) {
        setSpec(text)
      }
    } catch {
      // silent — user can retry
    } finally {
      setGenerating(false)
    }
  }

  const handleSubmit = () => {
    const trimmed = title.trim()
    if (!trimmed) return
    onCreate({
      title: trimmed,
      repo,
      description: '',
      spec,
      priority,
    })
    onClose()
  }

  return (
    <AnimatePresence>
      {open && (
    <>
      <div className="new-ticket-overlay" onClick={onClose} />
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
          <Button variant="icon" size="sm" onClick={onClose} title="Close">
            &#x2715;
          </Button>
        </div>

        <div className="new-ticket-modal__body">
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
        </div>

        <div className="new-ticket-modal__footer">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" onClick={handleSubmit} disabled={!title.trim()}>
            Save to Backlog
          </Button>
        </div>
      </motion.div>
    </>
      )}
    </AnimatePresence>
  )
}
