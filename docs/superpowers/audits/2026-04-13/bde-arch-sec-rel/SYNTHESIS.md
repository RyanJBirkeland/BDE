# BDE Audit Synthesis — Architecture · Security · Reliability

**Date:** 2026-04-13
**Lenses:** 9 across 3 teams
**Total findings:** 47 (Architecture: 25, Security: 18, Reliability: 24 — 20 unique after dedup)

---

## Scoring Notes

Score = (Severity × Confidence) / Effort. Severity: Critical=4, High=3, Medium=2, Low=1. Confidence: High=3, Medium=2, Low=1. Effort: S=1, M=2, L=4. Scores for all candidates are shown in the Top 10 table.

---

## Top 10 Ranked Actions

| Rank | Finding ID(s) | Title | Score | Severity | Effort | Confidence | Team |
|------|--------------|-------|-------|----------|--------|------------|------|
| 1 | F-t3-errors-1 | Add process-level uncaught exception and unhandled rejection handlers | 12.0 | Critical | S | High | Reliability |
| 2 | F-t3-lifecycle-1 | Fix watchdog-completion double-call race: move terminal guard before side effects | 12.0 | Critical | S | High | Reliability |
| 3 | F-t2-ipc-trust-3 | Wrap `tearoff:dragCancelFromRenderer` with `safeOn` | 9.0 | Medium | S | High | Security |
| 4 | F-t3-statesync-5 | Clean up `pendingUpdates` / `pendingCreates` on task deletion | 6.0 | Medium | S | High | Reliability |
| 5 | F-t3-lifecycle-5 | Orphan recovery must not increment `retry_count` | 6.0 | High | S | Medium | Reliability |
| 6 | F-t3-lifecycle-6 | Clear stale `claimed_by` on app restart for all task statuses | 6.0 | Medium | S | Medium | Reliability |
| 7 | F-t1-coupling-4 | Use `effectiveRepo` for `sprint:failureBreakdown` query (one-liner) | 6.0 | Medium | S | High | Architecture |
| 8 | F-t1-coupling-1 | Stop re-exporting maintenance internals through `ISprintTaskRepository` | 6.0 | High | S | High | Architecture |
| 9 | F-t2-ipc-trust-4 | Validate `windowId` UUID format in tearoff returnAll/returnToMain handlers | 4.0 | Medium | S | Medium | Security |
| 10 | F-t3-errors-6 | Add React error boundaries at the App level (and per high-risk view) | 4.5 | High | M | High | Reliability |

_Tie-breaking applied: among ties rank 1–2 (both 12.0), Critical beats High. Among ranks 3–9 at 6.0, Severity then Effort determine order. F-t3-errors-6 (4.5 = 3×3/2) beats others just below 6._

---

### Action Details

**Rank 1 — F-t3-errors-1: Process-Level Exception Handlers**
Zero `process.on('uncaughtException')` or `process.on('unhandledRejection')` handlers exist anywhere in the codebase. Any escaping synchronous throw or un-caught Promise rejection in the main process silently kills the Electron process, taking all in-flight agents with it, with no log entry and no user warning. Add these two handlers in `src/main/index.ts` before `app.whenReady()`. Log to file via `createLogger` and emit a renderer toast. For DB-corruption signals, trigger graceful shutdown rather than a crash loop. This is a two-line registration with a small logging body — the smallest possible surface area for the highest possible impact.

**Rank 2 — F-t3-lifecycle-1: Watchdog-Completion Double-Call Race**
The `terminalCalled` guard in `terminal-handler.ts` checks membership and then adds the task ID — but the guard is placed after the function has already started logging metrics. If the watchdog loop and the natural `consumeMessages()` completion fire within milliseconds of each other, both pass the guard and both invoke `resolveDependents()`, leading to double cascade cancellation, stale dependency overwrites, and double-counted metrics. The fix is to move `terminalCalled.add(taskId)` to the very first line after the guard check, before any side effects, and wrap the rest of the body in a try/finally that clears the ID after 5–10 seconds. This is a one-line move with a finally block addition.

**Rank 3 — F-t2-ipc-trust-3: Missing safeOn on Tearoff Drag Cancel**
`tearoff:dragCancelFromRenderer` is registered with raw `ipcMain.on()` without the `safeOn()` error wrapper used by all other handlers. If `cancelActiveDrag()` throws, the error is swallowed silently and no log entry is produced. This is a one-line change: replace `ipcMain.on` with `safeOn` (which already exists in `ipc-utils.ts`). Also move the channel to the typed IPC channel map — see F-t2-ipc-trust-1 for the broader tearoff pattern.

**Rank 4 — F-t3-statesync-5: Pending Updates Not Invalidated on Task Deletion**
When `deleteTask` or `batchDeleteTasks` removes tasks from the store, `pendingUpdates` and `pendingCreates` are not cleaned up. The orphaned entries expire via TTL eventually, but in the window they can apply stale protection to a new task that receives the same ID, and the entries accumulate unbounded during heavy create-delete churn. The fix is a three-line `Object.fromEntries` filter added inside the `set()` call in both delete paths.

**Rank 5 — F-t3-lifecycle-5: Orphan Recovery Increments Retry Count Incorrectly**
Orphan recovery re-queues tasks by incrementing `retry_count`. But orphaning is a process crash, not a task failure. The same task then gets `retry_count` incremented again when the next agent run actually fails, exhausting the three-retry budget in one real failure. The fix: have orphan recovery set `status: 'queued'` and `claimed_by: null` without touching `retry_count`. Only agent failure paths (`resolveFailure`) should increment the counter.

**Rank 6 — F-t3-lifecycle-6: Stale `claimed_by` on Restart**
On app restart, orphan recovery only queries tasks with `status = 'active'`. Tasks stuck in `review` or other non-active statuses with a non-null `claimed_by` from the previous session remain claimed forever. Add a startup sweep that clears `claimed_by` for any task still holding the current `EXECUTOR_ID`, regardless of status, before the drain loop starts. The orphan re-queue logic then handles active ones as before.

**Rank 7 — F-t1-coupling-4: One-Line Repository Consistency Fix**
`sprint-local.ts` imports `getFailureReasonBreakdown` via a dynamic `await import('../data/sprint-task-repository')` inside the `sprint:failureBreakdown` handler, even though the same handler file already has `effectiveRepo` in scope. This bypasses whatever repository is injected for testing and creates an inconsistent access pattern in the same file. Change it to `effectiveRepo.getFailureReasonBreakdown()`.

**Rank 8 — F-t1-coupling-1: Repository Interface Leaks Maintenance Internals**
`sprint-task-repository.ts` re-exports `UPDATE_ALLOWLIST`, `pruneOldDiffSnapshots`, `DIFF_SNAPSHOT_RETENTION_DAYS`, and `clearSprintTaskFk` — implementation details that bind callers to internal maintenance machinery. Move these to a `sprint-maintenance-facade.ts` so the repository interface surface is limited to CRUD, queue ops, PR lifecycle, and reporting. `bootstrap.ts` already imports these directly; redirecting it to the new facade is the only caller change.

**Rank 9 — F-t2-ipc-trust-4: Tearoff windowId Format Validation**
`tearoff:returnAll` and `tearoff:returnToMain` accept a renderer-supplied `windowId` string and use it to look up and destroy a BrowserWindow with no format check. Add a `VALID_WINDOW_ID_PATTERN` UUID regex guard before the Map lookup in both handlers. If the format does not match, log a warning and return early. The Map lookup already handles unknown IDs gracefully; the format check closes the remaining gap.

**Rank 10 — F-t3-errors-6: React Error Boundaries**
No React error boundary exists anywhere in the renderer. A single thrown exception in any component during render (malformed task data, store subscription failure, etc.) produces a white screen and requires an app restart, dropping any unsaved editor or pipeline state. Add one top-level `<ErrorBoundary>` wrapping `<App>` that displays a recoverable fallback and logs to the main process. Optionally add domain-level boundaries around `CodeReviewView` and `IDEView` (the most complex views) so a crash in one does not take down the others.

---

## Cross-Cutting Themes

### Theme 1: Fire-and-Forget Async Without Error Containment
**Spans:** F-t3-errors-1, F-t3-errors-2, F-t3-errors-4, F-t3-errors-5, F-t3-errors-9, F-t3-lifecycle-1, F-t3-lifecycle-3

The codebase consistently uses `.catch(err => logger.warn(...))` as a terminal handler for async operations that are actually critical (polling loops, agent telemetry, IPC streaming). This works until the Promise rejects before the `.catch()` line, or until the inner `.catch()` handler itself throws — both of which propagate as unhandled rejections. With no `process.on('unhandledRejection')` handler (F-t3-errors-1), these silently kill the process. The pattern is systemic: it appears in both pollers, all three streaming handlers, telemetry persistence, and adhoc agent turns. The fix is not just adding the process-level handler (Rank 1 above); it requires auditing each fire-and-forget site and wrapping them in async IIFEs with explicit try/catch.

### Theme 2: Singleton Repository / Direct DB Access Bypassing Abstraction
**Spans:** F-t1-coupling-1, F-t1-coupling-2, F-t1-coupling-3, F-t1-coupling-4, F-t1-coupling-5, F-t1-coupling-6

Multiple services instantiate `createSprintTaskRepository()` at module load time, and IPC handlers call `getDb()` directly and pass the connection into query functions. `AgentManager` correctly receives a repository via constructor injection; `sprint-mutations.ts`, `review-orchestration-service.ts`, and several handlers do not. This makes the IPC layer hard to test, couples it to the global SQLite lifecycle, and means that injected test repositories are silently bypassed. The pattern is systemic across the data layer, not an isolated exception.

### Theme 3: IPC Surface Typing and Wrapping Gaps — Tearoff Cluster
**Spans:** F-t2-ipc-trust-1, F-t2-ipc-trust-3, F-t2-ipc-trust-4, F-t2-ipc-trust-5, F-t1-boundaries-1, F-t1-boundaries-5

Four tearoff IPC handlers use raw `ipcMain.on()` instead of `safeOn()`, are absent from the typed IPC channel map, and perform destructive window operations (destroy, delete entry) on unvalidated renderer-supplied strings. Simultaneously, the broadcast-listener side (`api-agents.ts`, `api-utilities.ts`) constructs listeners manually without the `onBroadcast` helper, bypassing type safety. Both sides of the IPC boundary have the same gap: the wrapper infrastructure exists and is used correctly in most places, but the tearoff cluster and high-traffic broadcast channels were written before or outside that convention.

### Theme 4: Agent Lifecycle Race Conditions Around Terminal Status
**Spans:** F-t3-lifecycle-1, F-t3-lifecycle-2, F-t3-lifecycle-3, F-t3-lifecycle-5

The agent terminal resolution path has multiple concurrent-access problems: the deduplication guard fires after side effects begin (Rank 2), the watchdog deletes the agent from the active map before the natural completion path runs its cleanup check, `resolveSuccess` and fast-fail requeue can both run if `resolveSuccess` subsequently throws, and orphan recovery increments `retry_count` independently of the failure path. These four findings share a root cause: the lifecycle state machine is distributed across `index.ts`, `run-agent.ts`, `completion.ts`, and `terminal-handler.ts` without a single authoritative ownership point for "has this task been resolved?"

### Theme 5: Optimistic Update State Leaks in Renderer Stores
**Spans:** F-t3-statesync-1, F-t3-statesync-2, F-t3-statesync-5, F-t3-statesync-6, F-t3-errors-7

The `pendingUpdates` mechanism is designed for field-level protection during optimistic updates, but has several holes: the 2s TTL can expire while IPC is still in flight (F-t3-statesync-1), three independent pollers can race to write the same fields (F-t3-statesync-2), deleted tasks leave orphan entries (F-t3-statesync-5), and per-task TTL means multiple concurrent field updates from different sources overwrite each other (F-t3-statesync-6). The error path (F-t3-errors-7) is the same gap from the failure side: no rollback on IPC error. The pattern is systemic in `sprintTasks.ts` and `usePrStatusPolling.ts`.

---

## Quick Wins

Items scoring ≥ 6.0 with Effort = S. All can ship in a single PR or as a paired PR.

| Finding ID | Title | Score | What to do |
|-----------|-------|-------|------------|
| F-t3-errors-1 | Missing process-level exception handlers | 12.0 | Add `process.on('uncaughtException')` and `process.on('unhandledRejection')` in `src/main/index.ts` before `app.whenReady()`. Log to `~/.bde/bde.log` and optionally notify renderer. |
| F-t3-lifecycle-1 | Terminal guard fires after side effects | 12.0 | In `terminal-handler.ts`, move `terminalCalled.add(taskId)` to first line after the guard check, before any metric recording or dependent resolution. |
| F-t2-ipc-trust-3 | Missing `safeOn` on drag cancel handler | 9.0 | Replace `ipcMain.on('tearoff:dragCancelFromRenderer', ...)` with `safeOn(...)` in `tearoff-handlers.ts`. |
| F-t3-statesync-5 | `pendingUpdates` not cleared on task delete | 6.0 | In `deleteTask` and `batchDeleteTasks`, add `pendingUpdates: Object.fromEntries(...)` and `pendingCreates: s.pendingCreates.filter(...)` to the `set()` call. |
| F-t3-lifecycle-5 | Orphan recovery increments retry_count | 6.0 | In `orphan-recovery.ts`, remove the `retry_count: retryCount` assignment. Let failure paths own `retry_count` increments exclusively. |
| F-t3-lifecycle-6 | Stale `claimed_by` not cleared on restart | 6.0 | In `AgentManagerImpl.start()`, sweep all tasks held by `EXECUTOR_ID` and clear `claimed_by: null` before orphan recovery runs. |
| F-t1-coupling-4 | `failureBreakdown` bypasses `effectiveRepo` | 6.0 | In `sprint-local.ts`, change dynamic import call to `effectiveRepo.getFailureReasonBreakdown()`. One line. |
| F-t1-coupling-1 | Repository re-exports maintenance internals | 6.0 | In `sprint-task-repository.ts`, remove the four re-export lines for `UPDATE_ALLOWLIST`, `pruneOldDiffSnapshots`, `DIFF_SNAPSHOT_RETENTION_DAYS`, `clearSprintTaskFk`. Create `sprint-maintenance-facade.ts` that re-exports them; update `bootstrap.ts` to import from there. |
| F-t2-ipc-trust-4 | Tearoff `windowId` unvalidated | 4.0 | Add `VALID_WINDOW_ID_PATTERN` UUID check before `getEntry()` in `tearoff:returnAll` and `tearoff:returnToMain` handlers. |
| F-t1-boundaries-7 | Inconsistent IPC channel naming convention | 3.0 | Document the naming convention (queries: `get*`, mutations: verb+noun, one-way: `safeOn`, streams: `*Stream`) in a comment block at the top of `ipc-channels/index.ts`. Apply to new channels only — no backward-compat breakage. |
| F-t3-lifecycle-7 | Terminal cleanup window too short (5s) | 3.0 | In `terminal-handler.ts`, change the `setTimeout` delay from `5000` to `10_000`. Move the `terminalCalled.add` before side effects (see Rank 2). |
| F-t2-csp-sandbox-2 | Missing `frame-ancestors 'none'` in CSP | 3.0 | In `src/main/bootstrap.ts`, add `"frame-ancestors 'none'; "` to both dev and prod CSP strings. |
| F-t2-csp-sandbox-3 | Missing `form-action 'self'` in CSP | 3.0 | In `src/main/bootstrap.ts`, add `"form-action 'self'; "` to both dev and prod CSP strings. |

---

## Deferred / Out of Scope

| Finding ID | Title | Reason for Deferral |
|-----------|-------|---------------------|
| F-t1-cohesion-1 | AgentManager god class (801 lines) | Large refactor (Effort L). Does not affect correctness today. Schedule as a dedicated epic after lifecycle races (Theme 4) are fixed first — refactoring a racy system introduces new races. |
| F-t1-coupling-6 | Abstract `IDatabase` over SQLite singleton | Large refactor (Effort L). Low confidence that abstraction pays off for a single-process Electron app. Defer until there is a concrete need (e.g., in-memory test DB). |
| F-t3-statesync-2 | Consolidate three PR pollers into one | Large design change (Effort L). Correct finding — renderer and main-process pollers race — but the fix requires a new architectural contract for PR event ownership. Plan as separate work item after state sync quick wins land. |
| F-t3-statesync-6 | Per-field TTL in `pendingUpdates` | Large state refactor (Effort L). The per-task TTL with field list is already partially correct; per-field timestamps add significant complexity. Address after F-t3-statesync-5 and F-t3-statesync-1 are fixed. |
| F-t1-cohesion-2 | `run-agent.ts` message loop sprawl | Medium effort but lower priority than lifecycle correctness fixes. Schedule as part of the same epic as F-t1-cohesion-1. |
| F-t1-boundaries-4 | IPC channel interface sprawl | Medium effort, no runtime impact. Useful for DX but not a stability issue. Defer to a cleanup sprint. |
| F-t1-boundaries-6 | `api-utilities.ts` preload bridge split | Medium effort, no runtime impact. DX improvement only. Pair with F-t1-boundaries-4 in cleanup sprint. |
| F-t2-injection-3 | Unnecessary grep sanitization in `memory-search.ts` | Low severity. The over-engineering is harmless. Clean it up during a routine maintenance pass. |
| F-t2-csp-sandbox-10 | `unsafe-inline` in `style-src` | Medium confidence. Requires auditing actual inline style usage; may be legitimately needed by Monaco or CSS-in-JS patterns. Investigate before removing. |
| F-t3-statesync-7 | Stale selector snapshot (theoretical) | Low confidence, Low severity. Zustand v4's shallow equality prevents this in practice. Document only. |
| F-t3-statesync-9 | Batch mutations not sequenced | Low confidence. Theoretical race during rapid batch operations; no user reports. Monitor. |

---

## Open Questions

**1. Is the `terminalCalled` deduplication truly racy or just a review-time inference?**
F-t3-lifecycle-1 and F-t3-lifecycle-2 both hinge on the timing window between the watchdog and the natural completion path. The lifecycle lens assessed confidence as High but could not produce a reproduction. Before investing in the fix, add structured logging to `terminal-handler.ts` to capture duplicate-call occurrences in production. If zero duplicates appear after a 2-week soak, the guard placement may be sufficient.

**2. Is three-way PR poller conflict (F-t3-statesync-2) causing real user-visible bugs, or is it theoretical?**
The statesync lens identified a race between `usePrStatusPolling`, `sprint-pr-poller`, and `useSprintPolling`. The scenario produces non-deterministic field-merge order. It is worth adding a debug log in both pollers recording the current `pr_status` before and after writes to measure how often they see conflicting values. If the main-process poller always wins due to broadcast timing, the renderer-side PR poller may be redundant and safe to remove.

**3. Does `resolveSuccess` actually race with fast-fail requeue (F-t3-lifecycle-3)?**
The lifecycle lens noted that `fast-fail` takes an early return before calling `resolveSuccess`, so both paths *should not* run concurrently. The race concern is a subtle case where `resolveSuccess` throws and the `resolveFailure` fallback in `completion.ts` fires while watchdog's terminal handler is also in progress. This requires a test harness that can inject a rebase failure mid-stream to confirm. Until confirmed, treat as medium priority.

**4. What does `getOrphanedTasks()` actually query?**
The lifecycle audit noted that on restart, only `status = 'active'` tasks with `claimed_by = EXECUTOR_ID` are recovered. The query implementation was not visible during the audit. Before adding the startup sweep for F-t3-lifecycle-6, read `sprint-agent-queries.ts` to confirm the actual filter and whether `review`-status tasks with `claimed_by` set are already handled or truly orphaned.

**5. Is `unsafe-inline` in `style-src` actually required?**
F-t2-csp-sandbox-10 recommends removing it, but Monaco editor and some CSS-in-JS patterns (Emotion, styled-components) inject inline styles. Confirm by temporarily tightening the CSP in dev mode and checking for console errors before committing to removal.
