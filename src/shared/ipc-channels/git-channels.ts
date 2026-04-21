/**
 * Git, PR, and GitHub API IPC channels.
 */

import type { PrListPayload } from '../types'

/** Serialisable subset of RequestInit for the github:fetch IPC proxy. */
export interface GitHubFetchInit {
  method?: string | undefined
  headers?: Record<string, string>
  body?: string | undefined
}

/** Shape returned by the github:fetch IPC handler. */
export interface GitHubFetchResult {
  ok: boolean
  status: number
  body: unknown
  /** Parsed "next" URL from the GitHub Link header (for pagination). */
  linkNext: string | null
}

/** Git operations */
export interface GitChannels {
  'git:status': {
    args: [cwd: string]
    result: { files: { path: string; status: string; staged: boolean }[]; branch: string }
  }
  'git:diff': {
    args: [cwd: string, file?: string]
    result: string
  }
  'git:getRepoPaths': {
    args: []
    result: Record<string, string>
  }
  'git:stage': {
    args: [cwd: string, files: string[]]
    result: void
  }
  'git:unstage': {
    args: [cwd: string, files: string[]]
    result: void
  }
  'git:commit': {
    args: [cwd: string, message: string]
    result: void
  }
  'git:push': {
    args: [cwd: string]
    result: string
  }
  'git:branches': {
    args: [cwd: string]
    result: { current: string; branches: string[] }
  }
  'git:checkout': {
    args: [cwd: string, branch: string]
    result: void
  }
  'git:detectRemote': {
    args: [cwd: string]
    result: {
      isGitRepo: boolean
      remoteUrl: string | null
      owner: string | null
      repo: string | null
    }
  }
  'git:fetch': {
    args: [cwd: string]
    result: { success: boolean; error?: string | undefined; stdout?: string | undefined }
  }
  'git:pull': {
    args: [cwd: string, currentBranch: string]
    result: { success: boolean; error?: string | undefined; stdout?: string | undefined }
  }
  'git:checkInstalled': {
    args: []
    result: boolean
  }
}

/** Pull request operations */
export interface PrChannels {
  'pr:pollStatuses': {
    args: [prs: { taskId: string; prUrl: string }[]]
    result: {
      taskId: string
      merged: boolean
      state: string
      mergedAt: string | null
      mergeableState: string | null
    }[]
  }
  'pr:checkConflictFiles': {
    args: [input: { owner: string; repo: string; prNumber: number }]
    result: { prNumber: number; files: string[]; baseBranch: string; headBranch: string }
  }
  'pr:getList': {
    args: []
    result: PrListPayload
  }
  'pr:refreshList': {
    args: []
    result: PrListPayload
  }
}

export interface GitHubApiChannels {
  'github:fetch': {
    args: [path: string, init?: GitHubFetchInit]
    result: GitHubFetchResult
  }
  'github:isConfigured': {
    args: []
    result: boolean
  }
}
