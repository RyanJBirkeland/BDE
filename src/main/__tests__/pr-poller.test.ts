import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock dependencies before importing
vi.mock('../broadcast', () => ({ broadcast: vi.fn() }))
vi.mock('../config', () => ({
  getGitHubToken: vi.fn()
}))
vi.mock('../paths', () => ({
  getConfiguredRepos: vi.fn()
}))
vi.mock('../github-fetch', () => ({
  githubFetch: vi.fn(),
  fetchAllGitHubPages: vi.fn()
}))
vi.mock('../logger', () => ({
  createLogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  })
}))

import { startPrPoller, stopPrPoller, getLatestPrList, refreshPrList } from '../pr-poller'
import { broadcast } from '../broadcast'
import { fetchAllGitHubPages, githubFetch } from '../github-fetch'
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
    vi.mocked(githubFetch).mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          total_count: 2,
          check_runs: [
            { status: 'completed', conclusion: 'success' },
            { status: 'completed', conclusion: 'failure' }
          ]
        })
    } as any)

    const result = await refreshPrList()

    expect(githubFetch).toHaveBeenCalled()
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
    vi.mocked(githubFetch).mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({})
    } as any)

    const result = await refreshPrList()

    // Should still return result with empty check summary
    expect(result.prs.length).toBe(1)
    expect(result.checks['BDE-1'].status).toBe('pending')
    expect(result.checks['BDE-1'].total).toBe(0)
  })
})
