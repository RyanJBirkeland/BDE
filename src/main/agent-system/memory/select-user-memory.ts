import { basename } from 'node:path'
import { getUserMemory, type UserMemoryResult } from './user-memory'

const STOP_WORDS = new Set([
  'the',
  'this',
  'that',
  'with',
  'from',
  'have',
  'will',
  'your',
  'they',
  'been',
  'were',
  'when',
  'what',
  'which',
  'their',
  'there',
  'about',
  'into',
  'more',
  'also',
  'each',
  'should',
  'must',
  'only',
  'both'
])

function extractKeywords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/\W+/)
      .filter((tok) => tok.length >= 4 && !STOP_WORDS.has(tok))
  )
}

function isGlobalFile(relativePath: string): boolean {
  const name = basename(relativePath)
  return name.startsWith('global') || name.startsWith('_global')
}

/**
 * Synchronous. Calls getUserMemory() then filters by keyword relevance against
 * the task spec. Replaces unconditional getUserMemory() for pipeline agents.
 *
 * Files are included if:
 *  - Their basename starts with 'global' or '_global', OR
 *  - At least one keyword from the task spec appears in the file content
 */
export function selectUserMemory(taskSpec: string): UserMemoryResult {
  const all = getUserMemory()
  if (all.fileCount === 0) return all

  const keywords = extractKeywords(taskSpec)
  if (keywords.size === 0) return all // no keywords → include everything

  // Parse sections back out (they were joined with '\n\n---\n\n')
  const sections = all.content.split('\n\n---\n\n')

  const kept: string[] = []
  let totalBytes = 0

  for (const section of sections) {
    // Extract relative path from '### relativePath' header
    const headerMatch = section.match(/^### (.+)/)
    if (!headerMatch || !headerMatch[1]) continue
    const relativePath = headerMatch[1].trim()

    // Count only the raw file content bytes (consistent with getUserMemory's accounting).
    // The section string includes the '### header\n\n' prefix — strip it before counting.
    const contentStart = section.indexOf('\n\n')
    const contentBytes =
      contentStart >= 0
        ? Buffer.byteLength(section.slice(contentStart + 2), 'utf-8')
        : Buffer.byteLength(section, 'utf-8')

    if (isGlobalFile(relativePath)) {
      kept.push(section)
      totalBytes += contentBytes
      continue
    }

    const lower = section.toLowerCase()
    const hasMatch = [...keywords].some((kw) => lower.includes(kw))
    if (hasMatch) {
      kept.push(section)
      totalBytes += contentBytes
    }
  }

  return {
    content: kept.join('\n\n---\n\n'),
    totalBytes,
    fileCount: kept.length
  }
}
