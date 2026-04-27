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
  validateGitCleanStatus,
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
    expect(result.message).toContain('expired')
  })

  it('returns warn when token expires within one hour', async () => {
    vi.mocked(checkAuthStatus).mockResolvedValue({
      tokenFound: true,
      tokenExpired: false,
      expiresAt: new Date(Date.now() + 30 * 60 * 1000) // 30 minutes from now
    })

    const result = await validateAuthStatus()

    expect(result.status).toBe('warn')
    expect(result.message).toContain('expires in')
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
    vi.mocked(getRepoPath).mockReturnValue(undefined)

    const result = validateRepoPath('unknown-repo')

    expect(result.status).toBe('fail')
    expect(result.message).toContain('unknown-repo')
  })
})

describe('validateGitCleanStatus', () => {
  it('returns warn without calling execFileAsync when repoPath is undefined', async () => {
    const result = await validateGitCleanStatus(undefined)

    expect(result.status).toBe('warn')
    expect(result.message).toContain('not configured')
    expect(vi.mocked(execFileAsync)).not.toHaveBeenCalled()
  })

  it('returns pass when working directory is clean', async () => {
    vi.mocked(execFileAsync).mockResolvedValue({ stdout: '', stderr: '' })

    const result = await validateGitCleanStatus('/projects/bde')

    expect(result.status).toBe('pass')
  })

  it('returns warn when uncommitted changes are present', async () => {
    vi.mocked(execFileAsync).mockResolvedValue({ stdout: ' M src/foo.ts\n', stderr: '' })

    const result = await validateGitCleanStatus('/projects/bde')

    expect(result.status).toBe('warn')
    expect(result.message).toContain('Uncommitted')
  })

  it('returns warn containing "Unable to check" when git command throws', async () => {
    vi.mocked(execFileAsync).mockRejectedValue(new Error('not a git repository'))

    const result = await validateGitCleanStatus('/projects/bde')

    expect(result.status).toBe('warn')
    expect(result.message).toContain('Unable to check')
  })
})

describe('validateNoTaskConflicts', () => {
  it('returns pass when no tasks exist for the repo', () => {
    vi.mocked(listTasks).mockReturnValue([])

    const result = validateNoTaskConflicts('bde')

    expect(result.status).toBe('pass')
  })

  it('returns fail when active tasks are present', () => {
    vi.mocked(listTasks).mockReturnValue([
      { id: '1', repo: 'bde', status: 'active' } as never
    ])

    const result = validateNoTaskConflicts('bde')

    expect(result.status).toBe('fail')
    expect(result.message).toContain('active')
  })

  it('returns warn when only queued tasks are present', () => {
    vi.mocked(listTasks).mockReturnValue([
      { id: '1', repo: 'bde', status: 'queued' } as never
    ])

    const result = validateNoTaskConflicts('bde')

    expect(result.status).toBe('warn')
    expect(result.message).toContain('queued')
  })

  it('returns warn containing "Error checking" when listTasks throws', () => {
    vi.mocked(listTasks).mockImplementation(() => {
      throw new Error('DB unavailable')
    })

    const result = validateNoTaskConflicts('bde')

    expect(result.status).toBe('warn')
    expect(result.message).toContain('Error checking')
  })
})

describe('assessAgentSlotCapacity', () => {
  it('returns warn with zero counts when agent manager is undefined', () => {
    const result = assessAgentSlotCapacity(undefined)

    expect(result.status).toBe('warn')
    expect(result.available).toBe(0)
    expect(result.max).toBe(0)
  })

  it('returns pass with correct counts when slots are available', () => {
    const am = {
      getStatus: vi.fn().mockReturnValue({
        concurrency: { maxSlots: 2, activeCount: 1 }
      })
    }

    const result = assessAgentSlotCapacity(am as never)

    expect(result.status).toBe('pass')
    expect(result.available).toBe(1)
    expect(result.max).toBe(2)
  })

  it('returns warn when all slots are occupied', () => {
    const am = {
      getStatus: vi.fn().mockReturnValue({
        concurrency: { maxSlots: 2, activeCount: 2 }
      })
    }

    const result = assessAgentSlotCapacity(am as never)

    expect(result.status).toBe('warn')
    expect(result.available).toBe(0)
    expect(result.max).toBe(2)
  })
})

describe('runOperationalChecks', () => {
  it('returns a result with all five required keys', async () => {
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

    expect(result).toHaveProperty('auth')
    expect(result).toHaveProperty('repoPath')
    expect(result).toHaveProperty('gitClean')
    expect(result).toHaveProperty('noConflict')
    expect(result).toHaveProperty('slotsAvailable')
    expect(result.auth).toHaveProperty('status')
    expect(result.repoPath).toHaveProperty('status')
    expect(result.gitClean).toHaveProperty('status')
    expect(result.noConflict).toHaveProperty('status')
    expect(result.slotsAvailable).toHaveProperty('status')
  })

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
