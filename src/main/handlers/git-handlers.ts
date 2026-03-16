import { safeHandle } from '../ipc-utils'
import {
  getRepoPaths,
  readSprintMd,
  getDiff,
  getBranch,
  getLog,
  gitStatus,
  gitDiffFile,
  gitStage,
  gitUnstage,
  gitCommit,
  gitPush,
  gitBranches,
  gitCheckout,
  pollPrStatuses,
  type PrStatusInput
} from '../git'

export function registerGitHandlers(): void {
  safeHandle('get-repo-paths', () => getRepoPaths())
  safeHandle('read-sprint-md', (_e, repoPath: string) => readSprintMd(repoPath))

  // --- Git read-only IPC ---
  safeHandle('get-diff', (_e, repoPath: string, base?: string) => getDiff(repoPath, base))
  safeHandle('get-branch', (_e, repoPath: string) => getBranch(repoPath))
  safeHandle('get-log', (_e, repoPath: string, n?: number) => getLog(repoPath, n))

  // --- Git client IPC ---
  safeHandle('git:status', (_e, cwd: string) => gitStatus(cwd))
  safeHandle('git:diff', (_e, cwd: string, file?: string) => gitDiffFile(cwd, file))
  safeHandle('git:stage', (_e, cwd: string, files: string[]) => gitStage(cwd, files))
  safeHandle('git:unstage', (_e, cwd: string, files: string[]) => gitUnstage(cwd, files))
  safeHandle('git:commit', (_e, cwd: string, message: string) => gitCommit(cwd, message))
  safeHandle('git:push', (_e, cwd: string) => gitPush(cwd))
  safeHandle('git:branches', (_e, cwd: string) => gitBranches(cwd))
  safeHandle('git:checkout', (_e, cwd: string, branch: string) => gitCheckout(cwd, branch))

  // --- PR status polling ---
  safeHandle('poll-pr-statuses', (_e, prs: PrStatusInput[]) => pollPrStatuses(prs))
}
