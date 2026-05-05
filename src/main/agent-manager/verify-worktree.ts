/**
 * Pre-review verification — runs `npm run typecheck` and `npm test` inside the
 * agent's worktree after it has committed, before transition to `review`.
 *
 * A broken commit never makes it in front of a human reviewer: if either
 * check fails, the task is requeued with the tool's stderr in the notes so
 * the retry agent sees exactly what went wrong.
 *
 * Both steps are driven by the worktree's `package.json` so the verification
 * works correctly across any repo:
 *
 *   Typecheck: runs `npm run typecheck` only when `scripts.typecheck` exists.
 *   Tests:     runs `npm test -- --run` for Vitest, plain `npm test` for all
 *              other runners. Skipped entirely when `scripts.test` is absent.
 *
 * Skipping a step is not the same as passing it — it means the project has not
 * opted into that check. The task still proceeds to `review` so the human
 * reviewer can inspect the changes.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Logger } from '../logger'
import { execFileAsync } from '../lib/async-utils'
import { buildWorktreeEnv } from '../env-utils'

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

export type CommandResult =
  | { ok: true; stdout: string; stderr: string; durationMs: number }
  | { ok: false; stdout: string; stderr: string; durationMs: number }

/** Full output of both verification steps. null = step was not run. */
export interface WorktreeVerificationOutput {
  typecheck: CommandResult | null
  tests: CommandResult | null
}

/** Which test runner is present in the project, or 'none' when absent/undetectable. */
type TestRunner = 'vitest' | 'other' | 'none'

interface ProjectScripts {
  /** Whether `scripts.typecheck` exists in package.json. */
  hasTypecheck: boolean
  /** Which test runner is configured, based on devDependencies and scripts.test. */
  testRunner: TestRunner
}

interface CommandAttempt {
  command: string
  args: readonly string[]
  timeoutMs: number
  failureKind: VerificationFailureKind
  keywordHint: string
}

/**
 * Reads `package.json` from the worktree and returns which verification steps
 * are available. On any read/parse failure, all steps are reported absent so
 * the verification gate skips gracefully rather than blocking the task.
 */
function detectProjectScripts(
  worktreePath: string,
  readFile: (path: string) => string | null
): ProjectScripts {
  const pkgPath = join(worktreePath, 'package.json')
  let pkg: Record<string, unknown>
  try {
    const raw = readFile(pkgPath)
    if (!raw) return { hasTypecheck: false, testRunner: 'none' }
    pkg = JSON.parse(raw) as Record<string, unknown>
  } catch {
    return { hasTypecheck: false, testRunner: 'none' }
  }

  const scripts = pkg.scripts as Record<string, string> | undefined
  const hasTypecheck = !!scripts?.typecheck
  const hasTestScript = !!scripts?.test

  if (!hasTestScript) {
    return { hasTypecheck, testRunner: 'none' }
  }

  const allDeps = {
    ...(pkg.dependencies as object | undefined),
    ...(pkg.devDependencies as object | undefined)
  }
  const testRunner: TestRunner = 'vitest' in allDeps ? 'vitest' : 'other'
  return { hasTypecheck, testRunner }
}

export async function verifyWorktreeBuildsAndTests(
  worktreePath: string,
  logger: Logger,
  deps: VerificationDeps = defaultDeps()
): Promise<WorktreeVerificationOutput> {
  const readFile = deps.readFile ?? defaultReadFile
  const scripts = detectProjectScripts(worktreePath, readFile)

  let typecheckResult: CommandResult | null = null

  if (!scripts.hasTypecheck) {
    logger.info(`[verify-worktree] no typecheck script at ${worktreePath} — skipping typecheck`)
  } else {
    const typecheckAttempt: CommandAttempt = {
      command: 'npm',
      args: ['run', 'typecheck'],
      timeoutMs: TYPECHECK_TIMEOUT_MS,
      failureKind: 'compilation',
      keywordHint: 'typescript error'
    }
    typecheckResult = await runVerificationAttempt(typecheckAttempt, worktreePath, logger, deps)
    if (!typecheckResult.ok) {
      return { typecheck: typecheckResult, tests: null }
    }
  }

  if (scripts.testRunner === 'none') {
    logger.info(`[verify-worktree] no test script at ${worktreePath} — skipping test step`)
    return { typecheck: typecheckResult, tests: null }
  }

  const testAttempt: CommandAttempt = {
    command: 'npm',
    args: scripts.testRunner === 'vitest' ? ['test', '--', '--run'] : ['test'],
    timeoutMs: TEST_TIMEOUT_MS,
    failureKind: 'test_failure',
    keywordHint: 'test run failed'
  }
  const testsResult = await runVerificationAttempt(testAttempt, worktreePath, logger, deps)
  return { typecheck: typecheckResult, tests: testsResult }
}

async function runVerificationAttempt(
  attempt: CommandAttempt,
  worktreePath: string,
  logger: Logger,
  deps: VerificationDeps
): Promise<CommandResult> {
  const label = `${attempt.command} ${attempt.args.join(' ')}`
  const result = await deps.runCommand(attempt.command, attempt.args, worktreePath, attempt.timeoutMs)
  if (result.ok) {
    logger.info(`[verify-worktree] ${label} passed at ${worktreePath}`)
  } else {
    logger.warn(`[verify-worktree] ${label} failed at ${worktreePath}`)
  }
  return result
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
  const startMs = Date.now()
  try {
    const result = await execFileAsync(command, [...args], {
      cwd,
      env: buildWorktreeEnv(cwd),
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024
    })
    return {
      ok: true,
      stdout: typeof result.stdout === 'string' ? result.stdout : '',
      stderr: typeof result.stderr === 'string' ? result.stderr : '',
      durationMs: Date.now() - startMs
    }
  } catch (err) {
    const { stdout, stderr } = extractCommandOutputParts(err)
    return { ok: false, stdout, stderr, durationMs: Date.now() - startMs }
  }
}

function extractCommandOutputParts(err: unknown): { stdout: string; stderr: string } {
  if (err && typeof err === 'object') {
    const record = err as Record<string, unknown>
    return {
      stdout: typeof record.stdout === 'string' ? record.stdout : '',
      stderr: typeof record.stderr === 'string' ? record.stderr : ''
    }
  }
  const msg = err instanceof Error ? err.message : String(err)
  return { stdout: '', stderr: msg }
}
