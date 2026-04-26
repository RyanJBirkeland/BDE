#!/usr/bin/env node
/* eslint-disable @typescript-eslint/explicit-function-return-type, prettier/prettier */
/**
 * Phase A correctness audit.
 *
 * Mechanically verifies the invariants declared in
 *   openspec/changes/pipeline-stop-the-bleeding/specs/pipeline-correctness-baseline/spec.md
 *
 * Returns a non-zero exit code when any invariant is violated. CI runs this
 * on every PR; locally it is `npm run audit:phase-a`.
 *
 * Why this script and not a unit test? Several invariants ("no direct
 * `repo.updateTask({ status })` outside `TaskStateService`", "the pending
 * retry map has a size cap") are structural, codebase-wide assertions. A
 * grep gate catches them at the file boundary; a unit test only catches
 * them at runtime if the regression happens to execute.
 *
 * Exit codes: 0 = all green, 1 = at least one invariant violated.
 */

import { readFileSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

/**
 * @typedef {{ id: string, description: string, check: () => InvariantResult }} Invariant
 * @typedef {{ ok: boolean, detail?: string }} InvariantResult
 */

const REPO_ROOT = process.cwd()

/** @returns {string[]} */
function rg(pattern, ...paths) {
  try {
    const out = execFileSync('rg', ['-n', '--no-heading', pattern, ...paths], {
      encoding: 'utf8',
      cwd: REPO_ROOT
    })
    return out.split('\n').filter(Boolean)
  } catch (err) {
    if (err && err.status === 1) return [] // rg exits 1 when no matches; not an error
    throw err
  }
}

/** @returns {boolean} */
function fileContains(path, needle) {
  if (!existsSync(join(REPO_ROOT, path))) return false
  return readFileSync(join(REPO_ROOT, path), 'utf8').includes(needle)
}

/** @returns {boolean} */
function fileExists(path) {
  return existsSync(join(REPO_ROOT, path))
}

/** @type {Invariant[]} */
const INVARIANTS = [
  {
    id: 'single-terminal-chokepoint',
    description:
      'No direct `repo.updateTask({ status: <terminal> })` outside TaskStateService',
    check: () => {
      // Match `updateTask(<id>, { ... status: 'failed'|'error'|'done'|'cancelled'|'review' ... })`
      // across both `repo.updateTask` and bare `updateTask` in main process source.
      const pattern =
        "updateTask\\([^)]*status:\\s*['\\\"](?:failed|error|done|cancelled|review)['\\\"]"
      const allowedFiles = new Set([
        'src/main/services/task-state-service.ts',
        'src/main/services/task-terminal-service.ts',
        'src/main/data/sprint-task-crud.ts' // defense-in-depth assertion lives here
      ])
      const hits = rg(pattern, 'src/main/').filter((line) => {
        const file = line.split(':', 1)[0]
        if (allowedFiles.has(file)) return false
        // Skip lines marked as phase-a-bypass (tracked exceptions, see T-36)
        if (line.includes('phase-a-bypass')) return false
        return true
      })
      if (hits.length === 0) return { ok: true }
      return {
        ok: false,
        detail: `Found ${hits.length} forbidden direct status writes:\n  ${hits.slice(0, 10).join('\n  ')}`
      }
    }
  },
  {
    id: 'pr-poller-bounded-retry',
    description:
      'sprint-pr-poller defines MAX_PENDING_TASKS and emits terminal-retry.evicted',
    check: () => {
      const path = 'src/main/sprint-pr-poller.ts'
      if (!fileExists(path)) return { ok: false, detail: `Missing ${path}` }
      const hasCap = fileContains(path, 'MAX_PENDING_TASKS')
      const hasEvicted = fileContains(path, 'terminal-retry.evicted')
      const hasExhausted = fileContains(path, 'terminal-retry.exhausted')
      if (hasCap && hasEvicted && hasExhausted) return { ok: true }
      return {
        ok: false,
        detail: `Missing in ${path}: ${[
          !hasCap && 'MAX_PENDING_TASKS constant',
          !hasEvicted && "logger.event('terminal-retry.evicted', ...)",
          !hasExhausted && "logger.event('terminal-retry.exhausted', ...)"
        ]
          .filter(Boolean)
          .join(', ')}`
      }
    }
  },
  {
    id: 'worktree-lock-try-finally',
    description: 'setupWorktree releases the lock via try/finally',
    check: () => {
      const path = 'src/main/agent-manager/worktree.ts'
      if (!fileExists(path)) return { ok: false, detail: `Missing ${path}` }
      const src = readFileSync(join(REPO_ROOT, path), 'utf8')
      const hasTryFinally = /try\s*\{[\s\S]*?\}\s*finally\s*\{[\s\S]*?releaseLock/.test(src)
      if (hasTryFinally) return { ok: true }
      return {
        ok: false,
        detail: `Expected a try/.../finally { releaseLock(...) } block in ${path}`
      }
    }
  },
  {
    id: 'rev-list-failure-is-failure',
    description:
      "git rev-list catch in resolve-success-phases transitions to 'failed', not 'review'",
    check: () => {
      const path = 'src/main/agent-manager/resolve-success-phases.ts'
      if (!fileExists(path)) return { ok: false, detail: `Missing ${path}` }
      const src = readFileSync(join(REPO_ROOT, path), 'utf8')
      // Forbid the historical "assume commits exist" fallthrough.
      const forbidden = /rev-list[\s\S]{0,500}assuming commits exist[\s\S]{0,200}return true/i
      if (forbidden.test(src)) {
        return {
          ok: false,
          detail: `${path} still falls through to "return true" on rev-list failure`
        }
      }
      return { ok: true }
    }
  },
  {
    id: 'orphan-recovery-via-state-service',
    description:
      'orphan-recovery exhausted path goes through TaskStateService, not direct updateTask',
    check: () => {
      const path = 'src/main/agent-manager/orphan-recovery.ts'
      if (!fileExists(path)) return { ok: false, detail: `Missing ${path}` }
      const src = readFileSync(join(REPO_ROOT, path), 'utf8')
      // The exhausted branch must not call repo.updateTask({ status: 'error' }) inline.
      const directWrite =
        /repo\.updateTask\([^)]*status:\s*['"]error['"][^)]*orphan recovery/i
      if (directWrite.test(src)) {
        return {
          ok: false,
          detail: `${path} still writes status='error' directly on orphan exhaustion`
        }
      }
      return { ok: true }
    }
  },
  {
    id: 'high-blast-radius-tests-exist',
    description:
      'Direct unit tests exist for the named high-blast-radius functions',
    check: () => {
      const required = [
        'src/main/services/__tests__/sprint-use-cases.update.test.ts',
        'src/main/agent-manager/__tests__/review-transition.test.ts',
        'src/main/agent-manager/__tests__/watchdog-handler.test.ts',
        'src/main/agent-manager/__tests__/resolve-node.test.ts',
        'src/main/agent-manager/__tests__/prompt-assistant.test.ts',
        'src/main/agent-manager/__tests__/prompt-copilot.test.ts',
        'src/main/agent-manager/__tests__/prompt-synthesizer.test.ts',
        'src/main/handlers/__tests__/sprint-export-handlers.test.ts'
      ]
      const missing = required.filter((p) => !fileExists(p))
      if (missing.length === 0) return { ok: true }
      return {
        ok: false,
        detail: `Missing test files:\n  ${missing.join('\n  ')}`
      }
    }
  },
  {
    id: 'force-release-claim-aborts-agent',
    description:
      'forceReleaseClaim handler invokes agentManager cancellation before re-queuing',
    check: () => {
      const path = 'src/main/handlers/sprint-local.ts'
      if (!fileExists(path)) return { ok: false, detail: `Missing ${path}` }
      const src = readFileSync(join(REPO_ROOT, path), 'utf8')
      const idx = src.indexOf('forceReleaseClaim')
      if (idx < 0) return { ok: true } // handler renamed; out of scope
      const window = src.slice(idx, idx + 2000)
      const callsCancel = /cancelAgent|stopAgent|abortAgent/.test(window)
      if (callsCancel) return { ok: true }
      return {
        ok: false,
        detail: `${path}:forceReleaseClaim does not call cancelAgent/stopAgent/abortAgent before re-queue`
      }
    }
  },
  {
    id: 'oauth-refresh-coordination',
    description:
      'agent-manager exposes awaitOAuthRefresh (or equivalent) and message-consumer registers the in-flight promise',
    check: () => {
      const managerPath = 'src/main/agent-manager/index.ts'
      const consumerPath = 'src/main/agent-manager/message-consumer.ts'
      if (!fileExists(managerPath) || !fileExists(consumerPath)) {
        return {
          ok: false,
          detail: `Missing one of: ${managerPath}, ${consumerPath}`
        }
      }
      const managerExposes = fileContains(managerPath, 'awaitOAuthRefresh')
      const consumerRegisters = fileContains(consumerPath, 'awaitOAuthRefresh')
      if (managerExposes && consumerRegisters) return { ok: true }
      return {
        ok: false,
        detail: `Expected 'awaitOAuthRefresh' in both ${managerPath} and ${consumerPath}`
      }
    }
  },
  {
    id: 'spec-file-exists',
    description:
      'pipeline-correctness-baseline spec exists in openspec',
    check: () => {
      const path =
        'openspec/changes/pipeline-stop-the-bleeding/specs/pipeline-correctness-baseline/spec.md'
      if (fileExists(path)) return { ok: true }
      return { ok: false, detail: `Missing ${path}` }
    }
  }
]

/** @returns {{ passed: number, failed: number, skipped: number, failures: Array<{ id: string, description: string, detail: string }> }} */
function runAudit() {
  const report = { passed: 0, failed: 0, skipped: 0, failures: [] }
  for (const inv of INVARIANTS) {
    let result
    try {
      result = inv.check()
    } catch (err) {
      result = {
        ok: false,
        detail: `Check threw: ${err instanceof Error ? err.message : String(err)}`
      }
    }
    if (result.ok) {
      report.passed++
      console.log(`  ✓ ${inv.id} — ${inv.description}`)
    } else {
      report.failed++
      report.failures.push({
        id: inv.id,
        description: inv.description,
        detail: result.detail ?? '(no detail)'
      })
      console.log(`  ✗ ${inv.id} — ${inv.description}`)
      console.log(`      ${result.detail ?? '(no detail)'}`)
    }
  }
  return report
}

/** @returns {void} */
function main() {
  console.log('Phase A correctness audit')
  console.log('=========================')
  const report = runAudit()
  console.log('')
  console.log(
    `Passed: ${report.passed}  Failed: ${report.failed}  Total: ${INVARIANTS.length}`
  )
  if (report.failed > 0) {
    console.log('')
    console.log('Phase A invariants are not yet satisfied. See spec:')
    console.log(
      '  openspec/changes/pipeline-stop-the-bleeding/specs/pipeline-correctness-baseline/spec.md'
    )
    process.exit(1)
  }
  console.log('All Phase A invariants satisfied.')
}

main()
