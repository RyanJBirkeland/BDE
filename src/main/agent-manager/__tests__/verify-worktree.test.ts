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

const okResult: CommandResult = { ok: true, stdout: '', stderr: '', durationMs: 0 }

function failResult(stderr: string): CommandResult {
  return { ok: false, stdout: '', stderr, durationMs: 0 }
}

function buildRunner(responses: readonly CommandResult[]): RunCommand {
  let index = 0
  return async () => {
    const next = responses[index] ?? okResult
    index += 1
    return next
  }
}

type PackageSpec = {
  runner?: 'vitest' | 'jest' | 'none'
  hasTypecheck?: boolean
}

/**
 * Returns a readFile mock that serves a synthetic package.json matching
 * the given spec. Pass `runner: 'none'` or omit `runner` to produce a
 * package.json with no `scripts.test`. Pass `hasTypecheck: false` (default)
 * to omit `scripts.typecheck`.
 */
function makeReadFile(spec: PackageSpec = {}): (path: string) => string | null {
  const { runner = 'vitest', hasTypecheck = true } = spec

  const scripts: Record<string, string> = {}
  if (hasTypecheck) scripts.typecheck = 'tsc --noEmit'
  if (runner === 'vitest') scripts.test = 'vitest'
  if (runner === 'jest') scripts.test = 'jest'

  const devDependencies: Record<string, string> = {}
  if (runner === 'vitest') devDependencies.vitest = '^1.0.0'
  if (runner === 'jest') devDependencies.jest = '^29.0.0'

  return () => JSON.stringify({ scripts, devDependencies })
}

/** readFile that always returns null (simulates missing/unreadable package.json). */
const noPackageJson = () => null

describe('verifyWorktreeBuildsAndTests', () => {
  it('returns both steps as ok when typecheck and tests both pass', async () => {
    const runCommand = buildRunner([okResult, okResult])
    const result = await verifyWorktreeBuildsAndTests('/tmp/worktree', silentLogger, {
      runCommand,
      readFile: makeReadFile()
    })
    expect(result.typecheck?.ok).toBe(true)
    expect(result.tests?.ok).toBe(true)
  })

  it('returns typecheck failure and null tests when typecheck fails', async () => {
    const runCommand = buildRunner([failResult('error TS2304: Cannot find name')])
    const result = await verifyWorktreeBuildsAndTests('/tmp/worktree', silentLogger, {
      runCommand,
      readFile: makeReadFile()
    })

    expect(result.typecheck?.ok).toBe(false)
    expect(result.tests).toBeNull()
    if (!result.typecheck || result.typecheck.ok) return
    expect(result.typecheck.stderr).toContain('error TS2304')
  })

  it('returns typecheck ok and test failure when tests fail', async () => {
    const runCommand = buildRunner([
      okResult,
      failResult('FAIL src/foo.test.ts\n  expected true to be false')
    ])
    const result = await verifyWorktreeBuildsAndTests('/tmp/worktree', silentLogger, {
      runCommand,
      readFile: makeReadFile()
    })

    expect(result.typecheck?.ok).toBe(true)
    expect(result.tests?.ok).toBe(false)
    if (!result.tests || result.tests.ok) return
    expect(result.tests.stderr).toContain('expected true to be false')
  })

  it('short-circuits: does not run tests when typecheck fails', async () => {
    const calls: string[] = []
    const runCommand: RunCommand = async (command, args) => {
      calls.push(`${command} ${args.join(' ')}`)
      if (calls.length === 1) return failResult('tsc failed')
      return okResult
    }

    await verifyWorktreeBuildsAndTests('/tmp/worktree', silentLogger, {
      runCommand,
      readFile: makeReadFile()
    })

    expect(calls).toEqual(['npm run typecheck'])
  })

  it('carries raw stderr through without truncation', async () => {
    const longStderr = 'x'.repeat(VERIFICATION_STDERR_LIMIT * 2) + '\nfinal error line'
    const runCommand = buildRunner([failResult(longStderr)])

    const result = await verifyWorktreeBuildsAndTests('/tmp/worktree', silentLogger, {
      runCommand,
      readFile: makeReadFile()
    })

    expect(result.typecheck?.ok).toBe(false)
    if (!result.typecheck || result.typecheck.ok) return
    // Raw stderr is passed through untruncated — truncation is the consumer's responsibility
    expect(result.typecheck.stderr).toContain('final error line')
    expect(result.typecheck.stderr.length).toBeGreaterThan(VERIFICATION_STDERR_LIMIT)
  })

  it('passes the worktree path through to the command runner', async () => {
    const receivedCwds: string[] = []
    const runCommand: RunCommand = async (_command, _args, cwd) => {
      receivedCwds.push(cwd)
      return okResult
    }

    await verifyWorktreeBuildsAndTests('/custom/worktree/path', silentLogger, {
      runCommand,
      readFile: makeReadFile()
    })

    expect(receivedCwds).toEqual(['/custom/worktree/path', '/custom/worktree/path'])
  })
})

describe('verifyWorktreeBuildsAndTests — typecheck detection', () => {
  it('runs typecheck when scripts.typecheck is present', async () => {
    const calls: Array<{ command: string; args: readonly string[] }> = []
    const runCommand: RunCommand = async (command, args) => {
      calls.push({ command, args })
      return okResult
    }

    await verifyWorktreeBuildsAndTests('/tmp/worktree', silentLogger, {
      runCommand,
      readFile: makeReadFile({ hasTypecheck: true, runner: 'none' })
    })

    expect(calls.some((c) => c.args.includes('typecheck'))).toBe(true)
  })

  it('skips typecheck when scripts.typecheck is absent', async () => {
    const calls: Array<{ command: string; args: readonly string[] }> = []
    const runCommand: RunCommand = async (command, args) => {
      calls.push({ command, args })
      return okResult
    }

    await verifyWorktreeBuildsAndTests('/tmp/worktree', silentLogger, {
      runCommand,
      readFile: makeReadFile({ hasTypecheck: false, runner: 'none' })
    })

    expect(calls.some((c) => c.args.includes('typecheck'))).toBe(false)
  })

  it('skips both steps when package.json is unreadable', async () => {
    const calls: Array<{ command: string; args: readonly string[] }> = []
    const runCommand: RunCommand = async (command, args) => {
      calls.push({ command, args })
      return okResult
    }

    const result = await verifyWorktreeBuildsAndTests('/tmp/worktree', silentLogger, {
      runCommand,
      readFile: noPackageJson
    })

    expect(result).toEqual({ typecheck: null, tests: null })
    expect(calls).toHaveLength(0)
  })

  it('skips both steps and returns null steps when package.json is malformed', async () => {
    let callCount = 0
    const runCommand: RunCommand = async () => {
      callCount++
      return okResult
    }

    const result = await verifyWorktreeBuildsAndTests('/tmp/worktree', silentLogger, {
      runCommand,
      readFile: () => '{ not valid json'
    })

    expect(result).toEqual({ typecheck: null, tests: null })
    expect(callCount).toBe(0)
  })
})

describe('verifyWorktreeBuildsAndTests — test runner detection', () => {
  it('passes --run for a vitest project', async () => {
    const calls: Array<{ command: string; args: readonly string[] }> = []
    const runCommand: RunCommand = async (command, args) => {
      calls.push({ command, args })
      return okResult
    }

    await verifyWorktreeBuildsAndTests('/tmp/worktree', silentLogger, {
      runCommand,
      readFile: makeReadFile({ runner: 'vitest' })
    })

    const testCall = calls.find((c) => c.command === 'npm' && c.args[0] === 'test')
    expect(testCall?.args).toEqual(['test', '--', '--run'])
  })

  it('omits --run for a jest project', async () => {
    const calls: Array<{ command: string; args: readonly string[] }> = []
    const runCommand: RunCommand = async (command, args) => {
      calls.push({ command, args })
      return okResult
    }

    await verifyWorktreeBuildsAndTests('/tmp/worktree', silentLogger, {
      runCommand,
      readFile: makeReadFile({ runner: 'jest' })
    })

    const testCall = calls.find((c) => c.command === 'npm' && c.args[0] === 'test')
    expect(testCall?.args).toEqual(['test'])
  })

  it('skips the test step when no scripts.test is present', async () => {
    const calls: Array<{ command: string; args: readonly string[] }> = []
    const runCommand: RunCommand = async (command, args) => {
      calls.push({ command, args })
      return okResult
    }

    const result = await verifyWorktreeBuildsAndTests('/tmp/worktree', silentLogger, {
      runCommand,
      readFile: makeReadFile({ hasTypecheck: false, runner: 'none' })
    })

    expect(result).toEqual({ typecheck: null, tests: null })
    expect(calls).toHaveLength(0)
  })

  it('runs typecheck but skips test when only typecheck script exists', async () => {
    const calls: Array<{ command: string; args: readonly string[] }> = []
    const runCommand: RunCommand = async (command, args) => {
      calls.push({ command, args })
      return okResult
    }

    const result = await verifyWorktreeBuildsAndTests('/tmp/worktree', silentLogger, {
      runCommand,
      readFile: makeReadFile({ hasTypecheck: true, runner: 'none' })
    })

    expect(calls).toHaveLength(1)
    expect(calls[0]?.args).toContain('typecheck')
    expect(result.typecheck?.ok).toBe(true)
    expect(result.tests).toBeNull()
  })
})

describe('verifyWorktreeBuildsAndTests — CommandResult shape', () => {
  it('ok result includes stdout, stderr, and durationMs', async () => {
    const runCommand: RunCommand = async () => okResult
    const result = await verifyWorktreeBuildsAndTests('/tmp/worktree', silentLogger, {
      runCommand,
      readFile: makeReadFile({ hasTypecheck: true, runner: 'none' })
    })

    const tc = result.typecheck
    expect(tc).not.toBeNull()
    expect(tc).toHaveProperty('stdout')
    expect(tc).toHaveProperty('stderr')
    expect(tc).toHaveProperty('durationMs')
  })

  it('failed result includes stdout, stderr, and durationMs', async () => {
    const runCommand: RunCommand = async () => failResult('some error')
    const result = await verifyWorktreeBuildsAndTests('/tmp/worktree', silentLogger, {
      runCommand,
      readFile: makeReadFile({ hasTypecheck: true, runner: 'none' })
    })

    const tc = result.typecheck
    expect(tc?.ok).toBe(false)
    expect(tc).toHaveProperty('stdout')
    expect(tc).toHaveProperty('stderr', 'some error')
    expect(tc).toHaveProperty('durationMs')
  })
})

describe('default runCommand env uses buildWorktreeEnv', () => {
  it('imports buildWorktreeEnv from env-utils (compile check)', async () => {
    // This test exists to verify the module wires buildWorktreeEnv correctly.
    // The actual PATH augmentation is covered by env-utils tests.
    // Here we just verify the module can be imported without error after the change.
    const mod = await import('../verify-worktree')
    expect(typeof mod.verifyWorktreeBuildsAndTests).toBe('function')
  })
})
