# BDE Deep Audit — Synthesis
**Date:** 2026-04-12  
**Git SHA:** b8a055a1b01beb28c1175a43ec9300b1797bc050  
**Lenses:** 11 across 4 teams (lens-path-trav was not produced; 11/12 complete)

---

## Overall Assessment

BDE demonstrates a **strong architectural foundation**: Electron process boundaries are rigorously maintained, the IPC layer is typed end-to-end with `safeHandle`/`IpcChannelMap`, shell execution consistently uses argument arrays, SQLite transactions are well-scoped, and the repository abstraction is meaningfully applied in the agent manager. The codebase is not in crisis — it is a mature, thoughtfully designed system.

However, the audit uncovered **two concentrations of genuine risk** that need immediate attention. First, the agent lifecycle has three independent Critical defects (missing `resolveDependents` calls, un-killed watchdog processes, and insufficient shutdown timeout) that collectively mean dependent tasks silently stay blocked whenever an agent fails in any non-happy path. Second, the PR poller's direct-SQL bulk-transition path bypasses both the state machine validator and the audit trail atomicity guarantee — a double integrity failure on the same code path that handles PR merges. Beyond these clusters, security has three quick-win fixes (grep DoS, missing status validation, untyped webhook URL), and data growth has two unbounded-accumulation problems (agent\_events never pruned, dependency scans never bounded). Fixing the top 10 items below eliminates the most consequential risks while requiring modest, well-scoped effort.

---

## Top 10 Ranked Actions

Score = (Severity × Confidence) / Effort. Ties broken by Severity, then Effort.

| Rank | ID(s) | Title | Score | Sev | Conf | Effort | Action |
|------|-------|-------|-------|-----|------|--------|--------|
| 1 | F-t3-audit-trail-3 | Audit trail failure silently allows PR poller status transition | 12.0 | Critical | High | S | In `transitionTasksToDone` / `transitionTasksToCancelled`, change `catch (err) { logger.warn(...) }` to `throw err` so the wrapping transaction rolls back the status UPDATE when `recordTaskChangesBulk` fails. |
| 2 | F-t4-ipc-valid-1 | Grep regex DoS in `memory:search` handler | 12.0 | Critical | High | S | Add a query length cap (e.g., 200 chars), strip nested quantifier patterns, and set a 5-second execution timeout on the `execFileAsync('grep', ...)` call in `memory-search.ts:31`. |
| 3 | F-t2-prompt-tok-11 | No prompt validation before agent spawn | 9.0 | High | High | S | Add a length + required-section guard in `buildAgentPrompt()` that throws if the assembled prompt is under 200 chars, and log prompt size at `info` level in `validateAndPreparePrompt()`. |
| 4 | F-t1-repo-pat-2 | `getFailureReasonBreakdown` absent from `IDashboardRepository` interface | 9.0 | High | High | S | Add the method to `IDashboardRepository`, delegate it in the factory, and remove the module-level re-export that forces callers to import from the implementation file. |
| 5 | F-t3-sqlite-2 | `agent_events` table grows unbounded — `pruneOldEvents` never called | 9.0 | High | High | S | Wire `pruneOldEvents(db, 30)` into the existing daily maintenance task (or app shutdown hook). The function already exists in `event-queries.ts`; it simply has no caller. |
| 6 | F-t3-audit-trail-1 | `pr_mergeable_state` mutations bypass audit trail | 9.0 | High | High | S | Wrap the UPDATE in `updateTaskMergeableState()` with a `recordTaskChanges()` call (or redirect to `updateTask()`). Field is user-visible in the merge button state but currently has zero change history. |
| 7 | F-t4-ipc-valid-2 | `sprint:update` handler never calls `validateTransition()` | 9.0 | High | High | S | Before calling `updateTask()`, fetch the current status and call `isValidTransition(currentStatus, patch.status)` — throwing on invalid transitions. The shared module already exports this validator. |
| 8 | F-t2-agent-life-1 | `resolveDependents()` not called on 5 early-exit paths in `completion.ts` | 6.0 | Critical | High | M | Add a `finally`-block pattern in `completion.ts` that checks whether the task reached a terminal status and calls `onTaskTerminal()` if the guard has not yet fired. Blocked downstream tasks silently orphan on every worktree-eviction or branch-detection failure. |
| 9 | F-t2-agent-life-2 | Watchdog `abort()` does not kill the underlying agent process | 6.0 | Critical | High | M | After `agent.handle.abort()`, attempt `agent.handle.process?.kill('SIGKILL')` (or equivalent). Without this, timed-out agents continue consuming CPU and making API calls after the watchdog declares them dead. |
| 10 | F-t2-agent-life-3 | App shutdown timeout (10 s) too short for `finalizeAgentRun()` | 6.0 | Critical | High | M | Increase `stop()` timeout to 60 seconds and add explicit waiting for pending `onTaskTerminal` callbacks before returning. Git rebase + PR creation in `finalizeAgentRun()` regularly exceeds 10 seconds, leaving task state incomplete on quit. |

---

## Cross-Cutting Themes

### Theme 1: Terminal-Path Incompleteness — Dependency Graph Correctness at Risk
**Findings:** F-t2-agent-life-1, F-t2-agent-life-3, F-t2-agent-life-5, F-t3-audit-trail-2, F-t3-audit-trail-4, F-t3-audit-trail-5

Every one of these findings shares the same systemic root: **`resolveDependents()` / `onTaskTerminal()` is not reliably called on all terminal paths**. The completion handler has 5 early-return paths that skip it (F-t2-agent-life-1). The shutdown timeout truncates it (F-t2-agent-life-3). The watchdog/completion race can cause the wrong caller to win the guard (F-t2-agent-life-5). The PR poller bypasses the state-machine validator before triggering it (F-t3-audit-trail-2, -4). And the batch resolution loop swallows per-task errors silently (F-t3-audit-trail-5). The systemic cause is that `onTaskTerminal` is a **side-effecting callback threaded by hand** through many distinct code paths rather than being the single, unconditional exit point for every terminal status transition. Consider making `updateTask()` itself the trigger for dependency resolution whenever `isTerminal(newStatus)` — eliminating the need for callers to remember the callback.

### Theme 2: Data Accumulation Without Bounds — Storage and Query Performance
**Findings:** F-t3-sqlite-1, F-t3-sqlite-2, F-t2-agent-evts-1

Three independent findings document the same pattern: data is written correctly but no retention/pruning mechanism fires. `agent_events` rows accumulate with no cleanup (F-t3-sqlite-2 / F-t2-agent-evts-1 are the same root defect seen from two lenses). `getAllTaskIds()` and `getTasksWithDependencies()` load the full `sprint_tasks` table on every startup and dependency mutation (F-t3-sqlite-1). These are benign today at hundreds of tasks and events, but the architecture provides no ceiling. The fix pattern is identical in each case: add a bounded read or a scheduled purge.

### Theme 3: State Machine Bypass — PR Poller as a Privileged Back Door
**Findings:** F-t3-audit-trail-2, F-t3-audit-trail-3, F-t3-audit-trail-4

The PR poller (`sprint-pr-poller.ts`) uses direct SQL UPDATEs (`transitionTasksToDone`, `transitionTasksToCancelled`) that bypass `validateTransition()`, swallow audit trail write failures, and pass the affected task IDs to `onTaskTerminal()` without confirming the DB actually changed state. All three gaps live in the same ~40-line function. The systemic root is that the bulk-transition path was written for performance (one SQL call instead of N `updateTask()` calls) but skipped the correctness invariants that `updateTask()` enforces. The fix is either to re-route through `updateTask()` per task (simplest) or to replicate the validation + error-escalation logic inside the bulk path.

### Theme 4: IPC Type Safety Gaps — Definitions That Don't Enforce
**Findings:** F-t1-ipc-surf-2, F-t1-ipc-surf-3, F-t4-ipc-valid-2, F-t4-ipc-valid-3, F-t4-ipc-valid-4, F-t4-ipc-valid-5

The typed IPC layer (`IpcChannelMap`, `BroadcastChannels`) is well-conceived, but several gaps mean the types are documentation rather than contracts. Fire-and-forget `send()` channels are not constrained by `IpcChannelMap` (F-t1-ipc-surf-2). Broadcast `webContents.send()` calls are not validated against `BroadcastChannels` at the send site (F-t1-ipc-surf-3). And at the handler level, status transitions (F-t4-ipc-valid-2), webhook URLs (F-t4-ipc-valid-3), array lengths (F-t4-ipc-valid-4), and clone target formats (F-t4-ipc-valid-5) receive no runtime validation despite the IPC surface being the renderer/main trust boundary. The unifying fix is: typed definitions should be enforced at both compile time (wrappers) and runtime (validation in handlers).

---

## Quick Wins

Items with Score ≥ 6.0 and Effort = S that are not already in the Top 10.

| ID | Title | Score | One-Line Fix |
|----|-------|-------|--------------|
| F-t2-prompt-tok-10 | Upstream spec truncation capped at 500 chars vs. primary at 8000 | 6.0 | Change `truncateSpec(upstream.spec, 500)` to `2000` in `prompt-composer.ts:241`. |
| F-t3-sqlite-5 | Missing composite index on `agent_runs(status, started_at DESC)` | 6.0 | Add `CREATE INDEX idx_agent_runs_status_started_at ON agent_runs(status, started_at DESC)` in the next migration. |
| F-t3-state-mgmt-4 | `evictedAgents` flag never cleared after history reset | 6.0 | In `agentEvents.ts`'s `clear(agentId)` method, also delete `evictedAgents[agentId]` from state. |
| F-t1-ipc-surf-1 | Fragmented `safeHandle` calls break single-line detection tooling | 6.0 | Add an ESLint rule requiring channel names on the same line as `safeHandle(` — lint-only change, no logic touched. |
| F-t1-repo-pat-3 | `src/main/index.ts` imports task group queries directly rather than via repository | 6.0 | Replace the three direct `task-group-queries` imports in `index.ts` with lookups on the existing repository instance. |
| F-t4-ipc-valid-5 | `repos:clone` passes unvalidated `owner`/`repo` to git URL construction | 6.0 | Add `if (!/^[a-zA-Z0-9_.-]+$/.test(owner) || !/^[a-zA-Z0-9_.-]+$/.test(repo)) throw` before constructing the URL. |
| F-t1-repo-pat-7 | `reporting-queries` logger never initialized — falls back to console | ~4.5 | Add `setReportingQueriesLogger(logger)` alongside `setSprintQueriesLogger(logger)` in `src/main/index.ts`. (Not scored as a formal finding; confirmed Low in lens.) |

---

## Architectural Strengths

The following were explicitly confirmed as well-done by lens agents — they are genuine assets, not aspirational statements.

**Process boundary discipline (F-t1-proc-bound positive findings):** 150+ renderer files and 100+ main-process files were scanned; zero cross-process imports were found. Shared modules import neither Node.js built-ins nor DOM APIs. Context isolation is enabled in all windows. This is exemplary for an Electron codebase of this size.

**Shell injection prevention (lens-shell-inj):** All 140+ shell invocations use `execFile`/`execFileAsync` with argument arrays. Zero `execSync` or `shell:true` instances. Branch names run through a strict whitelist regex (`branchNameForTask`). Commit messages run through `sanitizeForGit()`. The codebase achieves defense-in-depth that most Electron apps don't bother with.

**SQLite transaction correctness (lens-sqlite-perf positive findings):** `claimTask`, `updateTask`, `releaseTask`, `deleteTask`, `markTaskDoneByPrNumber`, and `reorderGroupTasks` all use `db.transaction()` correctly. No N+1 patterns. Index coverage is comprehensive thanks to targeted migrations v039–v043.

**IPC channel type safety (lens-ipc-surf baseline):** `IpcChannelMap` with 166 typed channels, 143 registered handlers, 88 typed preload invocations, `safeHandle`/`safeOn` wrappers on all handlers — this infrastructure is genuinely robust and catches refactoring errors at compile time.

**Renderer state architecture (lens-state-mgmt positive findings):** No Zustand store reads from another store (preventing stale-read bugs). Optimistic update field-level TTL tracking is well-implemented and tested. `useBackoffInterval` provides jitter + exponential backoff for all polling except the log poller.

**Agent event cap enforcement (lens-agent-evts):** The 2000-event cap is correctly enforced in the renderer with FIFO eviction on both live events and history loads. Both code paths are covered by tests.

---

## Deferred / Out of Scope

**F-t2-agent-life-4 (double-claim drain race, score 1.5):** The claim is atomic at the SQLite level. The race only manifests if two BDE instances run against the same database simultaneously — an explicitly unsupported configuration. The L-effort fix is not justified until multi-instance use becomes a design goal.

**F-t2-agent-life-8 (terminal task fingerprint cache invariant, score ~1.0):** The behavior is intentionally correct (terminal tasks evicted from fingerprint cache but retained in dep index). Finding recommends a documentation comment only. Deferred to the next documentation pass.

**F-t2-agent-life-9 (max_runtime_ms timing documentation, Low):** Operational confusion risk only; no correctness defect. One TSDoc comment resolves this, deferred to any nearby PR touching watchdog.ts.

**F-t2-prompt-tok-5 (Copilot/Synthesizer settingSources already correct):** This is a positive finding + request for a code comment. No code change needed.

**F-t2-prompt-tok-6 (personality token overhead, Low):** ~200 tokens per agent, accepted overhead for high-quality behavioral guidance. Optimization opportunity only if per-agent cost becomes a primary concern.

**F-t2-prompt-tok-7 (output cap heuristic reliability, Low/M):** The classifier is advisory, not enforced. An improvement roadmap exists but the current heuristic is sufficient for the single-user desktop use case.

**F-t2-prompt-tok-9 (budget visibility for agents, Low):** Requires SDK support that may not exist. Deferred until SDK documentation confirms `maxBudgetUsd` signal availability.

**F-t1-repo-pat-4 (bootstrap raw SQL for test task cleanup):** Intentional documented bypass. Audit trail exemption is acceptable for startup maintenance that predates any active task.

**F-t1-repo-pat-5 (Supabase import direct schema access):** Scheduled for removal before public release. No action warranted.

**F-t1-proc-bound-2 (inline import() in preload for types):** Risk is theoretical; electron-vite's strict config makes accidental runtime inclusion highly unlikely. Deferred to a cleanup PR.

**F-t3-sqlite-4 (task_changes index verification):** Index already present via migration v041. No action needed.

**F-t1-ipc-surf-4 (test handler capture coupling):** Medium effort, low direct user impact. The test infrastructure coupling is real but not a regression risk. Backlog.

**F-t1-ipc-surf-5 (circuit-breaker channel naming inconsistency):** Low confidence, Low severity, naming only. Deferred indefinitely.

---

## Open Questions

**Path traversal lens missing:** `lens-path-trav.md` was not produced by Team 4. Path traversal was partially covered by the shell injection lens (worktree paths confirmed safe) and IPC validation lens (`validateRepoPath`, `validateMemoryPath`, `validateIdePath` noted as strengths), but a dedicated path traversal lens would have examined IDE file operations (`ide-fs-handlers.ts`) and memory path scoping more thoroughly. This coverage gap should be addressed in a follow-up audit.

**F-t2-agent-life-2 SDK internals unknown:** The watchdog lens concluded `abort()` probably does not kill the underlying subprocess, but the `@anthropic-ai/claude-agent-sdk` internals were not inspectable. The recommendation to call `agent.handle.process?.kill('SIGKILL')` assumes the handle exposes a process reference — this needs verification against the SDK type definitions before implementation.

**F-t2-prompt-tok-8 SDK maxTurns/maxBudgetUsd support:** The prompt/token lens recommends adding `maxTurns` and `maxBudgetUsd` to pipeline agent spawns, but notes these options require SDK documentation verification. If the SDK does not support them, the recommendation changes to watchdog-only enforcement.

**F-t3-audit-trail-2 vs. performance trade-off:** Refactoring `transitionTasksToDone` to call `updateTask()` per task (the simplest fix) converts a single bulk UPDATE into N individual transactions. For PRs associated with many tasks, this could be significantly slower. The lens did not measure the performance impact. The team should decide whether to accept the N-call approach or replicate the validation logic inline in the bulk path.

**F-t4-ipc-valid-3 SSRF threat model:** The webhook SSRF finding is real but the threat actor is the renderer process — which in the BDE single-user desktop model is the user themselves. If BDE adds multi-user or shared configurations in the future, this becomes a serious injection vector. The finding is rated High assuming future multi-user expansion; if the tool remains single-user only, the urgency is lower.
