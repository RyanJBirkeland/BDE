import { describe, it, expect, vi, beforeEach } from 'vitest'
import { parseGrepOutput, searchRepo } from '../repo-search-service'

vi.mock('../../lib/async-utils', () => ({
  execFileAsync: vi.fn()
}))

import { execFileAsync } from '../../lib/async-utils'

// ---------------------------------------------------------------------------
// parseGrepOutput — pure function, no I/O
// ---------------------------------------------------------------------------

describe('parseGrepOutput', () => {
  it('returns zero matches for empty output', () => {
    const result = parseGrepOutput('', 'query')
    expect(result.totalMatches).toBe(0)
    expect(result.filesSearched).toHaveLength(0)
  })

  it('parses a single-file match correctly', () => {
    const stdout = 'src/foo.ts:42:const foo = "bar"'
    const result = parseGrepOutput(stdout, 'foo')
    expect(result.totalMatches).toBe(1)
    expect(result.filesSearched).toContain('src/foo.ts')
    expect(result.content).toContain('src/foo.ts')
    expect(result.content).toContain('42')
  })

  it('groups multiple matches from the same file', () => {
    const stdout = [
      'src/a.ts:1:match one',
      'src/a.ts:2:match two',
      'src/a.ts:3:match three'
    ].join('\n')
    const result = parseGrepOutput(stdout, 'match')
    expect(result.totalMatches).toBe(1) // one file
    expect(result.filesSearched).toHaveLength(1)
  })

  it('limits displayed lines to 3 per file (MAX_LINES_PER_FILE)', () => {
    const lines = Array.from({ length: 5 }, (_, i) => `src/a.ts:${i + 1}:line ${i + 1}`).join('\n')
    const result = parseGrepOutput(lines, 'line')
    // Only first 3 of 5 lines should appear in content
    expect(result.content).toContain('1:')
    expect(result.content).toContain('2:')
    expect(result.content).toContain('3:')
    expect(result.content).not.toContain('4: line')
  })

  it('sets truncation flag indicator in content for > 10 files', () => {
    const manyFileLines = Array.from({ length: 12 }, (_, i) => `src/file${i}.ts:1:match`).join('\n')
    const result = parseGrepOutput(manyFileLines, 'match')
    // Only first 10 files shown
    expect(result.filesSearched).toHaveLength(10)
    expect(result.totalMatches).toBe(12) // all 12 counted
  })
})

// ---------------------------------------------------------------------------
// searchRepo — I/O wrapper
// ---------------------------------------------------------------------------

describe('searchRepo', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('passes the query and repo path to grep with -F (fixed string) flag', async () => {
    vi.mocked(execFileAsync).mockResolvedValue({ stdout: '', stderr: '' })

    await searchRepo('/repos/fleet', 'myQuery')

    expect(execFileAsync).toHaveBeenCalledWith(
      'grep',
      expect.arrayContaining(['-F', '--', 'myQuery']),
      expect.objectContaining({ cwd: '/repos/fleet' })
    )
  })

  it('returns empty result when grep exits with code 1 (no matches)', async () => {
    vi.mocked(execFileAsync).mockRejectedValue({ code: 1, message: 'grep: no matches' })

    const result = await searchRepo('/repos/fleet', 'nothingHere')

    expect(result.totalMatches).toBe(0)
    expect(result.filesSearched).toHaveLength(0)
    expect(result.content).toContain('No matches')
  })

  it('returns error content when grep throws an unexpected error', async () => {
    vi.mocked(execFileAsync).mockRejectedValue(new Error('EPERM: permission denied'))

    const result = await searchRepo('/repos/fleet', 'query')

    expect(result.content).toContain('Error')
    expect(result.totalMatches).toBe(0)
  })
})
