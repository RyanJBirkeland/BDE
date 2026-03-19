import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../config', () => ({
  getGitHubToken: vi.fn(),
}))

import { authenticatedGitHubFetch } from '../github-fetch'
import { getGitHubToken } from '../config'

function mockResponse(status: number, body: unknown = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('fetch', vi.fn())
})

describe('authenticatedGitHubFetch', () => {
  it('makes authenticated request with token from config', async () => {
    vi.mocked(getGitHubToken).mockReturnValue('token-A')
    vi.mocked(fetch).mockResolvedValue(mockResponse(200, { data: 'ok' }))

    const res = await authenticatedGitHubFetch('https://api.github.com/repos/o/r/pulls')

    expect(res.status).toBe(200)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch).toHaveBeenCalledWith(
      'https://api.github.com/repos/o/r/pulls',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer token-A',
          Accept: 'application/vnd.github+json',
        }),
      })
    )
  })

  it('throws when no token is configured', async () => {
    vi.mocked(getGitHubToken).mockReturnValue(null)

    await expect(
      authenticatedGitHubFetch('https://api.github.com/repos/o/r/pulls')
    ).rejects.toThrow('GitHub token not configured')

    expect(fetch).not.toHaveBeenCalled()
  })

  it('retries once with fresh token on 401 when token changed', async () => {
    vi.mocked(getGitHubToken)
      .mockReturnValueOnce('stale-token')
      .mockReturnValueOnce('fresh-token')
    vi.mocked(fetch)
      .mockResolvedValueOnce(mockResponse(401))
      .mockResolvedValueOnce(mockResponse(200, { retried: true }))

    const res = await authenticatedGitHubFetch('https://api.github.com/repos/o/r/pulls')

    expect(res.status).toBe(200)
    expect(fetch).toHaveBeenCalledTimes(2)
    // First call with stale token
    expect(fetch).toHaveBeenNthCalledWith(
      1,
      'https://api.github.com/repos/o/r/pulls',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer stale-token' }),
      })
    )
    // Retry with fresh token
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      'https://api.github.com/repos/o/r/pulls',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer fresh-token' }),
      })
    )
  })

  it('does not retry on 401 when token is unchanged', async () => {
    vi.mocked(getGitHubToken).mockReturnValue('same-token')
    vi.mocked(fetch).mockResolvedValue(mockResponse(401))

    const res = await authenticatedGitHubFetch('https://api.github.com/repos/o/r/pulls')

    expect(res.status).toBe(401)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('does not retry on 401 when fresh token is null', async () => {
    vi.mocked(getGitHubToken)
      .mockReturnValueOnce('old-token')
      .mockReturnValueOnce(null)
    vi.mocked(fetch).mockResolvedValue(mockResponse(401))

    const res = await authenticatedGitHubFetch('https://api.github.com/repos/o/r/pulls')

    expect(res.status).toBe(401)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('does not retry on non-401 errors', async () => {
    vi.mocked(getGitHubToken).mockReturnValue('token')
    vi.mocked(fetch).mockResolvedValue(mockResponse(403))

    const res = await authenticatedGitHubFetch('https://api.github.com/repos/o/r/pulls')

    expect(res.status).toBe(403)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('passes custom method, headers, and body', async () => {
    vi.mocked(getGitHubToken).mockReturnValue('token')
    vi.mocked(fetch).mockResolvedValue(mockResponse(200))

    await authenticatedGitHubFetch('https://api.github.com/repos/o/r/pulls/1/merge', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ merge_method: 'squash' }),
    })

    expect(fetch).toHaveBeenCalledWith(
      'https://api.github.com/repos/o/r/pulls/1/merge',
      expect.objectContaining({
        method: 'PUT',
        body: '{"merge_method":"squash"}',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          Authorization: 'Bearer token',
        }),
      })
    )
  })

  it('uses custom timeout when provided', async () => {
    vi.mocked(getGitHubToken).mockReturnValue('token')
    vi.mocked(fetch).mockResolvedValue(mockResponse(200))

    await authenticatedGitHubFetch('https://api.github.com/test', { timeoutMs: 5_000 })

    const callArgs = vi.mocked(fetch).mock.calls[0][1] as RequestInit
    expect(callArgs.signal).toBeDefined()
  })
})
