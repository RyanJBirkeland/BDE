import React, { useEffect } from 'react'
import { motion } from 'framer-motion'
import { GitBranch, RefreshCw, AlertCircle, X } from 'lucide-react'
import { useGitTreeStore } from '../stores/gitTree'
import { toast } from '../stores/toasts'
import { CommitBox } from '../components/git-tree/CommitBox'
import { FileTreeSection } from '../components/git-tree/FileTreeSection'
import { BranchSelector } from '../components/git-tree/BranchSelector'
import { InlineDiffDrawer } from '../components/git-tree/InlineDiffDrawer'
import { VARIANTS, SPRINGS, REDUCED_TRANSITION, useReducedMotion } from '../lib/motion'

export default function GitTreeView(): React.ReactElement {
  const reduced = useReducedMotion()
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
    window.api
      .gitCheckout(activeRepo, branchName)
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

  return (
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
            className="git-tree-view__repo-select"
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
              if (lastError.startsWith('Push')) handlePush()
              else handleCommit()
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
            onStageAll={
              unstaged.length > 0
                ? () => {
                    if (!activeRepo) return
                    const paths = unstaged.map((f) => f.path)
                    window.api
                      .gitStage(activeRepo, paths)
                      .then(() => fetchStatus(activeRepo))
                      .catch((e) => {
                        setLastError(
                          `Failed to stage files: ${e instanceof Error ? e.message : 'Unknown error'}`
                        )
                      })
                  }
                : undefined
            }
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
            onStageAll={
              untracked.length > 0
                ? () => {
                    if (!activeRepo) return
                    const paths = untracked.map((f) => f.path)
                    window.api
                      .gitStage(activeRepo, paths)
                      .then(() => fetchStatus(activeRepo))
                      .catch((e) => {
                        setLastError(
                          `Failed to stage files: ${e instanceof Error ? e.message : 'Unknown error'}`
                        )
                      })
                  }
                : undefined
            }
            onStageFile={handleStageFile}
            onUnstageFile={handleUnstageFile}
            onSelectFile={(path) => handleSelectFile(path, false)}
          />
        )}

        {/* Empty state */}
        {staged.length === 0 && unstaged.length === 0 && untracked.length === 0 && !loading && (
          <div className="git-tree-view__empty">No changes</div>
        )}
      </div>

      {/* Inline diff drawer */}
      <InlineDiffDrawer
        selectedFile={selectedFile}
        diffContent={diffContent}
        onClose={clearSelection}
      />

      {/* Keyframe for loading spinner */}
      <style>{`
        @keyframes bde-spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </motion.div>
  )
}
