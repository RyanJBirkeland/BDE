import { typedInvoke } from './ipc-helpers'
import type { IpcChannelMap } from '../shared/ipc-channels'

export const checkInstalled = (): Promise<IpcChannelMap['git:checkInstalled']['result']> =>
  typedInvoke('git:checkInstalled')

export const getRepoPaths = (): Promise<IpcChannelMap['git:getRepoPaths']['result']> =>
  typedInvoke('git:getRepoPaths')

export const gitStatus = (cwd: string): Promise<IpcChannelMap['git:status']['result']> =>
  typedInvoke('git:status', cwd)

export const gitDiff = (cwd: string, file?: string): Promise<IpcChannelMap['git:diff']['result']> =>
  typedInvoke('git:diff', cwd, file)

export const gitStage = (
  cwd: string,
  files: string[]
): Promise<IpcChannelMap['git:stage']['result']> => typedInvoke('git:stage', cwd, files)

export const gitUnstage = (
  cwd: string,
  files: string[]
): Promise<IpcChannelMap['git:unstage']['result']> => typedInvoke('git:unstage', cwd, files)

export const gitCommit = (
  cwd: string,
  message: string
): Promise<IpcChannelMap['git:commit']['result']> => typedInvoke('git:commit', cwd, message)

export const gitPush = (cwd: string): Promise<IpcChannelMap['git:push']['result']> =>
  typedInvoke('git:push', cwd)

export const gitBranches = (cwd: string): Promise<IpcChannelMap['git:branches']['result']> =>
  typedInvoke('git:branches', cwd)

export const gitCheckout = (
  cwd: string,
  branch: string
): Promise<IpcChannelMap['git:checkout']['result']> => typedInvoke('git:checkout', cwd, branch)

export const gitDetectRemote = (
  cwd: string
): Promise<IpcChannelMap['git:detectRemote']['result']> => typedInvoke('git:detectRemote', cwd)

export const gitFetch = (cwd: string): Promise<IpcChannelMap['git:fetch']['result']> =>
  typedInvoke('git:fetch', cwd)

export const gitPull = (
  cwd: string,
  currentBranch: string
): Promise<IpcChannelMap['git:pull']['result']> => typedInvoke('git:pull', cwd, currentBranch)
