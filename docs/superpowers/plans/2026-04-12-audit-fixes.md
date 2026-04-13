# BDE Audit Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the 15 highest-leverage findings from the 2026-04-12 BDE lensed audit across 6 parallel pipeline agent tasks.

**Architecture:** Each task is a self-contained sprint task spec seeded directly into BDE's SQLite database. All 6 tasks are independent and can run in parallel — they touch non-overlapping files. Each pipeline agent works in an isolated git worktree, runs `npm run typecheck && npm test && npm run lint` before committing, and transitions to `review` status when complete.

**Tech Stack:** TypeScript, Electron (main process), Vitest, SQLite (better-sqlite3), Zustand (renderer)

**Spec source:** `docs/superpowers/specs/2026-04-12-audit-fixes-design.md`  
**Audit source:** `docs/superpowers/audits/2026-04-12/bde-deep/SYNTHESIS.md`

---

## File Map

| Task | Files Modified | Conflicts |
|------|---------------|-----------|
| Task 1: Agent Lifecycle + Playground Path | `completion.ts`, `run-agent.ts`, `agent-manager/index.ts` | None |
| Task 2: Prompt Composition | `prompt-composer.ts` | None |
| Task 3: Data Hygiene | `db.ts`, `event-queries.ts`, `index.ts` | None |
| Task 4: IPC Security | `memory-search.ts`, `repo-discovery.ts` | None |
| Task 5: Path Security | config/settings handler, `paths.ts` or `db.ts` | None |
| Task 6: Audit Trail | `sprint-queries.ts`, `task-terminal-service.ts` | None |

> Note: `run-agent.ts` playground fix is in Task 1 (not Task 5) to avoid merge conflict.

---

## Task 1: Agent Lifecycle Reliability + Playground Path Fix

**Spec for pipeline agent:**

```
## Goal
Fix three reliability gaps in the agent lifecycle and one security gap in playground HTML path validation.

## Changes

### 1. Verify resolveDependents on all error paths
File: src/main/agent-manager/completion.ts

IMPORTANT: Read completion.ts in full FIRST. Most early-return paths already call `failTaskWithError()`, which internally calls `onTaskTerminal()`. Do not add redundant calls.

Specifically audit the `resolveSuccess` function: for each branch that sets the task to 'failed', 'error', or 'cancelled', confirm that it calls either `failTaskWithError(...)` (which calls `onTaskTerminal`) or `onTaskTerminal` directly. Only add calls where they are genuinely absent. If all paths already call it correctly, no change is needed to this file and that is acceptable — document what you found in the commit message.

### 2. Watchdog process kill
File: src/main/agent-manager/run-agent.ts

The watchdog calls agent.handle.abort() but does not kill the underlying subprocess. Timed-out agents continue consuming CPU.

After the abort() call in the watchdog timeout handler, add:
  const proc = (agent.handle as any).process
  if (proc && typeof proc.kill === 'function') {
    proc.kill('SIGKILL')
  }

If the SDK type exposes process directly (without casting), use that. Add a comment: "SDK may not expose process — revisit when SDK exposes subprocess handle".

### 3. Shutdown timeout
File: src/main/agent-manager/index.ts

The stop() method uses a 10-second timeout but finalizeAgentRun() (git operations, PR creation) takes 30+ seconds. Tasks are left in incomplete state on app quit.

Find the stop() method timeout. Increase it from 10000 to 60000 (60 seconds). Add a comment explaining why: "finalizeAgentRun includes git rebase + PR creation which can take 30+ seconds".

### 4. Playground path trailing slash
File: src/main/agent-manager/run-agent.ts

The playground HTML path containment check uses:
  resolvedPath.startsWith(resolvedWorktree)

This incorrectly allows a sibling directory (e.g. /worktrees/abc123-evil/) to pass.

Change to:
  resolvedPath.startsWith(resolvedWorktree + '/') || resolvedPath === resolvedWorktree

## Files to Change
- src/main/agent-manager/completion.ts
- src/main/agent-manager/run-agent.ts
- src/main/agent-manager/index.ts

## How to Test
1. npm run typecheck — must pass with zero errors
2. npm test — all unit tests must pass
3. npm run test:main — main process integration tests must pass
4. npm run lint — zero errors

Manual review checklist (read the diff carefully):
- completion.ts: every branch that sets status to failed/error/cancelled calls onTaskTerminal()
- run-agent.ts: watchdog handler has the SIGKILL call after abort()
- run-agent.ts: playground startsWith uses the trailing slash pattern
- index.ts: stop() timeout is 60000
```

### Steps

- [ ] Check current git SHA: `git log --oneline -3` in the worktree
- [ ] Read `src/main/agent-manager/completion.ts` in full — map every branch that sets a terminal status
- [ ] Read `src/main/agent-manager/run-agent.ts` — find watchdog handler and playground startsWith check
- [ ] Read `src/main/agent-manager/index.ts` — find stop() timeout
- [ ] Write tests first for the completion.ts change (if testable — at minimum add a test that verifies onTaskTerminal is called when an early-return error path is taken)
- [ ] Run tests to confirm they fail: `npm run test:main`
- [ ] Apply Fix 1 (completion.ts early-return paths)
- [ ] Apply Fix 2 (run-agent.ts SIGKILL after abort)
- [ ] Apply Fix 3 (index.ts timeout 60000)
- [ ] Apply Fix 4 (run-agent.ts playground trailing slash)
- [ ] `npm run typecheck` — fix any errors
- [ ] `npm test && npm run test:main` — all must pass
- [ ] `npm run lint` — zero errors
- [ ] Commit:
  ```bash
  git add src/main/agent-manager/completion.ts src/main/agent-manager/run-agent.ts src/main/agent-manager/index.ts
  git commit -m "fix: agent lifecycle reliability — resolveDependents on error paths, watchdog SIGKILL, shutdown timeout, playground path"
  ```

---

## Task 2: Prompt Composition Fixes

**Spec for pipeline agent:**

```
## Goal
Two fixes in prompt-composer.ts: add validation after prompt assembly, and increase upstream spec truncation from 500 to 2000 characters.

## Changes

### 1. Prompt validation guard
File: src/main/agent-manager/prompt-composer.ts

buildAgentPrompt() can silently produce a near-empty or malformed prompt if configuration is missing. There is no guard.

At the end of buildAgentPrompt() (before the return statement), add:
- A length check: if the assembled prompt length is under 200 characters, throw new Error(`[prompt-composer] Assembled prompt is too short (${prompt.length} chars) — check agent type '${agentType}' configuration`)
- A log statement: logger.info(`[prompt-composer] Assembled prompt: ${prompt.length} chars for agent type '${agentType}'`)

Use the existing logger from createLogger in the file. If no logger exists in the file, create one: const logger = createLogger('prompt-composer')

### 2. Upstream spec truncation
File: src/main/agent-manager/prompt-composer.ts

Upstream task context is truncated at 500 characters while the primary spec is truncated at 8000. Find the call: truncateSpec(upstream.spec, 500) (approximately line 241) and change 500 to 2000.

## Files to Change
- src/main/agent-manager/prompt-composer.ts

## How to Test
1. npm run typecheck — zero errors
2. npm test — all unit tests pass (check for existing prompt-composer tests)
3. npm run lint

Manual review:
- buildAgentPrompt() throws if prompt < 200 chars
- buildAgentPrompt() logs prompt character count at info level
- truncateSpec upstream call uses 2000 not 500
```

### Steps

- [ ] Read `src/main/agent-manager/prompt-composer.ts` in full
- [ ] Check if there are existing tests: `ls src/**/*.test.*` or look in `src/test/` for prompt-composer tests
- [ ] Write a test: `buildAgentPrompt()` with empty/minimal config should throw "too short"
- [ ] Run test to confirm it fails: `npm test`
- [ ] Apply Fix 1 (validation + logging at end of buildAgentPrompt)
- [ ] Apply Fix 2 (truncateSpec 500 → 2000)
- [ ] `npm run typecheck && npm test && npm run lint`
- [ ] Commit:
  ```bash
  git add src/main/agent-manager/prompt-composer.ts
  git commit -m "fix: prompt-composer — add length validation guard and increase upstream spec truncation to 2000"
  ```

---

## Task 3: Data & Interface Hygiene

**Spec for pipeline agent:**

```
## Goal
Three data layer fixes: wire pruneOldEvents, add a missing DB index, and route task-group-queries through the repository.

## Changes

### 1. Wire pruneOldEvents
Files: src/main/data/event-queries.ts (read), src/main/db.ts or src/main/index.ts (modify)

The function pruneOldEvents(db, retentionDays) exists in event-queries.ts but has zero callers. The agent_events table grows indefinitely.

Find where app startup maintenance runs (search for 'vacuum' or 'backup' or 'maintenance' in db.ts and index.ts). Wire in a call to pruneOldEvents(db, 30) after the existing maintenance task. If the maintenance runs on a timer, add pruneOldEvents to the same timer callback. Import pruneOldEvents from event-queries.

### 2. Composite index on agent_runs
File: src/main/db.ts (migrations section)

Dashboard cost summary queries scan all agent_runs rows by status then filter by date. No composite index exists.

Find the current highest migration version number: run sqlite3 ~/.bde/bde.db "PRAGMA user_version" or look at the last migration in the migrations array/file.

Add a new migration at version N+1:
  sql: `CREATE INDEX IF NOT EXISTS idx_agent_runs_status_started_at ON agent_runs(status, started_at DESC)`
  description: 'add composite index on agent_runs(status, started_at DESC)'

Follow exactly the same migration format as the existing migrations.

### 3. Route task-group-queries through repository
File: src/main/index.ts, src/main/data/sprint-task-repository.ts

src/main/index.ts imports getGroup, getGroupTasks, and/or getGroupsWithDependencies directly from src/main/data/task-group-queries.ts.

First: check ISprintTaskRepository in sprint-task-repository.ts. Note which of these three functions are already in the interface and which are absent.

For each function that is ABSENT from the interface:
- Add its signature to ISprintTaskRepository (or the appropriate sub-interface)
- Add its delegation in the factory (createSprintTaskRepository)
- Import task-group-queries in the factory if not already imported

Then in index.ts, replace the direct task-group-queries imports with calls on the repo instance. If repo is not accessible where these IPC handlers are registered, pass it through or access via the same pattern as the other handlers.

Do NOT add methods to the interface that are already present.

## Files to Change
- src/main/db.ts (or wherever migrations live — check src/main/migrations/ too)
- src/main/data/event-queries.ts (read-only, for understanding pruneOldEvents signature)
- src/main/data/sprint-task-repository.ts (if interface additions needed)
- src/main/index.ts

## How to Test
1. npm run typecheck — zero errors
2. npm test && npm run test:main — all pass
3. npm run lint
4. Verify migration: sqlite3 ~/.bde/bde.db "PRAGMA user_version" should show N+1
5. Verify index: sqlite3 ~/.bde/bde.db ".indexes agent_runs" should include idx_agent_runs_status_started_at
```

### Steps

- [ ] Read `src/main/data/event-queries.ts` — find pruneOldEvents signature
- [ ] Read `src/main/db.ts` — find current highest migration version and maintenance task location
- [ ] Read `src/main/data/sprint-task-repository.ts` — note which group query methods are in interface
- [ ] Read `src/main/index.ts` — find direct task-group-queries imports
- [ ] Write failing test: pruneOldEvents is called at app startup or maintenance timer. Run: `npm run test:main` — confirm fail
- [ ] Apply Fix 1 (wire pruneOldEvents)
- [ ] Apply Fix 2 (add migration for composite index)
- [ ] Apply Fix 3 (interface additions + index.ts re-routing)
- [ ] `npm run typecheck` — fix any type errors from interface changes
- [ ] `npm test && npm run test:main && npm run lint`
- [ ] Verify migration version: `sqlite3 ~/.bde/bde.db "PRAGMA user_version"`
- [ ] Commit:
  ```bash
  git add src/main/db.ts src/main/data/sprint-task-repository.ts src/main/index.ts
  git commit -m "fix: data hygiene — wire pruneOldEvents, add agent_runs index, route group queries through repository"
  ```

---

## Task 4: Security — IPC Input Hardening

**Spec for pipeline agent:**

```
## Goal
Two IPC input validation fixes: prevent grep regex DoS in memory:search, and validate owner/repo in repos:clone.

## Changes

### 1. memory:search grep regex DoS
File: src/main/handlers/memory-search.ts

The memory:search handler passes unvalidated user query strings to grep. A crafted pattern with nested quantifiers can cause catastrophic backtracking and hang the main process indefinitely.

Find the handler for the memory:search IPC channel. Before calling execFileAsync('grep', ...) add:

  // Input validation
  if (typeof query !== 'string' || query.length > 200) {
    throw new Error('Query must be a string of 200 characters or fewer')
  }
  // Strip catastrophic backtracking patterns
  const safeQuery = query.replace(/(\(\?:.*\))[+*]/g, '').replace(/\([^)]*\)[+*]{2,}/g, '')

Then pass safeQuery to grep instead of query.

Also add a timeout to the execFileAsync call. Check the existing signature — if it supports a timeout option, add { timeout: 5000 }. If it uses child_process directly, wrap in a Promise.race with a 5-second timeout that rejects with { timedOut: true }.

### 2. repos:clone owner/repo validation
File: src/main/handlers/repo-discovery.ts

The repos:clone handler passes unvalidated owner and repo strings into git URL construction. These strings should only contain safe characters.

Find the handler. Before constructing the clone URL, add:
  if (!/^[a-zA-Z0-9_.-]+$/.test(owner) || !/^[a-zA-Z0-9_.-]+$/.test(repo)) {
    throw new Error(`Invalid repository identifier: owner and repo must contain only alphanumeric characters, hyphens, underscores, and dots`)
  }

## Files to Change
- src/main/handlers/memory-search.ts
- src/main/handlers/repo-discovery.ts

## How to Test
1. npm run typecheck — zero errors
2. npm test — all tests pass (write new tests for the validation)
3. npm run lint

Write tests that confirm:
- memory:search rejects queries > 200 chars
- memory:search strips nested quantifier patterns
- repos:clone rejects owner/repo containing spaces, slashes, semicolons
- repos:clone accepts normal alphanumeric owner/repo
```

### Steps

- [ ] Read `src/main/handlers/memory-search.ts` in full
- [ ] Read `src/main/handlers/repo-discovery.ts` in full
- [ ] Write failing test: memory:search handler rejects query > 200 chars
- [ ] Write failing test: repos:clone rejects `owner` containing `/`
- [ ] Run tests to confirm they fail: `npm test`
- [ ] Apply Fix 1 (memory-search.ts validation + timeout)
- [ ] Apply Fix 2 (repo-discovery.ts regex guard)
- [ ] `npm run typecheck && npm test && npm run lint`
- [ ] Commit:
  ```bash
  git add src/main/handlers/memory-search.ts src/main/handlers/repo-discovery.ts
  git commit -m "fix: IPC security — memory:search grep DoS prevention, repos:clone owner/repo validation"
  ```

---

## Task 5: Security — Path Safety

**Spec for pipeline agent:**

```
## Goal
Two path safety fixes: validate worktreeBase setting stays within home directory, and validate BDE_TEST_DB env var stays within tmpdir.

## Changes

### 1. worktreeBase setting validation
File: find the settings write handler (search for 'agentManager.worktreeBase' or 'settings:set' in src/main/handlers/)

The agentManager.worktreeBase setting is accepted from the renderer and stored without validation. An attacker (or bug) that sets this to '/etc' would cause agent worktrees to be created in arbitrary system directories.

In the handler that writes settings (likely settings:set or settings:setJson), add validation when the key is 'agentManager.worktreeBase':

  import { homedir } from 'os'
  import { resolve } from 'path'

  if (key === 'agentManager.worktreeBase') {
    const resolved = resolve(String(value))
    const home = homedir()
    if (!resolved.startsWith(home + '/') && resolved !== home) {
      throw new Error(`agentManager.worktreeBase must be within the home directory (${home})`)
    }
  }

### 2. BDE_TEST_DB env var validation
File: src/main/paths.ts or src/main/db.ts (wherever BDE_TEST_DB is consumed)

process.env.BDE_TEST_DB is used as the database file path without validation. Can write SQLite to arbitrary paths.

Find where BDE_TEST_DB is read. Add:
  import { tmpdir } from 'os'
  import { resolve } from 'path'

  if (process.env.BDE_TEST_DB) {
    const testDbPath = resolve(process.env.BDE_TEST_DB)
    const tmp = tmpdir()
    if (!testDbPath.startsWith(tmp + '/') && !testDbPath.startsWith(tmp)) {
      throw new Error(`BDE_TEST_DB must be within the system temp directory (${tmp})`)
    }
  }

Note: existing tests that set BDE_TEST_DB must already use a path within tmpdir() — check the test setup files to confirm before adding validation, and update any test paths that don't comply.

## Files to Change
- src/main/handlers/ (settings handler — search for 'worktreeBase')
- src/main/paths.ts or src/main/db.ts (search for BDE_TEST_DB)

## How to Test
1. npm run typecheck — zero errors
2. npm test && npm run test:main — all pass (confirm existing tests still work after BDE_TEST_DB validation)
3. npm run lint

Write tests:
- worktreeBase validation: throws on '/etc', accepts '~/worktrees/bde'
- BDE_TEST_DB validation: throws on '/etc/shadow', accepts os.tmpdir() + '/bde-test.db'
```

### Steps

- [ ] Search for `agentManager.worktreeBase` across the codebase to find the settings write handler
- [ ] Search for `BDE_TEST_DB` to find where it's consumed
- [ ] Check existing test setup files for how BDE_TEST_DB is set — confirm they use tmpdir()
- [ ] Write failing test: worktreeBase rejects '/etc'
- [ ] Write failing test: BDE_TEST_DB rejects '/etc/shadow'
- [ ] Run tests to confirm they fail: `npm test`
- [ ] Apply Fix 1 (worktreeBase validation)
- [ ] Apply Fix 2 (BDE_TEST_DB validation)
- [ ] `npm run typecheck && npm test && npm run test:main && npm run lint`
- [ ] Commit:
  ```bash
  git add <modified files>
  git commit -m "fix: path security — validate worktreeBase and BDE_TEST_DB stay within safe directories"
  ```

---

## Task 6: Audit Trail & State Machine Integrity

**Spec for pipeline agent:**

```
## Goal
Three fixes in sprint-queries.ts and task-terminal-service.ts: make audit trail failures abort the status transition, add audit trail to pr_mergeable_state updates, and surface consolidated batch resolution error counts.

## Context
The audit trail logic for PR-driven status transitions lives in sprint-queries.ts — specifically in the private functions transitionTasksToDone() (line ~609) and transitionTasksToCancelled() (line ~656), and in updateTaskMergeableState() (line ~797). The sprint-pr-poller.ts delegates to these functions via dependency injection.

## Changes

### 1. Audit trail failure must abort status transition
File: src/main/data/sprint-queries.ts

In transitionTasksToDone() (around line 627-641) and transitionTasksToCancelled() (same pattern), the recordTaskChangesBulk() call is wrapped in a try/catch that swallows errors:
  try {
    recordTaskChangesBulk(...)
  } catch (err) {
    logger.warn(`[sprint-queries] Failed to record bulk changes: ${err}`)
  }
  // UPDATE still executes below

Change the catch in BOTH functions to:
  catch (err) {
    logger.error(`[sprint-queries] Failed to record bulk changes — aborting transition: ${err}`)
    throw err  // causes the wrapping db.transaction() to roll back
  }

The wrapping db.transaction() in markTaskDoneByPrNumber/markTaskCancelledByPrNumber will catch the rethrow and log a warn + return []. This is correct — an empty return means the poller won't call onTaskTerminal, which is the safe behavior.

### 2. pr_mergeable_state audit trail
File: src/main/data/sprint-queries.ts

updateTaskMergeableState() (around line 797) does a bare UPDATE with no audit trail:
  getDb().prepare('UPDATE sprint_tasks SET pr_mergeable_state = ? WHERE pr_number = ?').run(...)

Add an audit trail call. Fetch the current task(s) before updating, then call recordTaskChanges() for each:
  const affected = db.prepare(
    'SELECT id, pr_mergeable_state FROM sprint_tasks WHERE pr_number = ?'
  ).all(prNumber) as Array<{ id: string; pr_mergeable_state: string | null }>
  
  db.prepare('UPDATE sprint_tasks SET pr_mergeable_state = ? WHERE pr_number = ?')
    .run(mergeableState, prNumber)
  
  for (const row of affected) {
    recordTaskChanges(row.id, { pr_mergeable_state: mergeableState }, { pr_mergeable_state: row.pr_mergeable_state }, 'pr-poller', db)
  }

Import recordTaskChanges from './task-changes' if not already imported.

### 3. Surface consolidated batch resolution errors
File: src/main/services/task-terminal-service.ts

The batch dependency resolution loop already logs individual failures at error level (correct). The missing piece is a consolidated summary after the loop so operators can see total failure count in one log line.

After the resolution loop completes (after all resolveDependents calls), add:
  if (failedTaskIds.length > 0) {
    deps.logger.error(
      `[task-terminal-service] Dependency resolution completed with ${failedTaskIds.length} failure(s)`,
      { failedTaskIds }
    )
  }

To collect failedTaskIds, accumulate them in the existing catch block: push id to a failedTaskIds array declared before the loop.

Do not throw — the loop must continue processing remaining tasks even when one fails.

## Files to Change
- src/main/data/sprint-queries.ts
- src/main/services/task-terminal-service.ts

## How to Test
1. npm run typecheck — zero errors
2. npm test && npm run test:main — all pass
3. npm run lint

Write tests:
- sprint-queries: if recordTaskChangesBulk throws inside transitionTasksToDone, the status UPDATE does not commit (use a real in-memory SQLite db)
- sprint-queries: updateTaskMergeableState calls recordTaskChanges with old and new values
- task-terminal-service: when resolveDependents fails for one task, the consolidated error log fires after the loop with the correct count
```

### Steps

- [ ] Read `src/main/data/sprint-queries.ts` lines 607-810 (transitionTasksToDone, transitionTasksToCancelled, updateTaskMergeableState)
- [ ] Read `src/main/services/task-terminal-service.ts` in full
- [ ] Write failing test: recordTaskChangesBulk failure inside transitionTasksToDone causes the status UPDATE to not commit
- [ ] Write failing test: updateTaskMergeableState calls recordTaskChanges with old value
- [ ] Write failing test: task-terminal-service logs consolidated failure count after loop
- [ ] Run tests to confirm they fail: `npm test`
- [ ] Apply Fix 1 (throw err in transitionTasksToDone and transitionTasksToCancelled catch blocks)
- [ ] Apply Fix 2 (pr_mergeable_state audit trail in updateTaskMergeableState)
- [ ] Apply Fix 3 (consolidated failedTaskIds summary after resolution loop)
- [ ] `npm run typecheck && npm test && npm run test:main && npm run lint`
- [ ] Commit:
  ```bash
  git add src/main/data/sprint-queries.ts src/main/services/task-terminal-service.ts
  git commit -m "fix: audit trail integrity — abort on bulk write failure, pr_mergeable_state audit trail, surface batch resolution errors"
  ```

---

## Seeding All 6 Tasks into BDE

After verifying the plan is correct, seed the tasks directly into SQLite. BDE's drain loop picks up queued tasks within 30 seconds.

- [ ] Verify current migration version: `sqlite3 ~/.bde/bde.db "PRAGMA user_version"`
- [ ] Confirm BDE is not running (or pause the agent manager)
- [ ] Seed all 6 tasks with one Python script:

```python
#!/usr/bin/env python3
import sqlite3, uuid, time

DB = '/Users/ryan/.bde/bde.db'
REPO = 'bde'
conn = sqlite3.connect(DB)

tasks = [
    (
        'Agent Lifecycle Reliability + Playground Path Fix',
        '''## Goal
Fix three reliability gaps in the agent lifecycle and one security gap in playground HTML path validation.

[... paste Task 1 spec from plan ...]'''
    ),
    (
        'Prompt Composition Fixes',
        '''[... paste Task 2 spec ...]'''
    ),
    (
        'Data & Interface Hygiene',
        '''[... paste Task 3 spec ...]'''
    ),
    (
        'Security — IPC Input Hardening',
        '''[... paste Task 4 spec ...]'''
    ),
    (
        'Security — Path Safety',
        '''[... paste Task 5 spec ...]'''
    ),
    (
        'Audit Trail & State Machine Integrity',
        '''[... paste Task 6 spec ...]'''
    ),
]

now = int(time.time() * 1000)
for title, spec in tasks:
    task_id = str(uuid.uuid4())
    conn.execute(
        '''INSERT INTO sprint_tasks
           (id, title, status, repo, spec, spec_type, priority, needs_review, playground_enabled, created_at, updated_at)
           VALUES (?, ?, 'queued', ?, ?, 'feature', 1, 1, 0, ?, ?)''',
        (task_id, title, REPO, spec, now, now)
    )
    print(f'Queued: {title} ({task_id})')

conn.commit()
conn.close()
print('Done — BDE drain loop will pick these up within 30 seconds.')
```

- [ ] Run: `python3 /tmp/seed_audit_tasks.py`
- [ ] Confirm 6 rows inserted: `sqlite3 ~/.bde/bde.db "SELECT id, title, status FROM sprint_tasks WHERE status='queued' ORDER BY created_at DESC LIMIT 6"`
- [ ] Start BDE — drain loop activates all 6 tasks within 30 seconds

---

## Monitoring

- All 6 tasks should reach `review` status within 30-60 minutes
- If any task reaches `error` or `failed`, check `~/.bde/bde.log` for the failure reason
- Use Code Review Station to inspect diffs before merging each task
- Merge order doesn't matter — all tasks touch non-overlapping files

## Post-merge

After all 6 tasks land on main, the following deferred findings can be revisited:
- Double-claim drain race (requires multi-instance BDE support design decision)
- SDK maxTurns/maxBudgetUsd (requires SDK documentation verification)
- Prompt token overhead for assistant agents (low priority, optimize when cost is primary concern)
