import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock getUserMemory before importing the module under test
vi.mock('../user-memory', () => ({
  getUserMemory: vi.fn(),
}))

import { selectUserMemory } from '../select-user-memory'
import { getUserMemory } from '../user-memory'

const mockGetUserMemory = vi.mocked(getUserMemory)

function makeSection(relativePath: string, content: string): string {
  return `### ${relativePath}\n\n${content}`
}

function makeResult(sections: string[]) {
  const content = sections.join('\n\n---\n\n')
  return {
    content,
    totalBytes: Buffer.byteLength(content, 'utf-8'),
    fileCount: sections.length,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('selectUserMemory', () => {
  it('includes a file when a keyword from the task spec matches its content', () => {
    const sections = [
      makeSection('database.md', 'This file explains sqlite connection pooling and transactions.'),
      makeSection('styles.md', 'CSS variables and color tokens for the design system.'),
    ]
    mockGetUserMemory.mockReturnValue(makeResult(sections))

    const result = selectUserMemory('Fix the sqlite connection pooling issue')

    expect(result.fileCount).toBe(1)
    expect(result.content).toContain('database.md')
    expect(result.content).not.toContain('styles.md')
  })

  it('excludes a file with zero keyword overlap with the task spec', () => {
    const sections = [
      makeSection('unrelated.md', 'Notes about cooking recipes and meal planning strategies.'),
    ]
    mockGetUserMemory.mockReturnValue(makeResult(sections))

    const result = selectUserMemory('Implement sqlite query caching layer')

    expect(result.fileCount).toBe(0)
    expect(result.content).toBe('')
  })

  it('always includes a file named global_rules.md regardless of keywords', () => {
    const sections = [
      makeSection('global_rules.md', 'Always write tests. Follow clean code principles.'),
      makeSection('unrelated.md', 'Completely irrelevant content about cooking.'),
    ]
    mockGetUserMemory.mockReturnValue(makeResult(sections))

    const result = selectUserMemory('Implement sqlite query caching layer')

    expect(result.fileCount).toBe(1)
    expect(result.content).toContain('global_rules.md')
    expect(result.content).not.toContain('unrelated.md')
  })

  it('always includes a file named _global_api.md regardless of keywords', () => {
    const sections = [
      makeSection('_global_api.md', 'Global API conventions for all agents.'),
      makeSection('specific.md', 'Only relevant to typography styling.'),
    ]
    mockGetUserMemory.mockReturnValue(makeResult(sections))

    const result = selectUserMemory('Implement sqlite query caching layer')

    expect(result.fileCount).toBe(1)
    expect(result.content).toContain('_global_api.md')
    expect(result.content).not.toContain('specific.md')
  })

  it('always includes subdir/global_rules.md because basename starts with global', () => {
    const sections = [
      makeSection('subdir/global_rules.md', 'Shared rules for all agents in subdirectory.'),
      makeSection('subdir/specific.md', 'Only relevant to typography styling.'),
    ]
    mockGetUserMemory.mockReturnValue(makeResult(sections))

    const result = selectUserMemory('Implement sqlite query caching layer')

    expect(result.fileCount).toBe(1)
    expect(result.content).toContain('subdir/global_rules.md')
    expect(result.content).not.toContain('subdir/specific.md')
  })

  it('includes all files when task spec is empty (no keywords extracted)', () => {
    const sections = [
      makeSection('file-a.md', 'Content about database migrations.'),
      makeSection('file-b.md', 'Content about CSS design tokens.'),
    ]
    mockGetUserMemory.mockReturnValue(makeResult(sections))

    const result = selectUserMemory('')

    expect(result.fileCount).toBe(2)
    expect(result.content).toContain('file-a.md')
    expect(result.content).toContain('file-b.md')
  })

  it('returns empty result immediately when fileCount is 0 without running keyword logic', () => {
    const emptyResult = { content: '', totalBytes: 0, fileCount: 0 }
    mockGetUserMemory.mockReturnValue(emptyResult)

    const result = selectUserMemory('Fix the sqlite connection pooling issue')

    expect(result).toEqual(emptyResult)
    // getUserMemory was called exactly once — no extra processing
    expect(mockGetUserMemory).toHaveBeenCalledTimes(1)
  })

  it('returns only matching files when given a mix of matching and non-matching files', () => {
    const sections = [
      makeSection('auth.md', 'OAuth credential refresh logic and keychain access patterns.'),
      makeSection('database.md', 'SQLite migration patterns and WAL mode configuration.'),
      makeSection('styling.md', 'CSS variables, neon theme, glassmorphism effects.'),
      makeSection('testing.md', 'Vitest patterns, mock strategies, and coverage thresholds.'),
    ]
    mockGetUserMemory.mockReturnValue(makeResult(sections))

    const result = selectUserMemory('Fix oauth credential refresh and keychain access hang in Electron')

    expect(result.fileCount).toBe(1)
    expect(result.content).toContain('auth.md')
    expect(result.content).not.toContain('database.md')
    expect(result.content).not.toContain('styling.md')
    expect(result.content).not.toContain('testing.md')
  })
})
