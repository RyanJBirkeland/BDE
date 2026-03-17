import { useState, useEffect, useCallback, useRef } from 'react'
import { Button } from '../ui/Button'
import { EmptyState } from '../ui/EmptyState'
import { toast } from '../../stores/toasts'
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
}

function renderMarkdown(md: string): string {
  return md
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/^(?!<[huplo])(.+)$/gm, '<p>$1</p>')
}

export function SpecDrawer({ task, onClose, onSave, onLaunch, onPushToSprint }: SpecDrawerProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [dirty, setDirty] = useState(false)
  const [generating, setGenerating] = useState(false)
  const editorRef = useRef<HTMLTextAreaElement>(null)
  const resolvedContentRef = useRef('')

  useEffect(() => {
    if (!task) return
    setEditing(false)
    setDirty(false)
    setGenerating(false)

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
          resolvedContentRef.current = content
          setDraft(content)
        })
        .catch(() => {
          resolvedContentRef.current = fallback
          setDraft(fallback)
        })
    } else {
      resolvedContentRef.current = fallback
      setDraft(fallback)
    }
  }, [task?.id])

  const save = useCallback(() => {
    if (!task) return
    onSave(task.id, draft)
    setEditing(false)
    setDirty(false)
    toast.success('Spec saved')
  }, [task, draft, onSave])

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
                <h3>{task.title}</h3>
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

            <div className="spec-drawer__footer">
              <Button
                variant="primary"
                size="sm"
                onClick={() => onPushToSprint(task)}
                disabled={task.status !== 'backlog'}
              >
                {task.status === 'backlog'
                  ? '→ Push to Sprint'
                  : task.status === 'queued'
                    ? 'In Sprint'
                    : task.status}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleAskPaul}
                disabled={generating}
              >
                {generating ? 'Generating...' : 'Ask Paul'}
              </Button>
              {task.status === 'queued' && (
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => onLaunch(task)}
                >
                  Launch Agent
                </Button>
              )}
            </div>
          </>
        )}
      </div>
    </>
  )
}
