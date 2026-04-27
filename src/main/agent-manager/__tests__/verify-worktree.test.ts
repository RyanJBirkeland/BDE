import { describe, it, expect, vi } from 'vitest'
import {
  verifyWorktreeBuildsAndTests,
  VERIFICATION_STDERR_LIMIT,
  type CommandResult,
  type RunCommand
} from '../verify-worktree'

const silentLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn()
} as unknown as Parameters<typeof verifyWorktreeBuildsAndTests>[1]

function buildRunner(responses: readonly CommandResult[]): RunCommand {
  let index = 0
  return async () => {
    const next = responses[index] ?? { ok: true }
    index += 1
    return next
  }
}

describe('verifyWorktreeBuildsAndTests', () => {
  it('returns ok when typecheck and tests both pass', async () => {
    const runCommand = buildRunner([{ ok: true }, { ok: true }])
    const result = await verifyWorktreeBuildsAndTests('/tmp/worktree', silentLogger, { runCommand })
    expect(result).toEqual({ ok: true })
  })

  it('classifies a typecheck failure as "compilation"', async () => {
    const runCommand = buildRunner([{ ok: false, output: 'error TS2304: Cannot find name' }])
    const result = await verifyWorktreeBuildsAndTests('/tmp/worktree', silentLogger, { runCommand })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure.kind).toBe('compilation')
    expect(result.failure.stderr).toContain('Pre-review verification: typescript error')
    expect(result.failure.stderr).toContain('error TS2304')
  })

  it('classifies a test failure as "test_failure" and includes the test output', async () => {
    const runCommand = buildRunner([
      { ok: true },
      { ok: false, output: 'FAIL src/foo.test.ts\n  expected true to be false' }
    ])
    const result = await verifyWorktreeBuildsAndTests('/tmp/worktree', silentLogger, { runCommand })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure.kind).toBe('test_failure')
    expect(result.failure.stderr).toContain('Pre-review verification: vitest failed')
    expect(result.failure.stderr).toContain('expected true to be false')
  })

  it('short-circuits: does not run tests when typecheck fails', async () => {
    const calls: string[] = []
    const runCommand: RunCommand = async (command, args) => {
      calls.push(`${command} ${args.join(' ')}`)
      if (calls.length === 1) return { ok: false, output: 'tsc failed' }
      return { ok: true }
    }

    await verifyWorktreeBuildsAndTests('/tmp/worktree', silentLogger, { runCommand })

    expect(calls).toEqual(['npm run typecheck'])
  })

  it('tail-truncates long output to VERIFICATION_STDERR_LIMIT', async () => {
    const longOutput = 'x'.repeat(VERIFICATION_STDERR_LIMIT * 2) + '\nfinal error line'
    const runCommand = buildRunner([{ ok: false, output: longOutput }])

    const result = await verifyWorktreeBuildsAndTests('/tmp/worktree', silentLogger, { runCommand })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure.stderr).toContain('final error line')
    expect(result.failure.stderr.length).toBeLessThanOrEqual(
      VERIFICATION_STDERR_LIMIT + 'Pre-review verification: typescript error\n\n...\n'.length + 10
    )
  })

  it('passes the worktree path through to the command runner', async () => {
    const receivedCwds: string[] = []
    const runCommand: RunCommand = async (_command, _args, cwd) => {
      receivedCwds.push(cwd)
      return { ok: true }
    }

    await verifyWorktreeBuildsAndTests('/custom/worktree/path', silentLogger, { runCommand })

    expect(receivedCwds).toEqual(['/custom/worktree/path', '/custom/worktree/path'])
  })
})
