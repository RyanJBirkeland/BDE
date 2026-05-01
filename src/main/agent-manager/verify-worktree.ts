/**
 * Pre-review verification — runs `npm run typecheck` and `npm test` inside the
 * agent's worktree after it has committed, before transition to `review`.
 *
 * A broken commit never makes it in front of a human reviewer: if either
 * check fails, the task is requeued with the tool's stderr in the notes so
 * the retry agent sees exactly what went wrong.
 *
 * Test runner detection: reads `package.json` from the worktree to determine
 * the correct test flags. Vitest requires `--run` to exit after one pass;
 * other runners (Jest, Mocha, etc.) use plain `npm test`. If no `scripts.test`
 * exists, the test step is skipped entirely.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Logger } from '../logger'
import { execFileAsync } from '../lib/async-utils'
import { buildAgentEnv } from '../env-utils'

export const VERIFICATION_STDERR_LIMIT = 2000
const TYPECHECK_TIMEOUT_MS = 120_000
const TEST_TIMEOUT_MS = 300_000

export type VerificationFailureKind = 'compilation' | 'test_failure'

export interface VerificationFailure {
  kind: VerificationFailureKind
  stderr: string
}

export type VerificationResult = { ok: true } | { ok: false; failure: VerificationFailure }

export interface VerificationDeps {
  runCommand: RunCommand
  /** Override filesystem read for testing. Defaults to `fs.readFileSync`. */
  readFile?: (path: string) => string | null
}

export type RunCommand = (
  command: string,
  args: readonly string[],
  cwd: string,
  timeoutMs: number
) => Promise<CommandResult>

export type CommandResult = { ok: true } | { ok: false; output: string }

/** Which test runner is present in the project, or 'none' when absent/undetectable. */
type TestRunner = 'vitest' | 'other' | 'none'

interface CommandAttempt {
  command: string
  args: readonly string[]
  timeoutMs: number
  failureKind: VerificationFailureKind
  keywordHint: string
}

const TYPECHECK_ATTEMPT: CommandAttempt = {
  command: 'npm',
  args: ['run', 'typecheck'],
  timeoutMs: TYPECHECK_TIMEOUT_MS,
  failureKind: 'compilation',
  keywordHint: 'typescript error'
}

/**
 * Reads `package.json` from the worktree and determines which test runner is
 * configured. Returns:
 * - `'vitest'`  — `vitest` found in dependencies/devDependencies
 * - `'other'`   — a `scripts.test` exists but vitest is not in deps
 * - `'none'`    — no `scripts.test`, unreadable file, or parse failure
 */
function detectTestRunner(
  worktreePath: string,
  readFile: (path: string) => string | null
): TestRunner {
  const pkgPath = join(worktreePath, 'package.json')
  let pkg: Record<string, unknown>
  try {
    const raw = readFile(pkgPath)
    if (!raw) return 'none'
    pkg = JSON.parse(raw) as Record<string, unknown>
  } catch {
    return 'none'
  }
  const scripts = pkg.scripts as Record<string, string> | undefined
  if (!scripts?.test) return 'none'
  const allDeps = {
    ...(pkg.dependencies as object | undefined),
    ...(pkg.devDependencies as object | undefined)
  }
  if ('vitest' in allDeps) return 'vitest'
  return 'other'
}

export async function verifyWorktreeBuildsAndTests(
  worktreePath: string,
  logger: Logger,
  deps: VerificationDeps = defaultDeps()
): Promise<VerificationResult> {
  const typecheck = await runVerificationAttempt(TYPECHECK_ATTEMPT, worktreePath, logger, deps)
  if (!typecheck.ok) return typecheck

  const readFile = deps.readFile ?? defaultReadFile
  const runner = detectTestRunner(worktreePath, readFile)

  if (runner === 'none') {
    logger.info(`[verify-worktree] no test script detected at ${worktreePath} — skipping test step`)
    return { ok: true }
  }

  const testAttempt: CommandAttempt = {
    command: 'npm',
    args: runner === 'vitest' ? ['test', '--', '--run'] : ['test'],
    timeoutMs: TEST_TIMEOUT_MS,
    failureKind: 'test_failure',
    keywordHint: 'test run failed'
  }

  const tests = await runVerificationAttempt(testAttempt, worktreePath, logger, deps)
  if (!tests.ok) return tests

  return { ok: true }
}

async function runVerificationAttempt(
  attempt: CommandAttempt,
  worktreePath: string,
  logger: Logger,
  deps: VerificationDeps
): Promise<VerificationResult> {
  const label = `${attempt.command} ${attempt.args.join(' ')}`
  const result = await deps.runCommand(attempt.command, attempt.args, worktreePath, attempt.timeoutMs)

  if (result.ok) {
    logger.info(`[verify-worktree] ${label} passed at ${worktreePath}`)
    return { ok: true }
  }

  logger.warn(`[verify-worktree] ${label} failed at ${worktreePath}`)
  const stderr = formatFailureNote(attempt, result.output)
  return { ok: false, failure: { kind: attempt.failureKind, stderr } }
}

function formatFailureNote(attempt: CommandAttempt, output: string): string {
  const tail = tailTruncate(output, VERIFICATION_STDERR_LIMIT)
  const header = `Pre-review verification: ${attempt.keywordHint}`
  return `${header}\n\n${tail}`
}

function tailTruncate(text: string, limit: number): string {
  if (text.length <= limit) return text
  return `...\n${text.slice(-limit)}`
}

function defaultDeps(): VerificationDeps {
  return { runCommand: execFileRunCommand }
}

function defaultReadFile(path: string): string | null {
  try {
    return readFileSync(path, 'utf-8')
  } catch {
    return null
  }
}

async function execFileRunCommand(
  command: string,
  args: readonly string[],
  cwd: string,
  timeoutMs: number
): Promise<CommandResult> {
  try {
    await execFileAsync(command, [...args], {
      cwd,
      env: buildAgentEnv(),
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024
    })
    return { ok: true }
  } catch (err) {
    return { ok: false, output: extractCommandOutput(err) }
  }
}

function extractCommandOutput(err: unknown): string {
  if (err && typeof err === 'object') {
    const record = err as Record<string, unknown>
    const stderr = typeof record.stderr === 'string' ? record.stderr : ''
    const stdout = typeof record.stdout === 'string' ? record.stdout : ''
    const combined = [stderr, stdout].filter((s) => s.length > 0).join('\n')
    if (combined.length > 0) return combined
  }
  return err instanceof Error ? err.message : String(err)
}
