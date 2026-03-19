/**
 * DiffView — thin render layer for the git client UI.
 * All state and logic lives in stores/diffView.ts.
 */
import { useEffect } from 'react'
import { useVisibilityAwareInterval } from '../hooks/useVisibilityAwareInterval'
import { GitBranch } from 'lucide-react'
import { DiffViewer } from '../components/diff/DiffViewer'
import { Button } from '../components/ui/Button'
import { EmptyState } from '../components/ui/EmptyState'
import { DiffSizeWarning } from '../components/diff/DiffSizeWarning'
import { ErrorBanner } from '../components/ui/ErrorBanner'
import { POLL_GIT_STATUS_INTERVAL } from '../lib/constants'
import { useDiffViewStore } from '../stores/diffView'

function statusLabel(status: string): string {
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

function DiffView(): React.JSX.Element {
  const store = useDiffViewStore()

  useEffect(() => {
    store.loadRepos()
  }, [])
  useEffect(() => {
    store.refresh()
  }, [store.selectedRepo])
  useEffect(() => {
    store.loadDiff()
  }, [store.selectedRepo, store.selectedFile])

  useVisibilityAwareInterval(() => store.refresh(), POLL_GIT_STATUS_INTERVAL)

  useEffect(() => {
    const handler = (): void => {
      store.refresh()
      store.loadDiff()
    }
    window.addEventListener('bde:refresh', handler)
    return () => window.removeEventListener('bde:refresh', handler)
  }, [])

  const repoNames = Object.keys(store.repos)
  const stagedCount = store.files.filter((f) => store.stagedSet.has(f.path)).length

  return (
    <div className="diff-view">
      <div className="diff-view__header">
        <div className="diff-view__repos">
          {repoNames.map((name) => (
            <button
              key={name}
              className={`diff-view__chip ${store.selectedRepo === name ? 'diff-view__chip--active' : ''}`}
              onClick={() => store.selectRepo(name)}
            >
              {name}
            </button>
          ))}
        </div>
        <div className="diff-view__meta">
          {store.branches.length > 0 && (
            <select
              className="git-branch-select"
              value={store.currentBranch}
              onChange={(e) => store.switchBranch(e.target.value)}
            >
              {store.branches.map((b) => (
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
              store.refresh()
              store.loadDiff()
            }}
            disabled={store.loading}
            title="Refresh"
          >
            &#x21bb;
          </Button>
        </div>
      </div>

      <ErrorBanner message={store.error} className="diff-view__error" />
      {store.pushOutput && (
        <div className="git-push-output">
          <pre>{store.pushOutput}</pre>
          <button className="git-push-output__close" onClick={() => store.setPushOutput(null)}>
            &times;
          </button>
        </div>
      )}

      {store.loading && store.files.length === 0 ? (
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
              <span className="git-sidebar__count bde-count-badge">{store.files.length}</span>
            </div>

            <div className="git-sidebar__actions">
              <button
                className="git-sidebar__action"
                onClick={() => store.stageAll()}
                title="Stage all"
              >
                Stage All
              </button>
              {stagedCount > 0 && (
                <button
                  className="git-sidebar__action"
                  onClick={() => store.unstageAll()}
                  title="Unstage all"
                >
                  Unstage All
                </button>
              )}
            </div>

            <div className="git-sidebar__list">
              {store.files.map((f) => {
                const isStaged = store.stagedSet.has(f.path)
                return (
                  <div
                    key={f.path}
                    className={`git-file-item ${store.selectedFile === f.path ? 'git-file-item--active' : ''}`}
                  >
                    <label
                      className="git-file-item__checkbox"
                      title={isStaged ? 'Unstage' : 'Stage'}
                    >
                      <input
                        type="checkbox"
                        checked={isStaged}
                        onChange={() => store.toggleStage(f.path)}
                      />
                    </label>
                    <button
                      className="git-file-item__name"
                      onClick={() =>
                        store.setSelectedFile(store.selectedFile === f.path ? null : f.path)
                      }
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
              {store.files.length === 0 && (
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
                value={store.commitMsg}
                onChange={(e) => store.setCommitMsg(e.target.value)}
                rows={3}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && e.metaKey) {
                    e.preventDefault()
                    store.commit()
                  }
                }}
              />
              <div className="git-commit-panel__actions">
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => store.commit()}
                  disabled={!store.commitMsg.trim() || stagedCount === 0 || store.committing}
                  loading={store.committing}
                >
                  Commit ({stagedCount})
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => store.push()}
                  disabled={store.pushing}
                  loading={store.pushing}
                >
                  Push
                </Button>
              </div>
            </div>
          </div>

          <div className="git-diff-pane">
            {store.selectedFile && (
              <div className="git-diff-pane__file-header">
                <span className="git-diff-pane__file-path">{store.selectedFile}</span>
              </div>
            )}
            {store.diffSizeWarning ? (
              <DiffSizeWarning
                sizeBytes={store.diffSizeWarning}
                onLoadAnyway={() => store.forceLoadLargeDiff()}
              />
            ) : (
              <DiffViewer files={store.diffFiles} />
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default DiffView
