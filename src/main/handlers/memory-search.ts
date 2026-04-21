/**
 * Memory search handler — grep-based content search through memory files.
 */
import { safeHandle } from '../ipc-utils'
import { execFileAsync } from '../lib/async-utils'
import { BDE_MEMORY_DIR } from '../paths'
import { createLogger } from '../logger'

const logger = createLogger('memory-search')

export interface MemorySearchMatch {
  line: number
  content: string
}

export interface MemorySearchResult {
  path: string
  matches: MemorySearchMatch[]
}

export interface MemorySearchResponse {
  results: MemorySearchResult[]
  timedOut: boolean
}

/**
 * Search memory files using grep with fixed-string matching (-F).
 * Fixed-string mode treats the query as a literal string, not a regex pattern.
 * This prevents ReDoS from catastrophic backtracking on attacker-controlled patterns.
 * Returns an object with matching file results and a timedOut flag.
 * timedOut is true when the grep process was killed due to the 5-second timeout.
 */
async function searchMemory(query: string): Promise<MemorySearchResponse> {
  if (typeof query !== 'string' || query.length > 200) {
    logger.warn('memory:search query rejected: exceeds 200 char limit')
    throw new Error('Query must be a string of 200 characters or fewer')
  }

  if (!query.trim()) {
    return { results: [], timedOut: false }
  }

  try {
    const { stdout } = await execFileAsync('grep', ['-Frni', '--', query, '.'], {
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
      if (!filePath || !lineNum || content === undefined) continue

      if (!fileMap.has(filePath)) {
        fileMap.set(filePath, [])
      }

      fileMap.get(filePath)!.push({
        line: parseInt(lineNum, 10),
        content: content.trim()
      })
    }

    // Convert map to array of results
    const results = Array.from(fileMap.entries()).map(([path, matches]) => ({
      path,
      matches
    }))

    return { results, timedOut: false }
  } catch (err: unknown) {
    const error = err as { code?: number | string; killed?: boolean; signal?: string }

    // grep exits with code 1 when no matches found
    if (error.code === 1) {
      return { results: [], timedOut: false }
    }

    // execFile with timeout option kills the process with SIGTERM and sets killed=true
    if (error.killed === true || error.signal === 'SIGTERM' || error.code === 'ETIMEDOUT') {
      logger.warn('memory:search: grep timed out, returning empty results')
      return { results: [], timedOut: true }
    }

    throw err
  }
}

export function registerMemorySearchHandler(): void {
  safeHandle('memory:search', async (_e, query: string) => {
    return searchMemory(query)
  })
}
