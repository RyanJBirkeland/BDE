import { describe, it, expect, vi, beforeEach } from 'vitest'
import { parseReviewWorktreeArgs, parseReviewFileDiffArgs } from '../review'

vi.mock('../../lib/review-paths', () => ({
  validateWorktreePath: vi.fn(),
  validateFilePath: vi.fn(),
  validateGitRef: vi.fn(),
  getAllowedWorktreeBases: vi.fn().mockReturnValue(['/home/user/.bde/worktrees']),
  getWorktreeBase: vi.fn().mockReturnValue('/home/user/.bde/worktrees')
}))

// Minimal mocks to allow the module to load without Electron
vi.mock('../../ipc-utils', () => ({
  safeHandle: vi.fn(),
  safeOn: vi.fn()
}))
vi.mock('../../../shared/ipc-channels', () => ({ IpcChannelMap: {} }))
vi.mock('../../logger', () => ({ createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), event: vi.fn() }) }))
vi.mock('../../settings', () => ({ getSettingJson: vi.fn(), getSetting: vi.fn() }))
vi.mock('../../env-utils', () => ({ buildAgentEnv: vi.fn().mockReturnValue({}) }))
vi.mock('../../lib/async-utils', () => ({ execFileAsync: vi.fn() }))
vi.mock('../../services/auto-review-service', () => ({ checkAutoReview: vi.fn() }))
vi.mock('../../services/sprint-service', () => ({ getTask: vi.fn() }))
vi.mock('../../paths', () => ({ getRepoConfig: vi.fn() }))
vi.mock('../../services/review-orchestration-service', () => ({}))
vi.mock('../../services/review-query-service', () => ({
  getReviewDiff: vi.fn(),
  getReviewCommits: vi.fn(),
  getReviewFileDiff: vi.fn()
}))
vi.mock('../../services/review-ship-batch', () => ({ shipBatch: vi.fn() }))
vi.mock('../../../shared/time', () => ({ nowIso: vi.fn().mockReturnValue('2025-01-01T00:00:00.000Z') }))
vi.mock('../../lib/validation', () => ({ isValidTaskId: vi.fn().mockReturnValue(true) }))

import {
  validateWorktreePath,
  validateFilePath,
  validateGitRef
} from '../../lib/review-paths'

const mockValidateWorktreePath = validateWorktreePath as ReturnType<typeof vi.fn>
const mockValidateFilePath = validateFilePath as ReturnType<typeof vi.fn>
const mockValidateGitRef = validateGitRef as ReturnType<typeof vi.fn>

describe('parseReviewWorktreeArgs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('accepts a valid payload and calls validateWorktreePath', () => {
    const result = parseReviewWorktreeArgs([{ worktreePath: '/safe/worktree', base: 'main' }])
    expect(result).toEqual([{ worktreePath: '/safe/worktree', base: 'main' }])
    expect(mockValidateWorktreePath).toHaveBeenCalledWith('/safe/worktree')
  })

  it('throws when payload is not an object', () => {
    expect(() => parseReviewWorktreeArgs(['not-an-object'])).toThrow('must be an object')
  })

  it('throws when payload is null', () => {
    expect(() => parseReviewWorktreeArgs([null])).toThrow('must be an object')
  })

  it('throws when worktreePath is missing', () => {
    expect(() => parseReviewWorktreeArgs([{ base: 'main' }])).toThrow('worktreePath must be a string')
  })

  it('throws when worktreePath is not a string', () => {
    expect(() => parseReviewWorktreeArgs([{ worktreePath: 42, base: 'main' }])).toThrow(
      'worktreePath must be a string'
    )
  })

  it('propagates validateWorktreePath rejection for path traversal', () => {
    mockValidateWorktreePath.mockImplementationOnce(() => {
      throw new Error('not inside an allowed worktree base')
    })
    expect(() =>
      parseReviewWorktreeArgs([{ worktreePath: '/etc/passwd', base: 'main' }])
    ).toThrow('not inside an allowed worktree base')
  })
})

describe('parseReviewFileDiffArgs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('accepts a valid payload and calls all validators', () => {
    const result = parseReviewFileDiffArgs([
      { worktreePath: '/safe/worktree', filePath: 'src/foo.ts', base: 'main' }
    ])
    expect(result).toEqual([
      { worktreePath: '/safe/worktree', filePath: 'src/foo.ts', base: 'main' }
    ])
    expect(mockValidateWorktreePath).toHaveBeenCalledWith('/safe/worktree')
    expect(mockValidateFilePath).toHaveBeenCalledWith('src/foo.ts')
    expect(mockValidateGitRef).toHaveBeenCalledWith('main')
  })

  it('throws when payload is not an object', () => {
    expect(() => parseReviewFileDiffArgs([null])).toThrow('must be an object')
  })

  it('throws when worktreePath is missing', () => {
    expect(() =>
      parseReviewFileDiffArgs([{ filePath: 'src/foo.ts', base: 'main' }])
    ).toThrow('worktreePath must be a string')
  })

  it('throws when filePath is missing', () => {
    expect(() =>
      parseReviewFileDiffArgs([{ worktreePath: '/safe/worktree', base: 'main' }])
    ).toThrow('filePath must be a string')
  })

  it('throws when base is missing', () => {
    expect(() =>
      parseReviewFileDiffArgs([{ worktreePath: '/safe/worktree', filePath: 'src/foo.ts' }])
    ).toThrow('base must be a string')
  })

  it('propagates validateFilePath rejection for path traversal', () => {
    mockValidateFilePath.mockImplementationOnce(() => {
      throw new Error('must not contain path traversal')
    })
    expect(() =>
      parseReviewFileDiffArgs([
        { worktreePath: '/safe/worktree', filePath: '../../../etc/shadow', base: 'main' }
      ])
    ).toThrow('must not contain path traversal')
  })

  it('propagates validateGitRef rejection for invalid git ref', () => {
    mockValidateGitRef.mockImplementationOnce(() => {
      throw new Error('Invalid git ref')
    })
    expect(() =>
      parseReviewFileDiffArgs([
        { worktreePath: '/safe/worktree', filePath: 'src/foo.ts', base: '; rm -rf ~' }
      ])
    ).toThrow('Invalid git ref')
  })
})
