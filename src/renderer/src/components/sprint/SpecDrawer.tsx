import { useState, useEffect, useCallback, useRef } from 'react'
import { Pencil, Trash2 } from 'lucide-react'
import { Button } from '../ui/Button'
import { EmptyState } from '../ui/EmptyState'
import { toast } from '../../stores/toasts'
import { renderMarkdown } from '../../lib/render-markdown'
import { TASK_STATUS } from '../../../../shared/constants'
import type { SprintTask } from './SprintCenter'

function extractSpecPath(prompt: string): string | null {
  const match = prompt.match(/docs\/specs\/[\w-]+\.md/)
  return match ? match[0] : null
}

type SpecDrawerProps = {
  task: SprintTask | null
  onClose: () => void
  onSave: (taskId: string, spec: string) => void
  onLaunch: (task: SprintTask) => void
  onPushToSprint: (task: SprintTask) => void
  onMarkDone?: (task: SprintTask) => void
  onUpdate?: (patch: { id: string; title: string }) => void
  onDelete?: (taskId: string) => void
}

export function SpecDrawer({ task, onClose, onSave, onLaunch, onPushToSprint, onMarkDone, onUpdate, onDelete }: SpecDrawerProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [dirty, setDirty] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [showPrompt, setShowPrompt] = useState(false)
  const [titleDraft, setTitleDraft] = useState('')
  const editorRef = useRef<HTMLTextAreaElement>(null)
  const resolvedContentRef = useRef('')

  useEffect(() => {
    if (!task) return
    let cancelled = false

    setEditing(false)
    setDirty(false)
    setGenerating(false)
    setShowPrompt(false)
    setTitleDraft(task.title)

    if (task.spec) {
      resolvedContentRef.current = task.spec
      setDraft(task.spec)
      return
    }

    const fallback = task.prompt ?? ''
    const specPath = extractSpecPath(fallback)
    if (specPath) {
      window.api.sprint
        .readSpecFile(specPath)
        .then((content) => {
          if (cancelled) return
          resolvedContentRef.current = content
          setDraft(content)
        })
        .catch(() => {
          if (cancelled) return
          resolvedContentRef.current = fallback
          setDraft(fallback)
        })
    } else {
      resolvedContentRef.current = fallback
      setDraft(fallback)
    }

    return () => { cancelled = true }
  }, [task?.id])

  const save = useCallback(() => {
    if (!task) return
    onSave(task.id, draft)
    setEditing(false)
    setDirty(false)
    toast.success('Spec saved')
  }, [task, draft, onSave])

  const commitTitle = useCallback(() => {
    if (!task || !onUpdate) return
    const trimmed = titleDraft.trim()
    if (!trimmed) {
      setTitleDraft(task.title)
      return
    }
    if (trimmed !== task.title) {
      onUpdate({ id: task.id, title: trimmed })
    }
  }, [task, titleDraft, onUpdate])

  const handleDelete = useCallback(() => {
    if (!task || !onDelete) return
    if (!window.confirm('Delete this task? This cannot be undone.')) return
    onDelete(task.id)
  }, [task, onDelete])

  useEffect(() => {
    if (!task) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 's' && e.metaKey && editing) {
        e.preventDefault()
        save()
      }
      if (e.key === 'Escape') {
        if (editing && dirty) {
          if (confirm('Discard unsaved changes?')) {
            setEditing(false)
            setDraft(resolvedContentRef.current)
            setDirty(false)
          }
        } else {
          onClose()
        }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [task, editing, dirty, save, onClose])

  useEffect(() => {
    if (editing) editorRef.current?.focus()
  }, [editing])

  const handleAskPaul = async () => {
    if (!task) return
    setGenerating(true)
    try {
      const prompt = `You are a senior engineer writing a coding agent spec for BDE (Birkeland Development Environment).

Task title: "${task.title}"
Repo: ${task.repo}
Agent prompt: ${task.prompt || '(none)'}
Current notes: ${draft || '(none)'}

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
        setDraft(text)
        setDirty(true)
        setEditing(true)
      }
    } catch {
      toast.error('Failed to generate spec')
    } finally {
      setGenerating(false)
    }
  }

  const isOpen = task !== null

  return (
    <>
      {isOpen && <div className="spec-drawer__overlay" onClick={onClose} />}
      <div className={`spec-drawer ${isOpen ? 'spec-drawer--open' : ''}`}>
        {task && (
          <>
            <div className="spec-drawer__header">
              <div className="spec-drawer__header-info">
                <div className="spec-drawer__title-row">
                  <input
                    className="spec-drawer__title-input"
                    value={titleDraft}
                    onChange={(e) => setTitleDraft(e.target.value)}
                    onBlur={commitTitle}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        ;(e.target as HTMLInputElement).blur()
                      }
                    }}
                  />
                  <Pencil size={14} className="spec-drawer__title-hint" />
                </div>
                <span className="spec-drawer__header-meta">
                  {task.repo} &middot; {task.status}
                </span>
              </div>
              <Button variant="icon" size="sm" onClick={onClose} title="Close">
                &#x2715;
              </Button>
            </div>

            <div className="spec-drawer__toolbar">
              {!editing ? (
                <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
                  Edit
                </Button>
              ) : (
                <>
                  <Button variant="primary" size="sm" onClick={save}>
                    Save
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setEditing(false)
                      setDraft(resolvedContentRef.current)
                      setDirty(false)
                    }}
                  >
                    Cancel
                  </Button>
                </>
              )}
            </div>

            <div className="spec-drawer__body">
              {editing ? (
                <textarea
                  ref={editorRef}
                  className="spec-drawer__editor"
                  value={generating ? 'Paul is writing your spec...' : draft}
                  onChange={(e) => {
                    setDraft(e.target.value)
                    setDirty(true)
                  }}
                  disabled={generating}
                  placeholder="Write your spec in markdown..."
                />
              ) : draft ? (
                <div
                  className="spec-drawer__rendered"
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(draft) }}
                />
              ) : (
                <EmptyState
                  title="No spec yet"
                  description="Write a spec to guide the agent"
                  action={{ label: 'Write Spec', onClick: () => setEditing(true) }}
                />
              )}
            </div>

            {task.prompt && (
              <div className="spec-drawer__prompt-section">
                <button
                  className="spec-drawer__prompt-toggle"
                  onClick={() => setShowPrompt((v) => !v)}
                >
                  {showPrompt ? '▾ Hide Prompt' : '▸ View Full Prompt'}
                </button>
                {showPrompt && (
                  <pre className="spec-drawer__prompt-body">{task.prompt}</pre>
                )}
              </div>
            )}

            <div className="spec-drawer__footer">
              {task.status === TASK_STATUS.BACKLOG && task.spec ? (
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => {
                    onPushToSprint(task)
                    onLaunch(task)
                  }}
                >
                  Launch
                </Button>
              ) : task.status === TASK_STATUS.BACKLOG ? (
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => onPushToSprint(task)}
                >
                  → Push to Sprint
                </Button>
              ) : task.status === TASK_STATUS.QUEUED ? (
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => onLaunch(task)}
                >
                  Launch Agent
                </Button>
              ) : null}
              <Button
                variant="ghost"
                size="sm"
                onClick={handleAskPaul}
                disabled={generating}
              >
                {generating ? 'Generating...' : 'Ask Paul'}
              </Button>
              {onMarkDone && task.status !== TASK_STATUS.DONE && (
                <Button variant="ghost" size="sm" onClick={() => onMarkDone(task)}>
                  ✓ Mark Done
                </Button>
              )}
              {onDelete && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleDelete}
                  className="spec-drawer__delete-btn"
                >
                  <Trash2 size={14} /> Delete
                </Button>
              )}
            </div>
          </>
        )}
      </div>
    </>
  )
}
