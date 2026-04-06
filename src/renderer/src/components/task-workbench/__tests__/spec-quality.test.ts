import { describe, it, expect } from 'vitest'
import { analyzeSpec, countWords, hasFilePaths, hasTestSection } from '../spec-quality'

describe('spec-quality', () => {
  describe('countWords', () => {
    it('counts whitespace-delimited words', () => {
      expect(countWords('')).toBe(0)
      expect(countWords('   ')).toBe(0)
      expect(countWords('one')).toBe(1)
      expect(countWords('one two three')).toBe(3)
      expect(countWords('one\n  two\tthree\n\nfour')).toBe(4)
    })
  })

  describe('hasFilePaths', () => {
    it('detects src/ prefixed paths', () => {
      expect(hasFilePaths('Edit src/foo/bar.ts')).toBe(true)
      expect(hasFilePaths('touch packages/core/index.ts')).toBe(true)
    })

    it('detects bare filenames with known extensions', () => {
      expect(hasFilePaths('See index.tsx')).toBe(true)
      expect(hasFilePaths('update package.json')).toBe(true)
    })

    it('returns false when no paths present', () => {
      expect(hasFilePaths('Add a feature to the app')).toBe(false)
      expect(hasFilePaths('')).toBe(false)
    })
  })

  describe('hasTestSection', () => {
    it('detects markdown headings', () => {
      expect(hasTestSection('## How to Test\nRun npm test')).toBe(true)
      expect(hasTestSection('### Tests')).toBe(true)
      expect(hasTestSection('# Testing')).toBe(true)
    })

    it('detects inline npm test references', () => {
      expect(hasTestSection('Make sure `npm test` passes')).toBe(true)
    })

    it('returns false without test guidance', () => {
      expect(hasTestSection('Just add a comment')).toBe(false)
      expect(hasTestSection('')).toBe(false)
    })
  })

  describe('analyzeSpec', () => {
    it('returns a combined result', () => {
      const result = analyzeSpec(
        '## Problem\nFix the bug\n\n## Files\nsrc/index.ts\n\n## How to Test\nrun npm test'
      )
      expect(result.wordCount).toBeGreaterThan(0)
      expect(result.hasFilePaths).toBe(true)
      expect(result.hasTestSection).toBe(true)
    })
  })
})
