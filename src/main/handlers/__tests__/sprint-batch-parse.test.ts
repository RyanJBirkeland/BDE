/**
 * Tests for parseBatchImportArgs — validates the Zod-based IPC argument
 * parser for `sprint:batchImport`. Tests run in isolation from handlers.
 */
import { describe, it, expect } from 'vitest'
import { BatchImportTaskSchema } from '../sprint-ipc-schemas'

// parseBatchImportArgs is a module-private function; we test the schema it
// delegates to directly, matching the public contract the IPC handler exposes.

describe('BatchImportTaskSchema (parseBatchImportArgs contract)', () => {
  it('accepts a minimal valid array (title + repo only)', () => {
    const result = BatchImportTaskSchema.parse({ title: 'My task', repo: 'fleet' })
    expect(result.title).toBe('My task')
    expect(result.repo).toBe('fleet')
  })

  it('accepts an element with all optional fields populated', () => {
    const result = BatchImportTaskSchema.parse({
      title: 'Full task',
      repo: 'fleet',
      depType: 'soft',
      playgroundEnabled: true,
      tags: ['alpha', 'beta'],
      priority: 5,
      templateName: 'feature-template'
    })
    expect(result.depType).toBe('soft')
    expect(result.playgroundEnabled).toBe(true)
    expect(result.tags).toEqual(['alpha', 'beta'])
  })

  it('throws when an element has an invalid depType', () => {
    expect(() =>
      BatchImportTaskSchema.parse({ title: 'T', repo: 'fleet', depType: 'weak' })
    ).toThrow()
  })

  it('throws when an element has a non-integer priority', () => {
    expect(() =>
      BatchImportTaskSchema.parse({ title: 'T', repo: 'fleet', priority: 1.5 })
    ).toThrow()
  })

  it('throws when an element has a non-boolean playgroundEnabled', () => {
    expect(() =>
      BatchImportTaskSchema.parse({ title: 'T', repo: 'fleet', playgroundEnabled: 'yes' })
    ).toThrow()
  })
})
