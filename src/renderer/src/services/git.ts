/**
 * Service layer for git IPC operations.
 * All git-related window.api calls go through here — components never call IPC directly.
 */

export interface FileStatus {
  path: string
  status: string
  staged: boolean
}

export interface GitStatus {
  files: FileStatus[]
}

export interface BranchInfo {
  current: string
  branches: string[]
}

export async function getStatus(repoPath: string): Promise<GitStatus> {
  return window.api.gitStatus(repoPath)
}

export async function getBranches(repoPath: string): Promise<BranchInfo> {
  return window.api.gitBranches(repoPath)
}

export async function getDiff(repoPath: string, file?: string): Promise<string> {
  return window.api.gitDiff(repoPath, file)
}

export async function stageFiles(repoPath: string, files: string[]): Promise<void> {
  return window.api.gitStage(repoPath, files)
}

export async function unstageFiles(repoPath: string, files: string[]): Promise<void> {
  return window.api.gitUnstage(repoPath, files)
}

export async function commit(repoPath: string, message: string): Promise<void> {
  return window.api.gitCommit(repoPath, message)
}

export async function push(repoPath: string): Promise<string> {
  return window.api.gitPush(repoPath)
}

export async function checkout(repoPath: string, branch: string): Promise<void> {
  return window.api.gitCheckout(repoPath, branch)
}

export async function getRepoPaths(): Promise<Record<string, string>> {
  return window.api.getRepoPaths()
}
