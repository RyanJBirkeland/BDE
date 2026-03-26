import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { GitHubFetchResult } from '../../../../shared/ipc-channels'

// --- Mock window.api.github.fetch (IPC proxy) ---
const mockGithubFetch = vi.fn<(...args: unknown[]) => Promise<GitHubFetchResult>>()

Object.defineProperty(globalThis, 'window', {
  value: { api: { github: { fetch: mockGithubFetch } } },
  writable: true
})

import {
  listOpenPRs,
  getPRDetail,
  getPRFiles,
  getPRDiff,
  getCheckRuns,
  getCheckRunsList,
  getReviews,
  getReviewComments,
  getIssueComments,
  createReview,
  mergePR,
  closePR,
  getPrMergeability,
  checkOpenPrsMergeability,
  replyToComment
} from '../github-api'
import type { PullRequest } from '../github-api'

function ipcResponse(
  body: unknown,
  status = 200,
  linkNext: string | null = null
): GitHubFetchResult {
  return { ok: status >= 200 && status < 300, status, body, linkNext }
}

function makePR(number: number): PullRequest {
  return {
    number,
    title: `PR ${number}`,
    html_url: `https://github.com/o/r/pull/${number}`,
    state: 'open',
    draft: false,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-02T00:00:00Z',
    head: { ref: `branch-${number}`, sha: `sha${number}` },
    base: { ref: 'main' },
    user: { login: 'user1' },
    merged: false,
    merged_at: null,
    repo: 'r'
  }
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
          [
            {
              number: 1,
              title: 'PR1',
              html_url: '',
              state: 'open',
              draft: false,
              created_at: '',
              updated_at: '',
              head: { ref: 'a', sha: 'a1' },
              base: { ref: 'main' },
              user: { login: 'u' }
            }
          ],
          200,
          'https://api.github.com/repos/o/r/pulls?state=open&per_page=100&page=2'
        )
      )
      .mockResolvedValueOnce(
        ipcResponse([
          {
            number: 2,
            title: 'PR2',
            html_url: '',
            state: 'open',
            draft: false,
            created_at: '',
            updated_at: '',
            head: { ref: 'b', sha: 'b1' },
            base: { ref: 'main' },
            user: { login: 'u' }
          }
        ])
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

describe('getPRDetail', () => {
  it('returns PR detail on success', async () => {
    const detail = {
      number: 42,
      title: 'My PR',
      body: 'Description',
      draft: false,
      mergeable: true,
      mergeable_state: 'clean',
      head: { ref: 'feature', sha: 'abc123' },
      base: { ref: 'main' },
      user: { login: 'dev', avatar_url: 'https://example.com/avatar.png' },
      additions: 10,
      deletions: 5,
      labels: [{ name: 'bug', color: 'ee0701' }]
    }
    mockGithubFetch.mockResolvedValue(ipcResponse(detail))

    const result = await getPRDetail('owner', 'repo', 42)

    expect(result).toEqual(detail)
    expect(mockGithubFetch).toHaveBeenCalledWith('/repos/owner/repo/pulls/42', undefined)
  })

  it('throws on non-ok response', async () => {
    mockGithubFetch.mockResolvedValue(ipcResponse({ message: 'Not Found' }, 404))

    await expect(getPRDetail('owner', 'repo', 42)).rejects.toThrow('GitHub API error: 404')
  })
})

describe('getPRFiles', () => {
  it('returns list of changed files', async () => {
    const files = [
      { filename: 'src/foo.ts', status: 'modified', additions: 3, deletions: 1 },
      { filename: 'src/bar.ts', status: 'added', additions: 10, deletions: 0 }
    ]
    mockGithubFetch.mockResolvedValue(ipcResponse(files))

    const result = await getPRFiles('owner', 'repo', 42)

    expect(result).toHaveLength(2)
    expect(result[0].filename).toBe('src/foo.ts')
    expect(mockGithubFetch).toHaveBeenCalledWith(
      '/repos/owner/repo/pulls/42/files?per_page=100',
      undefined
    )
  })

  it('follows pagination for files', async () => {
    const page1 = [{ filename: 'a.ts', status: 'modified', additions: 1, deletions: 0 }]
    const page2 = [{ filename: 'b.ts', status: 'added', additions: 5, deletions: 0 }]
    mockGithubFetch
      .mockResolvedValueOnce(ipcResponse(page1, 200, 'https://api.github.com/next-page'))
      .mockResolvedValueOnce(ipcResponse(page2))

    const result = await getPRFiles('owner', 'repo', 42)

    expect(result).toHaveLength(2)
    expect(mockGithubFetch).toHaveBeenCalledTimes(2)
  })

  it('throws on non-ok response', async () => {
    mockGithubFetch.mockResolvedValue(ipcResponse({ message: 'Forbidden' }, 403))

    await expect(getPRFiles('owner', 'repo', 42)).rejects.toThrow('GitHub API error: 403')
  })
})

describe('getPRDiff', () => {
  it('returns raw diff string', async () => {
    const diff = 'diff --git a/foo.ts b/foo.ts\n+added line\n-removed line'
    mockGithubFetch.mockResolvedValue(ipcResponse(diff))

    const result = await getPRDiff('owner', 'repo', 42)

    expect(result).toBe(diff)
    expect(mockGithubFetch).toHaveBeenCalledWith('/repos/owner/repo/pulls/42', {
      headers: { Accept: 'application/vnd.github.diff' }
    })
  })

  it('throws on non-ok response', async () => {
    mockGithubFetch.mockResolvedValue(ipcResponse(null, 500))

    await expect(getPRDiff('owner', 'repo', 42)).rejects.toThrow('GitHub API error: 500')
  })
})

describe('getCheckRuns', () => {
  it('returns pass status when all checks succeed', async () => {
    mockGithubFetch.mockResolvedValue(
      ipcResponse({
        total_count: 2,
        check_runs: [
          { status: 'completed', conclusion: 'success' },
          { status: 'completed', conclusion: 'skipped' }
        ]
      })
    )

    const result = await getCheckRuns('owner', 'repo', 'abc123')

    expect(result.status).toBe('pass')
    expect(result.passed).toBe(2)
    expect(result.failed).toBe(0)
    expect(result.pending).toBe(0)
    expect(result.total).toBe(2)
  })

  it('returns fail status when any check fails', async () => {
    mockGithubFetch.mockResolvedValue(
      ipcResponse({
        total_count: 3,
        check_runs: [
          { status: 'completed', conclusion: 'success' },
          { status: 'completed', conclusion: 'failure' },
          { status: 'completed', conclusion: 'error' }
        ]
      })
    )

    const result = await getCheckRuns('owner', 'repo', 'abc123')

    expect(result.status).toBe('fail')
    expect(result.passed).toBe(1)
    expect(result.failed).toBe(2)
  })

  it('returns pending status when any check is still running', async () => {
    mockGithubFetch.mockResolvedValue(
      ipcResponse({
        total_count: 2,
        check_runs: [
          { status: 'completed', conclusion: 'success' },
          { status: 'in_progress', conclusion: null }
        ]
      })
    )

    const result = await getCheckRuns('owner', 'repo', 'abc123')

    expect(result.status).toBe('pending')
    expect(result.pending).toBe(1)
  })

  it('returns empty pending summary on non-ok response', async () => {
    mockGithubFetch.mockResolvedValue(ipcResponse(null, 404))

    const result = await getCheckRuns('owner', 'repo', 'abc123')

    expect(result).toEqual({ status: 'pending', total: 0, passed: 0, failed: 0, pending: 0 })
  })
})

describe('getCheckRunsList', () => {
  it('returns list of check runs', async () => {
    const checkRuns = [
      { name: 'CI', status: 'completed', conclusion: 'success', html_url: 'https://example.com/1' },
      {
        name: 'Lint',
        status: 'completed',
        conclusion: 'failure',
        html_url: 'https://example.com/2'
      }
    ]
    mockGithubFetch.mockResolvedValue(ipcResponse({ check_runs: checkRuns }))

    const result = await getCheckRunsList('owner', 'repo', 'abc123')

    expect(result).toHaveLength(2)
    expect(result[0].name).toBe('CI')
    expect(result[1].conclusion).toBe('failure')
  })

  it('returns empty array on non-ok response', async () => {
    mockGithubFetch.mockResolvedValue(ipcResponse(null, 404))

    const result = await getCheckRunsList('owner', 'repo', 'abc123')

    expect(result).toEqual([])
  })
})

describe('getReviews', () => {
  it('returns list of reviews', async () => {
    const reviews = [
      {
        id: 1,
        user: { login: 'reviewer1' },
        state: 'APPROVED',
        body: 'LGTM',
        submitted_at: '2024-01-01T00:00:00Z'
      },
      {
        id: 2,
        user: { login: 'reviewer2' },
        state: 'CHANGES_REQUESTED',
        body: 'Needs work',
        submitted_at: '2024-01-02T00:00:00Z'
      }
    ]
    mockGithubFetch.mockResolvedValue(ipcResponse(reviews))

    const result = await getReviews('owner', 'repo', 42)

    expect(result).toHaveLength(2)
    expect(mockGithubFetch).toHaveBeenCalledWith(
      '/repos/owner/repo/pulls/42/reviews?per_page=100',
      undefined
    )
  })

  it('throws on non-ok response', async () => {
    mockGithubFetch.mockResolvedValue(ipcResponse(null, 403))

    await expect(getReviews('owner', 'repo', 42)).rejects.toThrow('GitHub API error: 403')
  })
})

describe('getReviewComments', () => {
  it('returns list of review comments', async () => {
    const comments = [
      {
        id: 10,
        user: { login: 'dev' },
        body: 'Fix this',
        path: 'src/foo.ts',
        line: 5,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z'
      }
    ]
    mockGithubFetch.mockResolvedValue(ipcResponse(comments))

    const result = await getReviewComments('owner', 'repo', 42)

    expect(result).toHaveLength(1)
    expect(mockGithubFetch).toHaveBeenCalledWith(
      '/repos/owner/repo/pulls/42/comments?per_page=100',
      undefined
    )
  })

  it('throws on non-ok response', async () => {
    mockGithubFetch.mockResolvedValue(ipcResponse(null, 500))

    await expect(getReviewComments('owner', 'repo', 42)).rejects.toThrow('GitHub API error: 500')
  })
})

describe('getIssueComments', () => {
  it('returns list of issue comments', async () => {
    const comments = [
      {
        id: 20,
        user: { login: 'user1' },
        body: 'Great PR!',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z'
      },
      {
        id: 21,
        user: { login: 'user2' },
        body: 'Thanks!',
        created_at: '2024-01-02T00:00:00Z',
        updated_at: '2024-01-02T00:00:00Z'
      }
    ]
    mockGithubFetch.mockResolvedValue(ipcResponse(comments))

    const result = await getIssueComments('owner', 'repo', 42)

    expect(result).toHaveLength(2)
    expect(mockGithubFetch).toHaveBeenCalledWith(
      '/repos/owner/repo/issues/42/comments?per_page=100',
      undefined
    )
  })

  it('throws on non-ok response', async () => {
    mockGithubFetch.mockResolvedValue(ipcResponse(null, 404))

    await expect(getIssueComments('owner', 'repo', 42)).rejects.toThrow('GitHub API error: 404')
  })
})

describe('createReview', () => {
  it('submits a review successfully', async () => {
    mockGithubFetch.mockResolvedValue(ipcResponse({ id: 999 }, 200))

    await expect(
      createReview('owner', 'repo', 42, {
        event: 'APPROVE',
        body: 'LGTM!'
      })
    ).resolves.toBeUndefined()

    expect(mockGithubFetch).toHaveBeenCalledWith(
      '/repos/owner/repo/pulls/42/reviews',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: 'APPROVE', body: 'LGTM!' })
      })
    )
  })

  it('submits review with inline comments', async () => {
    mockGithubFetch.mockResolvedValue(ipcResponse({ id: 1000 }, 200))

    const review = {
      event: 'REQUEST_CHANGES' as const,
      body: 'Please fix these issues',
      comments: [{ path: 'src/foo.ts', line: 10, side: 'RIGHT' as const, body: 'Fix this' }]
    }

    await createReview('owner', 'repo', 42, review)

    expect(mockGithubFetch).toHaveBeenCalledWith(
      '/repos/owner/repo/pulls/42/reviews',
      expect.objectContaining({ body: JSON.stringify(review) })
    )
  })

  it('throws on non-ok response with message', async () => {
    mockGithubFetch.mockResolvedValue(ipcResponse({ message: 'Validation failed' }, 422))

    await expect(createReview('owner', 'repo', 42, { event: 'COMMENT' })).rejects.toThrow(
      'Review failed: 422 — Validation failed'
    )
  })

  it('throws with unknown message when body has no message field', async () => {
    mockGithubFetch.mockResolvedValue(ipcResponse({}, 500))

    await expect(createReview('owner', 'repo', 42, { event: 'COMMENT' })).rejects.toThrow(
      'Review failed: 500 — unknown'
    )
  })
})

describe('mergePR', () => {
  it('merges a PR with default squash method', async () => {
    mockGithubFetch.mockResolvedValue(ipcResponse({ sha: 'merged-sha' }, 200))

    await expect(mergePR('owner', 'repo', 42)).resolves.toBeUndefined()

    expect(mockGithubFetch).toHaveBeenCalledWith(
      '/repos/owner/repo/pulls/42/merge',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ merge_method: 'squash' })
      })
    )
  })

  it('merges with specified method and commit title', async () => {
    mockGithubFetch.mockResolvedValue(ipcResponse({ sha: 'merged-sha' }, 200))

    await mergePR('owner', 'repo', 42, 'merge', 'My commit title')

    expect(mockGithubFetch).toHaveBeenCalledWith(
      '/repos/owner/repo/pulls/42/merge',
      expect.objectContaining({
        body: JSON.stringify({ merge_method: 'merge', commit_title: 'My commit title' })
      })
    )
  })

  it('throws on merge failure with message', async () => {
    mockGithubFetch.mockResolvedValue(ipcResponse({ message: 'Merge conflict' }, 405))

    await expect(mergePR('owner', 'repo', 42)).rejects.toThrow('Merge failed: 405 — Merge conflict')
  })

  it('throws with unknown when body has no message', async () => {
    mockGithubFetch.mockResolvedValue(ipcResponse({}, 500))

    await expect(mergePR('owner', 'repo', 42)).rejects.toThrow('Merge failed: 500 — unknown')
  })
})

describe('closePR', () => {
  it('closes a PR successfully', async () => {
    mockGithubFetch.mockResolvedValue(ipcResponse({ number: 42, state: 'closed' }, 200))

    await expect(closePR('owner', 'repo', 42)).resolves.toBeUndefined()

    expect(mockGithubFetch).toHaveBeenCalledWith(
      '/repos/owner/repo/pulls/42',
      expect.objectContaining({
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: 'closed' })
      })
    )
  })

  it('throws on non-ok response with message', async () => {
    mockGithubFetch.mockResolvedValue(ipcResponse({ message: 'Not Found' }, 404))

    await expect(closePR('owner', 'repo', 42)).rejects.toThrow('Close failed: 404 — Not Found')
  })

  it('throws with unknown when body has no message', async () => {
    mockGithubFetch.mockResolvedValue(ipcResponse({}, 422))

    await expect(closePR('owner', 'repo', 42)).rejects.toThrow('Close failed: 422 — unknown')
  })
})

describe('getPrMergeability', () => {
  it('returns mergeability info on success', async () => {
    mockGithubFetch.mockResolvedValue(
      ipcResponse({
        mergeable: true,
        mergeable_state: 'clean'
      })
    )

    const result = await getPrMergeability('owner', 'repo', 42)

    expect(result).toEqual({ number: 42, repo: 'repo', mergeable: true, mergeable_state: 'clean' })
  })

  it('returns null mergeability fields when GitHub has not computed it yet', async () => {
    mockGithubFetch.mockResolvedValue(
      ipcResponse({
        mergeable: null,
        mergeable_state: 'unknown'
      })
    )

    const result = await getPrMergeability('owner', 'repo', 42)

    expect(result.mergeable).toBeNull()
    expect(result.mergeable_state).toBe('unknown')
  })

  it('returns null fields on non-ok response without throwing', async () => {
    mockGithubFetch.mockResolvedValue(ipcResponse(null, 404))

    const result = await getPrMergeability('owner', 'repo', 42)

    expect(result).toEqual({ number: 42, repo: 'repo', mergeable: null, mergeable_state: null })
  })
})

describe('checkOpenPrsMergeability', () => {
  it('checks mergeability for multiple PRs in parallel', async () => {
    const pr1Data = { mergeable: true, mergeable_state: 'clean' }
    const pr2Data = { mergeable: false, mergeable_state: 'dirty' }
    mockGithubFetch
      .mockResolvedValueOnce(ipcResponse(pr1Data))
      .mockResolvedValueOnce(ipcResponse(pr2Data))

    const prs = [makePR(1), makePR(2)]
    const result = await checkOpenPrsMergeability('owner', 'repo', prs)

    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({
      number: 1,
      repo: 'repo',
      mergeable: true,
      mergeable_state: 'clean'
    })
    expect(result[1]).toEqual({
      number: 2,
      repo: 'repo',
      mergeable: false,
      mergeable_state: 'dirty'
    })
    expect(mockGithubFetch).toHaveBeenCalledTimes(2)
  })

  it('returns empty array for empty PR list', async () => {
    const result = await checkOpenPrsMergeability('owner', 'repo', [])

    expect(result).toEqual([])
    expect(mockGithubFetch).not.toHaveBeenCalled()
  })
})

describe('replyToComment', () => {
  it('posts a reply and returns the new comment', async () => {
    const newComment = {
      id: 100,
      user: { login: 'dev' },
      body: 'Thanks for the feedback!',
      path: 'src/foo.ts',
      line: 5,
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z'
    }
    mockGithubFetch.mockResolvedValue(ipcResponse(newComment))

    const result = await replyToComment('owner', 'repo', 42, 55, 'Thanks for the feedback!')

    expect(result).toEqual(newComment)
    expect(mockGithubFetch).toHaveBeenCalledWith(
      '/repos/owner/repo/pulls/42/comments/55/replies',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: 'Thanks for the feedback!' })
      })
    )
  })

  it('throws on non-ok response with message', async () => {
    mockGithubFetch.mockResolvedValue(ipcResponse({ message: 'Comment not found' }, 404))

    await expect(replyToComment('owner', 'repo', 42, 55, 'reply')).rejects.toThrow(
      'Reply failed: 404 — Comment not found'
    )
  })

  it('throws with unknown when body has no message', async () => {
    mockGithubFetch.mockResolvedValue(ipcResponse({}, 500))

    await expect(replyToComment('owner', 'repo', 42, 55, 'reply')).rejects.toThrow(
      'Reply failed: 500 — unknown'
    )
  })
})
