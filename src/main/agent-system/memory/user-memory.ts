import { existsSync, readFileSync, statSync } from 'fs'
import { join } from 'path'
import { FLEET_MEMORY_DIR } from '../../paths'
import { getSettingJson, setSettingJson } from '../../settings'

const SETTING_KEY = 'memory.activeFiles'

// Per-file mtime cache — avoids re-reading unchanged memory files on every
// agent spawn. Each entry stores the file's last-known mtime and its content.
// When statSync reports the same mtime, content is served from cache.
const _fileCache = new Map<string, { mtime: number; content: string }>()

/** Clears the mtime cache. Used in tests and when memory files are explicitly updated. */
export function _invalidateUserMemoryCache(): void {
  _fileCache.clear()
}

export interface UserMemoryResult {
  content: string
  totalBytes: number
  fileCount: number
}

/**
 * Reads all active user memory files and concatenates their contents.
 *
 * Active files are tracked in the `memory.activeFiles` setting as a
 * `Record<string, boolean>` where keys are relative paths within
 * `~/.fleet/memory/`.
 *
 * Missing files are pruned from the setting automatically.
 *
 * @returns Concatenated content with `### {filename}` headers and `---` separators.
 */
export function getUserMemory(): UserMemoryResult {
  const activeFiles = getSettingJson<Record<string, boolean>>(SETTING_KEY)
  if (!activeFiles || Object.keys(activeFiles).length === 0) {
    return { content: '', totalBytes: 0, fileCount: 0 }
  }

  const sections: string[] = []
  let totalBytes = 0
  let pruned = false

  const remaining: Record<string, boolean> = {}

  for (const [relativePath, active] of Object.entries(activeFiles)) {
    if (!active) continue

    const fullPath = join(FLEET_MEMORY_DIR, relativePath)
    if (!existsSync(fullPath)) {
      pruned = true
      continue
    }

    try {
      const mtime = statSync(fullPath).mtimeMs
      const cached = _fileCache.get(fullPath)
      const content =
        cached && cached.mtime === mtime
          ? cached.content
          : (() => {
              const fresh = readFileSync(fullPath, 'utf-8')
              _fileCache.set(fullPath, { mtime, content: fresh })
              return fresh
            })()
      sections.push(`### ${relativePath}\n\n${content}`)
      totalBytes += Buffer.byteLength(content, 'utf-8')
      remaining[relativePath] = true
    } catch {
      // File unreadable — prune it
      pruned = true
    }
  }

  if (pruned) {
    setSettingJson(SETTING_KEY, remaining)
  }

  return {
    content: sections.join('\n\n---\n\n'),
    totalBytes,
    fileCount: sections.length
  }
}
