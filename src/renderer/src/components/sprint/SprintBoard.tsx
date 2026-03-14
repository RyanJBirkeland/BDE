import { useState, useEffect, useCallback, useRef } from 'react'
import { Button } from '../ui/Button'
import { Badge } from '../ui/Badge'
import { EmptyState } from '../ui/EmptyState'

// --- Types ---

interface CheckedOutItem {
  branch: string
  agent: string
  files: string
  started: string
  status: string
}

interface QueueItem {
  text: string
  done: boolean
}

interface DoneItem {
  pr: string
  title: string
  merged: string
}

interface SprintData {
  checkedOut: CheckedOutItem[]
  queue: QueueItem[]
  done: DoneItem[]
}

// --- Config ---

const REPOS = [
  { label: 'life-os', owner: 'RyanJBirkeland', name: 'life-os', color: '#00D37F' },
  { label: 'feast', owner: 'RyanJBirkeland', name: 'feast', color: '#FF8A00' }
]

const REFRESH_INTERVAL = 30_000

// --- Parsing ---

function parseSprintMd(raw: string): SprintData {
  const lines = raw.split('\n')
  const checkedOut: CheckedOutItem[] = []
  const queue: QueueItem[] = []
  const done: DoneItem[] = []

  let section: 'none' | 'checked-out' | 'queue' | 'done' = 'none'

  for (const line of lines) {
    const t = line.trim()

    if (t.startsWith('## ') && t.includes('Checked Out')) {
      section = 'checked-out'
      continue
    }
    if (t.startsWith('## ') && t.includes('Queue')) {
      section = 'queue'
      continue
    }
    if (t.startsWith('## ') && t.includes('Done This Sprint')) {
      section = 'done'
      continue
    }
    if (t.startsWith('## ') || t.startsWith('---')) {
      if (section !== 'none') section = 'none'
      continue
    }

    if (
      section === 'checked-out' &&
      t.startsWith('|') &&
      !t.includes('Branch') &&
      !t.startsWith('|--')
    ) {
      const cols = t
        .split('|')
        .map((c) => c.trim())
        .filter(Boolean)
      if (cols.length >= 5) {
        checkedOut.push({
          branch: cols[0],
          agent: cols[1],
          files: cols[2],
          started: cols[3],
          status: cols[4]
        })
      }
    }

    if (section === 'queue' && t.startsWith('- [')) {
      const isDone = t.startsWith('- [x]')
      const text = t.replace(/^- \[[ x]\]\s*/, '')
      if (text) {
        queue.push({ text, done: isDone })
      }
    }

    if (
      section === 'done' &&
      t.startsWith('|') &&
      !t.includes('PR') &&
      !t.startsWith('|--')
    ) {
      const cols = t
        .split('|')
        .map((c) => c.trim())
        .filter(Boolean)
      if (cols.length >= 3) {
        done.push({ pr: cols[0], title: cols[1], merged: cols[2] })
      }
    }
  }

  return { checkedOut, queue, done }
}

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

function branchUrl(repoLabel: string, branch: string): string {
  const r = REPOS.find((r) => r.label === repoLabel)
  if (!r) return '#'
  return `https://github.com/${r.owner}/${r.name}/tree/${branch}`
}

function prUrl(repoLabel: string, pr: string): string {
  const r = REPOS.find((r) => r.label === repoLabel)
  if (!r) return '#'
  const num = pr.replace('#', '')
  return `https://github.com/${r.owner}/${r.name}/pull/${num}`
}

// --- Component ---

export default function SprintBoard() {
  const [repo, setRepo] = useState<string>('life-os')
  const [repoPaths, setRepoPaths] = useState<Record<string, string> | null>(null)
  const [data, setData] = useState<SprintData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set())
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    window.api.getRepoPaths().then(setRepoPaths).catch(() => {
      setError('Failed to load repo paths')
    })
  }, [])

  const load = useCallback(async () => {
    if (!repoPaths) return
    const path = repoPaths[repo]
    if (!path) {
      setError(`No path configured for ${repo}`)
      setLoading(false)
      return
    }
    try {
      const raw = await window.api.readSprintMd(path)
      setData(parseSprintMd(raw))
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to read SPRINT.md')
    } finally {
      setLoading(false)
    }
  }, [repo, repoPaths])

  useEffect(() => {
    setLoading(true)
    setData(null)
    load()
    if (intervalRef.current) clearInterval(intervalRef.current)
    intervalRef.current = setInterval(load, REFRESH_INTERVAL)
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [load])

  const toggleExpand = (key: string) => {
    setExpandedCards((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const inProgress = data?.checkedOut.filter((i) => i.status !== 'Done') ?? []
  const doneCheckedOut = data?.checkedOut.filter((i) => i.status === 'Done') ?? []
  const pendingQueue = data?.queue.filter((i) => !i.done) ?? []
  const doneItems = data?.done ?? []

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

      {error && <div className="sprint-board__error">{error}</div>}

      <div className="sprint-board__columns">
        {loading && !data ? (
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
                <span className="sprint-col__count">{inProgress.length}</span>
              </div>
              <div className="sprint-col__cards">
                {inProgress.length === 0 ? (
                  <EmptyState title="Nothing checked out" />
                ) : (
                  inProgress.map((item, i) => (
                    <CheckedOutCard
                      key={item.branch}
                      item={item}
                      repo={repo}
                      expanded={expandedCards.has(item.branch)}
                      onToggle={() => toggleExpand(item.branch)}
                      staggerIndex={i}
                    />
                  ))
                )}
                {doneCheckedOut.length > 0 && (
                  <div className="sprint-col__recently-done">
                    <span className="sprint-col__sub-label">Recently completed</span>
                    {doneCheckedOut.map((item) => (
                      <CheckedOutCard
                        key={item.branch}
                        item={item}
                        repo={repo}
                        expanded={expandedCards.has(item.branch)}
                        onToggle={() => toggleExpand(item.branch)}
                        dimmed
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Queue */}
            <div className="sprint-col">
              <div className="sprint-col__header">
                <span className="sprint-col__icon sprint-col__icon--yellow">Queue</span>
                <span className="sprint-col__count">{pendingQueue.length}</span>
              </div>
              <div className="sprint-col__cards">
                {pendingQueue.length === 0 ? (
                  <EmptyState title="Queue is empty" />
                ) : (
                  pendingQueue.map((item, i) => (
                    <div key={i} className="sprint-card" style={{ '--stagger-index': Math.min(i, 10) } as React.CSSProperties}>
                      <p className="sprint-card__text">{item.text.replace(/\*\*/g, '')}</p>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Done */}
            <div className="sprint-col">
              <div className="sprint-col__header">
                <span className="sprint-col__icon sprint-col__icon--green">Done This Sprint</span>
                <span className="sprint-col__count">{doneItems.length}</span>
              </div>
              <div className="sprint-col__cards">
                {doneItems.length === 0 ? (
                  <EmptyState title="No completed PRs yet" />
                ) : (
                  doneItems.map((item, i) => (
                    <div key={item.pr} className="sprint-card" style={{ '--stagger-index': Math.min(i, 10) } as React.CSSProperties}>
                      <div className="sprint-card__done-row">
                        <a
                          href={prUrl(repo, item.pr)}
                          className="sprint-card__pr-link"
                          onClick={(e) => {
                            e.preventDefault()
                            window.api.openExternal(prUrl(repo, item.pr))
                          }}
                        >
                          <span className="sprint-card__pr-num">{item.pr}</span>
                        </a>
                        <span className="sprint-card__date">{item.merged}</span>
                      </div>
                      <p className="sprint-card__text-muted">{item.title}</p>
                    </div>
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

function CheckedOutCard({
  item,
  repo,
  expanded,
  onToggle,
  dimmed,
  staggerIndex
}: {
  item: CheckedOutItem
  repo: string
  expanded: boolean
  onToggle: () => void
  dimmed?: boolean
  staggerIndex?: number
}) {
  const files = item.files
    .split(',')
    .map((f) => f.trim())
    .filter(Boolean)

  return (
    <div
      className={`sprint-card ${dimmed ? 'sprint-card--dimmed' : ''}`}
      style={staggerIndex != null ? { '--stagger-index': Math.min(staggerIndex, 10) } as React.CSSProperties : undefined}
    >
      <div className="sprint-card__top-row">
        <a
          href={branchUrl(repo, item.branch)}
          className="sprint-card__branch-link"
          onClick={(e) => {
            e.preventDefault()
            window.api.openExternal(branchUrl(repo, item.branch))
          }}
        >
          {item.branch}
        </a>
        <Badge
          variant={item.status === 'Active' ? 'warning' : item.status === 'Done' ? 'success' : 'default'}
          size="sm"
        >
          {item.status}
        </Badge>
      </div>
      <div className="sprint-card__meta">
        <span>{item.agent}</span>
        <span>{timeAgo(item.started)}</span>
      </div>
      <Button variant="ghost" size="sm" className="sprint-card__files-toggle" onClick={onToggle}>
        {expanded ? '\u25BE' : '\u25B8'} {files.length} file{files.length !== 1 ? 's' : ''}
      </Button>
      {expanded && (
        <ul className="sprint-card__files-list">
          {files.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
      )}
    </div>
  )
}
