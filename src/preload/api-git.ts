import { typedInvoke } from './ipc-helpers'

export const getRepoPaths = () => typedInvoke('git:getRepoPaths')

export const gitStatus = (cwd: string) => typedInvoke('git:status', cwd)

export const gitDiff = (cwd: string, file?: string) => typedInvoke('git:diff', cwd, file)

export const gitStage = (cwd: string, files: string[]) => typedInvoke('git:stage', cwd, files)

export const gitUnstage = (cwd: string, files: string[]) => typedInvoke('git:unstage', cwd, files)

export const gitCommit = (cwd: string, message: string) => typedInvoke('git:commit', cwd, message)

export const gitPush = (cwd: string) => typedInvoke('git:push', cwd)

export const gitBranches = (cwd: string) => typedInvoke('git:branches', cwd)

export const gitCheckout = (cwd: string, branch: string) =>
  typedInvoke('git:checkout', cwd, branch)

export const gitDetectRemote = (cwd: string) => typedInvoke('git:detectRemote', cwd)

export const gitFetch = (cwd: string) => typedInvoke('git:fetch', cwd)

export const gitPull = (cwd: string, currentBranch: string) =>
  typedInvoke('git:pull', cwd, currentBranch)
