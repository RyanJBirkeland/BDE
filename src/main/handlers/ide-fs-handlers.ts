import { mkdir, rename, stat, writeFile } from 'fs/promises'
import { dirname } from 'path'
import { shell } from 'electron'
import { safeHandle } from '../ipc-utils'
import * as svc from '../services/ide-fs-service'

// Re-export service symbols consumed by other modules and tests
export const rememberApprovedIdeRoot = svc.approveRoot
export const _resetApprovedIdeRoots = svc._resetApprovedIdeRoots
export const getIdeRootPath = svc.getIdeRootPath
export const isApprovedRoot = svc.isApprovedRoot
export const validateIdePath = svc.validateIdePath
export const validateIdeRoot = svc.validateIdeRoot
export const readDir = svc.readDir
export const readFileContent = svc.readFileContent
export const writeFileContent = svc.writeFileAtomic

function requireRoot(): string {
  const root = svc.getIdeRootPath()
  if (!root) throw new Error('No IDE root path set — call fs:watchDir first')
  return root
}

export function registerIdeFsHandlers(): void {
  safeHandle('fs:watchDir', async (_e, dirPath: string) => {
    svc.watchRoot(await svc.validateIdeRoot(dirPath))
    return { success: true }
  })
  safeHandle('fs:unwatchDir', () => { svc.stopWatcher() })
  safeHandle('fs:readDir', (_e, dirPath: string) => svc.readDir(svc.validateIdePath(dirPath, requireRoot())))
  safeHandle('fs:readFile', (_e, filePath: string) => svc.readFileContent(svc.validateIdePath(filePath, requireRoot())))
  safeHandle('fs:writeFile', (_e, filePath: string, content: string) => svc.writeFileAtomic(svc.validateIdePath(filePath, requireRoot()), content))
  safeHandle('fs:createFile', async (_e, filePath: string) => {
    const safe = svc.validateIdePath(filePath, requireRoot())
    await mkdir(dirname(safe), { recursive: true })
    await writeFile(safe, '', 'utf-8')
  })
  safeHandle('fs:createDir', async (_e, dirPath: string) => { await mkdir(svc.validateIdePath(dirPath, requireRoot()), { recursive: true }) })
  safeHandle('fs:rename', async (_e, oldPath: string, newPath: string) => { await rename(svc.validateIdePath(oldPath, requireRoot()), svc.validateIdePath(newPath, requireRoot())) })
  safeHandle('fs:delete', async (_e, targetPath: string) => { await shell.trashItem(svc.validateIdePath(targetPath, requireRoot())) })
  safeHandle('fs:stat', async (_e, targetPath: string) => {
    const info = await stat(svc.validateIdePath(targetPath, requireRoot()))
    return { size: info.size, mtime: info.mtimeMs, isDirectory: info.isDirectory() }
  })
  safeHandle('fs:listFiles', async (_e, rootPath: string) => svc.listAllFiles(svc.validateIdePath(rootPath, requireRoot())))
}
