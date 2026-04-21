import React, { useEffect, useCallback } from 'react'
import './GitTreeView.css'
import { motion } from 'framer-motion'
import {
  GitBranch,
  RefreshCw,
  AlertCircle,
  X,
  CheckCircle,
  Download,
  ArrowDownToLine
} from 'lucide-react'
import { useGitTreeStore } from '../stores/gitTree'
import { toast } from '../stores/toasts'
import { CommitBox } from '../components/git-tree/CommitBox'
import { FileTreeSection } from '../components/git-tree/FileTreeSection'
import { BranchSelector } from '../components/git-tree/BranchSelector'
import { InlineDiffDrawer } from '../components/git-tree/InlineDiffDrawer'
import { EmptyState } from '../components/ui/EmptyState'
import { VARIANTS, SPRINGS, REDUCED_TRANSITION, useReducedMotion } from '../lib/motion'
import { useGitHubStatus } from '../hooks/useGitHubStatus'
import { useGitCommands } from '../hooks/useGitCommands'
import { ErrorBoundary } from '../components/ui/ErrorBoundary'

export default function GitTreeView(): React.ReactElement {
  const reduced = useReducedMotion()
  const { configured: ghConfigured } = useGitHubStatus()
  const branch = useGitTreeStore((s) => s.branch)
  const staged = useGitTreeStore((s) => s.staged)
  const unstaged = useGitTreeStore((s) => s.unstaged)
  const untracked = useGitTreeStore((s) => s.untracked)
  const loading = useGitTreeStore((s) => s.loading)
  const selectedFile = useGitTreeStore((s) => s.selectedFile)
  const diffContent = useGitTreeStore((s) => s.diffContent)
  const commitMessage = useGitTreeStore((s) => s.commitMessage)
  const repoPaths = useGitTreeStore((s) => s.repoPaths)
  const activeRepo = useGitTreeStore((s) => s.activeRepo)
  const branches = useGitTreeStore((s) => s.branches)
  const commitLoading = useGitTreeStore((s) => s.commitLoading)
  const pushLoading = useGitTreeStore((s) => s.pushLoading)
  const lastError = useGitTreeStore((s) => s.lastError)
  const lastErrorOp = useGitTreeStore((s) => s.lastErrorOp)

  const {
    fetchStatus,
    selectFile,
    clearSelection,
    stageFile,
    unstageFile,
    unstageAll,
    setCommitMessage,
    commit,
    push,
    fetchBranches,
    setActiveRepo,
    loadRepoPaths,
    clearError,
    setLastError
  } = useGitTreeStore.getState()

  const hasUncommittedChanges = staged.length > 0 || unstaged.length > 0 || untracked.length > 0

  // Load repos and initial status on mount
  useEffect(() => {
    loadRepoPaths()
  }, [loadRepoPaths])

  useEffect(() => {
    if (!activeRepo) return
    clearSelection()
    fetchStatus(activeRepo)
    fetchBranches(activeRepo)
  }, [activeRepo])

  function handleRefresh(): void {
    if (!activeRepo) return
    fetchStatus(activeRepo)
  }

  function handleRepoChange(e: React.ChangeEvent<HTMLSelectElement>): void {
    setActiveRepo(e.target.value)
  }

  function handleCheckout(branchName: string): void {
    if (!activeRepo) return
    window.api.git
      .checkout(activeRepo, branchName)
      .then(() => {
        fetchStatus(activeRepo)
        fetchBranches(activeRepo)
      })
      .catch((err) => {
        toast.error(`Checkout failed: ${err instanceof Error ? err.message : 'Unknown error'}`)
      })
  }

  function handleSelectFile(path: string, isStaged: boolean): void {
    if (!activeRepo) return
    selectFile(activeRepo, path, isStaged)
  }

  function handleStageFile(path: string): void {
    if (!activeRepo) return
    stageFile(activeRepo, path)
  }

  function handleUnstageFile(path: string): void {
    if (!activeRepo) return
    unstageFile(activeRepo, path)
  }

  function handleUnstageAll(): void {
    if (!activeRepo) return
    unstageAll(activeRepo)
  }

  function handleCommit(): void {
    if (!activeRepo) return
    commit(activeRepo)
  }

  function handlePush(): void {
    if (!activeRepo) return
    push(activeRepo)
  }

  function handleFetch(): void {
    if (!activeRepo) return
    window.api.git
      .fetch(activeRepo)
      .then((result) => {
        if (result.success) {
          toast.success('Fetched from origin')
          fetchStatus(activeRepo)
        } else {
          toast.error(result.error ?? 'Failed to fetch')
        }
      })
      .catch((err) => {
        toast.error(`Fetch failed: ${err instanceof Error ? err.message : 'Unknown error'}`)
      })
  }

  function handlePull(): void {
    if (!activeRepo || !branch) return
    window.api.git
      .pull(activeRepo, branch)
      .then((result) => {
        if (result.success) {
          toast.success('Pulled from origin')
          fetchStatus(activeRepo)
        } else {
          toast.error(result.error ?? 'Failed to pull')
        }
      })
      .catch((err) => {
        toast.error(`Pull failed: ${err instanceof Error ? err.message : 'Unknown error'}`)
      })
  }

  function handleStageSection(paths: string[]): void {
    if (!activeRepo) return
    window.api.git
      .stage(activeRepo, paths)
      .then(() => fetchStatus(activeRepo))
      .catch((e) => {
        setLastError(`Failed to stage files: ${e instanceof Error ? e.message : 'Unknown error'}`)
      })
  }

  const handleStageAll = useCallback(() => {
    if (!activeRepo) return
    const allUnstaged = [...unstaged, ...untracked].map((f) => f.path)
    if (allUnstaged.length === 0) {
      toast.info('No unstaged files to stage')
      return
    }
    handleStageSection(allUnstaged)
  }, [activeRepo, unstaged, untracked])

  const handleSwitchBranch = useCallback(() => {
    const selector = document.querySelector('.branch-selector__button') as HTMLElement
    if (selector) {
      selector.focus()
      selector.click()
    }
  }, [])

  const handleCommitAction = useCallback(() => {
    if (!activeRepo) return
    commit(activeRepo)
  }, [activeRepo, commit])

  const handlePushAction = useCallback(() => {
    if (!activeRepo) return
    push(activeRepo)
  }, [activeRepo, push])

  useGitCommands({
    onStageAll: handleStageAll,
    onCommit: handleCommitAction,
    onPush: handlePushAction,
    onSwitchBranch: handleSwitchBranch
  })

  return (
    <ErrorBoundary name="GitTreeView">
      <motion.div
        className="git-tree-view"
        variants={VARIANTS.fadeIn}
        initial="initial"
        animate="animate"
        transition={reduced ? REDUCED_TRANSITION : SPRINGS.snappy}
      >
        {/* Header */}
        <div className="git-tree-view__header">
          {/* Title */}
          <div className="git-tree-view__title text-gradient-aurora">
            <GitBranch size={14} />
            Source Control
          </div>

          {/* Spacer */}
          <div className="git-tree-view__spacer" />

          {/* Repo selector */}
          {repoPaths.length > 1 && (
            <select
              value={activeRepo ?? ''}
              onChange={handleRepoChange}
              aria-label="Select repository"
              className="git-tree-view__repo-select bde-select"
            >
              {repoPaths.map((p) => (
                <option key={p} value={p}>
                  {p.split('/').pop() ?? p}
                </option>
              ))}
            </select>
          )}

          {/* Branch selector */}
          <BranchSelector
            currentBranch={branch}
            branches={branches}
            hasUncommittedChanges={hasUncommittedChanges}
            onCheckout={handleCheckout}
          />

          {/* Fetch button */}
          <button
            onClick={handleFetch}
            aria-label="Fetch from remote"
            title="Fetch"
            disabled={loading}
            className="git-tree-view__refresh-btn"
          >
            <Download size={14} />
          </button>

          {/* Pull button */}
          <button
            onClick={handlePull}
            aria-label="Pull from remote"
            title="Pull"
            disabled={loading}
            className="git-tree-view__refresh-btn"
          >
            <ArrowDownToLine size={14} />
            Pull
          </button>

          {/* Refresh button */}
          <button
            onClick={handleRefresh}
            aria-label="Refresh git status"
            title="Refresh"
            disabled={loading}
            className={`git-tree-view__refresh-btn ${loading ? 'git-tree-view__refresh-btn--loading' : ''}`}
          >
            <RefreshCw
              size={14}
              style={{
                animation: loading ? 'bde-spin 1s linear infinite' : 'none'
              }}
            />
          </button>
        </div>

        {/* Commit box */}
        <CommitBox
          commitMessage={commitMessage}
          stagedCount={staged.length}
          commitLoading={commitLoading}
          pushLoading={pushLoading}
          pushDisabled={!ghConfigured}
          pushDisabledTitle="Configure GitHub in Settings → Connections"
          onMessageChange={setCommitMessage}
          onCommit={handleCommit}
          onPush={handlePush}
        />

        {/* Persistent error banner */}
        {lastError && (
          <div className="git-tree-view__error-banner" role="alert">
            <AlertCircle size={14} />
            <span className="git-tree-view__error-text">{lastError}</span>
            <button
              className="git-tree-view__error-retry"
              onClick={() => {
                clearError()
                if (lastErrorOp === 'push') handlePush()
                else if (lastErrorOp === 'commit') handleCommit()
              }}
              aria-label="Retry failed operation"
            >
              Retry
            </button>
            <button
              className="git-tree-view__error-dismiss"
              onClick={clearError}
              aria-label="Dismiss error"
            >
              <X size={12} />
            </button>
          </div>
        )}

        {/* File sections — scrollable */}
        <div className="git-tree-view__body">
          {/* Staged changes */}
          <FileTreeSection
            title="Staged Changes"
            files={staged}
            isStaged={true}
            selectedPath={selectedFile?.path}
            onUnstageAll={handleUnstageAll}
            onStageFile={handleStageFile}
            onUnstageFile={handleUnstageFile}
            onSelectFile={(path) => handleSelectFile(path, true)}
          />

          {/* Modified (unstaged tracked files) */}
          {unstaged.length > 0 && (
            <FileTreeSection
              title="Modified"
              files={unstaged}
              isStaged={false}
              selectedPath={selectedFile?.path}
              onStageAll={() => handleStageSection(unstaged.map((f) => f.path))}
              onStageFile={handleStageFile}
              onUnstageFile={handleUnstageFile}
              onSelectFile={(path) => handleSelectFile(path, false)}
            />
          )}

          {/* Untracked (new files not yet in git) */}
          {untracked.length > 0 && (
            <FileTreeSection
              title="Untracked"
              files={untracked}
              isStaged={false}
              selectedPath={selectedFile?.path}
              onStageAll={() => handleStageSection(untracked.map((f) => f.path))}
              onStageFile={handleStageFile}
              onUnstageFile={handleUnstageFile}
              onSelectFile={(path) => handleSelectFile(path, false)}
            />
          )}

          {/* Loading skeleton */}
          {loading && staged.length === 0 && unstaged.length === 0 && untracked.length === 0 && (
            <div style={{ padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div className="bde-skeleton" style={{ height: 24, width: '60%' }} />
              <div className="bde-skeleton" style={{ height: 32 }} />
              <div className="bde-skeleton" style={{ height: 32 }} />
              <div className="bde-skeleton" style={{ height: 32 }} />
            </div>
          )}

          {/* Empty state */}
          {staged.length === 0 && unstaged.length === 0 && untracked.length === 0 && !loading && (
            <EmptyState
              icon={<CheckCircle size={24} />}
              title="Working tree clean"
              description="No uncommitted changes. Edit files or pull updates to see changes here."
            />
          )}
        </div>

        {/* Inline diff drawer */}
        <InlineDiffDrawer
          selectedFile={selectedFile}
          diffContent={diffContent}
          onClose={clearSelection}
        />
      </motion.div>
    </ErrorBoundary>
  )
}
