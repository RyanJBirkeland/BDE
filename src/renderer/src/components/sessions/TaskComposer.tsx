import { useState, useEffect } from 'react'
import { useLocalAgentsStore } from '../../stores/localAgents'
import { toast } from '../../stores/toasts'
import { Button } from '../ui/Button'

const TEMPLATES = [
  { id: 'feature', label: '✦ Feature' },
  { id: 'fix', label: '⚡ Fix' },
  { id: 'refactor', label: '↻ Refactor' },
  { id: 'tests', label: '✓ Tests' }
] as const

const MODELS = [
  { id: 'sonnet', label: 'Sonnet' },
  { id: 'haiku', label: 'Haiku' },
  { id: 'opus', label: 'Opus' }
] as const

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50)
}

export function TaskComposer(): React.JSX.Element {
  const [template, setTemplate] = useState<string>('feature')
  const [repo, setRepo] = useState<string>('BDE')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [model, setModel] = useState<string>('sonnet')
  const [spawning, setSpawning] = useState(false)
  const [justSpawned, setJustSpawned] = useState(false)
  const [repoPaths, setRepoPaths] = useState<Record<string, string>>({})

  const spawnAgent = useLocalAgentsStore((s) => s.spawnAgent)

  useEffect(() => {
    window.api.getRepoPaths().then(setRepoPaths).catch(() => {})
  }, [])

  const repos = Object.keys(repoPaths)
  const branchName = title ? `feat/${slugify(title)}` : ''

  const handleRun = async (): Promise<void> => {
    if (!title.trim() || spawning) return
    setSpawning(true)
    try {
      const repoPath = repoPaths[repo]
      if (!repoPath) {
        toast.error('Unknown repository')
        return
      }

      const task = [
        `[${template}] ${title}`,
        description ? `\n${description}` : ''
      ].join('')

      const result = await spawnAgent({ task: task.trim(), repoPath, model })
      toast.success(`Agent spawned — PID ${result.pid}`)
      setTitle('')
      setDescription('')
      setJustSpawned(true)
      setTimeout(() => setJustSpawned(false), 1500)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      toast.error(`Spawn failed: ${msg}`)
    } finally {
      setSpawning(false)
    }
  }

  return (
    <div className="task-composer">
      <div className="task-composer__section">
        <label className="task-composer__label">Template</label>
        <div className="task-composer__chips">
          {TEMPLATES.map((t) => (
            <Button
              key={t.id}
              variant="ghost"
              size="sm"
              className={`task-composer__chip ${template === t.id ? 'task-composer__chip--active' : ''}`}
              onClick={() => setTemplate(t.id)}
            >
              {t.label}
            </Button>
          ))}
        </div>
      </div>

      <div className="task-composer__section">
        <label className="task-composer__label">Repository</label>
        <select
          className="task-composer__select"
          value={repo}
          onChange={(e) => setRepo(e.target.value)}
        >
          {repos.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </div>

      <div className="task-composer__section">
        <label className="task-composer__label">Title</label>
        <input
          className="task-composer__input"
          type="text"
          placeholder="e.g. Add user settings page"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        {branchName && <span className="task-composer__branch">{branchName}</span>}
      </div>

      <div className="task-composer__section">
        <label className="task-composer__label">Description</label>
        <textarea
          className="task-composer__textarea"
          placeholder="Describe the task in detail (markdown supported)"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={6}
        />
      </div>

      <div className="task-composer__section">
        <label className="task-composer__label">
          Model <span className="task-composer__max-badge">⬡ Max</span>
        </label>
        <div className="task-composer__chips">
          {MODELS.map((m) => (
            <Button
              key={m.id}
              variant="ghost"
              size="sm"
              className={`task-composer__chip ${model === m.id ? 'task-composer__chip--active' : ''}`}
              onClick={() => setModel(m.id)}
            >
              {m.label}
            </Button>
          ))}
        </div>
      </div>

      <Button
        variant="primary"
        className="task-composer__run"
        onClick={handleRun}
        disabled={!title.trim() || spawning}
        loading={spawning}
      >
        {justSpawned ? '✓ Spawned' : spawning ? '⟳ Spawning...' : '▶ Spawn Agent'}
      </Button>
    </div>
  )
}
