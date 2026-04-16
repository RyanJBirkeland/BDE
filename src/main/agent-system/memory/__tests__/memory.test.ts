import { describe, it, expect } from 'vitest'
import { getAllMemory } from '../index'

describe('Memory System', () => {
  describe('getAllMemory', () => {
    it('returns an empty string unconditionally (Option A debranding)', () => {
      expect(getAllMemory()).toBe('')
    })

    it('returns empty string regardless of repoName', () => {
      expect(getAllMemory({ repoName: 'bde' })).toBe('')
      expect(getAllMemory({ repoName: 'BDE' })).toBe('')
      expect(getAllMemory({ repoName: 'life-os' })).toBe('')
      expect(getAllMemory({ repoName: 'claude-task-runner' })).toBe('')
      expect(getAllMemory({ repoName: null })).toBe('')
      expect(getAllMemory({ repoName: undefined })).toBe('')
    })
  })
})
