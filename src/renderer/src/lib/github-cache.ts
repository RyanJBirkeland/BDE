/**
 * Simple TTL cache for GitHub API responses.
 * Reduces redundant fetches when switching between PRs or re-rendering.
 */
import {
  getPRDetail,
  getPRFiles,
  getReviews,
  getReviewComments,
  getIssueComments,
  type PRDetail,
  type PRFile
} from './github-api'
import type { PrReview, PrComment, PrIssueComment } from '../../../shared/types'

interface CacheEntry {
  data: unknown
  expiry: number
  lastAccessed: number
}

const cache = new Map<string, CacheEntry>()

const TTL_DETAIL = 30_000 // 30s for detail, files, reviews
const TTL_COMMENTS = 30_000 // 30s for comments
const MAX_CACHE_ENTRIES = 200 // LRU eviction threshold

function get<T>(key: string): T | undefined {
  const entry = cache.get(key)
  if (!entry) return undefined
  if (Date.now() > entry.expiry) {
    cache.delete(key)
    return undefined
  }
  // Update access time for LRU
  entry.lastAccessed = Date.now()
  return entry.data as T
}

function set(key: string, data: unknown, ttl: number): void {
  // Evict least recently used entries if cache is full
  if (cache.size >= MAX_CACHE_ENTRIES) {
    let oldestKey: string | null = null
    let oldestTime = Infinity
    for (const [k, v] of cache.entries()) {
      if (v.lastAccessed < oldestTime) {
        oldestTime = v.lastAccessed
        oldestKey = k
      }
    }
    if (oldestKey) cache.delete(oldestKey)
  }

  const now = Date.now()
  cache.set(key, { data, expiry: now + ttl, lastAccessed: now })
}

/**
 * Invalidate cache entries. If no key is provided, clears all entries.
 */
export function invalidateCache(key?: string): void {
  if (key) {
    cache.delete(key)
  } else {
    cache.clear()
  }
}

/**
 * Invalidate all cache entries for a specific PR.
 * Call this after mutations like merge, close, or review submission.
 */
export function invalidatePRCache(owner: string, repo: string, number: number): void {
  const prefix = `${owner}/${repo}#${number}`
  // Delete all keys matching this PR (use startsWith after first colon to avoid over-matching)
  for (const key of cache.keys()) {
    const colonIndex = key.indexOf(':')
    if (colonIndex !== -1 && key.substring(colonIndex + 1) === prefix) {
      cache.delete(key)
    }
  }
}

function makeKey(fn: string, owner: string, repo: string, id: number): string {
  return `${fn}:${owner}/${repo}#${id}`
}

export async function cachedGetPRDetail(
  owner: string,
  repo: string,
  number: number
): Promise<PRDetail> {
  const key = makeKey('detail', owner, repo, number)
  const cached = get<PRDetail>(key)
  if (cached) return cached
  const result = await getPRDetail(owner, repo, number)
  set(key, result, TTL_DETAIL)
  return result
}

export async function cachedGetPRFiles(
  owner: string,
  repo: string,
  number: number
): Promise<PRFile[]> {
  const key = makeKey('files', owner, repo, number)
  const cached = get<PRFile[]>(key)
  if (cached) return cached
  const result = await getPRFiles(owner, repo, number)
  set(key, result, TTL_DETAIL)
  return result
}

export async function cachedGetReviews(
  owner: string,
  repo: string,
  number: number
): Promise<PrReview[]> {
  const key = makeKey('reviews', owner, repo, number)
  const cached = get<PrReview[]>(key)
  if (cached) return cached
  const result = await getReviews(owner, repo, number)
  set(key, result, TTL_DETAIL)
  return result
}

export async function cachedGetReviewComments(
  owner: string,
  repo: string,
  number: number
): Promise<PrComment[]> {
  const key = makeKey('reviewComments', owner, repo, number)
  const cached = get<PrComment[]>(key)
  if (cached) return cached
  const result = await getReviewComments(owner, repo, number)
  set(key, result, TTL_COMMENTS)
  return result
}

export async function cachedGetIssueComments(
  owner: string,
  repo: string,
  number: number
): Promise<PrIssueComment[]> {
  const key = makeKey('issueComments', owner, repo, number)
  const cached = get<PrIssueComment[]>(key)
  if (cached) return cached
  const result = await getIssueComments(owner, repo, number)
  set(key, result, TTL_COMMENTS)
  return result
}
