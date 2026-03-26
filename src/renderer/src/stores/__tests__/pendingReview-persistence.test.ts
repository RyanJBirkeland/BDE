/**
 * Tests that pendingReview store persists to and restores from localStorage.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { usePendingReviewStore } from '../pendingReview'
import type { PendingComment } from '../pendingReview'

const STORAGE_KEY = 'bde:pendingReviewComments'

function makeComment(id: string): PendingComment {
  return {
    id,
    path: 'src/foo.ts',
    line: 10,
    side: 'RIGHT',
    body: `Comment ${id}`
  }
}

describe('pendingReview store — localStorage persistence', () => {
  beforeEach(() => {
    localStorage.clear()
    usePendingReviewStore.setState({ pendingComments: {} })
  })

  it('restoreFromStorage is a no-op when localStorage is empty', () => {
    usePendingReviewStore.getState().restoreFromStorage()
    expect(usePendingReviewStore.getState().pendingComments).toEqual({})
  })

  it('restoreFromStorage loads comments from localStorage', () => {
    const data = { 'repo#1': [makeComment('c1')] }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))

    usePendingReviewStore.getState().restoreFromStorage()
    const { pendingComments } = usePendingReviewStore.getState()
    expect(pendingComments['repo#1']).toHaveLength(1)
    expect(pendingComments['repo#1'][0].id).toBe('c1')
  })

  it('restoreFromStorage handles corrupt JSON gracefully', () => {
    localStorage.setItem(STORAGE_KEY, 'not-valid-json{{')
    expect(() => usePendingReviewStore.getState().restoreFromStorage()).not.toThrow()
    expect(usePendingReviewStore.getState().pendingComments).toEqual({})
  })

  it('auto-persists when a comment is added', () => {
    usePendingReviewStore.getState().addComment('repo#2', makeComment('c2'))
    const raw = localStorage.getItem(STORAGE_KEY)
    expect(raw).not.toBeNull()
    const parsed = JSON.parse(raw!) as Record<string, PendingComment[]>
    expect(parsed['repo#2']).toHaveLength(1)
    expect(parsed['repo#2'][0].id).toBe('c2')
  })

  it('auto-persists when a comment is removed', () => {
    usePendingReviewStore.getState().addComment('repo#3', makeComment('c3a'))
    usePendingReviewStore.getState().addComment('repo#3', makeComment('c3b'))
    usePendingReviewStore.getState().removeComment('repo#3', 'c3a')

    const raw = localStorage.getItem(STORAGE_KEY)!
    const parsed = JSON.parse(raw) as Record<string, PendingComment[]>
    expect(parsed['repo#3']).toHaveLength(1)
    expect(parsed['repo#3'][0].id).toBe('c3b')
  })

  it('auto-persists when pending is cleared', () => {
    usePendingReviewStore.getState().addComment('repo#4', makeComment('c4'))
    usePendingReviewStore.getState().clearPending('repo#4')

    const raw = localStorage.getItem(STORAGE_KEY)!
    const parsed = JSON.parse(raw) as Record<string, PendingComment[]>
    expect(parsed['repo#4']).toBeUndefined()
  })

  it('restoreFromStorage ignores non-object values', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([1, 2, 3]))
    usePendingReviewStore.getState().restoreFromStorage()
    // Array is not a plain object — should be ignored
    expect(usePendingReviewStore.getState().pendingComments).toEqual({})
  })

  it('survives localStorage.setItem throwing (e.g. quota exceeded)', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
      throw new Error('QuotaExceededError')
    })
    // Should not throw
    expect(() => {
      usePendingReviewStore.getState().addComment('repo#5', makeComment('c5'))
    }).not.toThrow()
    vi.restoreAllMocks()
  })
})
