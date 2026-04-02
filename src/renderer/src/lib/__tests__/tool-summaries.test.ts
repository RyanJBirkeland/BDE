import { describe, it, expect } from 'vitest'
import { formatToolSummary } from '../tool-summaries'

describe('formatToolSummary', () => {
  describe('Bash', () => {
    it('returns command string', () => {
      const result = formatToolSummary('Bash', { command: 'npm test' })
      expect(result).toBe('npm test')
    })

    it('truncates long commands to 100 chars', () => {
      const longCmd = 'a'.repeat(120)
      const result = formatToolSummary('bash', { command: longCmd })
      expect(result).toBe('a'.repeat(100) + '...')
    })

    it('handles case-insensitive tool names', () => {
      const result = formatToolSummary('BASH', { command: 'ls -la' })
      expect(result).toBe('ls -la')
    })

    it('returns null if command is missing', () => {
      const result = formatToolSummary('bash', {})
      expect(result).toBeNull()
    })

    it('returns null if command is not a string', () => {
      const result = formatToolSummary('bash', { command: 123 })
      expect(result).toBeNull()
    })
  })

  describe('Read', () => {
    it('returns file_path only', () => {
      const result = formatToolSummary('Read', { file_path: '/foo/bar.ts' })
      expect(result).toBe('/foo/bar.ts')
    })

    it('returns file_path with offset', () => {
      const result = formatToolSummary('read', {
        file_path: '/foo/bar.ts',
        offset: 10,
      })
      expect(result).toBe('/foo/bar.ts:10')
    })

    it('returns file_path with offset and limit range', () => {
      const result = formatToolSummary('read', {
        file_path: '/foo/bar.ts',
        offset: 10,
        limit: 20,
      })
      expect(result).toBe('/foo/bar.ts:10-29')
    })

    it('returns null if file_path is missing', () => {
      const result = formatToolSummary('read', { offset: 10 })
      expect(result).toBeNull()
    })

    it('returns null if file_path is not a string', () => {
      const result = formatToolSummary('read', { file_path: 123 })
      expect(result).toBeNull()
    })
  })

  describe('Edit', () => {
    it('returns file_path with old and new strings', () => {
      const result = formatToolSummary('Edit', {
        file_path: '/foo/bar.ts',
        old_string: 'const x = 1',
        new_string: 'const x = 2',
      })
      expect(result).toBe('/foo/bar.ts — replace "const x = 1" → "const x = 2"')
    })

    it('truncates old_string to 30 chars', () => {
      const longOld = 'a'.repeat(50)
      const result = formatToolSummary('edit', {
        file_path: '/foo/bar.ts',
        old_string: longOld,
        new_string: 'new',
      })
      expect(result).toBe(`/foo/bar.ts — replace "${'a'.repeat(30)}..." → "new"`)
    })

    it('truncates new_string to 30 chars', () => {
      const longNew = 'b'.repeat(50)
      const result = formatToolSummary('edit', {
        file_path: '/foo/bar.ts',
        old_string: 'old',
        new_string: longNew,
      })
      expect(result).toBe(`/foo/bar.ts — replace "old" → "${'b'.repeat(30)}..."`)
    })

    it('returns null if file_path is missing', () => {
      const result = formatToolSummary('edit', {
        old_string: 'old',
        new_string: 'new',
      })
      expect(result).toBeNull()
    })

    it('returns null if old_string is missing', () => {
      const result = formatToolSummary('edit', {
        file_path: '/foo/bar.ts',
        new_string: 'new',
      })
      expect(result).toBeNull()
    })

    it('returns null if new_string is missing', () => {
      const result = formatToolSummary('edit', {
        file_path: '/foo/bar.ts',
        old_string: 'old',
      })
      expect(result).toBeNull()
    })
  })

  describe('Write', () => {
    it('returns file_path with character count', () => {
      const result = formatToolSummary('Write', {
        file_path: '/foo/bar.ts',
        content: 'hello world',
      })
      expect(result).toBe('/foo/bar.ts (11 chars)')
    })

    it('formats large character counts with locale separators', () => {
      const longContent = 'x'.repeat(12345)
      const result = formatToolSummary('write', {
        file_path: '/foo/bar.ts',
        content: longContent,
      })
      expect(result).toBe('/foo/bar.ts (12,345 chars)')
    })

    it('returns null if file_path is missing', () => {
      const result = formatToolSummary('write', { content: 'hello' })
      expect(result).toBeNull()
    })

    it('returns null if content is missing', () => {
      const result = formatToolSummary('write', { file_path: '/foo/bar.ts' })
      expect(result).toBeNull()
    })

    it('returns null if content is not a string', () => {
      const result = formatToolSummary('write', {
        file_path: '/foo/bar.ts',
        content: 123,
      })
      expect(result).toBeNull()
    })
  })

  describe('Grep', () => {
    it('returns pattern only', () => {
      const result = formatToolSummary('Grep', { pattern: 'TODO' })
      expect(result).toBe('pattern "TODO"')
    })

    it('returns pattern with path', () => {
      const result = formatToolSummary('grep', {
        pattern: 'function.*test',
        path: '/src',
      })
      expect(result).toBe('pattern "function.*test" in /src')
    })

    it('returns null if pattern is missing', () => {
      const result = formatToolSummary('grep', { path: '/src' })
      expect(result).toBeNull()
    })

    it('returns null if pattern is not a string', () => {
      const result = formatToolSummary('grep', { pattern: 123 })
      expect(result).toBeNull()
    })
  })

  describe('Glob', () => {
    it('returns pattern', () => {
      const result = formatToolSummary('Glob', { pattern: '**/*.ts' })
      expect(result).toBe('**/*.ts')
    })

    it('returns null if pattern is missing', () => {
      const result = formatToolSummary('glob', {})
      expect(result).toBeNull()
    })

    it('returns null if pattern is not a string', () => {
      const result = formatToolSummary('glob', { pattern: 123 })
      expect(result).toBeNull()
    })
  })

  describe('Agent', () => {
    it('returns prompt', () => {
      const result = formatToolSummary('Agent', {
        prompt: 'Write a function to calculate fibonacci',
      })
      expect(result).toBe('Write a function to calculate fibonacci')
    })

    it('truncates prompt to 80 chars', () => {
      const longPrompt = 'x'.repeat(100)
      const result = formatToolSummary('agent', { prompt: longPrompt })
      expect(result).toBe('x'.repeat(80) + '...')
    })

    it('returns null if prompt is missing', () => {
      const result = formatToolSummary('agent', {})
      expect(result).toBeNull()
    })

    it('returns null if prompt is not a string', () => {
      const result = formatToolSummary('agent', { prompt: 123 })
      expect(result).toBeNull()
    })
  })

  describe('Unknown tools', () => {
    it('returns null for unknown tool names', () => {
      const result = formatToolSummary('UnknownTool', { foo: 'bar' })
      expect(result).toBeNull()
    })

    it('returns null for empty string tool name', () => {
      const result = formatToolSummary('', { foo: 'bar' })
      expect(result).toBeNull()
    })
  })

  describe('Edge cases', () => {
    it('handles null input', () => {
      const result = formatToolSummary('bash', null)
      expect(result).toBeNull()
    })

    it('handles undefined input', () => {
      const result = formatToolSummary('bash', undefined)
      expect(result).toBeNull()
    })

    it('handles empty object input', () => {
      const result = formatToolSummary('bash', {})
      expect(result).toBeNull()
    })

    it('handles non-object input', () => {
      const result = formatToolSummary('bash', 'not an object')
      expect(result).toBeNull()
    })
  })
})
