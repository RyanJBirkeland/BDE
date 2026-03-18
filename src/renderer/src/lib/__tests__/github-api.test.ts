import { describe, it, expect, vi, beforeEach } from 'vitest'

// --- Mock window.api.getGitHubToken ---
const getGitHubToken = vi.fn<() => Promise<string | null>>()

Object.defineProperty(globalThis, 'window', {
  value: { api: { getGitHubToken } },
  writable: true
})

// --- Mock global fetch ---
const mockFetch = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
globalThis.fetch = mockFetch as typeof globalThis.fetch

import { clearCachedToken, listOpenPRs } from '../github-api'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  })
}

beforeEach(() => {
  clearCachedToken()
  vi.resetAllMocks()
})

describe('github-api token caching', () => {
  it('caches the token across calls', async () => {
    getGitHubToken.mockResolvedValue('token-a')
    mockFetch.mockImplementation(() => Promise.resolve(jsonResponse([])))

    await listOpenPRs('o', 'r')
    await listOpenPRs('o', 'r')

    expect(getGitHubToken).toHaveBeenCalledTimes(1)
  })

  it('clearCachedToken forces a fresh token on next call', async () => {
    getGitHubToken.mockResolvedValueOnce('old').mockResolvedValueOnce('new')
    mockFetch.mockImplementation(() => Promise.resolve(jsonResponse([])))

    await listOpenPRs('o', 'r')
    clearCachedToken()
    await listOpenPRs('o', 'r')

    expect(getGitHubToken).toHaveBeenCalledTimes(2)
  })
})

describe('github-api 401 retry', () => {
  it('clears token and retries once on 401', async () => {
    getGitHubToken.mockResolvedValueOnce('stale').mockResolvedValueOnce('fresh')
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ message: 'Bad credentials' }, 401))
      .mockResolvedValueOnce(jsonResponse([{ number: 1, title: 'PR', html_url: '', state: 'open', draft: false, created_at: '', updated_at: '', head: { ref: 'b', sha: 'abc' }, base: { ref: 'main' }, user: { login: 'u' }, additions: 0, deletions: 0 }]))

    const prs = await listOpenPRs('o', 'r')

    expect(prs).toHaveLength(1)
    expect(getGitHubToken).toHaveBeenCalledTimes(2)
    expect(mockFetch).toHaveBeenCalledTimes(2)

    // Second call should use fresh token
    const secondCallHeaders = (mockFetch.mock.calls[1][1] as RequestInit).headers as Record<string, string>
    expect(secondCallHeaders.Authorization).toBe('Bearer fresh')
  })

  it('does not retry more than once on repeated 401', async () => {
    getGitHubToken.mockResolvedValueOnce('stale').mockResolvedValueOnce('also-stale')
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ message: 'Bad credentials' }, 401))
      .mockResolvedValueOnce(jsonResponse({ message: 'Bad credentials' }, 401))

    await expect(listOpenPRs('o', 'r')).rejects.toThrow('GitHub API error: 401')
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it('does not retry on non-401 errors', async () => {
    getGitHubToken.mockResolvedValue('token')
    mockFetch.mockResolvedValue(jsonResponse({ message: 'Not Found' }, 404))

    await expect(listOpenPRs('o', 'r')).rejects.toThrow('GitHub API error: 404')
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })
})
