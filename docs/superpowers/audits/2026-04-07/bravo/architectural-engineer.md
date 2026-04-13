# Architectural Engineer — Team Bravo — BDE Audit 2026-04-07

## Summary

BDE's agent + developer surface stack is the most architecturally significant area of the app and is showing its scars. The Agent Manager, IPC layer, and SQLite schema have absorbed every late requirement directly — `AgentManagerImpl` is now a 1,032-line god-object with circuit breakers, dependency indexing, watchdog routing, hot reload, drain orchestration, and shutdown lifecycle all jammed into one class. The IPC surface has grown to **144 typed channels across 27 domain interfaces**, and the preload bridge is a single 538-line wall of hand-maintained passthroughs that drift from the typed map. The sprint_tasks table has grown from 15 fields → 30+ via 35 migrations (12 of them ALTER, several full table-rewrites for CHECK constraints), and the only meaningful indexes on it are `status`, `claimed_by`, `pr_number`, `group_id`, `sprint_id` — `next_eligible_at`, `completed_at`, and `worktree_path` (all of which are queried regularly by drain/poll/dashboard/poller code paths) are unindexed. The completion path routes terminal status through five separate `setOnStatusTerminal` setters wired up at boot, with a documented logger.warn path when one isn't set; this is a coupling smell that will fail silently when someone adds the next caller. Dev Playground sanitization is mostly correct but is duplicated between `playground-handlers.ts` and `run-agent.ts` with one-of-them omitting DOMPurify, which is a real divergence risk.

## Findings

### [CRITICAL] AgentManagerImpl is a 1,032-line god-object mixing 7+ orthogonal concerns

- **Category:** Coupling
- **Location:** `src/main/agent-manager/index.ts:249-1020`
- **Observation:** `AgentManagerImpl` owns: drain loop scheduling, OAuth token refresh, dependency index incremental updates, circuit breaker state, watchdog kill routing, repo path resolution, queued task mapping, agent spawning, orphan recovery, worktree pruning, hot reload, shutdown drain, metrics increment fan-out, broadcast wiring, and process-level event emission. It holds 4 timers, 3 in-process collections (`_activeAgents`, `_processingTasks`, `_agentPromises`), a hand-rolled deps cache (`_lastTaskDeps`), and circuit breaker counters all on the same instance.
- **Why it matters:** Every new feature has to thread through this class, and tests have to instantiate the whole thing. The `_drainLoop` method alone (lines 629–706) interleaves dependency index maintenance, OAuth checking, task fetching, and per-task processing. Adding a feature like priority-aware scheduling or a second worker pool will require deep surgery.
- **Recommendation:** Extract `DrainScheduler` (timers + drain orchestration), `SpawnCircuitBreaker` (currently inlined as `_recordSpawnFailure`/`_isCircuitOpen`), `DependencyTracker` (the `_lastTaskDeps` + index update logic), and `LifecycleController` (start/stop/shutdown re-queue). The class should compose these, not contain them.

### [CRITICAL] sprint_tasks lacks indexes for hot-path queries

- **Category:** Performance
- **Location:** `src/main/db.ts:443-454` (v15 schema), migrations v23 (`next_eligible_at`), v21 (`worktree_path`), v29 (`duration_ms`), v33 (`review_diff_snapshot`)
- **Observation:** Only `idx_sprint_tasks_status`, `idx_sprint_tasks_claimed_by`, `idx_sprint_tasks_pr_number`, `idx_sprint_tasks_group`, and `idx_sprint_tasks_sprint` exist. The drain loop (`getQueuedTasks`), retry backoff (`next_eligible_at`), review diff pruning, the dashboard queries (`completed_at` ordering for "recent done"), and the sprint PR poller (`pr_status='open'` AND status filters) all run repeatedly without compound indexes. `pruneOldDiffSnapshots` filters on `(status, completed_at)` with no covering index.
- **Why it matters:** With a few hundred tasks the planner still does full-scans for every drain cycle (every 30s), every dashboard poll (every 60s × N renderer windows), and every PR poller cycle. SQLite is forgiving until it isn't — at 5–10k tasks (a year of usage) these queries will become measurable on the main thread and visibly stall the UI.
- **Recommendation:** Add `(status, next_eligible_at)`, `(status, completed_at)`, and `(pr_status, status)` compound indexes. Add `EXPLAIN QUERY PLAN` assertions in tests for the 5 hot queries.

### [CRITICAL] Migration history has 35 entries with 12 ALTERs and 4 full table rewrites, mostly for CHECK constraint changes

- **Category:** Migration Risk
- **Location:** `src/main/db.ts:89-887` (35 migrations), v9/v10/v17/v20 each rewrite `sprint_tasks` to alter the status CHECK constraint
- **Observation:** Every time a new task status is added (`error`, `blocked`, `review`), the migration must drop and recreate the entire table because SQLite can't ALTER a CHECK. Migration v15 silently re-creates `sprint_tasks` after v12 dropped it for the Supabase era — meaning users who upgraded mid-Supabase have a different column ordering than fresh installs. Several migrations (v3, v5, v7, v8, v13, v16, v21, v23, v24, v25, v29, v30, v31, v32, v33, v34, v35) ALTER TABLE in a way that produces different physical column ordering depending on the user's upgrade path.
- **Why it matters:** Schema drift between users is real. The next time someone tries to use `SELECT *` semantics or a positional binding, two users will hit different bugs. The CHECK-constraint-via-rewrite pattern is also a 30-second stall on large tables and risks data loss if interrupted.
- **Recommendation:** (a) Move statuses from CHECK to a lookup table or app-layer validation (already done in `task-transitions.ts` — drop the CHECK). (b) Add a `migration-shape` test that snapshots the final `PRAGMA table_info(sprint_tasks)` after running all migrations from each historical baseline. (c) Plan a v36 "normalize schema shape" migration that VACUUMs the table into a known column order.

### [CRITICAL] Terminal status callback is wired through 4 separate setters at boot, with logged-and-swallowed failure mode

- **Category:** Boundary Violation / Error Path
- **Location:** `src/main/index.ts:146-149`, `src/main/handlers/sprint-local.ts:75-79,188-197`, `src/main/handlers/git-handlers.ts:136-140`, `src/main/handlers/review.ts:27-31,295-301`, `src/main/sprint-pr-poller.ts` (`setOnTaskTerminal`)
- **Observation:** The `TaskTerminalService.onStatusTerminal` function is wired into 4 separate module-level singletons at boot, each with its own setter and its own "if (!\_onStatusTerminal) logger.warn(...)" fallback. Forgetting to wire one breaks dependency resolution silently — see `sprint-local.ts:191-194` and `review.ts:298-300` which both contain explicit warning paths because the bug has happened before.
- **Why it matters:** This is the single most important callback in the system (it unblocks downstream tasks). The pattern of "setter at boot + warn-on-missing" is fragile and gets worse with every new caller. The next view that mutates task status will inevitably forget to wire it.
- **Recommendation:** Replace the 4 setters with a single `TerminalEventBus` (or pass `terminalService` via DI to handler factories the way `agent-manager-handlers` already takes the AM instance). Make `updateTask()` itself trigger the terminal hook by detecting status transitions, so callers can't forget.

### [MAJOR] IPC surface has grown to 144 typed channels, preload bridge is hand-maintained

- **Category:** IPC Bloat
- **Location:** `src/shared/ipc-channels.ts:864-888` (27 domain interfaces composed by intersection), `src/preload/index.ts:1-538`
- **Observation:** The typed channel map declares 144 entries across 27 domain interfaces. The preload `api` object then re-declares each channel as a hand-written passthrough wrapper, often duplicating the parameter list verbatim (see `sprint.batchImport` at preload:157-172 versus its IPC type at ipc-channels.ts:331-352). The two MUST stay in sync but the type system only enforces that the channel name and arg shape match — it doesn't enforce that every channel has a preload binding, nor that channel groupings match.
- **Why it matters:** Every new IPC channel is 3 edits in 3 files (channel map, handler, preload). The preload file is on the conflict-prone list precisely because of this. Future migrations to context-isolation-strict will require touching all 538 lines.
- **Recommendation:** Generate the preload bridge from `IpcChannelMap` at build time (a ~50-line codegen script). At minimum, add a compile-time check that every key in `IpcChannelMap` has a corresponding entry in the preload `api` tree.

### [MAJOR] sdk-adapter SDK/CLI fallback uses bare `try { import }` swallowing all errors

- **Category:** Error Path / Fragility
- **Location:** `src/main/agent-manager/sdk-adapter.ts:44-53`
- **Observation:** `spawnAgent` does `try { const sdk = await import('@anthropic-ai/claude-agent-sdk'); return spawnViaSdk(...) } catch { /* SDK not available — use CLI fallback */ }`. The catch swallows EVERY error, including transient module-load failures, syntax errors in the SDK, or even `spawnViaSdk` throwing synchronously after a successful import. There is no logger call.
- **Why it matters:** When the SDK breaks (which happens — the SDK is on a fast release cycle) the agent silently degrades to CLI mode with NO indication. Users will see different behavior with no diagnostic. CLI mode also doesn't support steering (`SDK mode does not support steering` is hardcoded in the SDK path; CLI uses stdin) so the steer button silently changes semantics.
- **Recommendation:** Catch only `ERR_MODULE_NOT_FOUND`/`MODULE_NOT_FOUND` errors. Log every fall-through with the original error. Emit an `agent:event` telling the renderer the agent is in CLI mode.

### [MAJOR] Drain loop holds OAuth file I/O on the critical path of every cycle

- **Category:** Performance / Race Condition
- **Location:** `src/main/agent-manager/index.ts:679-680`, `src/main/agent-manager/index.ts:71-110`
- **Observation:** Every drain cycle (every 30s, plus initial defer) calls `checkOAuthToken` which does `await readFile(tokenPath)` + `await stat(tokenPath)` + potentially `refreshOAuthTokenFromKeychain()` (which can hang per the documented Electron Keychain limitation). If the file is locked, slow, or the keychain refresh is blocking, the entire drain loop stalls. There is no timeout.
- **Why it matters:** The whole rationale for the file-based token (per CLAUDE.md) is "Keychain access hangs in Electron." But `checkOAuthToken` calls `refreshOAuthTokenFromKeychain` BOTH when the file is missing AND proactively when the file is >45min old — which is a guaranteed hang risk on every long-running session. The `refreshOAuthTokenFromKeychain` call is unbounded.
- **Recommendation:** Wrap the keychain refresh in `Promise.race` against a 5s timeout. Move the proactive 45-min refresh out of the drain loop entirely — make it a separate timer that doesn't gate spawning.

### [MAJOR] Worktree setup has cross-process file lock with manual liveness check; race window remains

- **Category:** Race Condition
- **Location:** `src/main/agent-manager/worktree.ts:107-163`
- **Observation:** `acquireLock` uses `writeFileSync(lockFile, pid, { flag: 'wx' })`, then on EEXIST reads the holder PID, calls `process.kill(pid, 0)` to test liveness, removes the stale lock, and re-acquires via temp-file + rename. There is a race window between the staleness check and the rename — another process could acquire between `rmSync(lockFile)` and `renameSync(tempLockFile, lockFile)`. The rename then silently overwrites another live holder's lock.
- **Why it matters:** Two BDE instances (e.g., user runs two windows for different repos, or restart while old process is shutting down) can both think they hold the lock and run concurrent `git worktree add` calls. Git will partially fail and leave half-created worktrees that the pruner won't recognize.
- **Recommendation:** Use `flock(2)` via a small native helper, or use `O_EXCL` with a UUID-named lockfile and an explicit `link(2)` instead of rename. At minimum, after acquiring, re-read the lock file content and verify it still contains your PID before proceeding.

### [MAJOR] Dev Playground sanitization is duplicated and divergent

- **Category:** Boundary Violation / Fragility
- **Location:** `src/main/handlers/playground-handlers.ts:55` vs `src/main/agent-manager/run-agent.ts:136-137`
- **Observation:** `playground-handlers.ts` (the manual `playground:show` IPC handler) reads the file and broadcasts the **raw** HTML — no DOMPurify call. `run-agent.ts` (the auto-detect path used by pipeline agents) DOES call `purify.sanitize(rawHtml)` before broadcasting. Both broadcast on the same `agent:event` channel with the same `agent:playground` event type, so the renderer cannot tell which path the HTML came from and is forced to assume it's safe.
- **Why it matters:** The `playground:show` IPC is callable from any renderer — including potentially compromised render content. The renderer iframe uses `sandbox="allow-scripts"` per the docs, but allow-scripts plus an unsanitized payload is exactly the threat model DOMPurify exists to defeat. This is a real XSS-in-a-sandboxed-iframe vector.
- **Recommendation:** Move sanitization into a shared `sanitizePlaygroundHtml()` helper in `src/main/playground-sanitize.ts` and call it from BOTH paths. Add a regression test asserting that a `<script>alert(1)</script>` payload is stripped on both paths.

### [MAJOR] IDE filesystem handlers leak singleton state and cannot support multiple roots

- **Category:** Coupling / Boundary Violation
- **Location:** `src/main/handlers/ide-fs-handlers.ts:11-13` (`let ideRootPath`, `let watcher`, `let debounceTimer` as module-level state)
- **Observation:** The IDE FS handlers maintain `ideRootPath`, `watcher`, and `debounceTimer` as module-level singletons. Calling `fs:watchDir` for a second root path tears down the first watcher with no notification to the renderer. Tear-off windows can each open their own IDE view — they all share these globals. Two IDE tabs in two windows will fight each other, with the second one silently winning.
- **Why it matters:** The panel system explicitly supports multiple panels and tear-off windows (CLAUDE.md highlights tear-offs as a feature). The IDE view is not multi-instance safe. This will manifest as "my files disappeared" bugs that are very hard to reproduce.
- **Recommendation:** Key all IDE state by `windowId` (or `BrowserWindow.id`). Track watchers in a `Map<number, FSWatcher>`. Reject `fs:readFile` calls that don't match the calling window's root.

### [MAJOR] Settings module is a 33-line passthrough that bypasses dependency injection

- **Category:** Coupling
- **Location:** `src/main/settings.ts:1-33`
- **Observation:** `settings.ts` is a thin wrapper that calls `getDb()` inside every function. `getSettingJson` is imported into 30+ modules across handlers, services, agent-manager, and tearoff-manager. This creates an implicit "main process is initialized" coupling that makes any test that touches a handler also have to set up the DB. There's no way to inject test settings; tests have to seed real SQLite.
- **Why it matters:** Adds DB lifecycle dependency to almost every unit test in `src/main/`. Makes it impossible to render a handler in isolation. Encourages "just call getSetting" instead of passing config explicitly to constructors — the agent-manager already gets config injected, but then `reloadConfig()` reaches around through the global `getSetting` import (`agent-manager/index.ts:967, 978, 984, 992`).
- **Recommendation:** Define a `SettingsProvider` interface, inject it into modules that need settings, and let tests pass an in-memory implementation.

### [MAJOR] tearoff-manager persists window state via 500ms debounced writes with no flush on quit

- **Category:** Fragility
- **Location:** `src/main/tearoff-manager.ts:117-127`, `src/main/tearoff-manager.ts:73-83`
- **Observation:** `persistBoundsDebounced` uses a 500ms `setTimeout` to write tearoff window bounds to settings. `closeTearoffWindows` (called in `before-quit`) calls `persistTearoffState()` directly but does NOT clear or await the in-flight resize timers. If the user resizes a window and immediately quits within 500ms, the latest bounds are lost.
- **Why it matters:** Users notice when their window positions don't restore correctly. Compounds with the IDE state debouncing (also 2s, also no quit-flush — though IDE has a `beforeunload` listener that the tearoff manager lacks).
- **Recommendation:** In `closeTearoffWindows`, iterate `resizeTimers`, clear each one, and write final state synchronously before destroying windows.

### [MAJOR] Dashboard handlers run unindexed JOIN on every poll, scaling badly

- **Category:** Performance
- **Location:** `src/main/handlers/dashboard-handlers.ts:32-58`
- **Observation:** `getRecentEvents` does `agent_events LEFT JOIN agent_runs ON ae.agent_id = ar.id LEFT JOIN sprint_tasks ON ar.sprint_task_id = st.id ORDER BY ae.timestamp DESC LIMIT ?`. There's no index on `agent_events.timestamp` (only `(agent_id, timestamp)` per migration v11). The order-by-timestamp without a leading-column index forces a full sort. The join through `agent_runs` exists only because someone needed task title for events, instead of denormalizing it.
- **Why it matters:** Dashboard polls this every 60s × every renderer window. With months of `agent_events` (rows accumulate fast — events come out of every agent message), this query becomes O(N log N) on the main thread.
- **Recommendation:** Add a single-column index on `agent_events(timestamp DESC)`. Or better: denormalize `task_title` into `agent_events` at write time, drop the joins.

### [MAJOR] panelLayout store deep-clones the entire tree on every mutation and persists with 500ms debounce

- **Category:** Performance
- **Location:** `src/renderer/src/stores/panelLayout.ts:101-184` (every mutation rebuilds spine of the tree), `src/renderer/src/stores/panelLayout.ts:537-543`
- **Observation:** Every `splitNode`/`addTab`/`closeTab`/`setActiveTab` call walks the entire tree, returning new objects up the spine. The persist subscriber fires on every mutation with no equality check, queuing a settings.setJson write 500ms later. With ~9 views and frequent panel manipulation (drag/drop a tab → 2-3 mutations) the renderer does many redundant tree walks per gesture.
- **Why it matters:** Currently fast because trees are shallow (1-3 splits). But the recursive copy pattern + lack of memoization will make any future feature like "remember scroll position per panel" or "per-tab state" architecturally painful — the entire state would re-allocate on every keystroke in a panel.
- **Recommendation:** Use Immer (already a transitive dep of zustand-immer if added). Add a `===` check in the persist subscriber so identical state doesn't trigger writes.

### [MAJOR] DependencyIndex requires manual incremental updates with deep equality check on every drain

- **Category:** Coupling / Performance
- **Location:** `src/main/agent-manager/index.ts:608-625` (`_depsEqual`), `index.ts:646-673` (incremental update in drain loop)
- **Observation:** The agent manager maintains its own `_lastTaskDeps: Map<string, TaskDependency[] | null>` and rebuilds the index incrementally inside the drain loop. The deep-equality check sorts both arrays on every comparison. This is the second copy of dependency state (the first lives in `dependency-index.ts`'s reverse index). Two sources of truth, manually kept in sync via O(N log N) walks every 30s.
- **Why it matters:** "Manual cache that is invalidated by deep comparison every poll" is a bug factory. The drain loop already had to add bookkeeping for "task was deleted," "task was added," and "task deps changed" — and missing any of these would silently leak entries or fail to unblock dependents.
- **Recommendation:** Either (a) make the dependency index lazy and rebuild from a query when needed (it's not on the hot path), or (b) drive updates from a SQLite trigger / write-through wrapper around `updateTask`, so the manager doesn't poll for diffs.

### [MAJOR] completion.ts is 769 lines with deeply nested auto-merge logic

- **Category:** Coupling
- **Location:** `src/main/agent-manager/completion.ts:582-715`
- **Observation:** `resolveSuccess` handles: worktree existence guard, branch detection, auto-commit, rebase onto main, no-commits guard, transition to review, diff snapshot capture, auto-review rule loading, file diff parsing, rule evaluation, squash merge execution, post-merge dedup, worktree cleanup, branch deletion, and task done update — all in one function with 6 levels of nested try/catch. The auto-merge block alone (582-711) is 130 lines deep.
- **Why it matters:** Adding a new completion behavior (e.g., "auto-tag the merge commit") requires reading and modifying a function that already takes 5 minutes to understand. The nested try/catches mean a partial failure in step 9 leaves the system in an inconsistent state with no recovery.
- **Recommendation:** Extract into a `CompletionPipeline` object with named, ordered steps. Each step returns a discriminated union (`{kind: 'continue'|'halt'|'abort', state}`). The shape becomes a state machine that can be tested per-step.

### [MINOR] sprint-local handler doubles as a re-export module

- **Category:** Boundary Violation
- **Location:** `src/main/handlers/sprint-local.ts:52-71`
- **Observation:** This file exports both IPC handler registration AND re-exports 13 service-layer functions and 2 types so other modules can deep-import them. Mixing handler concerns and library re-exports in one file means changing handler internals risks breaking unrelated importers.
- **Why it matters:** Confuses the dependency graph. Tests that want to call `getTask` end up importing the entire handler module and pulling in its boot-time singletons.
- **Recommendation:** Keep handlers in `handlers/`, library exports in `data/` or `services/`. Use dedicated barrel files for re-exports.

### [MINOR] Broadcast helper sends to ALL BrowserWindows including tearoff windows

- **Category:** Performance / Coupling
- **Location:** `src/main/broadcast.ts:7-11`
- **Observation:** Every event (agent events, sprint mutations, PR list updates) goes to every window via a tight loop. Tearoff windows that don't host the relevant view still receive every event and ignore it in the renderer. With many tearoffs and busy agents, the renderer receives thousands of irrelevant IPC messages.
- **Why it matters:** Renderer-side filtering is wasted CPU. As tearoff windows are encouraged, this scales linearly with windows × event rate.
- **Recommendation:** Allow callers to scope broadcasts (e.g., `broadcast(channel, data, { windowFilter: w => w.viewKey === 'agents' })`). At minimum, count events per window in dev mode so the cost is visible.

### [MINOR] Agent skills/memory/personality system has 19 small files but is never tested as composed

- **Category:** Test Gap
- **Location:** `src/main/agent-system/{personality,skills,memory}/` (19 files, 770 lines total)
- **Observation:** The native agent system splits BDE conventions into many small modules each exporting a markdown string. They're concatenated in `getAllSkills()` (skills/index.ts:20-30) and `getAllMemory()` (memory/index.ts:49-57), then injected by `prompt-composer.ts`. There's no test that the composed prompt is well-formed or that token budgets are respected — only unit tests on individual modules.
- **Why it matters:** The composed pipeline-agent prompt is the single most important production artifact in BDE. Adding a new skill that pushes the prompt over the model's effective context length will silently degrade every task, with the failure mode being "agents do worse" rather than an error.
- **Recommendation:** Add a snapshot test of the full composed prompt for each agent type, with an assertion on token count budget.

### [MINOR] `agentManager.useNativeSystem` setting was added in v18 then removed in v19 — schema cruft remains

- **Category:** Migration Risk
- **Location:** `src/main/db.ts:537-555`
- **Observation:** Migration v18 inserts a setting key, v19 deletes it. Pure historical noise that has to be re-applied to every fresh DB. Future contributors will wonder why this exists.
- **Why it matters:** Each pair of migrations like this adds confusion to a 35-step history and increases the surface area to test rollback semantics.
- **Recommendation:** When safe (i.e., all in-the-wild DBs have moved past v19), squash setting-only no-op migrations during the "v36 schema normalize" cleanup.

### [MINOR] gitTree store and IDE store both write settings on every state change with no shared persistence layer

- **Category:** Coupling
- **Location:** `src/renderer/src/stores/ide.ts:308-351`, `src/renderer/src/stores/panelLayout.ts:535-545`
- **Observation:** Each renderer store implements its own debounced settings persistence with its own timer, equality check, and `beforeunload` flush (or lack thereof). Three stores = three slightly different implementations.
- **Why it matters:** Each new persisted store will copy-paste the pattern. Bugs (like the tearoff missing-flush issue, or panelLayout's missing equality check) will be fixed in one store and not the others.
- **Recommendation:** Extract a `createPersistedStore(key, selector, opts)` helper. Standardize debounce, equality check, and flush-on-unload.

### [MINOR] Process-environment global mutation in main/index.ts via `ensureExtraPathsOnProcessEnv()` runs at import time

- **Category:** Fragility
- **Location:** `src/main/index.ts:38-43`
- **Observation:** `ensureExtraPathsOnProcessEnv()` is called at module-eval time with a comment explaining it must run before any spawn. This is a load-bearing import-time side effect — if anyone reorders the imports, agents will stop finding `claude`/`gh`/`git` from Finder launches.
- **Why it matters:** Import-order dependencies are the #1 hardest-to-debug class of bug in TypeScript codebases. This one is documented in a comment but not enforced anywhere.
- **Recommendation:** Move the call into `app.whenReady()` as the very first line, OR add an assertion in `buildAgentEnv()` that the extra PATH entries are present and throw a clear error if not.

### [MINOR] Two SQLite queries in dashboard handlers use unix-epoch math with timezone implicit assumptions

- **Category:** Fragility
- **Location:** `src/main/handlers/dashboard-handlers.ts:11-14`, `src/main/handlers/dashboard-handlers.ts:65-71`
- **Observation:** `getCompletionsPerHour` uses `strftime('%Y-%m-%dT%H:00:00', finished_at / 1000, 'unixepoch', 'localtime')` — bucketing by _server local time_ on a database that stores ISO-UTC strings. `getTaskBurndown` uses `DATE(completed_at)` against ISO strings — implicitly UTC. The two queries disagree on what "today" means.
- **Why it matters:** The same dashboard shows hourly buckets in local time and daily buckets in UTC. Users in non-UTC timezones see off-by-day discrepancies between charts.
- **Recommendation:** Standardize all dashboard queries on either local time or UTC. Document the choice.
