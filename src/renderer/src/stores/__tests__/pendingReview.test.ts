import { describe, it, expect, beforeEach } from 'vitest'
import { usePendingReviewStore } from '../pendingReview'
import type { PendingComment } from '../pendingReview'

const initialState = {
  pendingComments: {} as Record<string, PendingComment[]>
}

const makeComment = (id: string): PendingComment => ({
  id,
  path: 'src/foo.ts',
  line: 10,
  side: 'RIGHT' as const,
  body: `comment ${id}`
})

describe('pendingReview store', () => {
  beforeEach(() => {
    usePendingReviewStore.setState(initialState)
  })

  it('starts with empty pendingComments', () => {
    expect(Object.keys(usePendingReviewStore.getState().pendingComments)).toHaveLength(0)
  })

  it('addComment adds a comment to the given prKey', () => {
    const comment = makeComment('c1')
    usePendingReviewStore.getState().addComment('pr-1', comment)
    const state = usePendingReviewStore.getState()
    expect(state.pendingComments['pr-1']).toHaveLength(1)
    expect(state.pendingComments['pr-1'][0]).toEqual(comment)
  })

  it('addComment appends to existing comments for the same prKey', () => {
    const c1 = makeComment('c1')
    const c2 = makeComment('c2')
    usePendingReviewStore.getState().addComment('pr-1', c1)
    usePendingReviewStore.getState().addComment('pr-1', c2)
    expect(usePendingReviewStore.getState().pendingComments['pr-1']).toHaveLength(2)
  })

  it('addComment keeps different prKeys independent', () => {
    usePendingReviewStore.getState().addComment('pr-1', makeComment('c1'))
    usePendingReviewStore.getState().addComment('pr-2', makeComment('c2'))
    const state = usePendingReviewStore.getState()
    expect(state.pendingComments['pr-1']).toHaveLength(1)
    expect(state.pendingComments['pr-2']).toHaveLength(1)
  })

  it('removeComment removes the comment with matching id', () => {
    const c1 = makeComment('c1')
    const c2 = makeComment('c2')
    usePendingReviewStore.getState().addComment('pr-1', c1)
    usePendingReviewStore.getState().addComment('pr-1', c2)
    usePendingReviewStore.getState().removeComment('pr-1', 'c1')
    const list = usePendingReviewStore.getState().pendingComments['pr-1']
    expect(list).toHaveLength(1)
    expect(list[0].id).toBe('c2')
  })

  it('removeComment on unknown prKey results in an empty list for that key', () => {
    usePendingReviewStore.getState().removeComment('no-such-pr', 'c1')
    const list = usePendingReviewStore.getState().pendingComments['no-such-pr']
    expect(list).toEqual([])
  })

  it('updateComment updates body of matching comment', () => {
    usePendingReviewStore.getState().addComment('pr-1', makeComment('c1'))
    usePendingReviewStore.getState().updateComment('pr-1', 'c1', 'updated body')
    const list = usePendingReviewStore.getState().pendingComments['pr-1']
    expect(list[0].body).toBe('updated body')
  })

  it('updateComment does not affect other comments', () => {
    usePendingReviewStore.getState().addComment('pr-1', makeComment('c1'))
    usePendingReviewStore.getState().addComment('pr-1', makeComment('c2'))
    usePendingReviewStore.getState().updateComment('pr-1', 'c1', 'new')
    const list = usePendingReviewStore.getState().pendingComments['pr-1']
    expect(list[1].body).toBe('comment c2')
  })

  it('clearPending removes all comments for the given prKey', () => {
    usePendingReviewStore.getState().addComment('pr-1', makeComment('c1'))
    usePendingReviewStore.getState().addComment('pr-2', makeComment('c2'))
    usePendingReviewStore.getState().clearPending('pr-1')
    const state = usePendingReviewStore.getState()
    expect(state.pendingComments['pr-1']).toBeUndefined()
    expect(state.pendingComments['pr-2']).toHaveLength(1)
  })

  it('getPendingCount returns 0 for unknown prKey', () => {
    expect(usePendingReviewStore.getState().getPendingCount('unknown')).toBe(0)
  })

  it('getPendingCount returns correct count', () => {
    usePendingReviewStore.getState().addComment('pr-1', makeComment('c1'))
    usePendingReviewStore.getState().addComment('pr-1', makeComment('c2'))
    expect(usePendingReviewStore.getState().getPendingCount('pr-1')).toBe(2)
  })
})
