import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks — must be declared before imports (vitest hoists vi.mock calls)
// ---------------------------------------------------------------------------

vi.mock('../../lib/async-utils', () => ({
  execFileAsync: vi.fn()
}))

vi.mock('../../env-utils', () => ({
  buildAgentEnv: vi.fn().mockReturnValue({})
}))

// Dynamic import inside evaluateAutoMergePolicy: `import('../services/auto-review')`
// vitest resolves vi.mock paths relative to the test file, so we use the path
// relative to THIS file (which lives in agent-manager/__tests__/).
vi.mock('../../services/auto-review', () => ({
  evaluateAutoReviewRules: vi.fn()
}))

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { evaluateAutoMergePolicy } from '../auto-merge-policy'
import { execFileAsync } from '../../lib/async-utils'
import { evaluateAutoReviewRules } from '../../services/auto-review'
import type { AutoReviewRule } from '../../../shared/types/task-types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRule(overrides: Partial<AutoReviewRule> = {}): AutoReviewRule {
  return {
    id: 'rule-1',
    name: 'test-rule',
    enabled: true,
    conditions: {},
    action: 'auto-merge',
    ...overrides
  }
}

function mockNumstat(output: string) {
  vi.mocked(execFileAsync).mockResolvedValue({
    stdout: output,
    stderr: ''
  } as Awaited<ReturnType<typeof execFileAsync>>)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('evaluateAutoMergePolicy', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('early exit — no rules', () => {
    it('returns shouldMerge: false without calling git when rules list is empty', async () => {
      const result = await evaluateAutoMergePolicy([], '/tmp/worktree')

      expect(result).toEqual({ shouldMerge: false })
      expect(execFileAsync).not.toHaveBeenCalled()
    })
  })

  describe('git diff produces empty output', () => {
    it('returns shouldMerge: false when numstat output is empty', async () => {
      mockNumstat('')

      const result = await evaluateAutoMergePolicy([makeRule()], '/tmp/worktree')

      expect(result).toEqual({ shouldMerge: false })
      expect(evaluateAutoReviewRules).not.toHaveBeenCalled()
    })

    it('returns shouldMerge: false when numstat output is only whitespace', async () => {
      mockNumstat('   \n  ')

      const result = await evaluateAutoMergePolicy([makeRule()], '/tmp/worktree')

      expect(result).toEqual({ shouldMerge: false })
    })
  })

  describe('numstat line parsing', () => {
    it('parses additions and deletions and passes files to evaluateAutoReviewRules', async () => {
      mockNumstat('10\t5\tsrc/foo.ts\n3\t1\tsrc/bar.ts\n')
      vi.mocked(evaluateAutoReviewRules).mockReturnValue(null)

      await evaluateAutoMergePolicy([makeRule()], '/tmp/worktree')

      expect(evaluateAutoReviewRules).toHaveBeenCalledWith(
        [makeRule()],
        [
          { path: 'src/foo.ts', additions: 10, deletions: 5 },
          { path: 'src/bar.ts', additions: 3, deletions: 1 }
        ]
      )
    })

    it('parses binary files (dash placeholders) as 0 additions and 0 deletions', async () => {
      mockNumstat('-\t-\tassets/image.png\n')
      vi.mocked(evaluateAutoReviewRules).mockReturnValue(null)

      await evaluateAutoMergePolicy([makeRule()], '/tmp/worktree')

      expect(evaluateAutoReviewRules).toHaveBeenCalledWith(
        [makeRule()],
        [{ path: 'assets/image.png', additions: 0, deletions: 0 }]
      )
    })

    it('handles file paths containing tabs by joining remaining parts', async () => {
      // Unusual but valid: a path with a tab character
      mockNumstat('2\t1\tsrc/some\tpath.ts\n')
      vi.mocked(evaluateAutoReviewRules).mockReturnValue(null)

      await evaluateAutoMergePolicy([makeRule()], '/tmp/worktree')

      expect(evaluateAutoReviewRules).toHaveBeenCalledWith(
        [makeRule()],
        [{ path: 'src/some\tpath.ts', additions: 2, deletions: 1 }]
      )
    })

    it('passes the worktree path as cwd to git', async () => {
      mockNumstat('1\t0\tsrc/x.ts\n')
      vi.mocked(evaluateAutoReviewRules).mockReturnValue(null)

      await evaluateAutoMergePolicy([makeRule()], '/my/worktree')

      expect(execFileAsync).toHaveBeenCalledWith(
        'git',
        ['diff', '--numstat', 'origin/main...HEAD'],
        expect.objectContaining({ cwd: '/my/worktree' })
      )
    })
  })

  describe('evaluateAutoReviewRules result', () => {
    it('returns shouldMerge: false when evaluateAutoReviewRules returns null', async () => {
      mockNumstat('5\t2\tsrc/foo.ts\n')
      vi.mocked(evaluateAutoReviewRules).mockReturnValue(null)

      const result = await evaluateAutoMergePolicy([makeRule()], '/tmp/worktree')

      expect(result).toEqual({ shouldMerge: false })
    })

    it('returns shouldMerge: false when evaluateAutoReviewRules returns non-auto-merge action', async () => {
      mockNumstat('5\t2\tsrc/foo.ts\n')
      const rule = makeRule({ name: 'approve-rule', action: 'auto-approve' })
      vi.mocked(evaluateAutoReviewRules).mockReturnValue({ rule, action: 'auto-approve' })

      const result = await evaluateAutoMergePolicy([rule], '/tmp/worktree')

      expect(result).toEqual({ shouldMerge: false })
    })

    it('returns shouldMerge: true with ruleName when action is auto-merge', async () => {
      mockNumstat('5\t2\tsrc/foo.ts\n')
      const rule = makeRule({ name: 'my-merge-rule' })
      vi.mocked(evaluateAutoReviewRules).mockReturnValue({ rule, action: 'auto-merge' })

      const result = await evaluateAutoMergePolicy([rule], '/tmp/worktree')

      expect(result).toEqual({ shouldMerge: true, ruleName: 'my-merge-rule' })
    })

    it('uses the matched rule name (not the first rule name) in the result', async () => {
      mockNumstat('5\t2\tsrc/foo.ts\n')
      const rules = [makeRule({ name: 'rule-a' }), makeRule({ id: 'rule-2', name: 'rule-b' })]
      vi.mocked(evaluateAutoReviewRules).mockReturnValue({ rule: rules[1], action: 'auto-merge' })

      const result = await evaluateAutoMergePolicy(rules, '/tmp/worktree')

      expect(result).toEqual({ shouldMerge: true, ruleName: 'rule-b' })
    })
  })
})
