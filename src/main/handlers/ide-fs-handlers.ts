import fs from 'fs'
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'fs/promises'
import { dirname, join, resolve, relative } from 'path'
import { shell, BrowserWindow } from 'electron'
import { safeHandle } from '../ipc-utils'
import { getConfiguredRepos } from '../paths'

const MAX_READ_BYTES = 5 * 1024 * 1024 // 5 MB
const BINARY_DETECT_BYTES = 8 * 1024 // 8 KB

let ideRootPath: string | null = null
let watcher: fs.FSWatcher | null = null
let debounceTimer: ReturnType<typeof setTimeout> | null = null

/**
 * Paths the user has explicitly approved as IDE roots in this session —
 * either by picking them in the Open Folder dialog or by adding them as a
 * configured repo. A renderer cannot repoint the IDE root at an arbitrary
 * directory like `~/.ssh/` without going through one of those gestures.
 */
const approvedIdeRoots = new Set<string>()

/** Register a directory the user explicitly picked via dialog or added as a repo. */
export function rememberApprovedIdeRoot(absPath: string): void {
  approvedIdeRoots.add(resolve(absPath))
}

function isApprovedIdeRoot(resolvedPath: string): boolean {
  if (approvedIdeRoots.has(resolvedPath)) return true
  try {
    for (const repo of getConfiguredRepos()) {
      if (!repo.localPath) continue
      if (resolve(repo.localPath) === resolvedPath) return true
    }
  } catch {
    /* settings may not be initialised in tests */
  }
  return false
}

/** @internal — test-only reset of the in-session approval allowlist. */
export function _resetApprovedIdeRoots(): void {
  approvedIdeRoots.clear()
}

/**
 * Validates that a directory path is safe to use as an IDE root.
 * The path must:
 *   1. Exist and be a directory
 *   2. Be on the in-session approval allowlist — either a configured repo's
 *      `localPath` or a directory the user picked via the Open Folder
 *      dialog in this session (registered via `rememberApprovedIdeRoot`).
 *
 * Exported so tests — and callers wanting to scope follow-up reads — can
 * invoke the same guard the IPC handler uses.
 */
export async function validateIdeRoot(dirPath: string): Promise<string> {
  const resolved = resolve(dirPath)

  if (!isApprovedIdeRoot(resolved)) {
    throw new Error(
      `IDE root path rejected: "${dirPath}" is not a configured repo or a dialog-approved folder. ` +
        `Use the Open Folder dialog or add the path under Settings → Repositories.`
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
  const rootReal = canonicalizeRootPath(root)
  const resolved = resolve(targetPath)
  const targetReal = canonicalizeTargetPath(resolved, root, rootReal)

  if (!targetReal.startsWith(rootReal + '/') && targetReal !== rootReal) {
    throw new Error(`Path traversal blocked: "${targetPath}" is outside root "${allowedRoot}"`)
  }
  // IDE-2: Return the real (canonical) path to avoid TOCTOU issues
  return targetReal
}

function canonicalizeRootPath(root: string): string {
  try {
    return fs.realpathSync(root)
  } catch {
    return root
  }
}

/**
 * Resolve a target path to its canonical filesystem path, resolving symlinks
 * even when the target itself does not yet exist (e.g. about to be written).
 *
 * Falls back through three increasingly defensive paths:
 *   1. realpath the target directly (existing files)
 *   2. realpath its parent and reattach the basename (parent exists, target
 *      will be created soon)
 *   3. rebase the prefix from the input root to the canonical root, when both
 *      the target and its parent are missing (e.g. nested mkdir)
 */
function canonicalizeTargetPath(resolved: string, root: string, rootReal: string): string {
  try {
    return fs.realpathSync(resolved)
  } catch {
    return canonicalizeMissingTargetPath(resolved, root, rootReal)
  }
}

function canonicalizeMissingTargetPath(resolved: string, root: string, rootReal: string): string {
  const parent = dirname(resolved)
  try {
    const parentReal = fs.realpathSync(parent)
    const basename = resolved.split('/').pop() ?? ''
    return `${parentReal}/${basename}`
  } catch {
    return rebaseUnderRoot(resolved, root, rootReal)
  }
}

function rebaseUnderRoot(resolved: string, root: string, rootReal: string): string {
  if (resolved.startsWith(root + '/')) return resolved.replace(root, rootReal)
  if (resolved === root) return rootReal
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

/**
 * Recursively lists all files in a directory tree.
 * Returns file paths relative to rootPath.
 * Skips common non-source directories to improve performance.
 */
async function listAllFiles(rootPath: string): Promise<string[]> {
  const skipDirs = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'coverage'])
  const files: string[] = []

  async function walk(dirPath: string): Promise<void> {
    const entries = await readdir(dirPath, { withFileTypes: true })
    for (const entry of entries) {
      if (skipDirs.has(entry.name)) continue
      const fullPath = join(dirPath, entry.name)
      if (entry.isDirectory()) {
        await walk(fullPath)
      } else if (entry.isFile()) {
        files.push(relative(rootPath, fullPath))
      }
    }
  }

  await walk(rootPath)
  return files
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

  safeHandle('fs:listFiles', async (_e, rootPath: string) => {
    if (!ideRootPath) throw new Error('No IDE root path set — call fs:watchDir first')
    const safe = validateIdePath(rootPath, ideRootPath)
    return listAllFiles(safe)
  })
}
