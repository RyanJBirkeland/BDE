import { safeHandle } from '../ipc-utils'
import {
  getIdeRootPath,
  validateIdePath,
  validateIdeRoot,
  rememberApprovedIdeRoot,
  _resetApprovedIdeRoots,
  readDir,
  readFileContent,
  writeFileContent,
  watchDir,
  unwatchDir,
  createFile,
  createDir,
  renameFile,
  deleteFile,
  statFile,
  listAllFiles
} from '../services/ide-fs-service'

// Re-exported for callers and tests that import from this module
export {
  getIdeRootPath,
  validateIdePath,
  validateIdeRoot,
  rememberApprovedIdeRoot,
  _resetApprovedIdeRoots,
  readDir,
  readFileContent,
  writeFileContent
}

function requireRoot(): string {
  const root = getIdeRootPath()
  if (!root) throw new Error('No IDE root path set — call fs:watchDir first')
  return root
}

export function registerIdeFsHandlers(): void {
  safeHandle('fs:watchDir', (_e, dir: string) => watchDir(dir))
  safeHandle('fs:unwatchDir', () => unwatchDir())
  safeHandle('fs:readDir', (_e, dir: string) => readDir(validateIdePath(dir, requireRoot())))
  safeHandle('fs:readFile', (_e, file: string) => readFileContent(validateIdePath(file, requireRoot())))
  safeHandle('fs:writeFile', (_e, file: string, content: string) =>
    writeFileContent(validateIdePath(file, requireRoot()), content)
  )
  safeHandle('fs:createFile', (_e, file: string) => createFile(validateIdePath(file, requireRoot())))
  safeHandle('fs:createDir', (_e, dir: string) => createDir(validateIdePath(dir, requireRoot())))
  safeHandle('fs:rename', (_e, oldPath: string, newPath: string) => {
    const root = requireRoot()
    return renameFile(validateIdePath(oldPath, root), validateIdePath(newPath, root))
  })
  safeHandle('fs:delete', (_e, path: string) => deleteFile(validateIdePath(path, requireRoot())))
  safeHandle('fs:stat', (_e, path: string) => statFile(validateIdePath(path, requireRoot())))
  safeHandle('fs:listFiles', (_e, root: string) => listAllFiles(validateIdePath(root, requireRoot())))
}
