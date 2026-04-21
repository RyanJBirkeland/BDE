import { typedInvoke } from './ipc-helpers'
import type { IpcChannelMap } from '../shared/ipc-channels'

export const listMemoryFiles = (): Promise<IpcChannelMap['memory:listFiles']['result']> =>
  typedInvoke('memory:listFiles')

export const readMemoryFile = (path: string): Promise<IpcChannelMap['memory:readFile']['result']> =>
  typedInvoke('memory:readFile', path)

export const writeMemoryFile = (
  path: string,
  content: string
): Promise<IpcChannelMap['memory:writeFile']['result']> =>
  typedInvoke('memory:writeFile', path, content)

export const searchMemory = (query: string): Promise<IpcChannelMap['memory:search']['result']> =>
  typedInvoke('memory:search', query)

export const getActiveMemoryFiles = (): Promise<IpcChannelMap['memory:getActiveFiles']['result']> =>
  typedInvoke('memory:getActiveFiles')

export const setMemoryFileActive = (
  path: string,
  active: boolean
): Promise<IpcChannelMap['memory:setFileActive']['result']> =>
  typedInvoke('memory:setFileActive', path, active)
