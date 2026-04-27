import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mocks must come before imports
vi.mock('electron', () => ({
  BrowserWindow: { fromWebContents: vi.fn(), getAllWindows: vi.fn() },
  ipcMain: { on: vi.fn() }
}))
vi.mock('../../ipc-utils', () => ({ safeHandle: vi.fn(), safeOn: vi.fn() }))
vi.mock('../../pty', () => ({
  createPty: vi.fn(),
  isPtyAvailable: vi.fn().mockReturnValue(true),
  validateShell: vi.fn().mockReturnValue(true),
  _setPty: vi.fn()
}))

const mockGetRepoPaths = vi.fn()
const mockGetWorktreeBase = vi.fn()

vi.mock('../../paths', () => ({
  getRepoPaths: (...args: unknown[]) => mockGetRepoPaths(...args),
  ADHOC_WORKTREE_BASE: '/home/user/.fleet/worktrees-adhoc'
}))
vi.mock('../../lib/review-paths', () => ({
  getWorktreeBase: (...args: unknown[]) => mockGetWorktreeBase(...args)
}))

import { validateTerminalCwd } from '../terminal-handlers'

describe('validateTerminalCwd', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetRepoPaths.mockReturnValue({
      fleet: '/home/user/Projects/fleet',
      other: '/home/user/Projects/other'
    })
    mockGetWorktreeBase.mockReturnValue('/home/user/.fleet/worktrees')
  })

  it('accepts cwd exactly matching a configured repo localPath', () => {
    expect(() => validateTerminalCwd('/home/user/Projects/fleet')).not.toThrow()
  })

  it('accepts cwd inside a configured repo localPath', () => {
    expect(() => validateTerminalCwd('/home/user/Projects/fleet/src/main')).not.toThrow()
  })

  it('accepts cwd inside the pipeline worktree base', () => {
    expect(() => validateTerminalCwd('/home/user/.fleet/worktrees/some-task-id')).not.toThrow()
  })

  it('accepts cwd inside the adhoc worktree base', () => {
    expect(() =>
      validateTerminalCwd('/home/user/.fleet/worktrees-adhoc/some-session')
    ).not.toThrow()
  })

  it('rejects cwd outside all safe roots', () => {
    expect(() => validateTerminalCwd('/tmp/evil')).toThrow('not inside an allowed directory')
  })

  it('rejects /etc path', () => {
    expect(() => validateTerminalCwd('/etc')).toThrow('not inside an allowed directory')
  })

  it('rejects a repo prefix path that does not actually start with the repo root', () => {
    // /home/user/Projects/fleet-evil is NOT inside /home/user/Projects/fleet
    expect(() => validateTerminalCwd('/home/user/Projects/fleet-evil')).toThrow(
      'not inside an allowed directory'
    )
  })

  it('includes allowed roots in the error message', () => {
    let error: Error | null = null
    try {
      validateTerminalCwd('/tmp/bad')
    } catch (e) {
      error = e as Error
    }
    expect(error?.message).toContain('/home/user/Projects/fleet')
    expect(error?.message).toContain('/home/user/.fleet/worktrees')
  })
})
