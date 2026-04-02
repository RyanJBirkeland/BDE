import fs from 'fs'
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'fs/promises'
import { dirname, join, resolve } from 'path'
import { homedir } from 'os'
import { shell, BrowserWindow } from 'electron'
import { safeHandle } from '../ipc-utils'

const MAX_READ_BYTES = 5 * 1024 * 1024 // 5 MB
const BINARY_DETECT_BYTES = 8 * 1024 // 8 KB

let ideRootPath: string | null = null
let watcher: fs.FSWatcher | null = null
let debounceTimer: ReturnType<typeof setTimeout> | null = null

/**
 * Validates that a directory path is safe to use as an IDE root.
 * The path must:
 * 1. Exist and be a directory
 * 2. Be within the user's home directory
 */
async function validateIdeRoot(dirPath: string): Promise<string> {
  const resolved = resolve(dirPath)
  const homeDir = resolve(homedir())

  // Ensure path is within user's home directory
  if (!resolved.startsWith(homeDir + '/') && resolved !== homeDir) {
    throw new Error(
      `IDE root path rejected: "${dirPath}" is outside user home directory "${homeDir}"`
    )
  }

  // Verify path exists and is a directory
  let dirStat
  try {
    dirStat = await stat(resolved)
  } catch (_err) {
    throw new Error(`IDE root path rejected: "${dirPath}" does not exist or is not accessible`)
  }

  if (!dirStat.isDirectory()) {
    throw new Error(`IDE root path rejected: "${dirPath}" is not a directory`)
  }

  return resolved
}

/** Returns the current IDE root path, or null if none is set. */
export function getIdeRootPath(): string | null {
  return ideRootPath
}

/** Validates that targetPath is within allowedRoot. Returns the resolved absolute path. */
export function validateIdePath(targetPath: string, allowedRoot: string): string {
  const root = resolve(allowedRoot)

  // Resolve root symlinks first to get the canonical root path
  let rootReal: string
  try {
    rootReal = fs.realpathSync(root)
  } catch {
    rootReal = root
  }

  const resolved = resolve(targetPath)

  // Resolve symlinks to prevent path traversal via symlink escape
  let real: string
  try {
    real = fs.realpathSync(resolved)
  } catch {
    // IDE-3: If realpath fails (e.g., path doesn't exist yet), resolve parent symlinks
    const parent = dirname(resolved)
    try {
      const parentReal = fs.realpathSync(parent)
      const basename = resolved.split('/').pop() ?? ''
      real = `${parentReal}/${basename}`
    } catch {
      // If parent also doesn't exist, normalize using real root
      if (resolved.startsWith(root + '/')) {
        real = resolved.replace(root, rootReal)
      } else if (resolved === root) {
        real = rootReal
      } else {
        real = resolved
      }
    }
  }

  if (!real.startsWith(rootReal + '/') && real !== rootReal) {
    throw new Error(`Path traversal blocked: "${targetPath}" is outside root "${allowedRoot}"`)
  }
  // IDE-2: Return the real (canonical) path to avoid TOCTOU issues
  return real
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

  // For files larger than BINARY_DETECT_BYTES, check the header first to avoid
  // reading the entire file if it's binary
  if (info.size > BINARY_DETECT_BYTES) {
    const handle = await fs.promises.open(filePath, 'r')
    try {
      const probe = Buffer.allocUnsafe(BINARY_DETECT_BYTES)
      await handle.read(probe, 0, BINARY_DETECT_BYTES, 0)
      for (let i = 0; i < probe.length; i++) {
        if (probe[i] === 0) {
          throw new Error(`File appears to be binary and cannot be opened as text`)
        }
      }
    } finally {
      await handle.close()
    }
  }

  const buf = await readFile(filePath)

  // For small files, still check for null bytes
  // Detect binary by looking for null bytes in the first 8 KB.
  // Limitation: This simple heuristic may yield false negatives for some binary
  // formats that don't contain null bytes in their header (e.g., some image formats,
  // minified JS with high-entropy data). For production use, consider libmagic or
  // a more sophisticated content-type detector.
  const probe = buf.subarray(0, Math.min(BINARY_DETECT_BYTES, buf.length))
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
  // Use timestamp + random component to prevent collisions on rapid saves
  const random = Math.random().toString(36).substring(2, 8)
  const tmpPath = `${filePath}.bde-tmp-${Date.now()}-${random}`
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
  safeHandle('fs:watchDir', async (_e, dirPath: string) => {
    const validatedPath = await validateIdeRoot(dirPath)

    stopWatcher()
    ideRootPath = validatedPath

    watcher = fs.watch(validatedPath, { recursive: true }, () => {
      if (debounceTimer !== null) clearTimeout(debounceTimer)
      debounceTimer = setTimeout(() => {
        broadcastDirChanged(validatedPath)
        debounceTimer = null
      }, 500)
    })

    // IDE-6: Add error handler to prevent crashes on EMFILE/EACCES
    watcher.on('error', (err) => {
      console.error('File watcher error:', err)
      stopWatcher()
      const windows = BrowserWindow.getAllWindows()
      for (const win of windows) {
        win.webContents.send('fs:watchError', err.message)
      }
    })

    return { success: true }
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
