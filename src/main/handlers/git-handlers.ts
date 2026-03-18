import { safeHandle } from '../ipc-utils'
import {
  getRepoPaths,
  gitStatus,
  gitDiffFile,
  gitStage,
  gitUnstage,
  gitCommit,
  gitPush,
  gitBranches,
  gitCheckout,
  pollPrStatuses,
  checkConflictFiles,
  type PrStatusInput,
  type ConflictFilesInput
} from '../git'
import { getLatestPrList, refreshPrList } from '../pr-poller'

export function registerGitHandlers(): void {
  // TODO: AX-S1 — add 'get-repo-paths' to IpcChannelMap
  safeHandle('get-repo-paths', () => getRepoPaths())

  // --- Git client IPC ---
  safeHandle('git:status', (_e, cwd: string) => gitStatus(cwd))
  safeHandle('git:diff', (_e, cwd: string, file?: string) => gitDiffFile(cwd, file))
  // TODO: AX-S1 — add 'git:stage' through 'git:checkout' to IpcChannelMap
  safeHandle('git:stage', (_e, cwd: string, files: string[]) => gitStage(cwd, files))
  safeHandle('git:unstage', (_e, cwd: string, files: string[]) => gitUnstage(cwd, files))
  safeHandle('git:commit', (_e, cwd: string, message: string) => gitCommit(cwd, message))
  safeHandle('git:push', (_e, cwd: string) => gitPush(cwd))
  safeHandle('git:branches', (_e, cwd: string) => gitBranches(cwd))
  safeHandle('git:checkout', (_e, cwd: string, branch: string) => gitCheckout(cwd, branch))

  // --- PR status polling ---
  // TODO: AX-S1 — add 'poll-pr-statuses' to IpcChannelMap
  safeHandle('poll-pr-statuses', (_e, prs: PrStatusInput[]) => pollPrStatuses(prs))

  // --- Conflict file detection ---
  safeHandle('check-conflict-files', (_e, input: ConflictFilesInput) => checkConflictFiles(input))

  // --- Open PR list (main-process poller is the source of truth) ---
  safeHandle('pr:get-list', () => getLatestPrList() ?? { prs: [], checks: {} })
  safeHandle('pr:refresh-list', () => refreshPrList())
}
