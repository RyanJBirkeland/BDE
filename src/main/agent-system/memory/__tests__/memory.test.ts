import { describe, it, expect } from 'vitest'
import { getAllMemory, isBdeRepo } from '../index'
import { ipcConventions } from '../ipc-conventions'
import { testingPatterns } from '../testing-patterns'
import { architectureRules } from '../architecture-rules'

describe('Memory System', () => {
  it('should consolidate all memory modules', () => {
    const memory = getAllMemory({ repoName: 'bde' })
    expect(memory).toContain('IPC Conventions')
    expect(memory).toContain('Testing Patterns')
    expect(memory).toContain('Architecture Rules')
  })

  it('should separate modules with markdown dividers', () => {
    const memory = getAllMemory({ repoName: 'bde' })
    expect(memory).toContain('---')
  })

  it('should include IPC conventions content', () => {
    expect(ipcConventions).toContain('safeHandle')
    expect(ipcConventions).toContain('Handler Registration')
  })

  it('should include testing patterns content', () => {
    expect(testingPatterns).toContain('Coverage Requirements')
    expect(testingPatterns).toContain('npm run test:coverage')
    // Thresholds must NOT be hardcoded — they live in vitest config only
    expect(testingPatterns).not.toMatch(/\d{2}%\s+(statements|branches|functions|lines)/)
  })

  it('should include architecture rules content', () => {
    expect(architectureRules).toContain('Process Boundaries')
    expect(architectureRules).toContain('Zustand')
  })

  describe('repo-aware memory injection', () => {
    it('returns full BDE memory when repoName is "bde"', () => {
      const memory = getAllMemory({ repoName: 'bde' })
      expect(memory).toContain('IPC Conventions')
      expect(memory).toContain('Testing Patterns')
      expect(memory).toContain('Architecture Rules')
    })

    it('returns empty string when repoName is undefined (unknown repo)', () => {
      expect(getAllMemory()).toBe('')
    })

    it('returns empty string when repoName is null (unknown repo)', () => {
      expect(getAllMemory({ repoName: null })).toBe('')
    })

    it('returns empty string for non-BDE repos', () => {
      expect(getAllMemory({ repoName: 'life-os' })).toBe('')
      expect(getAllMemory({ repoName: 'claude-task-runner' })).toBe('')
      expect(getAllMemory({ repoName: 'bde-site' })).toBe('')
    })

    it('matches BDE case-insensitively', () => {
      expect(getAllMemory({ repoName: 'BDE' })).toContain('IPC Conventions')
      expect(getAllMemory({ repoName: 'Bde' })).toContain('IPC Conventions')
    })

    it('matches owner-prefixed BDE repo names', () => {
      expect(getAllMemory({ repoName: 'rbirkeland/bde' })).toContain('IPC Conventions')
    })
  })

  describe('isBdeRepo helper', () => {
    it('returns true for "bde" (any case)', () => {
      expect(isBdeRepo('bde')).toBe(true)
      expect(isBdeRepo('BDE')).toBe(true)
      expect(isBdeRepo('  bde  ')).toBe(true)
    })

    it('returns true for owner-prefixed bde', () => {
      expect(isBdeRepo('owner/bde')).toBe(true)
    })

    it('returns false for null/undefined/empty (unknown repo)', () => {
      expect(isBdeRepo(null)).toBe(false)
      expect(isBdeRepo(undefined)).toBe(false)
      expect(isBdeRepo('')).toBe(false)
    })

    it('returns false for unrelated repos', () => {
      expect(isBdeRepo('life-os')).toBe(false)
      expect(isBdeRepo('bde-site')).toBe(false)
      expect(isBdeRepo('repomap')).toBe(false)
    })
  })
})
