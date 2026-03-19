import { useState, useEffect, useCallback } from 'react'
import { GitMerge, ExternalLink, Play, Loader2 } from 'lucide-react'
import { Button } from '../ui/Button'
import { Badge } from '../ui/Badge'
import { toast } from '../../stores/toasts'
import { repoColor } from '../../lib/format'
import { parsePrUrl } from '../../../../shared/github'
import type { SprintTask } from '../../../../shared/types'

type ConflictDrawerProps = {
  open: boolean
  tasks: SprintTask[]
  onClose: () => void
}

interface BranchInfo {
  headBranch: string
  baseBranch: string
  files: string[]
  loading: boolean
}

export function ConflictDrawer({ open, tasks, onClose }: ConflictDrawerProps) {
  const [resolving, setResolving] = useState<string | null>(null)
  const [branchInfo, setBranchInfo] = useState<Record<string, BranchInfo>>({})
  const [expandedId, setExpandedId] = useState<string | null>(null)

  // Fetch branch info for each conflicting task when drawer opens
  useEffect(() => {
    if (!open || tasks.length === 0) return

    const controller = new AbortController()

    for (const task of tasks) {
      if (!task.pr_url || !task.pr_number) continue
      if (branchInfo[task.id] && !branchInfo[task.id].loading) continue

      const parsed = parsePrUrl(task.pr_url)
      if (!parsed) continue

      setBranchInfo((prev) => ({
        ...prev,
        [task.id]: { headBranch: '', baseBranch: '', files: [], loading: true },
      }))

      window.api
        .checkConflictFiles({
          owner: parsed.owner,
          repo: parsed.repo,
          prNumber: task.pr_number,
        })
        .then((result) => {
          if (controller.signal.aborted) return
          setBranchInfo((prev) => ({
            ...prev,
            [task.id]: {
              headBranch: result.headBranch,
              baseBranch: result.baseBranch,
              files: result.files,
              loading: false,
            },
          }))
        })
        .catch(() => {
          if (controller.signal.aborted) return
          setBranchInfo((prev) => ({
            ...prev,
            [task.id]: { ...prev[task.id], loading: false },
          }))
        })
    }

    return () => { controller.abort() }
  }, [open, tasks])

  // Reset when drawer closes
  useEffect(() => {
    if (!open) {
      setBranchInfo({})
      setExpandedId(null)
    }
  }, [open])

  const handleResolve = useCallback(
    async (task: SprintTask) => {
      setResolving(task.id)
      try {
        const repoPaths = await window.api.getRepoPaths()
        const repoPath = repoPaths[task.repo.toLowerCase()] ?? repoPaths[task.repo]
        if (!repoPath) {
          toast.error(`No repo path configured for "${task.repo}"`)
          return
        }

        const info = branchInfo[task.id]
        const head = info?.headBranch ?? 'the PR branch'
        const base = info?.baseBranch ?? 'main'

        const prompt = [
          `Resolve merge conflicts on branch "${head}" with "${base}".`,
          '',
          `PR #${task.pr_number}: ${task.title}`,
          '',
          'Steps:',
          `1. git fetch origin`,
          `2. git checkout ${head}`,
          `3. git rebase origin/${base}`,
          '4. Resolve all merge conflicts — keep both sets of changes where possible',
          '5. git rebase --continue',
          '6. git push --force-with-lease',
          '',
          'IMPORTANT: Do NOT drop any changes from either side unless they are truly redundant.',
          'For import lists, keep all imports from both sides.',
          'For props/interfaces, keep all fields from both sides.',
        ].join('\n')

        await window.api.spawnLocalAgent({ task: prompt, repoPath })
        toast.success(`Conflict resolution agent launched for PR #${task.pr_number}`)
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Failed to launch agent')
      } finally {
        setResolving(null)
      }
    },
    [branchInfo]
  )

  return (
    <>
      {open && <div className="conflict-drawer__overlay" onClick={onClose} />}
      <div className={`conflict-drawer ${open ? 'conflict-drawer--open' : ''}`}>
        <div className="conflict-drawer__header">
          <div className="conflict-drawer__header-left">
            <GitMerge size={14} />
            <span className="conflict-drawer__title">Merge Conflicts</span>
            <Badge variant="danger" size="sm">{tasks.length}</Badge>
          </div>
          <Button variant="icon" size="sm" onClick={onClose} title="Close">
            &#x2715;
          </Button>
        </div>

        <div className="conflict-drawer__body">
          {tasks.length === 0 ? (
            <div className="conflict-drawer__empty">No merge conflicts detected.</div>
          ) : (
            tasks.map((task) => {
              const info = branchInfo[task.id]
              const isExpanded = expandedId === task.id
              return (
                <div key={task.id} className="conflict-row">
                  <div
                    className="conflict-row__header"
                    onClick={() => setExpandedId(isExpanded ? null : task.id)}
                  >
                    <span
                      className="conflict-row__repo-dot"
                      style={{ background: repoColor(task.repo) }}
                      title={task.repo}
                    />
                    <div className="conflict-row__info">
                      <span className="conflict-row__title">{task.title}</span>
                      <span className="conflict-row__meta">
                        {task.repo} #{task.pr_number}
                        {info?.headBranch && ` \u00B7 ${info.headBranch}`}
                      </span>
                    </div>
                    <Badge variant="danger" size="sm">dirty</Badge>
                    <span className="conflict-row__chevron">
                      {isExpanded ? '\u25BE' : '\u25B8'}
                    </span>
                  </div>

                  {isExpanded && (
                    <div className="conflict-row__detail">
                      {info?.loading ? (
                        <div className="conflict-row__loading">Loading file list...</div>
                      ) : info?.files.length ? (
                        <>
                          <div className="conflict-row__files-label">
                            Changed files ({info.files.length}):
                          </div>
                          <ul className="conflict-row__files-list">
                            {info.files.map((f) => (
                              <li key={f}>{f}</li>
                            ))}
                          </ul>
                        </>
                      ) : (
                        <div className="conflict-row__loading">
                          Could not load file details.
                        </div>
                      )}

                      <div className="conflict-row__actions">
                        {task.pr_url && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => window.api.openExternal(task.pr_url!)}
                            title="Open on GitHub"
                          >
                            <ExternalLink size={13} /> View PR
                          </Button>
                        )}
                        <Button
                          variant="primary"
                          size="sm"
                          disabled={resolving === task.id}
                          onClick={() => handleResolve(task)}
                          title="Spawn an agent to resolve conflicts"
                        >
                          {resolving === task.id ? (
                            <>
                              <Loader2 size={13} className="conflict-row__spinner" /> Resolving...
                            </>
                          ) : (
                            <>
                              <Play size={13} /> Fix Conflicts
                            </>
                          )}
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>

        <div className="conflict-drawer__footer">
          <span className="conflict-drawer__hint">
            Fix Conflicts spawns a Claude agent to rebase the branch and resolve conflicts.
          </span>
        </div>
      </div>
    </>
  )
}
