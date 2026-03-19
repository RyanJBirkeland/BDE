/**
 * DiffView — full git client UI.
 * Provides file staging/unstaging, diff viewer, commit message composer,
 * and push interface. Supports multi-repo selection. Fetches git status
 * via IPC (git:status, git:diff) and polls every 30s.
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import { useVisibilityAwareInterval } from '../hooks/useVisibilityAwareInterval'
import { GitBranch } from 'lucide-react'
import { DiffViewer } from '../components/diff/DiffViewer'
import { parseDiffChunked } from '../lib/diff-parser'
import type { DiffFile } from '../lib/diff-parser'
import { Button } from '../components/ui/Button'
import { EmptyState } from '../components/ui/EmptyState'
import { DiffSizeWarning } from '../components/diff/DiffSizeWarning'
import { ErrorBanner } from '../components/ui/ErrorBanner'
import { POLL_GIT_STATUS_INTERVAL, DIFF_SIZE_WARN_BYTES } from '../lib/constants'
import * as git from '../services/git'
import { toast } from '../stores/toasts'

interface GitFileEntry {
  path: string
  status: string
  staged: boolean
}

/** Deduplicate files — show each path once, preferring unstaged if both exist */
function dedupeFiles(files: GitFileEntry[]): (GitFileEntry & { hasStaged: boolean })[] {
  const map = new Map<string, GitFileEntry & { hasStaged: boolean }>()
  for (const f of files) {
    const existing = map.get(f.path)
    if (existing) {
      if (f.staged) existing.hasStaged = true
      else {
        existing.staged = false
        existing.hasStaged = true
      }
    } else {
      map.set(f.path, { ...f, hasStaged: f.staged })
    }
  }
  return Array.from(map.values())
}

function DiffView(): React.JSX.Element {
  const [repos, setRepos] = useState<Record<string, string>>({})
  const [selectedRepo, setSelectedRepo] = useState<string | null>(null)
  const [branches, setBranches] = useState<string[]>([])
  const [currentBranch, setCurrentBranch] = useState('')
  const [files, setFiles] = useState<(GitFileEntry & { hasStaged: boolean })[]>([])
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [diffFiles, setDiffFiles] = useState<DiffFile[]>([])
  const [stagedSet, setStagedSet] = useState<Set<string>>(new Set())
  const [commitMsg, setCommitMsg] = useState('')
  const [loading, setLoading] = useState(true)
  const [pushing, setPushing] = useState(false)
  const [committing, setCommitting] = useState(false)
  const [pushOutput, setPushOutput] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [diffSizeWarning, setDiffSizeWarning] = useState<number | null>(null)
  const rawDiffRef = useRef<string | null>(null)
  const diffAbortRef = useRef<AbortController | null>(null)

  // Load repos on mount
  useEffect(() => {
    git.getRepoPaths().then((paths) => {
      setRepos(paths)
      if (paths['bde']) setSelectedRepo('bde')
      else {
        const first = Object.keys(paths)[0]
        if (first) setSelectedRepo(first)
      }
    }).catch(() => {
      setError('Failed to load repo paths')
    })
  }, [])

  const repoPath = selectedRepo ? repos[selectedRepo] : null

  // Refresh status + branches
  const refresh = useCallback(async () => {
    if (!repoPath) return
    setLoading(true)
    setError(null)
    try {
      const [statusResult, branchResult] = await Promise.all([
        git.getStatus(repoPath),
        git.getBranches(repoPath)
      ])
      const deduped = dedupeFiles(statusResult.files)
      setFiles(deduped)
      setBranches(branchResult.branches)
      setCurrentBranch(branchResult.current)

      const staged = new Set<string>()
      for (const f of statusResult.files) {
        if (f.staged) staged.add(f.path)
      }
      setStagedSet(staged)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load status')
    } finally {
      setLoading(false)
    }
  }, [repoPath])

  useEffect(() => {
    refresh()
  }, [refresh])

  useVisibilityAwareInterval(refresh, POLL_GIT_STATUS_INTERVAL)

  const applyRawDiff = useCallback((raw: string) => {
    diffAbortRef.current?.abort()
    const controller = new AbortController()
    diffAbortRef.current = controller
    parseDiffChunked(raw, setDiffFiles, controller.signal).catch(() => {
      // AbortError is expected on re-navigation; silently ignore
    })
  }, [])

  // Load diff when selected file changes
  const loadDiff = useCallback(async () => {
    if (!repoPath) return
    setDiffSizeWarning(null)
    rawDiffRef.current = null
    try {
      const raw = await git.getDiff(repoPath, selectedFile ?? undefined)
      rawDiffRef.current = raw
      if (raw.length > DIFF_SIZE_WARN_BYTES) {
        setDiffSizeWarning(raw.length)
        setDiffFiles([])
        return
      }
      applyRawDiff(raw)
    } catch {
      setDiffFiles([])
    }
  }, [repoPath, selectedFile, applyRawDiff])

  useEffect(() => {
    loadDiff()
  }, [loadDiff])

  useEffect(() => {
    const handler = (): void => {
      refresh()
      loadDiff()
    }
    window.addEventListener('bde:refresh', handler)
    return () => window.removeEventListener('bde:refresh', handler)
  }, [refresh, loadDiff])

  const toggleStage = async (filePath: string): Promise<void> => {
    if (!repoPath) return
    const isStaged = stagedSet.has(filePath)
    try {
      if (isStaged) {
        await git.unstageFiles(repoPath, [filePath])
      } else {
        await git.stageFiles(repoPath, [filePath])
      }
      await refresh()
      await loadDiff()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Stage/unstage failed')
    }
  }

  const stageAll = async (): Promise<void> => {
    if (!repoPath) return
    const unstaged = files.filter((f) => !stagedSet.has(f.path)).map((f) => f.path)
    if (unstaged.length === 0) return
    try {
      await git.stageFiles(repoPath, unstaged)
      await refresh()
      await loadDiff()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Stage all failed')
    }
  }

  const unstageAll = async (): Promise<void> => {
    if (!repoPath) return
    const staged = files.filter((f) => stagedSet.has(f.path)).map((f) => f.path)
    if (staged.length === 0) return
    try {
      await git.unstageFiles(repoPath, staged)
      await refresh()
      await loadDiff()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unstage all failed')
    }
  }

  const doCommit = async (): Promise<void> => {
    if (!repoPath || !commitMsg.trim()) return
    setCommitting(true)
    setError(null)
    try {
      await git.commit(repoPath, commitMsg.trim())
      setCommitMsg('')
      await refresh()
      await loadDiff()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Commit failed')
    } finally {
      setCommitting(false)
    }
  }

  const doPush = async (): Promise<void> => {
    if (!repoPath) return
    setPushing(true)
    setPushOutput(null)
    setError(null)
    try {
      const output = await git.push(repoPath)
      setPushOutput(output || 'Pushed successfully')
      await refresh()
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Push failed'
      setError(msg)
      toast.error(msg)
    } finally {
      setPushing(false)
    }
  }

  const switchBranch = async (branch: string): Promise<void> => {
    if (!repoPath || branch === currentBranch) return
    try {
      await git.checkout(repoPath, branch)
      await refresh()
      await loadDiff()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Checkout failed')
    }
  }

  const repoNames = Object.keys(repos)
  const stagedCount = files.filter((f) => stagedSet.has(f.path)).length

  const statusLabel = (status: string): string => {
    switch (status) {
      case 'M':
        return 'modified'
      case 'A':
        return 'added'
      case 'D':
        return 'deleted'
      case '?':
        return 'untracked'
      case 'R':
        return 'renamed'
      case 'C':
        return 'copied'
      default:
        return status
    }
  }

  return (
    <div className="diff-view">
      <div className="diff-view__header">
        <div className="diff-view__repos">
          {repoNames.map((name) => (
            <button
              key={name}
              className={`diff-view__chip ${selectedRepo === name ? 'diff-view__chip--active' : ''}`}
              onClick={() => {
                setSelectedRepo(name)
                setSelectedFile(null)
                setPushOutput(null)
              }}
            >
              {name}
            </button>
          ))}
        </div>
        <div className="diff-view__meta">
          {branches.length > 0 && (
            <select
              className="git-branch-select"
              value={currentBranch}
              onChange={(e) => switchBranch(e.target.value)}
            >
              {branches.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          )}
          <Button
            variant="icon"
            size="sm"
            onClick={() => {
              refresh()
              loadDiff()
            }}
            disabled={loading}
            title="Refresh"
          >
            &#x21bb;
          </Button>
        </div>
      </div>

      <ErrorBanner message={error} className="diff-view__error" />
      {pushOutput && (
        <div className="git-push-output">
          <pre>{pushOutput}</pre>
          <button className="git-push-output__close" onClick={() => setPushOutput(null)}>
            &times;
          </button>
        </div>
      )}

      {loading && files.length === 0 ? (
        <div className="diff-view__loading">
          <div className="diff-view__loading-grid">
            <div className="bde-skeleton diff-view__loading-sidebar" />
            <div className="bde-skeleton diff-view__loading-content" />
          </div>
        </div>
      ) : (
        <div className="git-client">
          <div className="git-sidebar">
            <div className="git-sidebar__header">
              <span className="git-sidebar__title">Changes</span>
              <span className="git-sidebar__count bde-count-badge">{files.length}</span>
            </div>

            <div className="git-sidebar__actions">
              <button className="git-sidebar__action" onClick={stageAll} title="Stage all">
                Stage All
              </button>
              {stagedCount > 0 && (
                <button className="git-sidebar__action" onClick={unstageAll} title="Unstage all">
                  Unstage All
                </button>
              )}
            </div>

            <div className="git-sidebar__list">
              {files.map((f) => {
                const isStaged = stagedSet.has(f.path)
                return (
                  <div
                    key={f.path}
                    className={`git-file-item ${selectedFile === f.path ? 'git-file-item--active' : ''}`}
                  >
                    <label
                      className="git-file-item__checkbox"
                      title={isStaged ? 'Unstage' : 'Stage'}
                    >
                      <input
                        type="checkbox"
                        checked={isStaged}
                        onChange={() => toggleStage(f.path)}
                      />
                    </label>
                    <button
                      className="git-file-item__name"
                      onClick={() => setSelectedFile(selectedFile === f.path ? null : f.path)}
                    >
                      {f.path.split('/').pop()}
                    </button>
                    <span
                      className={`git-file-item__status git-file-item__status--${f.status.toLowerCase()}`}
                      title={statusLabel(f.status)}
                    >
                      {f.status}
                    </span>
                  </div>
                )
              })}
              {files.length === 0 && (
                <EmptyState
                  icon={<GitBranch size={24} />}
                  title="Working tree clean"
                  description="No uncommitted changes"
                />
              )}
            </div>

            <div className="git-commit-panel">
              <textarea
                className="git-commit-panel__input"
                placeholder="Commit message..."
                value={commitMsg}
                onChange={(e) => setCommitMsg(e.target.value)}
                rows={3}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && e.metaKey) {
                    e.preventDefault()
                    doCommit()
                  }
                }}
              />
              <div className="git-commit-panel__actions">
                <Button
                  variant="primary"
                  size="sm"
                  onClick={doCommit}
                  disabled={!commitMsg.trim() || stagedCount === 0 || committing}
                  loading={committing}
                >
                  Commit ({stagedCount})
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={doPush}
                  disabled={pushing}
                  loading={pushing}
                >
                  Push
                </Button>
              </div>
            </div>
          </div>

          <div className="git-diff-pane">
            {selectedFile && (
              <div className="git-diff-pane__file-header">
                <span className="git-diff-pane__file-path">{selectedFile}</span>
              </div>
            )}
            {diffSizeWarning ? (
              <DiffSizeWarning
                sizeBytes={diffSizeWarning}
                onLoadAnyway={() => {
                  setDiffSizeWarning(null)
                  if (rawDiffRef.current) applyRawDiff(rawDiffRef.current)
                }}
              />
            ) : (
              <DiffViewer files={diffFiles} />
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default DiffView
