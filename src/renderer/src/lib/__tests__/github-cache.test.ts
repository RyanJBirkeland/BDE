import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../github-api', () => ({
  getPRDetail: vi.fn().mockResolvedValue({ number: 1, title: 'PR 1' }),
  getPRFiles: vi.fn().mockResolvedValue([{ filename: 'file.ts' }]),
  getReviews: vi.fn().mockResolvedValue([{ id: 1, state: 'APPROVED' }]),
  getReviewComments: vi.fn().mockResolvedValue([{ id: 1, body: 'comment' }]),
  getIssueComments: vi.fn().mockResolvedValue([{ id: 1, body: 'issue comment' }])
}))

import {
  cachedGetPRDetail,
  cachedGetPRFiles,
  cachedGetReviews,
  cachedGetReviewComments,
  cachedGetIssueComments,
  invalidateCache,
  invalidatePRCache
} from '../github-cache'
import {
  getPRDetail,
  getPRFiles,
  getReviews,
  getReviewComments,
  getIssueComments
} from '../github-api'

describe('github-cache', () => {
  beforeEach(() => {
    invalidateCache() // Clear all cache between tests
    vi.clearAllMocks()
  })

  describe('cachedGetPRDetail', () => {
    it('fetches and caches PR detail', async () => {
      const result = await cachedGetPRDetail('owner', 'repo', 1)
      expect(result).toEqual({ number: 1, title: 'PR 1' })
      expect(getPRDetail).toHaveBeenCalledTimes(1)
    })

    it('returns cached value on second call', async () => {
      await cachedGetPRDetail('owner', 'repo', 1)
      await cachedGetPRDetail('owner', 'repo', 1)
      expect(getPRDetail).toHaveBeenCalledTimes(1) // Only called once
    })
  })

  describe('cachedGetPRFiles', () => {
    it('fetches and caches PR files', async () => {
      const result = await cachedGetPRFiles('owner', 'repo', 1)
      expect(result).toEqual([{ filename: 'file.ts' }])
      expect(getPRFiles).toHaveBeenCalledTimes(1)
    })

    it('returns cached value on second call', async () => {
      await cachedGetPRFiles('owner', 'repo', 1)
      await cachedGetPRFiles('owner', 'repo', 1)
      expect(getPRFiles).toHaveBeenCalledTimes(1)
    })
  })

  describe('cachedGetReviews', () => {
    it('fetches and caches reviews', async () => {
      const result = await cachedGetReviews('owner', 'repo', 1)
      expect(result).toEqual([{ id: 1, state: 'APPROVED' }])
      expect(getReviews).toHaveBeenCalledTimes(1)
    })

    it('returns cached value on second call', async () => {
      await cachedGetReviews('owner', 'repo', 1)
      await cachedGetReviews('owner', 'repo', 1)
      expect(getReviews).toHaveBeenCalledTimes(1)
    })
  })

  describe('cachedGetReviewComments', () => {
    it('fetches and caches review comments', async () => {
      const result = await cachedGetReviewComments('owner', 'repo', 1)
      expect(result).toEqual([{ id: 1, body: 'comment' }])
      expect(getReviewComments).toHaveBeenCalledTimes(1)
    })

    it('returns cached value on second call', async () => {
      await cachedGetReviewComments('owner', 'repo', 1)
      await cachedGetReviewComments('owner', 'repo', 1)
      expect(getReviewComments).toHaveBeenCalledTimes(1)
    })
  })

  describe('cachedGetIssueComments', () => {
    it('fetches and caches issue comments', async () => {
      const result = await cachedGetIssueComments('owner', 'repo', 1)
      expect(result).toEqual([{ id: 1, body: 'issue comment' }])
      expect(getIssueComments).toHaveBeenCalledTimes(1)
    })

    it('returns cached value on second call', async () => {
      await cachedGetIssueComments('owner', 'repo', 1)
      await cachedGetIssueComments('owner', 'repo', 1)
      expect(getIssueComments).toHaveBeenCalledTimes(1)
    })
  })

  describe('invalidateCache', () => {
    it('clears all cache when no key provided', async () => {
      await cachedGetPRDetail('owner', 'repo', 1)
      invalidateCache()
      await cachedGetPRDetail('owner', 'repo', 1)
      expect(getPRDetail).toHaveBeenCalledTimes(2)
    })

    it('clears specific cache entry when key provided', async () => {
      await cachedGetPRDetail('owner', 'repo', 1)
      await cachedGetPRFiles('owner', 'repo', 1)
      invalidateCache('detail:owner/repo#1')
      await cachedGetPRDetail('owner', 'repo', 1)
      await cachedGetPRFiles('owner', 'repo', 1) // Should still be cached
      expect(getPRDetail).toHaveBeenCalledTimes(2)
      expect(getPRFiles).toHaveBeenCalledTimes(1)
    })
  })

  describe('invalidatePRCache', () => {
    it('clears all cache entries for a specific PR', async () => {
      await cachedGetPRDetail('owner', 'repo', 1)
      await cachedGetPRFiles('owner', 'repo', 1)
      await cachedGetReviews('owner', 'repo', 1)
      invalidatePRCache('owner', 'repo', 1)
      await cachedGetPRDetail('owner', 'repo', 1)
      await cachedGetPRFiles('owner', 'repo', 1)
      await cachedGetReviews('owner', 'repo', 1)
      expect(getPRDetail).toHaveBeenCalledTimes(2)
      expect(getPRFiles).toHaveBeenCalledTimes(2)
      expect(getReviews).toHaveBeenCalledTimes(2)
    })

    it('does not clear entries for other PRs', async () => {
      await cachedGetPRDetail('owner', 'repo', 1)
      await cachedGetPRDetail('owner', 'repo', 2)
      invalidatePRCache('owner', 'repo', 1)
      await cachedGetPRDetail('owner', 'repo', 2)
      // PR #2 should still be cached
      expect(getPRDetail).toHaveBeenCalledTimes(2) // Only initial calls
    })
  })
})
