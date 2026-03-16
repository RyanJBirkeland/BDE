import { useState, useEffect, useCallback, useRef } from 'react'
import { Button } from '../ui/Button'
import { Badge } from '../ui/Badge'
import { EmptyState } from '../ui/EmptyState'
import { POLL_SPRINT_INTERVAL } from '../../lib/constants'

// --- Types ---

interface SprintTask {
  id: string
  title: string
  repo: string
  priority: number
  status: 'queued' | 'active' | 'done'
  started_at: string | null
  updated_at: string
}

// --- Config ---

const REPOS = [
  { label: 'bde', color: '#6C8EEF' },
  { label: 'life-os', color: '#00D37F' },
  { label: 'feast', color: '#FF8A00' }
]


// --- Helpers ---

function timeAgo(dateStr: string): string {
  const date = new Date(dateStr)
  if (isNaN(date.getTime())) return dateStr
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const mins = Math.floor(diffMs / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

// --- Component ---

export default function SprintBoard() {
  const [repo, setRepo] = useState<string>('bde')
  const [tasks, setTasks] = useState<SprintTask[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const [supabaseUrl, setSupabaseUrl] = useState<string | null>(null)
  const [supabaseAnonKey, setSupabaseAnonKey] = useState<string | null>(null)

  useEffect(() => {
    window.api.getSupabaseConfig().then((cfg) => {
      if (cfg) {
        setSupabaseUrl(cfg.url)
        setSupabaseAnonKey(cfg.anonKey)
      } else {
        setError('Supabase not configured — set supabaseUrl and supabaseAnonKey in ~/.openclaw/openclaw.json or env vars')
        setLoading(false)
      }
    }).catch(() => {
      setError('Failed to load Supabase config')
      setLoading(false)
    })
  }, [])

  const load = useCallback(async () => {
    if (!supabaseUrl || !supabaseAnonKey) return
    try {
      setLoading(true)
      const res = await fetch(
        `${supabaseUrl}/rest/v1/sprint_tasks?repo=eq.${repo}&order=priority.asc`,
        {
          headers: {
            apikey: supabaseAnonKey,
            Authorization: `Bearer ${supabaseAnonKey}`
          }
        }
      )
      const data: SprintTask[] = await res.json()
      setTasks(data)
      setError(null)
    } catch {
      setError('Failed to load tasks')
    } finally {
      setLoading(false)
    }
  }, [repo, supabaseUrl, supabaseAnonKey])

  useEffect(() => {
    if (!supabaseUrl || !supabaseAnonKey) return
    setLoading(true)
    setTasks([])
    load()
    if (intervalRef.current) clearInterval(intervalRef.current)
    intervalRef.current = setInterval(load, POLL_SPRINT_INTERVAL)
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [load, supabaseUrl, supabaseAnonKey])

  const active = tasks.filter((t) => t.status === 'active')
  const queued = tasks.filter((t) => t.status === 'queued')
  const done = tasks.filter((t) => t.status === 'done')

  return (
    <div className="sprint-board">
      <div className="sprint-board__header">
        <div className="sprint-board__title-row">
          <span className="sprint-board__title">Sprint Board</span>
          <div className="sprint-board__repo-switcher">
            {REPOS.map((r) => (
              <button
                key={r.label}
                onClick={() => setRepo(r.label)}
                className={`sprint-board__repo-chip ${repo === r.label ? 'sprint-board__repo-chip--active' : ''}`}
                style={repo === r.label ? { borderColor: r.color, color: r.color } : undefined}
              >
                <span className="sprint-board__repo-dot" style={{ background: r.color }} />
                {r.label}
              </button>
            ))}
          </div>
        </div>
        <Button variant="icon" size="sm" onClick={load} disabled={loading} title="Refresh">
          &#x21bb;
        </Button>
      </div>

      {error && <div className="sprint-board__error bde-error-banner">{error}</div>}

      <div className="sprint-board__columns">
        {loading && tasks.length === 0 ? (
          <div className="sprint-board__loading">
            <div className="sprint-board__skeleton" />
            <div className="sprint-board__skeleton" />
            <div className="sprint-board__skeleton" />
          </div>
        ) : (
          <>
            {/* In Progress */}
            <div className="sprint-col">
              <div className="sprint-col__header">
                <span className="sprint-col__icon sprint-col__icon--red">In Progress</span>
                <span className="sprint-col__count bde-count-badge">{active.length}</span>
              </div>
              <div className="sprint-col__cards">
                {active.length === 0 ? (
                  <EmptyState title="Nothing in progress" />
                ) : (
                  active.map((task, i) => (
                    <TaskCard key={task.id} task={task} index={i} />
                  ))
                )}
              </div>
            </div>

            {/* Queue */}
            <div className="sprint-col">
              <div className="sprint-col__header">
                <span className="sprint-col__icon sprint-col__icon--yellow">Queue</span>
                <span className="sprint-col__count bde-count-badge">{queued.length}</span>
              </div>
              <div className="sprint-col__cards">
                {queued.length === 0 ? (
                  <EmptyState title="Queue is empty" />
                ) : (
                  queued.map((task, i) => (
                    <TaskCard key={task.id} task={task} index={i} />
                  ))
                )}
              </div>
            </div>

            {/* Done */}
            <div className="sprint-col">
              <div className="sprint-col__header">
                <span className="sprint-col__icon sprint-col__icon--green">Done This Sprint</span>
                <span className="sprint-col__count bde-count-badge">{done.length}</span>
              </div>
              <div className="sprint-col__cards">
                {done.length === 0 ? (
                  <EmptyState title="No completed tasks yet" />
                ) : (
                  done.map((task, i) => (
                    <TaskCard key={task.id} task={task} index={i} />
                  ))
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// --- Sub-components ---

function TaskCard({ task, index }: { task: SprintTask; index: number }) {
  return (
    <div
      className="sprint-card"
      style={{ '--stagger-index': index } as React.CSSProperties}
    >
      <div className="sprint-card__top-row">
        <span className="sprint-card__text">{task.title}</span>
        <Badge
          variant={task.repo === 'bde' ? 'info' : task.repo === 'feast' ? 'warning' : 'success'}
          size="sm"
        >
          {task.repo}
        </Badge>
      </div>
      <div className="sprint-card__meta">
        <span>p{task.priority}</span>
        {task.started_at && <span>{timeAgo(task.started_at)}</span>}
      </div>
    </div>
  )
}
