import { useCallback, useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useLocalAgentsStore } from '../../stores/localAgents'
import { toast } from '../../stores/toasts'
import { Button } from '../ui/Button'
import { SPAWN_TASK_MAX_CHARS_SOFT, SPAWN_TASK_MAX_CHARS_HARD, SPAWN_TASK_HISTORY_LIMIT, REPO_OPTIONS } from '../../lib/constants'
import { VARIANTS, SPRINGS, REDUCED_TRANSITION, useReducedMotion } from '../../lib/motion'
const MODELS = [
  { id: 'haiku', label: 'Haiku', claude: 'claude-haiku-4-5-20251001' },
  { id: 'sonnet', label: 'Sonnet', claude: 'claude-sonnet-4-6' },
  { id: 'opus', label: 'Opus', claude: 'claude-opus-4-6' }
] as const

const HISTORY_KEY = 'bde-spawn-history'

interface SpawnModalProps {
  open: boolean
  onClose: () => void
}

export function SpawnModal({ open, onClose }: SpawnModalProps): React.JSX.Element {
  const [task, setTask] = useState('')
  const [repo, setRepo] = useState<string>(REPO_OPTIONS[0].label)
  const [model, setModel] = useState<string>('sonnet')
  const [showHistory, setShowHistory] = useState(false)
  const [history, setHistory] = useState<string[]>([])
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const historyRef = useRef<HTMLDivElement>(null)
  const reduced = useReducedMotion()
  const spawnAgent = useLocalAgentsStore((s) => s.spawnAgent)
  const fetchProcesses = useLocalAgentsStore((s) => s.fetchProcesses)
  const spawning = useLocalAgentsStore((s) => s.isSpawning)
  const [repoPaths, setRepoPaths] = useState<Record<string, string>>({})
  const [isLoadingRepos, setIsLoadingRepos] = useState(true)
  const [repoLoadError, setRepoLoadError] = useState<string | null>(null)

  useEffect(() => {
    setIsLoadingRepos(true)
    setRepoLoadError(null)
    window.api
      .getRepoPaths()
      .then(setRepoPaths)
      .catch((err) => {
        setRepoLoadError(err instanceof Error ? err.message : 'Failed to load repository paths')
      })
      .finally(() => setIsLoadingRepos(false))
    // Load task history
    try {
      const stored = localStorage.getItem(HISTORY_KEY)
      if (stored) {
        const parsed = JSON.parse(stored)
        if (Array.isArray(parsed)) setHistory(parsed)
      }
    } catch {
      // Ignore parse errors
    }
  }, [])

  useEffect(() => {
    if (open) {
      setTask('')
      setRepo(REPO_OPTIONS[0].label)
      setModel('sonnet')
      setShowHistory(false)
      requestAnimationFrame(() => textareaRef.current?.focus())
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        if (showHistory) {
          setShowHistory(false)
        } else {
          onClose()
        }
      }
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [open, showHistory, onClose])

  // Close history dropdown on outside click
  useEffect(() => {
    if (!showHistory) return
    const handler = (e: MouseEvent): void => {
      if (historyRef.current && !historyRef.current.contains(e.target as Node)) {
        setShowHistory(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showHistory])

  const handleSubmit = useCallback(
    async (e?: { preventDefault(): void }): Promise<void> => {
      e?.preventDefault()
      if (!task.trim() || spawning) return
      const repoPath = repoPaths[repo]
      if (!repoPath) {
        toast.error(`Repo path not found for "${repo}" — check git.ts REPO_PATHS`)
        return
      }
      try {
        const taskTrimmed = task.trim()
        await spawnAgent({ task: taskTrimmed, repoPath, model })

        // Save to history
        const newHistory = [taskTrimmed, ...history.filter((t) => t !== taskTrimmed)].slice(0, SPAWN_TASK_HISTORY_LIMIT)
        setHistory(newHistory)
        localStorage.setItem(HISTORY_KEY, JSON.stringify(newHistory))

        fetchProcesses()
        toast.success('Agent spawned')
        onClose()
      } catch (err) {
        toast.error(`Spawn failed: ${err instanceof Error ? err.message : String(err)}`)
      }
    },
    [task, repo, model, spawnAgent, fetchProcesses, repoPaths, history, onClose, spawning]
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
      if (e.key === 'Enter' && e.metaKey) {
        e.preventDefault()
        if (task.trim() && !spawning && !isLoadingRepos && !repoLoadError) {
          handleSubmit()
        }
      }
    },
    [task, spawning, isLoadingRepos, repoLoadError, handleSubmit]
  )

  const selectHistoryItem = useCallback((historyTask: string): void => {
    setTask(historyTask)
    setShowHistory(false)
    textareaRef.current?.focus()
  }, [])

  const charCount = task.length
  const overSoftLimit = charCount > SPAWN_TASK_MAX_CHARS_SOFT
  const overHardLimit = charCount > SPAWN_TASK_MAX_CHARS_HARD

  return (
    <AnimatePresence>
      {open && (
    <div className="spawn-modal__overlay elevation-3-backdrop" onClick={onClose}>
      <motion.div
        className="spawn-modal glass-modal"
        onClick={(e) => e.stopPropagation()}
        variants={VARIANTS.scaleIn}
        initial="initial"
        animate="animate"
        exit="exit"
        transition={reduced ? REDUCED_TRANSITION : SPRINGS.snappy}
      >
        <h2 className="spawn-modal__title">Spawn Agent <span className="spawn-modal__plan-badge">⬡ Max</span></h2>

        <form onSubmit={handleSubmit}>
          <div className="spawn-modal__section">
            <label className="spawn-modal__label">Task Prompt</label>
            <div className="spawn-modal__textarea-wrapper">
              <textarea
                ref={textareaRef}
                className="spawn-modal__textarea"
                placeholder="Describe the task for the agent..."
                value={task}
                onChange={(e) => setTask(e.target.value)}
                onKeyDown={handleKeyDown}
                onFocus={() => history.length > 0 && setShowHistory(true)}
                rows={5}
                disabled={spawning}
                maxLength={SPAWN_TASK_MAX_CHARS_HARD}
              />
              {showHistory && history.length > 0 && (
                <div ref={historyRef} className="spawn-modal__history">
                  <div className="spawn-modal__history-label">Recent tasks</div>
                  {history.map((h) => (
                    <button
                      key={h}
                      type="button"
                      className="spawn-modal__history-item"
                      onClick={() => selectHistoryItem(h)}
                    >
                      {h.slice(0, 80)}
                      {h.length > 80 ? '...' : ''}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className={`spawn-modal__char-count ${overSoftLimit ? 'spawn-modal__char-count--warning' : ''} ${overHardLimit ? 'spawn-modal__char-count--error' : ''}`}>
              {charCount} / {SPAWN_TASK_MAX_CHARS_SOFT}
              {overSoftLimit && ` (max ${SPAWN_TASK_MAX_CHARS_HARD})`}
            </div>
          </div>

          <div className="spawn-modal__section">
            <label className="spawn-modal__label">Repository</label>
            <select
              className="spawn-modal__select"
              value={repo}
              onChange={(e) => setRepo(e.target.value)}
              disabled={spawning}
            >
              {REPO_OPTIONS.map((r) => {
                const path = repoPaths[r.label]
                const shortPath = path ? path.replace(/^\/Users\/[^/]+/, '~') : r.label
                return (
                  <option key={r.label} value={r.label}>
                    {r.label} ({shortPath})
                  </option>
                )
              })}
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

          {repoLoadError && (
            <div className="spawn-modal__error">{repoLoadError}</div>
          )}

          <div className="spawn-modal__actions">
            <Button variant="ghost" size="md" type="button" onClick={onClose} disabled={spawning}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="md"
              type="submit"
              disabled={!task.trim() || spawning || isLoadingRepos || !!repoLoadError}
              loading={spawning || isLoadingRepos}
            >
              {isLoadingRepos ? 'Loading...' : spawning ? 'Spawning...' : 'Spawn'}
            </Button>
          </div>
        </form>
      </motion.div>
    </div>
      )}
    </AnimatePresence>
  )
}
