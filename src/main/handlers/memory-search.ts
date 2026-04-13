/**
 * Memory search handler — grep-based content search through memory files.
 */
import { safeHandle } from '../ipc-utils'
import { promisify } from 'util'
import { execFile } from 'child_process'
import { BDE_MEMORY_DIR } from '../paths'

const execFileAsync = promisify(execFile)

export interface MemorySearchMatch {
  line: number
  content: string
}

export interface MemorySearchResult {
  path: string
  matches: MemorySearchMatch[]
}

/**
 * Search memory files using grep.
 * Returns array of files with matching lines.
 */
async function searchMemory(query: string): Promise<MemorySearchResult[]> {
  // Input validation
  if (typeof query !== 'string' || query.length > 200) {
    throw new Error('Query must be a string of 200 characters or fewer')
  }

  if (!query.trim()) {
    return []
  }

  // Strip catastrophic backtracking patterns
  const safeQuery = query.replace(/(\(\?:.*\))[+*]/g, '').replace(/\([^)]*\)[+*]{2,}/g, '')

  try {
    const { stdout } = await execFileAsync('grep', ['-rni', '--', safeQuery, '.'], {
      cwd: BDE_MEMORY_DIR,
      encoding: 'utf-8',
      maxBuffer: 5 * 1024 * 1024, // 5MB
      timeout: 5000
    })

    const lines = stdout.trim().split('\n').filter(Boolean)
    const fileMap = new Map<string, MemorySearchMatch[]>()

    for (const line of lines) {
      // Parse grep output: filename:lineNum:content
      const match = line.match(/^(.+?):(\d+):(.*)$/)
      if (!match) continue

      const [, filePath, lineNum, content] = match

      if (!fileMap.has(filePath)) {
        fileMap.set(filePath, [])
      }

      fileMap.get(filePath)!.push({
        line: parseInt(lineNum, 10),
        content: content.trim()
      })
    }

    // Convert map to array of results
    return Array.from(fileMap.entries()).map(([path, matches]) => ({
      path,
      matches
    }))
  } catch (err: unknown) {
    // grep exits with code 1 when no matches found
    if ((err as { code?: number }).code === 1) {
      return []
    }
    throw err
  }
}

export function registerMemorySearchHandler(): void {
  safeHandle('memory:search', async (_e, query: string) => {
    return searchMemory(query)
  })
}
