import { describe, it, expect, vi, beforeEach } from 'vitest'
import { checkAutoReview } from '../auto-review-service'
import type { CheckAutoReviewParams } from '../auto-review-service'

vi.mock('../../lib/async-utils', () => ({
  execFileAsync: vi.fn()
}))

vi.mock('../auto-review', () => ({
  evaluateAutoReviewRules: vi.fn()
}))

import { execFileAsync } from '../../lib/async-utils'
import { evaluateAutoReviewRules } from '../auto-review'

const ENV = { PATH: '/usr/bin' }

function makeParams(overrides: Partial<CheckAutoReviewParams> = {}): CheckAutoReviewParams {
  return {
    worktreePath: '/tmp/worktree',
    rules: [],
    env: ENV,
    ...overrides
  }
}

describe('checkAutoReview — zero rules', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(execFileAsync).mockResolvedValue({ stdout: '1\t0\tsrc/foo.ts\n', stderr: '' })
  })

  it('returns false for all flags when rules array is empty', async () => {
    vi.mocked(evaluateAutoReviewRules).mockReturnValue(null)

    const result = await checkAutoReview(makeParams({ rules: [] }))

    expect(result.shouldAutoMerge).toBe(false)
    expect(result.shouldAutoApprove).toBe(false)
    expect(result.matchedRule).toBeNull()
  })
})

describe('checkAutoReview — no diff output', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(execFileAsync).mockResolvedValue({ stdout: '   ', stderr: '' })
  })

  it('short-circuits when numstat is blank (no files changed)', async () => {
    const result = await checkAutoReview(makeParams())

    expect(result.shouldAutoMerge).toBe(false)
    expect(result.shouldAutoApprove).toBe(false)
    expect(result.matchedRule).toBeNull()
    // evaluateAutoReviewRules should not be called when there are no files
    expect(evaluateAutoReviewRules).not.toHaveBeenCalled()
  })
})

describe('checkAutoReview — single rule match', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(execFileAsync).mockResolvedValue({ stdout: '2\t1\tsrc/style.css\n', stderr: '' })
  })

  it('returns auto-merge when a rule matches with action auto-merge', async () => {
    const rule = { id: 'r1', name: 'CSS auto-merge', enabled: true, conditions: {}, action: 'auto-merge' as const }
    vi.mocked(evaluateAutoReviewRules).mockReturnValue({ rule, action: 'auto-merge' })

    const result = await checkAutoReview(makeParams({ rules: [rule] }))

    expect(result.shouldAutoMerge).toBe(true)
    expect(result.shouldAutoApprove).toBe(false)
    expect(result.matchedRule).toBe('CSS auto-merge')
  })

  it('returns auto-approve when a rule matches with action auto-approve', async () => {
    const rule = { id: 'r2', name: 'Docs auto-approve', enabled: true, conditions: {}, action: 'auto-approve' as const }
    vi.mocked(evaluateAutoReviewRules).mockReturnValue({ rule, action: 'auto-approve' })

    const result = await checkAutoReview(makeParams({ rules: [rule] }))

    expect(result.shouldAutoMerge).toBe(false)
    expect(result.shouldAutoApprove).toBe(true)
    expect(result.matchedRule).toBe('Docs auto-approve')
  })
})

describe('checkAutoReview — multi-rule precedence', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(execFileAsync).mockResolvedValue({ stdout: '5\t0\tsrc/a.ts\n', stderr: '' })
  })

  it('returns the first matching rule (evaluateAutoReviewRules determines winner)', async () => {
    const winner = { id: 'winner', name: 'First match', enabled: true, conditions: {}, action: 'auto-merge' as const }
    vi.mocked(evaluateAutoReviewRules).mockReturnValue({ rule: winner, action: 'auto-merge' })

    const rules = [winner]
    const result = await checkAutoReview(makeParams({ rules }))

    expect(result.matchedRule).toBe('First match')
    expect(evaluateAutoReviewRules).toHaveBeenCalledOnce()
  })
})

describe('checkAutoReview — no-match path', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(execFileAsync).mockResolvedValue({ stdout: '10\t5\tsrc/big.ts\n', stderr: '' })
  })

  it('returns all-false when no rule matches the diff', async () => {
    vi.mocked(evaluateAutoReviewRules).mockReturnValue(null)

    const rules = [{ id: 'r1', name: 'Tiny only', enabled: true, conditions: { maxLinesChanged: 3 }, action: 'auto-merge' as const }]
    const result = await checkAutoReview(makeParams({ rules }))

    expect(result.shouldAutoMerge).toBe(false)
    expect(result.shouldAutoApprove).toBe(false)
    expect(result.matchedRule).toBeNull()
  })
})
