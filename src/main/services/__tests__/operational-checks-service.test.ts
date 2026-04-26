import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../credential-store', () => ({ checkAuthStatus: vi.fn() }))
vi.mock('../../paths', () => ({ getRepoPath: vi.fn() }))
vi.mock('../../lib/async-utils', () => ({ execFileAsync: vi.fn() }))
vi.mock('../sprint-service', () => ({ listTasks: vi.fn() }))

import { checkAuthStatus } from '../../credential-store'
import { getRepoPath } from '../../paths'
import { execFileAsync } from '../../lib/async-utils'
import { listTasks } from '../sprint-service'
import {
  validateAuthStatus,
  validateRepoPath,
  validateNoTaskConflicts,
  assessAgentSlotCapacity,
  runOperationalChecks
} from '../operational-checks-service'

beforeEach(() => {
  vi.mocked(execFileAsync).mockResolvedValue({ stdout: '', stderr: '' })
  vi.mocked(listTasks).mockReturnValue([])
})

describe('validateAuthStatus', () => {
  it('returns pass when token is valid and not expiring', async () => {
    vi.mocked(checkAuthStatus).mockResolvedValue({
      tokenFound: true,
      tokenExpired: false,
      expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000) // 2 hours from now
    })

    const result = await validateAuthStatus()

    expect(result.status).toBe('pass')
    expect(result.message).toContain('valid')
  })

  it('returns fail when no token found', async () => {
    vi.mocked(checkAuthStatus).mockResolvedValue({
      tokenFound: false,
      tokenExpired: false,
      expiresAt: null
    })

    const result = await validateAuthStatus()

    expect(result.status).toBe('fail')
    expect(result.message).toContain('claude login')
  })

  it('returns fail when token is expired', async () => {
    vi.mocked(checkAuthStatus).mockResolvedValue({
      tokenFound: true,
      tokenExpired: true,
      expiresAt: null
    })

    const result = await validateAuthStatus()

    expect(result.status).toBe('fail')
  })
})

describe('validateRepoPath', () => {
  it('returns pass with path when repo is configured', () => {
    vi.mocked(getRepoPath).mockReturnValue('/Users/dev/my-repo')

    const result = validateRepoPath('my-repo')

    expect(result.status).toBe('pass')
    expect(result.path).toBe('/Users/dev/my-repo')
  })

  it('returns fail when no path configured for repo', () => {
    vi.mocked(getRepoPath).mockReturnValue(null)

    const result = validateRepoPath('unknown-repo')

    expect(result.status).toBe('fail')
    expect(result.message).toContain('unknown-repo')
  })
})

// ── T-131: validateNoTaskConflicts ─────────────────────────────────────────

describe('validateNoTaskConflicts', () => {
  it('returns pass when no active or queued tasks exist for repo', () => {
    vi.mocked(listTasks).mockReturnValue([])
    const result = validateNoTaskConflicts('bde')
    expect(result.status).toBe('pass')
  })

  it('returns fail when active tasks exist on the repo', () => {
    vi.mocked(listTasks).mockReturnValue([
      { id: 't1', repo: 'bde', status: 'active' } as any,
      { id: 't2', repo: 'bde', status: 'active' } as any
    ])
    const result = validateNoTaskConflicts('bde')
    expect(result.status).toBe('fail')
    expect(result.message).toContain('2 active')
  })

  it('returns warn when only queued tasks exist on the repo', () => {
    vi.mocked(listTasks).mockReturnValue([
      { id: 't1', repo: 'bde', status: 'queued' } as any
    ])
    const result = validateNoTaskConflicts('bde')
    expect(result.status).toBe('warn')
    expect(result.message).toContain('1 queued')
  })

  it('ignores tasks on different repos', () => {
    vi.mocked(listTasks).mockReturnValue([
      { id: 't1', repo: 'other-repo', status: 'active' } as any
    ])
    const result = validateNoTaskConflicts('bde')
    expect(result.status).toBe('pass')
  })
})

// ── T-131: assessAgentSlotCapacity ─────────────────────────────────────────

describe('assessAgentSlotCapacity', () => {
  it('returns warn when agent manager is not available', () => {
    const result = assessAgentSlotCapacity(undefined)
    expect(result.status).toBe('warn')
    expect(result.available).toBe(0)
  })

  it('returns pass when slots are available', () => {
    const am = { getStatus: vi.fn().mockReturnValue({ concurrency: { maxSlots: 3, activeCount: 1 } }) }
    const result = assessAgentSlotCapacity(am as any)
    expect(result.status).toBe('pass')
    expect(result.available).toBe(2)
    expect(result.max).toBe(3)
  })

  it('returns warn when all slots are occupied', () => {
    const am = { getStatus: vi.fn().mockReturnValue({ concurrency: { maxSlots: 2, activeCount: 2 } }) }
    const result = assessAgentSlotCapacity(am as any)
    expect(result.status).toBe('warn')
    expect(result.available).toBe(0)
    expect(result.message).toContain('queue')
  })

  it('handles missing concurrency info gracefully', () => {
    const am = { getStatus: vi.fn().mockReturnValue({}) }
    const result = assessAgentSlotCapacity(am as any)
    expect(result.status).toBe('warn')
    expect(result.available).toBe(0)
  })
})

describe('runOperationalChecks', () => {
  it('returns all-pass result when all checks succeed', async () => {
    vi.mocked(checkAuthStatus).mockResolvedValue({
      tokenFound: true,
      tokenExpired: false,
      expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000)
    })
    vi.mocked(getRepoPath).mockReturnValue('/repo')
    vi.mocked(execFileAsync).mockResolvedValue({ stdout: '', stderr: '' })
    vi.mocked(listTasks).mockReturnValue([])

    const am = {
      getStatus: vi.fn().mockReturnValue({
        concurrency: { maxSlots: 2, activeCount: 0 }
      })
    }

    const result = await runOperationalChecks('bde', am as never)

    expect(result.auth.status).toBe('pass')
    expect(result.repoPath.status).toBe('pass')
    expect(result.slotsAvailable.status).toBe('pass')
  })

  it('reflects fail status when auth check fails', async () => {
    vi.mocked(checkAuthStatus).mockResolvedValue({
      tokenFound: false,
      tokenExpired: false,
      expiresAt: null
    })
    vi.mocked(getRepoPath).mockReturnValue('/repo')
    vi.mocked(execFileAsync).mockResolvedValue({ stdout: '', stderr: '' })

    const am = {
      getStatus: vi.fn().mockReturnValue({ concurrency: { maxSlots: 2, activeCount: 0 } })
    }

    const result = await runOperationalChecks('bde', am as never)

    expect(result.auth.status).toBe('fail')
    // Other checks are independent — repoPath can still pass
    expect(result.repoPath.status).toBe('pass')
  })
})
