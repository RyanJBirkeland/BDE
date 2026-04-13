import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useGitHubErrorListener } from '../useGitHubErrorListener'
import type { GitHubErrorKind } from '../../../../shared/types/github-errors'

// Mock the toast store so we can observe what the hook fires
vi.mock('../../stores/toasts', () => ({
  toast: {
    info: vi.fn(),
    error: vi.fn()
  }
}))

type GitHubErrorPayload = { kind: GitHubErrorKind; message: string; status?: number }

describe('useGitHubErrorListener', () => {
  let errorHandler: ((payload: GitHubErrorPayload) => void) | null
  const unsub = vi.fn()

  beforeEach(() => {
    errorHandler = null
    vi.clearAllMocks()

    vi.mocked(window.api.onGitHubError).mockImplementation((handler) => {
      errorHandler = handler
      return unsub
    })
  })

  it('subscribes to github:error on mount', () => {
    renderHook(() => useGitHubErrorListener())
    expect(window.api.onGitHubError).toHaveBeenCalledWith(expect.any(Function))
  })

  it('unsubscribes on unmount', () => {
    const { unmount } = renderHook(() => useGitHubErrorListener())
    unmount()
    expect(unsub).toHaveBeenCalled()
  })

  it('shows a persistent info toast with a "Fix billing" action for kind=billing', async () => {
    const { toast } = await import('../../stores/toasts')
    vi.mocked(window.api.openExternal).mockResolvedValue({} as never)

    renderHook(() => useGitHubErrorListener())
    errorHandler!({ kind: 'billing', message: 'GitHub Actions disabled', status: 403 })

    expect(toast.info).toHaveBeenCalledWith(
      expect.stringContaining('billing'),
      expect.objectContaining({
        action: expect.stringMatching(/billing|settings/i),
        durationMs: expect.any(Number)
      })
    )
    // The durationMs should be long enough to actually read the message.
    // Regular info toasts default to 3s; this one should be much longer.
    const call = vi.mocked(toast.info).mock.calls[0]
    const options = call[1] as { durationMs?: number }
    expect(options.durationMs).toBeGreaterThanOrEqual(15_000)
  })

  it('invokes openExternal(github.com/settings/billing) when billing action is clicked', async () => {
    const { toast } = await import('../../stores/toasts')
    vi.mocked(window.api.openExternal).mockResolvedValue({} as never)

    renderHook(() => useGitHubErrorListener())
    errorHandler!({ kind: 'billing', message: 'GitHub Actions disabled', status: 403 })

    const call = vi.mocked(toast.info).mock.calls[0]
    const options = call[1] as { onAction?: () => void }
    // Simulate the user clicking the toast action
    options.onAction?.()

    expect(window.api.openExternal).toHaveBeenCalledWith(
      expect.stringContaining('github.com/settings/billing')
    )
  })

  it('shows a short error toast for kind=network', async () => {
    const { toast } = await import('../../stores/toasts')
    renderHook(() => useGitHubErrorListener())

    errorHandler!({ kind: 'network', message: 'Network error: ECONNREFUSED' })

    expect(toast.error).toHaveBeenCalledWith(
      expect.stringMatching(/network|offline|retrying/i),
      expect.any(Number)
    )
  })

  it('shows a toast with scope hint for kind=permission', async () => {
    const { toast } = await import('../../stores/toasts')
    renderHook(() => useGitHubErrorListener())

    errorHandler!({ kind: 'permission', message: 'Resource not accessible', status: 403 })

    expect(toast.error).toHaveBeenCalledWith(
      expect.stringMatching(/forbidden|scope|permission/i),
      expect.any(Number)
    )
  })

  it('shows a toast with "Configure" action for kind=no-token', async () => {
    const { toast } = await import('../../stores/toasts')
    renderHook(() => useGitHubErrorListener())

    errorHandler!({ kind: 'no-token', message: 'No GitHub token configured' })

    expect(toast.info).toHaveBeenCalledWith(
      expect.stringMatching(/token|settings/i),
      expect.objectContaining({
        action: expect.any(String)
      })
    )
  })

  it('shows a generic server error toast for kind=server', async () => {
    const { toast } = await import('../../stores/toasts')
    renderHook(() => useGitHubErrorListener())

    errorHandler!({ kind: 'server', message: 'GitHub server error (503)', status: 503 })

    expect(toast.error).toHaveBeenCalledWith(
      expect.stringMatching(/server|503/i),
      expect.any(Number)
    )
  })

  it('fires an info toast for kind=rate-limit using the pre-formatted message', async () => {
    const { toast } = await import('../../stores/toasts')
    renderHook(() => useGitHubErrorListener())

    // Main process pre-formats the message with remaining/limit/reset UTC time
    const message = 'GitHub API rate limit low: 50/5000 remaining. Resets at 14:30 UTC.'
    errorHandler!({ kind: 'rate-limit', message, status: 403 })

    expect(toast.info).toHaveBeenCalledWith(
      message,
      expect.objectContaining({
        durationMs: expect.any(Number)
      })
    )
  })

  it('fires an error toast for kind=token-expired using the payload message', async () => {
    const { toast } = await import('../../stores/toasts')
    renderHook(() => useGitHubErrorListener())

    const message = 'GitHub token is invalid or expired. Update it in Settings.'
    errorHandler!({ kind: 'token-expired', message, status: 401 })

    expect(toast.error).toHaveBeenCalledWith(message, expect.any(Number))
  })

  it('does NOT fire a toast for kind=not-found (main never broadcasts these)', async () => {
    const { toast } = await import('../../stores/toasts')
    renderHook(() => useGitHubErrorListener())

    errorHandler!({ kind: 'not-found', message: 'resource not found', status: 404 })

    expect(toast.info).not.toHaveBeenCalled()
    expect(toast.error).not.toHaveBeenCalled()
  })
})
