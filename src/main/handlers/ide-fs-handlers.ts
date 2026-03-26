import fs from 'fs'
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'fs/promises'
import { dirname, join, resolve } from 'path'
import { shell, BrowserWindow } from 'electron'
import { safeHandle } from '../ipc-utils'

const MAX_READ_BYTES = 5 * 1024 * 1024 // 5 MB
const BINARY_DETECT_BYTES = 8 * 1024 // 8 KB

let ideRootPath: string | null = null
let watcher: fs.FSWatcher | null = null
let debounceTimer: ReturnType<typeof setTimeout> | null = null

/** Validates that targetPath is within allowedRoot. Returns the resolved absolute path. */
export function validateIdePath(targetPath: string, allowedRoot: string): string {
  const resolved = resolve(targetPath)
  const root = resolve(allowedRoot)
  if (!resolved.startsWith(root + '/') && resolved !== root) {
    throw new Error(`Path traversal blocked: "${targetPath}" is outside root "${allowedRoot}"`)
  }
  return resolved
}

export async function readDir(
  dirPath: string
): Promise<{ name: string; type: 'file' | 'directory'; size: number }[]> {
  const entries = await readdir(dirPath, { withFileTypes: true })
  const results: { name: string; type: 'file' | 'directory'; size: number }[] = []

  for (const entry of entries) {
    const fullPath = join(dirPath, entry.name)
    let size = 0
    if (entry.isFile()) {
      try {
        const info = await stat(fullPath)
        size = info.size
      } catch {
        // skip files we can't stat
      }
    }
    results.push({
      name: entry.name,
      type: entry.isDirectory() ? 'directory' : 'file',
      size
    })
  }

  // Sort: directories first, then alphabetical within each group
  results.sort((a, b) => {
    if (a.type === b.type) return a.name.localeCompare(b.name)
    return a.type === 'directory' ? -1 : 1
  })

  return results
}

/** Reads a file as UTF-8 text with size guard and binary detection. */
export async function readFileContent(filePath: string): Promise<string> {
  const info = await stat(filePath)
  if (info.size > MAX_READ_BYTES) {
    throw new Error(`File too large: ${(info.size / 1024 / 1024).toFixed(1)} MB exceeds 5 MB limit`)
  }

  const buf = await readFile(filePath)

  // Detect binary by looking for null bytes in the first 8 KB
  const probe = buf.subarray(0, BINARY_DETECT_BYTES)
  for (let i = 0; i < probe.length; i++) {
    if (probe[i] === 0) {
      throw new Error(`File appears to be binary and cannot be opened as text`)
    }
  }

  return buf.toString('utf-8')
}

/** Atomic write: write to a temp file then rename into place. */
export async function writeFileContent(filePath: string, content: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true })
  const tmpPath = `${filePath}.bde-tmp-${Date.now()}`
  try {
    await writeFile(tmpPath, content, 'utf-8')
    await rename(tmpPath, filePath)
  } catch (err) {
    // Clean up temp file on failure
    try {
      await rm(tmpPath, { force: true })
    } catch {
      // ignore cleanup errors
    }
    throw err
  }
}

function broadcastDirChanged(dirPath: string): void {
  const windows = BrowserWindow.getAllWindows()
  for (const win of windows) {
    win.webContents.send('fs:dirChanged', dirPath)
  }
}

function stopWatcher(): void {
  if (debounceTimer !== null) {
    clearTimeout(debounceTimer)
    debounceTimer = null
  }
  if (watcher !== null) {
    watcher.close()
    watcher = null
  }
}

export function registerIdeFsHandlers(): void {
  safeHandle('fs:watchDir', (_e, dirPath: string) => {
    stopWatcher()
    ideRootPath = dirPath

    watcher = fs.watch(dirPath, { recursive: true }, () => {
      if (debounceTimer !== null) clearTimeout(debounceTimer)
      debounceTimer = setTimeout(() => {
        broadcastDirChanged(dirPath)
        debounceTimer = null
      }, 500)
    })
  })

  safeHandle('fs:unwatchDir', () => {
    stopWatcher()
    ideRootPath = null
  })

  safeHandle('fs:readDir', (_e, dirPath: string) => {
    if (!ideRootPath) throw new Error('No IDE root path set — call fs:watchDir first')
    const safe = validateIdePath(dirPath, ideRootPath)
    return readDir(safe)
  })

  safeHandle('fs:readFile', (_e, filePath: string) => {
    if (!ideRootPath) throw new Error('No IDE root path set — call fs:watchDir first')
    const safe = validateIdePath(filePath, ideRootPath)
    return readFileContent(safe)
  })

  safeHandle('fs:writeFile', (_e, filePath: string, content: string) => {
    if (!ideRootPath) throw new Error('No IDE root path set — call fs:watchDir first')
    const safe = validateIdePath(filePath, ideRootPath)
    return writeFileContent(safe, content)
  })

  safeHandle('fs:createFile', async (_e, filePath: string) => {
    if (!ideRootPath) throw new Error('No IDE root path set — call fs:watchDir first')
    const safe = validateIdePath(filePath, ideRootPath)
    await mkdir(dirname(safe), { recursive: true })
    await writeFile(safe, '', 'utf-8')
  })

  safeHandle('fs:createDir', async (_e, dirPath: string) => {
    if (!ideRootPath) throw new Error('No IDE root path set — call fs:watchDir first')
    const safe = validateIdePath(dirPath, ideRootPath)
    await mkdir(safe, { recursive: true })
  })

  safeHandle('fs:rename', async (_e, oldPath: string, newPath: string) => {
    if (!ideRootPath) throw new Error('No IDE root path set — call fs:watchDir first')
    const safeOld = validateIdePath(oldPath, ideRootPath)
    const safeNew = validateIdePath(newPath, ideRootPath)
    await rename(safeOld, safeNew)
  })

  safeHandle('fs:delete', async (_e, targetPath: string) => {
    if (!ideRootPath) throw new Error('No IDE root path set — call fs:watchDir first')
    const safe = validateIdePath(targetPath, ideRootPath)
    await shell.trashItem(safe)
  })

  safeHandle('fs:stat', async (_e, targetPath: string) => {
    if (!ideRootPath) throw new Error('No IDE root path set — call fs:watchDir first')
    const safe = validateIdePath(targetPath, ideRootPath)
    const info = await stat(safe)
    return {
      size: info.size,
      mtime: info.mtimeMs,
      isDirectory: info.isDirectory()
    }
  })
}
