import { describe, it, expect } from 'vitest'
import { formatBlockedNote, stripBlockedNote, buildBlockedNotes } from '../dependency-helpers'

describe('formatBlockedNote', () => {
  it('formats blocked-by list with prefix', () => {
    expect(formatBlockedNote(['task-1', 'task-2'])).toBe('[auto-block] Blocked by: task-1, task-2')
  })

  it('handles single dependency', () => {
    expect(formatBlockedNote(['task-1'])).toBe('[auto-block] Blocked by: task-1')
  })
})

describe('stripBlockedNote', () => {
  it('removes auto-block prefix and returns user notes', () => {
    expect(stripBlockedNote('[auto-block] Blocked by: task-1\nUser notes here')).toBe('User notes here')
  })

  it('returns empty string for null', () => {
    expect(stripBlockedNote(null)).toBe('')
  })

  it('returns original text when no auto-block prefix', () => {
    expect(stripBlockedNote('Just user notes')).toBe('Just user notes')
  })

  it('returns empty string when only auto-block prefix', () => {
    expect(stripBlockedNote('[auto-block] Blocked by: task-1')).toBe('')
  })
})

describe('buildBlockedNotes', () => {
  it('builds note with just blocked-by when no existing notes', () => {
    expect(buildBlockedNotes(['task-1'])).toBe('[auto-block] Blocked by: task-1')
  })

  it('preserves existing user notes after blocked-by', () => {
    expect(buildBlockedNotes(['task-1'], 'User wrote this')).toBe('[auto-block] Blocked by: task-1\nUser wrote this')
  })

  it('strips old auto-block prefix from existing notes before rebuilding', () => {
    expect(buildBlockedNotes(['task-2'], '[auto-block] Blocked by: task-1\nOriginal notes'))
      .toBe('[auto-block] Blocked by: task-2\nOriginal notes')
  })

  it('handles null existing notes', () => {
    expect(buildBlockedNotes(['task-1'], null)).toBe('[auto-block] Blocked by: task-1')
  })
})
