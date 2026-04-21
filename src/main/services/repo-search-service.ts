/**
 * Repo search service — grep-based codebase search for workbench research.
 */
import { execFileAsync } from '../lib/async-utils'

const MAX_FILES = 10
const MAX_LINES_PER_FILE = 3

export interface RepoSearchMatch {
  file: string
  lines: string[]
}

export interface RepoSearchResult {
  content: string
  filesSearched: string[]
  totalMatches: number
}

/**
 * Parses raw grep stdout (format: `file:linenum:content`) into structured
 * match results. Returns the same shape whether there are matches or not.
 */
export function parseGrepOutput(stdout: string, query: string): RepoSearchResult {
  const lines = stdout.trim().split('\n').filter(Boolean)
  const fileMap = new Map<string, string[]>()

  for (const line of lines) {
    const match = line.match(/^(.+?):(\d+):(.*)$/)
    if (!match) continue
    const [, file, lineNum, lineContent] = match
    if (!file || !lineNum || lineContent === undefined) continue
    if (!fileMap.has(file)) {
      fileMap.set(file, [])
    }
    fileMap.get(file)!.push(`${lineNum}: ${lineContent.trim()}`)
  }

  const filesSearched = Array.from(fileMap.keys()).slice(0, MAX_FILES)
  const totalMatches = fileMap.size

  let content = `Found ${totalMatches} file(s) matching "${query}" (showing first ${MAX_FILES}):\n\n`
  for (const file of filesSearched) {
    const matchLines = fileMap.get(file)!.slice(0, MAX_LINES_PER_FILE)
    content += `**${file}**\n${matchLines.join('\n')}\n\n`
  }

  return { content, filesSearched, totalMatches }
}

/**
 * Searches a repository directory for the given query string using grep.
 * Uses -F (fixed-string mode) to treat the query as a literal string rather than a regex,
 * which prevents ReDoS from pathological user-supplied patterns.
 * Handles the grep exit-code-1 case (no matches) gracefully.
 */
export async function searchRepo(repoPath: string, query: string): Promise<RepoSearchResult> {
  try {
    const { stdout } = await execFileAsync('grep', ['-rn', '-i', '-F', '--', query, '.'], {
      cwd: repoPath,
      encoding: 'utf-8',
      maxBuffer: 5 * 1024 * 1024 // 5MB
    })
    return parseGrepOutput(stdout, query)
  } catch (err: unknown) {
    // grep exits with code 1 when no matches found — that is not an error
    if ((err as { code?: number }).code === 1) {
      return {
        content: `No matches found for "${query}" in repo`,
        filesSearched: [],
        totalMatches: 0
      }
    }
    return {
      content: `Error searching repo: ${(err as Error).message}`,
      filesSearched: [],
      totalMatches: 0
    }
  }
}
