import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ---------------------------------------------------------------------------
// Electron mock
// ---------------------------------------------------------------------------
const mockSend = vi.fn()

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: vi.fn(() => [{ id: 1, webContents: { send: mockSend } }])
  }
}))

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------
import {
  githubFetch,
  githubFetchJson,
  classifyHttpError,
  classifyNetworkError,
  parseRateLimitHeaders,
  computeBackoffMs,
  _resetRateLimitState,
  parseNextLink,
  fetchAllGitHubPages
} from '../github-fetch'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function headersFrom(map: Record<string, string>): Headers {
  return new Headers(map)
}

/** Build a minimal mock Response with the given status and headers. */
function mockResponse(
  status: number,
  headerMap: Record<string, string> = {},
  body = '{}'
): Response {
  return new Response(body, {
    status,
    headers: new Headers(headerMap)
  })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.useFakeTimers()
  vi.restoreAllMocks()
  mockSend.mockReset()
  _resetRateLimitState()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('parseRateLimitHeaders', () => {
  it('extracts all rate-limit headers', () => {
    const h = headersFrom({
      'x-ratelimit-remaining': '42',
      'x-ratelimit-limit': '5000',
      'x-ratelimit-reset': '1700000000',
      'retry-after': '60'
    })
    const rl = parseRateLimitHeaders(h)
    expect(rl.remaining).toBe(42)
    expect(rl.limit).toBe(5000)
    expect(rl.resetEpoch).toBe(1700000000)
    expect(rl.retryAfterMs).toBe(60_000)
  })

  it('returns null for missing headers', () => {
    const rl = parseRateLimitHeaders(headersFrom({}))
    expect(rl.remaining).toBeNull()
    expect(rl.limit).toBeNull()
    expect(rl.resetEpoch).toBeNull()
    expect(rl.retryAfterMs).toBeNull()
  })
})

describe('computeBackoffMs', () => {
  it('increases exponentially with attempt number', () => {
    // attempt 0: base * 2^0 = 1000, plus 0-1000 jitter → [1000, 2000]
    // attempt 2: base * 2^2 = 4000, plus jitter → [4000, 5000]
    const a0 = computeBackoffMs(0)
    const a2 = computeBackoffMs(2)
    expect(a0).toBeGreaterThanOrEqual(1_000)
    expect(a0).toBeLessThanOrEqual(2_000)
    expect(a2).toBeGreaterThanOrEqual(4_000)
    expect(a2).toBeLessThanOrEqual(5_000)
  })

  it('caps at MAX_BACKOFF_MS (30s)', () => {
    const val = computeBackoffMs(20) // 2^20 is huge
    expect(val).toBeLessThanOrEqual(30_000)
  })
})

describe('githubFetch', () => {
  it('returns a successful response on first try', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        mockResponse(200, {
          'x-ratelimit-remaining': '4999',
          'x-ratelimit-limit': '5000',
          'x-ratelimit-reset': '1700000000'
        })
      )
    )

    const res = await githubFetch('https://api.github.com/repos/o/r', {
      headers: { Authorization: 'Bearer tok' }
    })

    expect(res.status).toBe(200)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('retries on 403 with x-ratelimit-remaining: 0 and respects Retry-After', async () => {
    const rateLimitedResponse = mockResponse(
      403,
      {
        'x-ratelimit-remaining': '0',
        'x-ratelimit-limit': '5000',
        'x-ratelimit-reset': '1700000000',
        'retry-after': '1'
      },
      '{"message":"API rate limit exceeded"}'
    )

    const okResponse = mockResponse(200, {
      'x-ratelimit-remaining': '4999',
      'x-ratelimit-limit': '5000',
      'x-ratelimit-reset': '1700000000'
    })

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(rateLimitedResponse).mockResolvedValueOnce(okResponse)
    )

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const [res] = await Promise.all([
      githubFetch('https://api.github.com/test', {
        headers: { Authorization: 'Bearer tok' },
        timeoutMs: 10_000
      }),
      vi.runAllTimersAsync()
    ])

    expect(res.status).toBe(200)
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[github-fetch]'),
      expect.stringContaining('Rate limited')
    )
    warnSpy.mockRestore()
  })

  it('retries on 5xx server errors with exponential backoff', async () => {
    const serverError = mockResponse(502, {
      'x-ratelimit-remaining': '4000',
      'x-ratelimit-limit': '5000',
      'x-ratelimit-reset': '1700000000'
    })

    const okResponse = mockResponse(200, {
      'x-ratelimit-remaining': '3999',
      'x-ratelimit-limit': '5000',
      'x-ratelimit-reset': '1700000000'
    })

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(serverError).mockResolvedValueOnce(okResponse)
    )

    vi.spyOn(console, 'warn').mockImplementation(() => {})

    const [res] = await Promise.all([
      githubFetch('https://api.github.com/test', {
        headers: { Authorization: 'Bearer tok' }
      }),
      vi.runAllTimersAsync()
    ])

    expect(res.status).toBe(200)
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('returns last response after exhausting retries', async () => {
    const serverError = mockResponse(503, {
      'x-ratelimit-remaining': '4000',
      'x-ratelimit-limit': '5000',
      'x-ratelimit-reset': '1700000000'
    })

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(serverError))
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    const [res] = await Promise.all([
      githubFetch('https://api.github.com/test', {
        headers: { Authorization: 'Bearer tok' }
      }),
      vi.runAllTimersAsync()
    ])

    expect(res.status).toBe(503)
    // MAX_RETRIES = 3 → 4 total attempts (0, 1, 2, 3)
    expect(fetch).toHaveBeenCalledTimes(4)
  })

  it('does not retry 403 when x-ratelimit-remaining is > 0 (not a rate limit)', async () => {
    const forbidden = mockResponse(
      403,
      {
        'x-ratelimit-remaining': '4999',
        'x-ratelimit-limit': '5000',
        'x-ratelimit-reset': '1700000000'
      },
      '{"message":"Resource not accessible by integration"}'
    )

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(forbidden))

    const res = await githubFetch('https://api.github.com/test', {
      headers: { Authorization: 'Bearer tok' }
    })

    expect(res.status).toBe(403)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('does not retry 4xx errors other than rate-limit 403', async () => {
    const notFound = mockResponse(404, {
      'x-ratelimit-remaining': '4000',
      'x-ratelimit-limit': '5000',
      'x-ratelimit-reset': '1700000000'
    })

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(notFound))

    const res = await githubFetch('https://api.github.com/test', {
      headers: { Authorization: 'Bearer tok' }
    })

    expect(res.status).toBe(404)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('broadcasts rate-limit warning via github:error when remaining drops below threshold', async () => {
    const lowLimitResponse = mockResponse(200, {
      'x-ratelimit-remaining': '50',
      'x-ratelimit-limit': '5000',
      'x-ratelimit-reset': '1700000000'
    })

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(lowLimitResponse))
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    await githubFetch('https://api.github.com/test', {
      headers: { Authorization: 'Bearer tok' }
    })

    // Pre-formatted message includes remaining/limit and UTC reset time
    // (1700000000 → 2023-11-14T22:13:20Z → "22:13 UTC").
    expect(mockSend).toHaveBeenCalledWith(
      'github:error',
      expect.objectContaining({
        kind: 'rate-limit',
        status: 403,
        message: expect.stringMatching(/50\/5000.*Resets at \d{2}:\d{2} UTC/)
      })
    )
  })

  it('broadcasts token-expired via github:error on 401 response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        mockResponse(401, {
          'x-ratelimit-remaining': '4999',
          'x-ratelimit-limit': '5000',
          'x-ratelimit-reset': '1700000000'
        })
      )
    )
    vi.spyOn(console, 'error').mockImplementation(() => {})

    await githubFetch('https://api.github.com/test', {
      headers: { Authorization: 'Bearer bad-token' }
    })

    expect(mockSend).toHaveBeenCalledWith(
      'github:error',
      expect.objectContaining({
        kind: 'token-expired',
        status: 401,
        message: expect.stringContaining('Settings')
      })
    )
  })

  it('only emits token-expired broadcast once per session', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        mockResponse(401, {
          'x-ratelimit-remaining': '4999',
          'x-ratelimit-limit': '5000',
          'x-ratelimit-reset': '1700000000'
        })
      )
    )
    vi.spyOn(console, 'error').mockImplementation(() => {})

    await githubFetch('https://api.github.com/test1')
    await githubFetch('https://api.github.com/test2')

    // Count only token-expired broadcasts (ignore any rate-limit noise)
    const tokenExpiredCalls = mockSend.mock.calls.filter(
      ([channel, payload]) =>
        channel === 'github:error' && (payload as { kind: string }).kind === 'token-expired'
    )
    expect(tokenExpiredCalls).toHaveLength(1)
  })

  it('does not broadcast warning when remaining is above threshold', async () => {
    const healthyResponse = mockResponse(200, {
      'x-ratelimit-remaining': '4500',
      'x-ratelimit-limit': '5000',
      'x-ratelimit-reset': '1700000000'
    })

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(healthyResponse))

    await githubFetch('https://api.github.com/test', {
      headers: { Authorization: 'Bearer tok' }
    })

    expect(mockSend).not.toHaveBeenCalled()
  })

  it('only emits the warning once per rate-limit window', async () => {
    const lowLimit = mockResponse(200, {
      'x-ratelimit-remaining': '50',
      'x-ratelimit-limit': '5000',
      'x-ratelimit-reset': '1700000000'
    })

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(lowLimit))
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    await githubFetch('https://api.github.com/test1')
    await githubFetch('https://api.github.com/test2')

    // Should only emit once despite two calls
    expect(mockSend).toHaveBeenCalledTimes(1)
  })

  it('passes timeoutMs as AbortSignal.timeout to fetch', async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout')
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        mockResponse(200, {
          'x-ratelimit-remaining': '5000',
          'x-ratelimit-limit': '5000',
          'x-ratelimit-reset': '1700000000'
        })
      )
    )

    await githubFetch('https://api.github.com/test', { timeoutMs: 15_000 })

    expect(timeoutSpy).toHaveBeenCalledWith(15_000)
    timeoutSpy.mockRestore()
  })
})

describe('parseNextLink', () => {
  it('extracts the next URL from a Link header', () => {
    const header =
      '<https://api.github.com/repos/o/r/pulls?page=2&per_page=100>; rel="next", ' +
      '<https://api.github.com/repos/o/r/pulls?page=5&per_page=100>; rel="last"'
    expect(parseNextLink(header)).toBe('https://api.github.com/repos/o/r/pulls?page=2&per_page=100')
  })

  it('returns null when there is no next link', () => {
    const header = '<https://api.github.com/repos/o/r/pulls?page=1&per_page=100>; rel="prev"'
    expect(parseNextLink(header)).toBeNull()
  })

  it('returns null for null input', () => {
    expect(parseNextLink(null)).toBeNull()
  })

  it('returns null for empty string', () => {
    expect(parseNextLink('')).toBeNull()
  })
})

describe('fetchAllGitHubPages', () => {
  const mockFetch = vi.fn()

  beforeEach(() => {
    mockFetch.mockReset()
    vi.stubGlobal('fetch', mockFetch)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function jsonResponse(body: unknown, linkNext: string | null = null, ok = true, status = 200) {
    const headers = new Map<string, string>()
    if (linkNext) {
      headers.set('Link', `<${linkNext}>; rel="next"`)
    }
    return {
      ok,
      status,
      json: async () => body,
      headers: { get: (name: string) => headers.get(name) ?? null }
    }
  }

  it('returns all items from a single page', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse([{ id: 1 }, { id: 2 }]))

    const result = await fetchAllGitHubPages<{ id: number }>(
      'https://api.github.com/repos/o/r/pulls?per_page=100',
      { token: 'tok' }
    )

    expect(result).toEqual([{ id: 1 }, { id: 2 }])
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('follows pagination across multiple pages', async () => {
    mockFetch
      .mockResolvedValueOnce(
        jsonResponse([{ id: 1 }], 'https://api.github.com/repos/o/r/pulls?per_page=100&page=2')
      )
      .mockResolvedValueOnce(
        jsonResponse([{ id: 2 }], 'https://api.github.com/repos/o/r/pulls?per_page=100&page=3')
      )
      .mockResolvedValueOnce(jsonResponse([{ id: 3 }]))

    const result = await fetchAllGitHubPages<{ id: number }>(
      'https://api.github.com/repos/o/r/pulls?per_page=100',
      { token: 'tok' }
    )

    expect(result).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }])
    expect(mockFetch).toHaveBeenCalledTimes(3)
  })

  it('returns partial results when a mid-page request fails', async () => {
    // Use 404 (non-retryable) to avoid githubFetch retry delays
    mockFetch
      .mockResolvedValueOnce(
        jsonResponse([{ id: 1 }], 'https://api.github.com/repos/repos/o/r/pulls?page=2')
      )
      .mockResolvedValueOnce(jsonResponse(null, null, false, 404))

    const result = await fetchAllGitHubPages<{ id: number }>(
      'https://api.github.com/repos/o/r/pulls?per_page=100',
      { token: 'tok' }
    )

    expect(result).toEqual([{ id: 1 }])
  })

  it('returns empty array when first page fails', async () => {
    // Use 404 (non-retryable) to avoid githubFetch retry delays
    mockFetch.mockResolvedValueOnce(jsonResponse(null, null, false, 404))

    const result = await fetchAllGitHubPages<{ id: number }>(
      'https://api.github.com/repos/o/r/pulls?per_page=100',
      { token: 'tok' }
    )

    expect(result).toEqual([])
  })

  it('sends Authorization header with the provided token', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse([]))

    await fetchAllGitHubPages('https://api.github.com/repos/o/r/pulls?per_page=100', {
      token: 'ghp_secret'
    })

    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.github.com/repos/o/r/pulls?per_page=100',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer ghp_secret',
          Accept: 'application/vnd.github+json'
        })
      })
    )
  })
})

// ---------------------------------------------------------------------------
// Structured error classification (shared with renderer via broadcast)
// ---------------------------------------------------------------------------

describe('classifyHttpError', () => {
  it('classifies 401 as token-expired', () => {
    const res = mockResponse(401)
    const err = classifyHttpError(res, '')
    expect(err.kind).toBe('token-expired')
    expect(err.retryable).toBe(false)
    expect(err.status).toBe(401)
  })

  it('classifies 403 with x-ratelimit-remaining=0 as rate-limit', () => {
    const res = mockResponse(403, { 'x-ratelimit-remaining': '0' })
    const err = classifyHttpError(res, '')
    expect(err.kind).toBe('rate-limit')
    expect(err.retryable).toBe(true)
  })

  it('classifies 403 with billing keywords in body as billing', () => {
    const res = mockResponse(403, {})
    const body =
      'The job was not started because recent account payments have failed or your spending limit needs to be increased.'
    const err = classifyHttpError(res, body)
    expect(err.kind).toBe('billing')
    expect(err.retryable).toBe(false)
    expect(err.message.toLowerCase()).toContain('billing')
  })

  it('classifies 403 with no rate-limit header and no billing keywords as permission', () => {
    const res = mockResponse(403, {})
    const err = classifyHttpError(res, 'Resource not accessible by integration')
    expect(err.kind).toBe('permission')
    expect(err.retryable).toBe(false)
  })

  it('classifies 404 as not-found', () => {
    const res = mockResponse(404)
    const err = classifyHttpError(res, '')
    expect(err.kind).toBe('not-found')
    expect(err.retryable).toBe(false)
  })

  it('classifies 422 as validation', () => {
    const res = mockResponse(422)
    const err = classifyHttpError(res, '{"message":"Validation Failed"}')
    expect(err.kind).toBe('validation')
    expect(err.retryable).toBe(false)
  })

  it('classifies 5xx as server (retryable)', () => {
    const res = mockResponse(503)
    const err = classifyHttpError(res, '')
    expect(err.kind).toBe('server')
    expect(err.retryable).toBe(true)
    expect(err.status).toBe(503)
  })

  it('classifies unrecognized status as unknown', () => {
    const res = mockResponse(418)
    const err = classifyHttpError(res, '')
    expect(err.kind).toBe('unknown')
    expect(err.status).toBe(418)
  })
})

describe('classifyNetworkError', () => {
  it('classifies AbortError (fetch timeout) as network + retryable', () => {
    const abortErr = new Error('timed out')
    abortErr.name = 'AbortError'
    const err = classifyNetworkError(abortErr)
    expect(err.kind).toBe('network')
    expect(err.retryable).toBe(true)
    expect(err.message.toLowerCase()).toContain('time')
  })

  it('classifies ECONNREFUSED as network + retryable', () => {
    const err = classifyNetworkError(new Error('connect ECONNREFUSED 127.0.0.1:443'))
    expect(err.kind).toBe('network')
    expect(err.retryable).toBe(true)
    expect(err.message).toContain('ECONNREFUSED')
  })

  it('classifies ENOTFOUND (DNS failure) as network + retryable', () => {
    const err = classifyNetworkError(new Error('getaddrinfo ENOTFOUND api.github.com'))
    expect(err.kind).toBe('network')
    expect(err.retryable).toBe(true)
  })

  it('classifies unknown throwable as network (not unknown — fetch failures are always network)', () => {
    const err = classifyNetworkError(new Error('something weird'))
    expect(err.kind).toBe('network')
    expect(err.retryable).toBe(true)
  })
})

describe('githubFetchJson', () => {
  it('returns ok:false with kind=no-token when token is null', async () => {
    const result = await githubFetchJson<{ foo: string }>('https://api.github.com/x', null)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.kind).toBe('no-token')
    }
  })

  it('returns ok:true with parsed JSON on 200 response', async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce(
      new Response('{"name":"repo","stars":42}', {
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' })
      })
    )
    vi.stubGlobal('fetch', mockFetch)

    const result = await githubFetchJson<{ name: string; stars: number }>(
      'https://api.github.com/repos/o/r',
      'ghp_token'
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.name).toBe('repo')
      expect(result.data.stars).toBe(42)
    }
    vi.unstubAllGlobals()
  })

  it('returns ok:false with classified http error on non-ok response', async () => {
    const body = 'The job was not started because recent account payments have failed.'
    const mockFetch = vi.fn().mockResolvedValueOnce(new Response(body, { status: 403 }))
    vi.stubGlobal('fetch', mockFetch)

    const result = await githubFetchJson<unknown>('https://api.github.com/x', 'ghp_token')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.kind).toBe('billing')
      expect(result.error.status).toBe(403)
    }
    vi.unstubAllGlobals()
  })

  it('returns ok:false with kind=network when fetch throws', async () => {
    const mockFetch = vi.fn().mockRejectedValueOnce(new Error('connect ECONNREFUSED 127.0.0.1:443'))
    vi.stubGlobal('fetch', mockFetch)

    const result = await githubFetchJson<unknown>('https://api.github.com/x', 'ghp_token')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.kind).toBe('network')
      expect(result.error.retryable).toBe(true)
    }
    vi.unstubAllGlobals()
  })
})
