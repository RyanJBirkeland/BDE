import { useCallback, useEffect, useRef, useState } from 'react'
import { useSessionsStore } from '../../stores/sessions'
import { Button } from '../ui/Button'

const REPOS = ['BDE', 'life-os', 'feast'] as const
const MODELS = [
  { id: 'haiku', label: 'Haiku' },
  { id: 'sonnet', label: 'Sonnet' }
] as const

interface SpawnModalProps {
  open: boolean
  onClose: () => void
}

export function SpawnModal({ open, onClose }: SpawnModalProps): React.JSX.Element | null {
  const [task, setTask] = useState('')
  const [repo, setRepo] = useState<string>(REPOS[0])
  const [model, setModel] = useState<string>('sonnet')
  const [spawning, setSpawning] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const runTask = useSessionsStore((s) => s.runTask)

  useEffect(() => {
    if (open) {
      setTask('')
      setRepo(REPOS[0])
      setModel('sonnet')
      requestAnimationFrame(() => textareaRef.current?.focus())
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [open, onClose])

  const handleSubmit = useCallback(
    async (e: React.FormEvent): Promise<void> => {
      e.preventDefault()
      if (!task.trim() || spawning) return
      setSpawning(true)
      try {
        await runTask(task.trim(), { repo, model })
        onClose()
      } finally {
        setSpawning(false)
      }
    },
    [task, repo, model, spawning, runTask, onClose]
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
      if (e.key === 'Enter' && e.metaKey) {
        e.preventDefault()
        if (task.trim() && !spawning) {
          handleSubmit(e as unknown as React.FormEvent)
        }
      }
    },
    [task, spawning, handleSubmit]
  )

  if (!open) return null

  return (
    <div className="spawn-modal__overlay" onClick={onClose}>
      <div className="spawn-modal" onClick={(e) => e.stopPropagation()}>
        <h2 className="spawn-modal__title">Spawn Agent</h2>

        <form onSubmit={handleSubmit}>
          <div className="spawn-modal__section">
            <label className="spawn-modal__label">Task Prompt</label>
            <textarea
              ref={textareaRef}
              className="spawn-modal__textarea"
              placeholder="Describe the task for the agent..."
              value={task}
              onChange={(e) => setTask(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={5}
              disabled={spawning}
            />
          </div>

          <div className="spawn-modal__section">
            <label className="spawn-modal__label">Repository</label>
            <select
              className="spawn-modal__select"
              value={repo}
              onChange={(e) => setRepo(e.target.value)}
              disabled={spawning}
            >
              {REPOS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>

          <div className="spawn-modal__section">
            <label className="spawn-modal__label">Model</label>
            <div className="spawn-modal__chips">
              {MODELS.map((m) => (
                <Button
                  key={m.id}
                  variant="ghost"
                  size="sm"
                  type="button"
                  className={`spawn-modal__chip ${model === m.id ? 'spawn-modal__chip--active' : ''}`}
                  onClick={() => setModel(m.id)}
                  disabled={spawning}
                >
                  {m.label}
                </Button>
              ))}
            </div>
          </div>

          <div className="spawn-modal__actions">
            <Button variant="ghost" size="md" type="button" onClick={onClose} disabled={spawning}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="md"
              type="submit"
              disabled={!task.trim() || spawning}
              loading={spawning}
            >
              {spawning ? 'Spawning...' : 'Spawn'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
