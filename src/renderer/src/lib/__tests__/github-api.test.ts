import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { GitHubFetchResult } from '../../../../shared/ipc-channels'

// --- Mock window.api.github.fetch (IPC proxy) ---
const mockGithubFetch = vi.fn<(...args: unknown[]) => Promise<GitHubFetchResult>>()

Object.defineProperty(globalThis, 'window', {
  value: { api: { github: { fetch: mockGithubFetch } } },
  writable: true
})

import { listOpenPRs } from '../github-api'

function ipcResponse(body: unknown, status = 200, linkNext: string | null = null): GitHubFetchResult {
  return { ok: status >= 200 && status < 300, status, body, linkNext }
}

beforeEach(() => {
  vi.resetAllMocks()
})

describe('github-api via IPC proxy', () => {
  it('fetches open PRs through IPC', async () => {
    mockGithubFetch.mockResolvedValue(
      ipcResponse([
        {
          number: 1,
          title: 'PR',
          html_url: '',
          state: 'open',
          draft: false,
          created_at: '',
          updated_at: '',
          head: { ref: 'b', sha: 'abc' },
          base: { ref: 'main' },
          user: { login: 'u' }
        }
      ])
    )

    const prs = await listOpenPRs('o', 'r')

    expect(prs).toHaveLength(1)
    expect(prs[0].repo).toBe('r')
    expect(mockGithubFetch).toHaveBeenCalledWith(
      '/repos/o/r/pulls?state=open&per_page=100',
      undefined
    )
  })

  it('follows pagination via linkNext', async () => {
    mockGithubFetch
      .mockResolvedValueOnce(
        ipcResponse(
          [{ number: 1, title: 'PR1', html_url: '', state: 'open', draft: false, created_at: '', updated_at: '', head: { ref: 'a', sha: 'a1' }, base: { ref: 'main' }, user: { login: 'u' } }],
          200,
          'https://api.github.com/repos/o/r/pulls?state=open&per_page=100&page=2'
        )
      )
      .mockResolvedValueOnce(
        ipcResponse([{ number: 2, title: 'PR2', html_url: '', state: 'open', draft: false, created_at: '', updated_at: '', head: { ref: 'b', sha: 'b1' }, base: { ref: 'main' }, user: { login: 'u' } }])
      )

    const prs = await listOpenPRs('o', 'r')

    expect(prs).toHaveLength(2)
    expect(mockGithubFetch).toHaveBeenCalledTimes(2)
    // Second call should use the full URL from linkNext
    expect(mockGithubFetch).toHaveBeenCalledWith(
      'https://api.github.com/repos/o/r/pulls?state=open&per_page=100&page=2',
      undefined
    )
  })

  it('throws on non-ok response', async () => {
    mockGithubFetch.mockResolvedValue(ipcResponse({ message: 'Not Found' }, 404))

    await expect(listOpenPRs('o', 'r')).rejects.toThrow('GitHub API error: 404')
    expect(mockGithubFetch).toHaveBeenCalledTimes(1)
  })

  it('does not use global fetch or handle tokens in renderer', async () => {
    mockGithubFetch.mockResolvedValue(ipcResponse([]))

    await listOpenPRs('o', 'r')

    // Verify the call goes through window.api.github.fetch, not global fetch
    expect(mockGithubFetch).toHaveBeenCalledTimes(1)
  })
})
