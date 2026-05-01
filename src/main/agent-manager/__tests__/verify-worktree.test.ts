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

/** Returns a readFile mock that serves a package.json with the given runner. */
function makeReadFile(runner: 'vitest' | 'jest' | 'none'): (path: string) => string | null {
  if (runner === 'none') return () => null
  const pkg =
    runner === 'vitest'
      ? { scripts: { test: 'vitest' }, devDependencies: { vitest: '^1.0.0' } }
      : { scripts: { test: 'jest' }, devDependencies: { jest: '^29.0.0' } }
  return () => JSON.stringify(pkg)
}

describe('verifyWorktreeBuildsAndTests', () => {
  it('returns ok when typecheck and tests both pass (vitest project)', async () => {
    const runCommand = buildRunner([{ ok: true }, { ok: true }])
    const result = await verifyWorktreeBuildsAndTests('/tmp/worktree', silentLogger, {
      runCommand,
      readFile: makeReadFile('vitest')
    })
    expect(result).toEqual({ ok: true })
  })

  it('classifies a typecheck failure as "compilation"', async () => {
    const runCommand = buildRunner([{ ok: false, output: 'error TS2304: Cannot find name' }])
    const result = await verifyWorktreeBuildsAndTests('/tmp/worktree', silentLogger, {
      runCommand,
      readFile: makeReadFile('vitest')
    })

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
    const result = await verifyWorktreeBuildsAndTests('/tmp/worktree', silentLogger, {
      runCommand,
      readFile: makeReadFile('vitest')
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure.kind).toBe('test_failure')
    expect(result.failure.stderr).toContain('Pre-review verification: test run failed')
    expect(result.failure.stderr).toContain('expected true to be false')
  })

  it('short-circuits: does not run tests when typecheck fails', async () => {
    const calls: string[] = []
    const runCommand: RunCommand = async (command, args) => {
      calls.push(`${command} ${args.join(' ')}`)
      if (calls.length === 1) return { ok: false, output: 'tsc failed' }
      return { ok: true }
    }

    await verifyWorktreeBuildsAndTests('/tmp/worktree', silentLogger, {
      runCommand,
      readFile: makeReadFile('vitest')
    })

    expect(calls).toEqual(['npm run typecheck'])
  })

  it('tail-truncates long output to VERIFICATION_STDERR_LIMIT', async () => {
    const longOutput = 'x'.repeat(VERIFICATION_STDERR_LIMIT * 2) + '\nfinal error line'
    const runCommand = buildRunner([{ ok: false, output: longOutput }])

    const result = await verifyWorktreeBuildsAndTests('/tmp/worktree', silentLogger, {
      runCommand,
      readFile: makeReadFile('vitest')
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure.stderr).toContain('final error line')
    expect(result.failure.stderr.length).toBeLessThanOrEqual(
      VERIFICATION_STDERR_LIMIT + 'Pre-review verification: typescript error\n\n...\n'.length + 10
    )
  })

  it('passes the worktree path through to the command runner (vitest project)', async () => {
    const receivedCwds: string[] = []
    const runCommand: RunCommand = async (_command, _args, cwd) => {
      receivedCwds.push(cwd)
      return { ok: true }
    }

    await verifyWorktreeBuildsAndTests('/custom/worktree/path', silentLogger, {
      runCommand,
      readFile: makeReadFile('vitest')
    })

    expect(receivedCwds).toEqual(['/custom/worktree/path', '/custom/worktree/path'])
  })
})

describe('verifyWorktreeBuildsAndTests — test runner detection', () => {
  it('passes --run for a vitest project', async () => {
    const calls: Array<{ command: string; args: readonly string[] }> = []
    const runCommand: RunCommand = async (command, args) => {
      calls.push({ command, args })
      return { ok: true }
    }

    await verifyWorktreeBuildsAndTests('/tmp/worktree', silentLogger, {
      runCommand,
      readFile: makeReadFile('vitest')
    })

    const testCall = calls.find((c) => c.command === 'npm' && c.args[0] === 'test')
    expect(testCall?.args).toEqual(['test', '--', '--run'])
  })

  it('omits --run for a jest project', async () => {
    const calls: Array<{ command: string; args: readonly string[] }> = []
    const runCommand: RunCommand = async (command, args) => {
      calls.push({ command, args })
      return { ok: true }
    }

    await verifyWorktreeBuildsAndTests('/tmp/worktree', silentLogger, {
      runCommand,
      readFile: makeReadFile('jest')
    })

    const testCall = calls.find((c) => c.command === 'npm' && c.args[0] === 'test')
    expect(testCall?.args).toEqual(['test'])
  })

  it('skips the test step when no scripts.test is present', async () => {
    const calls: Array<{ command: string; args: readonly string[] }> = []
    const runCommand: RunCommand = async (command, args) => {
      calls.push({ command, args })
      return { ok: true }
    }

    const readFile = () => JSON.stringify({ devDependencies: { vitest: '^1.0.0' } })
    const result = await verifyWorktreeBuildsAndTests('/tmp/worktree', silentLogger, {
      runCommand,
      readFile
    })

    expect(result).toEqual({ ok: true })
    // Only typecheck ran — no test command
    expect(calls).toHaveLength(1)
    expect(calls[0]?.command).toBe('npm')
    expect(calls[0]?.args[0]).toBe('run')
  })

  it('skips the test step when package.json is unreadable', async () => {
    const calls: Array<{ command: string; args: readonly string[] }> = []
    const runCommand: RunCommand = async (command, args) => {
      calls.push({ command, args })
      return { ok: true }
    }

    const result = await verifyWorktreeBuildsAndTests('/tmp/worktree', silentLogger, {
      runCommand,
      readFile: makeReadFile('none')
    })

    expect(result).toEqual({ ok: true })
    expect(calls).toHaveLength(1)
  })

  it('skips the test step when package.json is malformed JSON', async () => {
    const calls: Array<{ command: string; args: readonly string[] }> = []
    const runCommand: RunCommand = async (command, args) => {
      calls.push({ command, args })
      return { ok: true }
    }

    const result = await verifyWorktreeBuildsAndTests('/tmp/worktree', silentLogger, {
      runCommand,
      readFile: () => '{ not valid json'
    })

    expect(result).toEqual({ ok: true })
    expect(calls).toHaveLength(1)
  })

  it('returns ok with only one command call when test step is skipped', async () => {
    let callCount = 0
    const runCommand: RunCommand = async () => {
      callCount++
      return { ok: true }
    }

    await verifyWorktreeBuildsAndTests('/tmp/worktree', silentLogger, {
      runCommand,
      readFile: makeReadFile('none')
    })

    expect(callCount).toBe(1)
  })
})
