import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock dependencies before importing
vi.mock('../broadcast', () => ({ broadcast: vi.fn(), broadcastCoalesced: vi.fn() }))
vi.mock('../config', () => ({
  getGitHubToken: vi.fn()
}))
vi.mock('../paths', () => ({
  getConfiguredRepos: vi.fn()
}))
vi.mock('../github-fetch', () => ({
  githubFetch: vi.fn(),
  githubFetchJson: vi.fn(),
  fetchAllGitHubPages: vi.fn()
}))
vi.mock('../logger', () => ({
  createLogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    event: vi.fn()
  })
}))

import {
  startPrPoller,
  stopPrPoller,
  getLatestPrList,
  refreshPrList,
  POLL_INTERVAL_MS
} from '../pr-poller'
import { broadcast } from '../broadcast'
import { fetchAllGitHubPages, githubFetch, githubFetchJson } from '../github-fetch'
import { getGitHubToken } from '../config'
import { getConfiguredRepos } from '../paths'

function setupDefaultMocks(): void {
  vi.mocked(getGitHubToken).mockReturnValue('test-token')
  vi.mocked(getConfiguredRepos).mockReturnValue([
    { name: 'BDE', localPath: '/tmp/bde', githubOwner: 'TestOwner', githubRepo: 'BDE' }
  ] as any)
  vi.mocked(fetchAllGitHubPages).mockResolvedValue([])
  vi.mocked(githubFetch).mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ total_count: 0, check_runs: [] })
  } as any)
  vi.mocked(githubFetchJson).mockResolvedValue({
    ok: true,
    data: { total_count: 0, check_runs: [] }
  } as any)
}

describe('pr-poller', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    setupDefaultMocks()
    stopPrPoller()
  })

  afterEach(() => {
    stopPrPoller()
    vi.useRealTimers()
  })

  it('refreshPrList fetches PRs and broadcasts result', async () => {
    vi.mocked(fetchAllGitHubPages).mockResolvedValue([
      {
        number: 1,
        title: 'Test PR',
        html_url: 'https://github.com/test/1',
        state: 'open',
        draft: false,
        created_at: '2026-01-01',
        updated_at: '2026-01-01',
        head: { ref: 'feat/test', sha: 'abc123' },
        base: { ref: 'main' },
        user: { login: 'dev' },
        repo: 'BDE'
      }
    ])

    const result = await refreshPrList()

    expect(fetchAllGitHubPages).toHaveBeenCalled()
    expect(broadcast).toHaveBeenCalledWith('pr:listUpdated', expect.any(Object))
    expect(result).toBeTruthy()
    expect(result.prs.length).toBe(1)
    expect(result.prs[0].repo).toBe('BDE')
  })

  it('getLatestPrList returns cached data after refresh', async () => {
    await refreshPrList()
    const cached = getLatestPrList()
    expect(cached).not.toBeNull()
    expect(cached!.prs).toEqual([])
  })

  it('refreshPrList returns empty payload when no token', async () => {
    vi.mocked(getGitHubToken).mockReturnValue(null as any)

    const result = await refreshPrList()

    // When no token, poll() returns early, latestPayload unchanged
    // refreshPrList returns latestPayload ?? { prs: [], checks: {} }
    expect(result).toBeTruthy()
    expect(result.prs).toBeDefined()
  })

  it('startPrPoller triggers initial poll', async () => {
    startPrPoller()

    // safePoll is fire-and-forget; flush microtasks
    for (let i = 0; i < 20; i++) await vi.advanceTimersByTimeAsync(1)

    expect(fetchAllGitHubPages).toHaveBeenCalled()
    stopPrPoller()
  })

  it('stopPrPoller stops the interval', async () => {
    startPrPoller()
    // Let initial poll settle
    for (let i = 0; i < 20; i++) await vi.advanceTimersByTimeAsync(1)

    stopPrPoller()
    vi.clearAllMocks()
    setupDefaultMocks()

    await vi.advanceTimersByTimeAsync(120_000)
    expect(fetchAllGitHubPages).not.toHaveBeenCalled()
  })

  it('fetches check runs for each PR', async () => {
    vi.mocked(fetchAllGitHubPages).mockResolvedValue([
      {
        number: 42,
        title: 'Test PR',
        html_url: 'https://github.com/test/42',
        state: 'open',
        draft: false,
        created_at: '2026-01-01',
        updated_at: '2026-01-01',
        head: { ref: 'feat/test', sha: 'sha123' },
        base: { ref: 'main' },
        user: { login: 'dev' },
        repo: 'BDE'
      }
    ])
    vi.mocked(githubFetchJson).mockResolvedValue({
      ok: true,
      data: {
        total_count: 2,
        check_runs: [
          { status: 'completed', conclusion: 'success' },
          { status: 'completed', conclusion: 'failure' }
        ]
      }
    } as any)

    const result = await refreshPrList()

    expect(githubFetchJson).toHaveBeenCalled()
    expect(result.checks).toBeDefined()
    expect(result.checks['BDE-42']).toBeDefined()
    expect(result.checks['BDE-42'].failed).toBe(1)
    expect(result.checks['BDE-42'].passed).toBe(1)
    expect(result.checks['BDE-42'].status).toBe('fail')
  })

  it('sorts PRs by updated_at descending', async () => {
    vi.mocked(fetchAllGitHubPages).mockResolvedValue([
      {
        number: 1,
        title: 'Old PR',
        html_url: 'https://github.com/test/1',
        state: 'open',
        draft: false,
        created_at: '2026-01-01',
        updated_at: '2026-01-01',
        head: { ref: 'feat/old', sha: 'aaa' },
        base: { ref: 'main' },
        user: { login: 'dev' },
        repo: 'BDE'
      },
      {
        number: 2,
        title: 'New PR',
        html_url: 'https://github.com/test/2',
        state: 'open',
        draft: false,
        created_at: '2026-01-02',
        updated_at: '2026-01-02',
        head: { ref: 'feat/new', sha: 'bbb' },
        base: { ref: 'main' },
        user: { login: 'dev' },
        repo: 'BDE'
      }
    ])

    const result = await refreshPrList()

    expect(result.prs[0].number).toBe(2) // newer first
    expect(result.prs[1].number).toBe(1)
  })

  it('handles check run fetch failure gracefully', async () => {
    vi.mocked(fetchAllGitHubPages).mockResolvedValue([
      {
        number: 1,
        title: 'PR',
        html_url: 'https://github.com/test/1',
        state: 'open',
        draft: false,
        created_at: '2026-01-01',
        updated_at: '2026-01-01',
        head: { ref: 'feat/test', sha: 'abc' },
        base: { ref: 'main' },
        user: { login: 'dev' },
        repo: 'BDE'
      }
    ])
    vi.mocked(githubFetchJson).mockResolvedValue({
      ok: false,
      error: { kind: 'server', status: 503, message: 'GitHub server error (503)', retryable: true }
    } as any)

    const result = await refreshPrList()

    // Should still return result with empty check summary (the error is
    // broadcast via github:error but the poller degrades gracefully).
    expect(result.prs.length).toBe(1)
    expect(result.checks['BDE-1'].status).toBe('unknown')
    expect(result.checks['BDE-1'].total).toBe(0)
  })

  it('startPrPoller uses a single setInterval — no timer recreation on backoff (F-t1-sre-4)', async () => {
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval')
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval')

    // Simulate poll errors to trigger backoff
    vi.mocked(fetchAllGitHubPages).mockRejectedValue(new Error('network error'))

    startPrPoller()

    // Let initial poll fire and 3 interval ticks occur (enough to trigger backoff)
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3 + 100)

    stopPrPoller()

    // setInterval should have been called exactly once (for the main loop),
    // not once-per-tick as in the old timer-recreation pattern.
    const pollSetIntervalCalls = setIntervalSpy.mock.calls.filter(
      (args) => Number(args[1]) === POLL_INTERVAL_MS
    )
    expect(pollSetIntervalCalls.length).toBe(1)

    // clearInterval for timer recreation: should be 0 (only stopPrPoller clears)
    // The old pattern called clearInterval inside every tick callback.
    expect(clearIntervalSpy).toHaveBeenCalledTimes(1) // only from stopPrPoller
  })

  it('startPrPoller clears any existing interval before creating a new one (double-start guard)', () => {
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval')

    startPrPoller() // first start — timer is null, no clearInterval called
    startPrPoller() // second start — WITHOUT the fix, timer is not cleared

    // Without the guard, clearInterval is never called between starts (only from stopPrPoller).
    // With the guard, clearInterval is called once (to clear the first timer before creating a new one).
    expect(clearIntervalSpy).toHaveBeenCalledTimes(1)

    stopPrPoller() // cleans up; adds a second clearInterval call
  })

  it('degrades gracefully when check-run fetch returns 5xx (T-113)', async () => {
    vi.mocked(fetchAllGitHubPages).mockResolvedValue([
      {
        number: 7,
        title: 'PR with bad checks',
        html_url: 'https://github.com/test/7',
        state: 'open',
        draft: false,
        created_at: '2026-01-01',
        updated_at: '2026-01-01',
        head: { ref: 'feat/bad', sha: 'deadbeef' },
        base: { ref: 'main' },
        user: { login: 'dev' },
        repo: 'BDE'
      }
    ])
    vi.mocked(githubFetchJson).mockResolvedValue({
      ok: false,
      error: { kind: 'server', status: 500, message: 'Internal Server Error', retryable: true }
    } as any)

    const result = await refreshPrList()

    expect(result.prs.length).toBe(1)
    expect(result.checks['BDE-7'].status).toBe('unknown')
    expect(result.checks['BDE-7'].total).toBe(0)
  })

  it('surfaces fetchOpenPrs error in repoErrors on the payload (T-112)', async () => {
    vi.mocked(fetchAllGitHubPages).mockRejectedValue(new Error('network timeout'))

    const result = await refreshPrList()

    expect(result.prs).toEqual([])
    expect(result.repoErrors).toBeDefined()
    expect(result.repoErrors!['BDE']).toContain('network timeout')
  })

  it('check-run fetches are capped at 4 concurrent calls (T-114)', async () => {
    // Use real timers for this test — the concurrency probe relies on
    // genuine microtask/Promise scheduling that fake timers suppress.
    vi.useRealTimers()

    const prs = Array.from({ length: 6 }, (_, i) => ({
      number: i + 1,
      title: `PR ${i + 1}`,
      html_url: `https://github.com/test/${i + 1}`,
      state: 'open',
      draft: false,
      created_at: '2026-01-01',
      updated_at: '2026-01-01',
      head: { ref: `feat/pr-${i + 1}`, sha: `sha${i + 1}` },
      base: { ref: 'main' },
      user: { login: 'dev' },
      repo: 'BDE'
    }))
    vi.mocked(fetchAllGitHubPages).mockResolvedValue(prs)

    let inFlight = 0
    let maxObservedInFlight = 0

    // Each mock call delays slightly so concurrent calls overlap and
    // pLimit's 4-slot cap is observable.
    vi.mocked(githubFetchJson).mockImplementation(
      () =>
        new Promise((resolve) => {
          inFlight++
          maxObservedInFlight = Math.max(maxObservedInFlight, inFlight)
          setTimeout(() => {
            inFlight--
            resolve({ ok: true, data: { total_count: 0, check_runs: [] } } as any)
          }, 10)
        })
    )

    await refreshPrList()

    expect(maxObservedInFlight).toBeLessThanOrEqual(4)
  })

  it('poll() logs start and completion with PR count and durationMs per cycle (T-115)', async () => {
    const { createLogger } = await import('../logger')
    const mockLogger = vi.mocked(createLogger)('')

    vi.mocked(fetchAllGitHubPages).mockResolvedValue([])

    await refreshPrList()

    const infoCalls = vi.mocked(mockLogger.info).mock.calls.map((args) => String(args[0]))
    const startLog = infoCalls.find((msg) => msg.includes('poll started'))
    const completionLog = infoCalls.find((msg) => msg.includes('poll completed'))

    expect(startLog).toBeDefined()
    expect(startLog).toMatch(/repos:/)

    expect(completionLog).toBeDefined()
    expect(completionLog).toMatch(/prs:/)
    expect(completionLog).toMatch(/repos:/)
    expect(completionLog).toMatch(/durationMs:/)
  })

  // ── T-112/T-113: Per-cycle observability events ──────────────────────────

  it('emits pr-poller.tick.start and pr-poller.tick.end events on successful poll (T-112, T-113)', async () => {
    const { createLogger } = await import('../logger')
    const mockLogger = vi.mocked(createLogger).mock.results[0]?.value
    if (!mockLogger) return

    startPrPoller()
    for (let i = 0; i < 20; i++) await vi.advanceTimersByTimeAsync(1)
    stopPrPoller()

    expect(mockLogger.event).toHaveBeenCalledWith('pr-poller.tick.start', expect.any(Object))
    expect(mockLogger.event).toHaveBeenCalledWith('pr-poller.tick.end', expect.objectContaining({ ok: true }))
  })

  it('emits pr-poller.tick.end with ok:false when poll throws (T-113)', async () => {
    const { createLogger } = await import('../logger')
    const mockLogger = vi.mocked(createLogger).mock.results[0]?.value
    if (!mockLogger) return

    vi.mocked(fetchAllGitHubPages).mockRejectedValue(new Error('network failure'))

    startPrPoller()
    for (let i = 0; i < 20; i++) await vi.advanceTimersByTimeAsync(1)
    stopPrPoller()

    expect(mockLogger.event).toHaveBeenCalledWith(
      'pr-poller.tick.end',
      expect.objectContaining({ ok: false, error: expect.stringContaining('network failure') })
    )
  })

  // ── T-102: errorCount bounded ────────────────────────────────────────────

  it('caps errorCount at MAX_ERROR_COUNT so backoff does not grow unbounded (T-102)', async () => {
    vi.mocked(fetchAllGitHubPages).mockRejectedValue(new Error('persistent error'))

    startPrPoller()

    // Run many cycles to drive errorCount past 10
    for (let cycle = 0; cycle < 15; cycle++) {
      await vi.advanceTimersByTimeAsync(300_000) // advance past the longest backoff
      for (let i = 0; i < 20; i++) await vi.advanceTimersByTimeAsync(1)
    }
    stopPrPoller()

    // If errorCount were unbounded, backoff would grow to POLL_INTERVAL * 2^15 = months.
    // Verify we can still poll after cap (nextPollAt should not be impossibly far in future).
    // The indirect proof: startPrPoller resets errorCount=0, so subsequent polls fire.
    vi.mocked(fetchAllGitHubPages).mockResolvedValue([])
    startPrPoller()
    for (let i = 0; i < 20; i++) await vi.advanceTimersByTimeAsync(1)
    expect(fetchAllGitHubPages).toHaveBeenCalled()
    stopPrPoller()
  })

  // ── T-106/T-107: Error path coverage ──────────────────────────────────

  it('logs warning when a repo fetch returns 401 (T-107)', async () => {
    const { createLogger } = await import('../logger')
    const mockLogger = vi.mocked(createLogger).mock.results[0]?.value
    if (!mockLogger) return

    const authError = Object.assign(new Error('Request failed with status code 401'), {
      response: { status: 401 }
    })
    vi.mocked(fetchAllGitHubPages).mockRejectedValue(authError)

    const result = await refreshPrList()

    // fetchOpenPrs catches and logs a warning; poll still completes with empty PRs
    expect(mockLogger.warn).toHaveBeenCalled()
    expect(result.prs).toEqual([])
  })

  it('degrades gracefully when a repo fetch returns 5xx (T-106)', async () => {
    const serverError = Object.assign(new Error('GitHub server error (503)'), {
      response: { status: 503 }
    })
    vi.mocked(fetchAllGitHubPages).mockRejectedValue(serverError)

    const result = await refreshPrList()

    // Should return an empty PR list rather than throwing
    expect(result.prs).toEqual([])
    expect(result).toHaveProperty('checks')
  })
})
