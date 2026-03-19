import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ---------------------------------------------------------------------------
// Electron mock
// ---------------------------------------------------------------------------
const mockSend = vi.fn()

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: vi.fn(() => [{ id: 1, webContents: { send: mockSend } }]),
  },
}))

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------
import {
  githubFetch,
  parseRateLimitHeaders,
  computeBackoffMs,
  _resetRateLimitState,
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
    headers: new Headers(headerMap),
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
      'retry-after': '60',
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
          'x-ratelimit-reset': '1700000000',
        })
      )
    )

    const res = await githubFetch('https://api.github.com/repos/o/r', {
      headers: { Authorization: 'Bearer tok' },
    })

    expect(res.status).toBe(200)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('retries on 403 with x-ratelimit-remaining: 0 and respects Retry-After', async () => {
    const rateLimitedResponse = mockResponse(403, {
      'x-ratelimit-remaining': '0',
      'x-ratelimit-limit': '5000',
      'x-ratelimit-reset': '1700000000',
      'retry-after': '1',
    }, '{"message":"API rate limit exceeded"}')

    const okResponse = mockResponse(200, {
      'x-ratelimit-remaining': '4999',
      'x-ratelimit-limit': '5000',
      'x-ratelimit-reset': '1700000000',
    })

    vi.stubGlobal(
      'fetch',
      vi.fn()
        .mockResolvedValueOnce(rateLimitedResponse)
        .mockResolvedValueOnce(okResponse)
    )

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const [res] = await Promise.all([
      githubFetch('https://api.github.com/test', {
        headers: { Authorization: 'Bearer tok' },
        timeoutMs: 10_000,
      }),
      vi.runAllTimersAsync(),
    ])

    expect(res.status).toBe(200)
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Rate limited')
    )
    warnSpy.mockRestore()
  })

  it('retries on 5xx server errors with exponential backoff', async () => {
    const serverError = mockResponse(502, {
      'x-ratelimit-remaining': '4000',
      'x-ratelimit-limit': '5000',
      'x-ratelimit-reset': '1700000000',
    })

    const okResponse = mockResponse(200, {
      'x-ratelimit-remaining': '3999',
      'x-ratelimit-limit': '5000',
      'x-ratelimit-reset': '1700000000',
    })

    vi.stubGlobal(
      'fetch',
      vi.fn()
        .mockResolvedValueOnce(serverError)
        .mockResolvedValueOnce(okResponse)
    )

    vi.spyOn(console, 'warn').mockImplementation(() => {})

    const [res] = await Promise.all([
      githubFetch('https://api.github.com/test', {
        headers: { Authorization: 'Bearer tok' },
      }),
      vi.runAllTimersAsync(),
    ])

    expect(res.status).toBe(200)
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('returns last response after exhausting retries', async () => {
    const serverError = mockResponse(503, {
      'x-ratelimit-remaining': '4000',
      'x-ratelimit-limit': '5000',
      'x-ratelimit-reset': '1700000000',
    })

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(serverError))
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    const [res] = await Promise.all([
      githubFetch('https://api.github.com/test', {
        headers: { Authorization: 'Bearer tok' },
      }),
      vi.runAllTimersAsync(),
    ])

    expect(res.status).toBe(503)
    // MAX_RETRIES = 3 → 4 total attempts (0, 1, 2, 3)
    expect(fetch).toHaveBeenCalledTimes(4)
  })

  it('does not retry 403 when x-ratelimit-remaining is > 0 (not a rate limit)', async () => {
    const forbidden = mockResponse(403, {
      'x-ratelimit-remaining': '4999',
      'x-ratelimit-limit': '5000',
      'x-ratelimit-reset': '1700000000',
    }, '{"message":"Resource not accessible by integration"}')

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(forbidden))

    const res = await githubFetch('https://api.github.com/test', {
      headers: { Authorization: 'Bearer tok' },
    })

    expect(res.status).toBe(403)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('does not retry 4xx errors other than rate-limit 403', async () => {
    const notFound = mockResponse(404, {
      'x-ratelimit-remaining': '4000',
      'x-ratelimit-limit': '5000',
      'x-ratelimit-reset': '1700000000',
    })

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(notFound))

    const res = await githubFetch('https://api.github.com/test', {
      headers: { Authorization: 'Bearer tok' },
    })

    expect(res.status).toBe(404)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('broadcasts rate-limit warning when remaining drops below threshold', async () => {
    const lowLimitResponse = mockResponse(200, {
      'x-ratelimit-remaining': '50',
      'x-ratelimit-limit': '5000',
      'x-ratelimit-reset': '1700000000',
    })

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(lowLimitResponse))
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    await githubFetch('https://api.github.com/test', {
      headers: { Authorization: 'Bearer tok' },
    })

    expect(mockSend).toHaveBeenCalledWith('github:rate-limit-warning', {
      remaining: 50,
      limit: 5000,
      resetEpoch: 1700000000,
    })
  })

  it('does not broadcast warning when remaining is above threshold', async () => {
    const healthyResponse = mockResponse(200, {
      'x-ratelimit-remaining': '4500',
      'x-ratelimit-limit': '5000',
      'x-ratelimit-reset': '1700000000',
    })

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(healthyResponse))

    await githubFetch('https://api.github.com/test', {
      headers: { Authorization: 'Bearer tok' },
    })

    expect(mockSend).not.toHaveBeenCalled()
  })

  it('only emits the warning once per rate-limit window', async () => {
    const lowLimit = mockResponse(200, {
      'x-ratelimit-remaining': '50',
      'x-ratelimit-limit': '5000',
      'x-ratelimit-reset': '1700000000',
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
          'x-ratelimit-reset': '1700000000',
        })
      )
    )

    await githubFetch('https://api.github.com/test', { timeoutMs: 15_000 })

    expect(timeoutSpy).toHaveBeenCalledWith(15_000)
    timeoutSpy.mockRestore()
  })
})
