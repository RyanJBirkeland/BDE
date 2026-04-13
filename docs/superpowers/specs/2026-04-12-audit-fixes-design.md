# BDE Audit Fixes — Design Spec
**Date:** 2026-04-12  
**Source:** Lensed audit `docs/superpowers/audits/2026-04-12/bde-deep/SYNTHESIS.md`  
**Scope:** All findings with score ≥ 6.0, organized into 6 parallel sprint tasks  
**Constraint:** All tasks are independent of each other and of the TaskStateService refactor (merged 2026-04-12)

---

## Overview

Six parallel pipeline agent tasks fixing the highest-leverage audit findings. Tasks are grouped by domain so each agent has a single clear concern and a focused file list. All tasks must pass `npm run typecheck && npm test && npm run lint` before committing.

---

## Task 1 — Agent Lifecycle Reliability

**Audit findings:** F-t2-agent-life-1, F-t2-agent-life-2, F-t2-agent-life-3  
**Files:** `src/main/agent-manager/completion.ts`, `src/main/agent-manager/run-agent.ts`, `src/main/agent-manager/index.ts`

### Fix 1: resolveDependents on all error paths (F-t2-agent-life-1)
`completion.ts` has 5 early-return paths (worktree eviction, branch detection failure, etc.) that exit without calling `onTaskTerminal()`. Downstream blocked tasks silently orphan on agent failure.

**Change:** Add a `finally` block or sentinel guard so every exit path that sets a terminal status calls `onTaskTerminal()`. The existing `_terminalCalled` guard pattern should be extended — not replaced — so the race between watchdog and completion handler is preserved.

### Fix 2: Watchdog process kill (F-t2-agent-life-2)
`run-agent.ts` watchdog calls `agent.handle.abort()` but does not kill the underlying subprocess. Timed-out agents continue consuming CPU and making API calls.

**Change:** After `agent.handle.abort()`, call `agent.handle.process?.kill('SIGKILL')` (conditional on the property existing in the SDK type). If the SDK handle does not expose `process`, log a warning and note in a comment that this needs revisiting when the SDK exposes the subprocess handle.

### Fix 3: Shutdown timeout (F-t2-agent-life-3)
`index.ts` `stop()` uses a 10-second timeout, but `finalizeAgentRun()` (git rebase, PR creation, dependency resolution) can take 30+ seconds. App quits before cleanup completes, leaving task state incomplete.

**Change:** Increase the `stop()` timeout to 60 seconds. If the SDK or internal completion callbacks expose a way to await pending `onTaskTerminal` calls, await them before returning.

### How to Test
- `npm test` — existing agent-manager tests must pass
- `npm run test:main` — main process integration tests must pass
- Manually verify: read through the `completion.ts` changes and confirm every branch that sets `failed`, `error`, or `cancelled` now calls `onTaskTerminal()`

---

## Task 2 — Prompt Composition Fixes

**Audit findings:** F-t2-prompt-tok-11, F-t2-prompt-tok-10  
**Files:** `src/main/agent-manager/prompt-composer.ts`

### Fix 1: Prompt validation before spawn (F-t2-prompt-tok-11)
`buildAgentPrompt()` can silently produce malformed or near-empty prompts if configuration is missing. There is no guard.

**Change:** At the end of `buildAgentPrompt()` (before returning), add:
- A length check: throw if the assembled prompt is under 200 characters
- Log the total prompt character count at `info` level via `createLogger`
- The error should include the agent type and task ID for debuggability

### Fix 2: Upstream spec truncation (F-t2-prompt-tok-10)
Upstream task context is truncated at 500 characters — barely a title and opening sentence — while the primary spec is truncated at 8000 characters. The inconsistency defeats the value of upstream context.

**Change:** Find `truncateSpec(upstream.spec, 500)` (around line 241) and change the cap to `2000`.

### How to Test
- `npm test` — prompt composer unit tests must pass
- `npm run typecheck`
- Read through the validation logic — confirm it throws on empty/truncated assembly

---

## Task 3 — Data & Interface Hygiene

**Audit findings:** F-t3-sqlite-2, F-t3-sqlite-5, F-t1-repo-pat-3  
**Files:** `src/main/db.ts` (migration), `src/main/data/event-queries.ts`, `src/main/index.ts`

### Fix 1: Wire pruneOldEvents (F-t3-sqlite-2)
`pruneOldEvents()` exists in `event-queries.ts` but has zero callers. The `agent_events` table grows indefinitely.

**Change:** Find the existing daily maintenance task or startup hook in `db.ts` or `index.ts`. Wire in `pruneOldEvents(db, 30)` (30-day retention). If no maintenance hook exists, add a one-time call at app startup after migrations complete.

### Fix 2: Composite index on agent_runs (F-t3-sqlite-5)
Dashboard cost summary queries scan all `agent_runs` rows by status then filter by date. No composite index.

**Change:** Add a new migration (next version number after the current highest — check `PRAGMA user_version` first). Migration: `CREATE INDEX IF NOT EXISTS idx_agent_runs_status_started_at ON agent_runs(status, started_at DESC)`.

### Fix 3: Direct task-group-queries imports (F-t1-repo-pat-3)
`src/main/index.ts` imports task group queries (`getGroup`, `getGroupTasks`, `getGroupsWithDependencies`) directly from `src/main/data/task-group-queries.ts` rather than via the repository instance.

**Change:** First check `ISprintTaskRepository` in `sprint-task-repository.ts` — add only the methods that are genuinely absent from the interface. Then replace the direct `task-group-queries` imports in `index.ts` with calls on the existing `repo` instance. Do not add methods to the interface that are already present.

### How to Test
- `npm test && npm run test:main`
- `npm run typecheck`
- Confirm migration version doesn't conflict: `sqlite3 ~/.bde/bde.db "PRAGMA user_version"`

---

## Task 4 — Security: IPC Hardening

**Audit findings:** F-t4-ipc-valid-1, F-t4-ipc-valid-5  
**Files:** `src/main/handlers/memory-search.ts`, `src/main/handlers/repo-discovery.ts`

### Fix 1: memory:search grep regex DoS (F-t4-ipc-valid-1)
The `memory:search` handler passes unvalidated user query strings to `grep`. Catastrophic backtracking on crafted regex patterns can hang the main process.

**Change:**
1. Add a 200-character length cap: reject queries over 200 chars with a typed error
2. Strip dangerous nested quantifier patterns before passing to grep (e.g. replace `(?:.*)+` style constructs)
3. Add a 5-second timeout to the `execFileAsync('grep', ...)` call — if it times out, return an empty result with a `timedOut: true` flag

### Fix 2: repos:clone owner/repo validation (F-t4-ipc-valid-5)
The `repos:clone` handler passes unvalidated `owner` and `repo` strings directly into git URL construction.

**Change:** Before constructing the URL, add:
```
if (!/^[a-zA-Z0-9_.-]+$/.test(owner) || !/^[a-zA-Z0-9_.-]+$/.test(repo)) {
  throw new Error('Invalid owner or repo name')
}
```

### How to Test
- `npm test && npm run typecheck && npm run lint`
- Manually trace the grep timeout: confirm `execFileAsync` receives a timeout option
- Confirm the regex validation rejects strings with spaces, slashes, and shell metacharacters

---

## Task 5 — Security: Paths + Renderer

**Audit findings:** F-t4-path-trav-1, F-t4-path-trav-2, F-t4-path-trav-6, F-t3-state-mgmt-4  
**Files:** `src/main/agent-manager/run-agent.ts`, `src/main/handlers/` (settings/config handler), `src/main/paths.ts` or `src/main/db.ts`, `src/renderer/src/stores/agentEvents.ts`

### Fix 1: Playground trailing slash (F-t4-path-trav-1)
`run-agent.ts` path containment check uses `resolvedPath.startsWith(resolvedWorktree)`. Missing trailing `/` allows a sibling directory (e.g. `/worktrees/abc123-evil/`) to pass.

**Change:** Change to `resolvedPath.startsWith(resolvedWorktree + '/') || resolvedPath === resolvedWorktree`.

### Fix 2: worktreeBase validation (F-t4-path-trav-2)
`agentManager.worktreeBase` setting is stored and used without validation. Can redirect agent worktrees to arbitrary system directories.

**Change:** In the settings write handler, when `agentManager.worktreeBase` is set, validate that `path.resolve(value)` starts with `homedir() + '/'`. Throw a descriptive error if not.

### Fix 3: BDE_TEST_DB unvalidated (F-t4-path-trav-6)
`process.env.BDE_TEST_DB` is used as the database path without validation. Can write SQLite to arbitrary system paths in CI.

**Change:** In `paths.ts` or `db.ts`, if `BDE_TEST_DB` is set, validate it resolves within `os.tmpdir()`. Throw if not.

### How to Test
- `npm test && npm run typecheck`
- For playground fix: read through `run-agent.ts` and confirm the `startsWith` check has the trailing slash
- For worktreeBase: confirm the validation rejects paths outside home directory

---

## Task 6 — Audit Trail & State Machine Integrity

**Audit findings:** F-t3-audit-trail-1, F-t3-audit-trail-3, F-t3-audit-trail-4, F-t3-audit-trail-5  
**Files:** `src/main/sprint-pr-poller.ts`, `src/main/services/task-state-service.ts`, `src/main/services/task-terminal-service.ts`

**Context:** The TaskStateService refactor (merged 2026-04-12) extracted business logic from `sprint-local.ts`. The PR poller's bulk-transition path was NOT refactored and still has direct SQL UPDATEs that bypass state machine validation and the audit trail.

### Fix 1: PR poller swallows audit trail failures (F-t3-audit-trail-3)
In `transitionTasksToDone()` and `transitionTasksToCancelled()`, audit trail write failures are caught and logged as warnings — the status UPDATE still executes. Audit records are silently lost.

**Change:** Change `catch (err) { logger.warn(...) }` to `throw err` so the wrapping transaction rolls back the status UPDATE if `recordTaskChangesBulk` fails. Both operations must succeed atomically.

### Fix 2: pr_mergeable_state bypasses audit trail (F-t3-audit-trail-1)
The `pr_mergeable_state` field is updated via direct SQL without recording an audit trail entry. This field affects merge button UX but has zero change history.

**Change:** Wrap the `pr_mergeable_state` UPDATE in a `recordTaskChanges()` call, or redirect it through `updateTask()` so the audit machinery fires automatically.

### Fix 3: PR poller calls onTaskTerminal without status verification (F-t3-audit-trail-4)
After the bulk UPDATE, the PR poller calls `onTaskTerminal()` regardless of whether the WHERE clause matched any rows. Dependents can be unblocked for tasks that didn't actually change state.

**Change:** Check the affected row count after the UPDATE. Only call `onTaskTerminal()` for tasks where the UPDATE actually changed a row.

### Fix 4: TaskTerminalService swallows per-task errors (F-t3-audit-trail-5)
The batch dependency resolution loop in `TaskTerminalService` catches per-task errors and continues. Partial failure states are invisible to operators.

**Change:** Accumulate errors across the batch and log them as a consolidated `error`-level entry after the loop completes (not `warn`). Consider surfacing partial failure counts to the caller if the interface supports it.

### How to Test
- `npm test && npm run test:main && npm run typecheck`
- Confirm `transitionTasksToDone` now has the throw-on-audit-failure behavior by reading the final diff carefully
- Confirm `isValidTransition` is called for general status updates in task-state-service.ts

---

## Phasing & Dependencies

All 6 tasks are independent and can run in parallel. Task 6 targets `sprint-pr-poller.ts` and the newly-extracted `task-state-service.ts` — it does NOT conflict with Tasks 1–5.

After these land, the remaining deferred findings (double-claim drain race, prompt token overhead, SDK maxTurns support) can be addressed in a follow-up pass once the SDK exposes the required APIs.
