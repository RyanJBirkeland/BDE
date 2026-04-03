# Production Readiness Audit -- Synthesis

**Date:** 2026-03-29
**Sources:** 18 audit reports (6 features x 3 personas: Red Team, Reliability Engineer, UX QA)

## Executive Summary

This synthesis consolidates 18 production readiness audit reports covering Agent Manager, Queue API, Sprint Pipeline, IDE, PR Station, and Data Layer. After aggressive deduplication (many findings like SQL column interpolation, missing merge confirmation, and SSE token exposure appear across 2-4 reports), the audit produced **127 unique findings**: 7 Critical/High, 42 Medium, 48 Low, and 30 Informational/test-gap items.

Compared to the March 28 audit, **11 previously-reported issues are now fixed**, including the most critical security items: CORS wildcard on Queue API (SEC-5), symlink path traversal in IDE (SEC-2), open GitHub API proxy (SEC-3), agent failure notes lacking recovery guidance (UX-1), Pipeline "Edit" button blank Workbench (UX-3), duplicate merge controls (UX-4), worktree lock TOCTOU race (main-process-sd S1), and terminal fontSize not wired (workspace-sd 3.5). **8 issues remain open from March 28**, notably: renderer sandbox disabled (SEC-1), repository pattern inconsistencies (ARCH-2), dual onStatusTerminal wiring (ARCH-6), SQL column allowlist without regex assertion (main-process-sd S7), and SSE token query-string exposure (main-process-sd C4).

The biggest new risks are: (1) **Agent filesystem sandbox gap** -- agents run with `bypassPermissions` and inherit the full `process.env`, enabling credential exfiltration via committed files; (2) **Sprint Pipeline dependency bypass** -- `batchUpdate` skips `onStatusTerminal`, and `unblockTask` skips spec validation, allowing tasks to run out of order or without adequate specs; (3) **Data layer audit trail gaps** -- 5+ write functions (claim, release, markDone, markCancelled, delete) bypass `recordTaskChanges()`, making the audit feature incomplete; (4) **IDE data loss** -- `fileContents` in component state means unsaved edits vanish on view switch with no warning.

---

## Delta from March 28 Audit

### Fixed Since Last Audit

| March 28 ID           | Description                                     | Evidence                                                                                   |
| --------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------ |
| SEC-2                 | Symlink path traversal in IDE `validateIdePath` | `fs.realpathSync()` added at `ide-fs-handlers.ts:19-42`; integration test covers traversal |
| SEC-3                 | `github:fetch` IPC open proxy                   | Endpoint/method allowlist at `git-handlers.ts:31-48`; tests cover rejection                |
| SEC-5                 | CORS `*` on Queue API                           | `CORS_HEADERS = {}` at `helpers.ts:57`                                                     |
| SEC-6                 | SQL interpolation in `backupDatabase()`         | Regex validation at `db.ts:32` (partially -- see DL-RED-3)                                 |
| UX-1                  | Agent failure notes not actionable              | Rewritten with recovery guidance in `run-agent.ts`, `index.ts`                             |
| UX-3                  | Pipeline "Edit" navigates to blank Workbench    | `loadTask()` called before `setView()` at `SprintPipeline.tsx:278`                         |
| UX-4                  | Duplicate merge controls                        | `PRStationActions` deleted; single `MergeButton` remains                                   |
| ARCH-3                | Hardcoded `REPO_OPTIONS` in PR Station          | `useRepoOptions()` hook used by all 7 components                                           |
| main-process-sd S1    | Worktree lock TOCTOU race                       | Atomic `writeFileSync` with `flag: 'wx'` at `worktree.ts:48-83`                            |
| main-process-pm C2/C3 | Orphan recovery and shutdown notes              | Both now set explanatory notes                                                             |
| workspace-sd 3.5      | Terminal fontSize never consumed                | `TerminalPane.tsx` reads fontSize from store                                               |

### Still Open from March 28

| March 28 ID         | Description                                   | Current Status                                                                                                                 |
| ------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| SEC-1               | Renderer sandbox disabled                     | Still present. Amplifies all renderer-side findings.                                                                           |
| ARCH-2              | Repository pattern inconsistently applied     | Partially fixed (agent manager uses DI). IPC handlers and Queue API still bypass.                                              |
| ARCH-6              | Fragile `onStatusTerminal` wiring             | `TaskTerminalService` exists but dual-path logic in agent manager remains; PR poller captures stale reference at construction. |
| main-process-sd S7  | SQL column allowlist without regex assertion  | Still open at `sprint-queries.ts:200` and `agent-queries.ts:131`.                                                              |
| main-process-sd C4  | SSE token via query-string                    | Still accepted risk at `helpers.ts:30-35`.                                                                                     |
| main-process-ax 4.8 | Stale "Supabase proxy" JSDoc in server.ts     | Still present at `server.ts:2`.                                                                                                |
| UX-2                | Virtualized diff silently disables commenting | Partially fixed (plain mode forced when comments exist), but still no indicator for new commenting on large diffs.             |
| UX-5                | Keyboard shortcuts fire in contentEditable    | Partially fixed for Cmd+S, but Cmd+B/Cmd+J still fire unconditionally in IDE.                                                  |

### New Findings

**73 new unique findings** across all features, summarized in the tables below.

---

## Findings by Feature x Severity

### Agent Manager

#### Critical/High

| ID   | Title                                                                                           | Severity | Effort | Sources           | File(s)                                      |
| ---- | ----------------------------------------------------------------------------------------------- | -------- | ------ | ----------------- | -------------------------------------------- |
| AM-1 | Agents run with `bypassPermissions` + full filesystem access                                    | Critical | L      | AM-RED-1          | `sdk-adapter.ts:46-47`                       |
| AM-2 | OAuth token passed via env var to all spawned agent processes                                   | High     | S      | AM-RED-2          | `sdk-adapter.ts:16-18`, `env-utils.ts:49-55` |
| AM-3 | Task title used unsanitized in git commit messages and PR bodies                                | High     | S      | AM-RED-3          | `completion.ts:106,172-175`                  |
| AM-4 | `claimed_by` not cleared on watchdog max-runtime and idle kills                                 | High     | S      | AM-UX-4           | `index.ts:142-174`                           |
| AM-5 | `resolveFailure` returns false on DB error, silencing terminal failures and leaving tasks stuck | High     | S      | AM-REL-5, AM-UX-6 | `completion.ts:366-392`                      |
| AM-6 | Steer in SDK mode returns misleading "delivered: true"                                          | High     | M      | AM-UX-2           | `sdk-adapter.ts:76-89`                       |

#### Medium

| ID    | Title                                                                       | Severity | Effort | Sources                       | File(s)                    |
| ----- | --------------------------------------------------------------------------- | -------- | ------ | ----------------------------- | -------------------------- |
| AM-7  | `git push --no-verify` bypasses pre-push security hooks                     | Medium   | S      | AM-RED-4                      | `completion.ts:323`        |
| AM-8  | Playground HTML served without sanitization (XSS via agent output)          | Medium   | M      | AM-RED-5                      | `run-agent.ts:89-125`      |
| AM-9  | Worktree lock race between cleanup and re-acquire                           | Medium   | S      | AM-RED-6                      | `worktree.ts:78-83`        |
| AM-10 | `_checkAndBlockDeps` silently proceeds on parse failure (dependency bypass) | Medium   | S      | AM-RED-7, AM-REL-23, AM-UX-13 | `index.ts:327-351`         |
| AM-11 | Agent env inherits full `process.env` including sensitive variables         | Medium   | M      | AM-RED-8                      | `env-utils.ts:17-24`       |
| AM-12 | `git add -A` captures all untracked files including secrets                 | Medium   | S      | AM-RED-9                      | `completion.ts:105`        |
| AM-13 | Spawn timeout timer leaks on successful spawn                               | Medium   | S      | AM-REL-1                      | `run-agent.ts:162-175`     |
| AM-14 | `cleanupWorktree` is fire-and-forget with no error logging                  | Medium   | S      | AM-REL-2                      | `worktree.ts:217-229`      |
| AM-15 | Race between orphan recovery and drain loop on startup                      | Medium   | M      | AM-REL-7                      | `index.ts:549-592`         |
| AM-16 | `_watchdogLoop` iterates over Map while deleting entries                    | Medium   | S      | AM-REL-8                      | `index.ts:489-519`         |
| AM-17 | No test coverage for `TaskTerminalService` integration                      | Medium   | M      | AM-REL-11                     | `task-terminal-service.ts` |
| AM-18 | `sdk-streaming.ts` timeout does not indicate truncation to caller           | Medium   | S      | AM-REL-12                     | `sdk-streaming.ts:42-45`   |
| AM-19 | `checkOAuthToken` reads file synchronously on main thread                   | Medium   | M      | AM-REL-13                     | `index.ts:85-124`          |
| AM-20 | `_mapQueuedTask` does not validate required fields                          | Medium   | S      | AM-REL-16                     | `index.ts:303-315`         |
| AM-21 | Rate-limit loop requeue note lacks recovery guidance                        | Medium   | S      | AM-UX-1                       | `index.ts:179-182`         |
| AM-22 | No user-visible feedback when repo path resolution fails                    | Medium   | S      | AM-UX-3                       | `index.ts:387-391`         |
| AM-23 | `killAgent` throws uncaught Error instead of returning result               | Medium   | S      | AM-UX-8                       | `index.ts:684-688`         |
| AM-24 | No agent:started event emitted for agents that fail during spawn            | Medium   | S      | AM-UX-10                      | `run-agent.ts:160-191`     |
| AM-25 | Completion handler does not emit agent events for worktree eviction         | Medium   | S      | AM-UX-11                      | `completion.ts:227-279`    |
| AM-26 | `pr_status='branch_only'` has no UI guidance for manual PR creation         | Medium   | M      | AM-UX-12                      | `completion.ts:351-359`    |
| AM-27 | CLI fallback does not handle child process crash                            | Medium   | M      | AM-REL-22                     | `sdk-adapter.ts:93-195`    |
| AM-28 | `stop()` re-queue path not tested                                           | Medium   | S      | AM-REL-20                     | `index.ts:639-653`         |

#### Low

| ID    | Title                                                                     | Severity | Effort | Sources           | File(s)                       |
| ----- | ------------------------------------------------------------------------- | -------- | ------ | ----------------- | ----------------------------- |
| AM-29 | No rate limiting on steerAgent IPC                                        | Low      | S      | AM-RED-10         | `index.ts:678-681`            |
| AM-30 | `runSdkStreaming` uses `buildAgentEnv` without auth token                 | Low      | S      | AM-RED-11         | `sdk-streaming.ts:25-26`      |
| AM-31 | Orphan recovery re-queues without incrementing retry_count                | Low      | S      | AM-RED-12         | `orphan-recovery.ts:28-32`    |
| AM-32 | `tryEmitPlaygroundEvent` allows path traversal                            | Low      | S      | AM-RED-13         | `run-agent.ts:96-97`          |
| AM-33 | `pruneStaleWorktrees` uses `console.warn` instead of logger               | Low      | S      | AM-REL-3          | `worktree.ts:250,261`         |
| AM-34 | `emitAgentEvent` swallows all SQLite write errors silently                | Low      | S      | AM-REL-9, AM-UX-5 | `agent-event-mapper.ts:70-76` |
| AM-35 | `fileLog` swallows write errors completely                                | Low      | S      | AM-REL-10         | `index.ts:52-60`              |
| AM-36 | `branchNameForTask` produces invalid `agent/` on special-char-only titles | Low      | S      | AM-REL-14         | `worktree.ts:11-19`           |
| AM-37 | Worktree error notes truncated to 500 chars                               | Low      | S      | AM-UX-9           | `index.ts:414`                |
| AM-38 | `mapRawMessage` returns empty array for unrecognized message types        | Low      | S      | AM-UX-14          | `agent-event-mapper.ts:14-63` |
| AM-39 | `branch_only` tasks stay active indefinitely                              | Low      | M      | AM-REL-17         | `completion.ts`               |
| AM-40 | `_drainRunning` flag redundant with `_drainInFlight`                      | Low      | M      | AM-REL-19         | `index.ts:429-485`            |

### Queue API

#### Critical/High

| ID   | Title                                                                    | Severity | Effort | Sources  | File(s)                    |
| ---- | ------------------------------------------------------------------------ | -------- | ------ | -------- | -------------------------- |
| QA-1 | Batch operations not atomic -- partial failures leave inconsistent state | High     | M      | QA-REL-6 | `task-handlers.ts:538-624` |
| QA-2 | Inconsistent field naming (snake_case vs camelCase) across endpoints     | High     | S      | QA-UX-1  | `task-handlers.ts:412,454` |

#### Medium

| ID    | Title                                                                     | Severity | Effort | Sources            | File(s)                                        |
| ----- | ------------------------------------------------------------------------- | -------- | ------ | ------------------ | ---------------------------------------------- |
| QA-3  | SSE token exposed in query string                                         | Medium   | M      | QA-RED-1, DL-RED-9 | `helpers.ts:29-35`                             |
| QA-4  | No rate limiting / timing-unsafe string comparison on auth                | Medium   | M      | QA-RED-2           | `helpers.ts:20-48`                             |
| QA-5  | Batch delete has no authorization granularity                             | Medium   | S      | QA-RED-3           | `task-handlers.ts:538-624`                     |
| QA-6  | Agent log access lacks task-level authorization                           | Medium   | M      | QA-RED-6           | `agent-handlers.ts:38-75`                      |
| QA-7  | SSE broadcast leaks all task events to all clients                        | Medium   | M      | QA-RED-7           | `sse-broadcaster.ts:44-53`                     |
| QA-8  | `skipValidation` query param bypasses spec quality gates (no audit trail) | Medium   | S      | QA-RED-9           | `task-handlers.ts:174,317`                     |
| QA-9  | `parseBody` continues accumulating after size rejection, double-rejection | Medium   | S      | QA-REL-1, QA-REL-2 | `helpers.ts:70-80`, `task-handlers.ts:136-142` |
| QA-10 | `handleUpdateStatus` does not validate `status` field is present          | Medium   | S      | QA-REL-4           | `task-handlers.ts:308-312`                     |
| QA-11 | `blocked` status missing from `RUNNER_WRITABLE_STATUSES`                  | Medium   | S      | QA-REL-5, QA-UX-3  | `queue-api-contract.ts:43-50`                  |
| QA-12 | No API key caching -- potential key regeneration storm                    | Medium   | S      | QA-REL-10          | `helpers.ts:12-18`                             |
| QA-13 | No request timeout on body parsing                                        | Medium   | M      | QA-REL-12          | `helpers.ts:66-96`, `server.ts`                |
| QA-14 | General PATCH silently drops disallowed fields                            | Medium   | S      | QA-UX-2            | `task-handlers.ts:260-271`                     |
| QA-15 | No individual DELETE endpoint for tasks                                   | Medium   | S      | QA-UX-4, QA-REL-15 | `router.ts`                                    |
| QA-16 | Error response inconsistency across handlers                              | Medium   | M      | QA-UX-5, QA-RED-11 | `task-handlers.ts`, `server.ts`                |
| QA-17 | Event persistence silently swallows errors                                | Medium   | S      | QA-REL-9           | `event-handlers.ts:96-98`                      |

#### Low

| ID    | Title                                                      | Severity | Effort | Sources                                                      | File(s)                                         |
| ----- | ---------------------------------------------------------- | -------- | ------ | ------------------------------------------------------------ | ----------------------------------------------- |
| QA-18 | SQL column name interpolation pattern (defense-in-depth)   | Low      | S      | QA-RED-4, SP-RED-1, DL-RED-1, DL-RED-2, DL-REL-13, DL-REL-14 | `sprint-queries.ts:200`, `agent-queries.ts:131` |
| QA-19 | Unvalidated `status` query parameter                       | Low      | S      | QA-RED-5                                                     | `task-handlers.ts:114-121`                      |
| QA-20 | Unbounded SSE client connections                           | Low      | S      | QA-RED-10                                                    | `sse-broadcaster.ts:26-39`                      |
| QA-21 | OPTIONS handler serves no purpose with empty CORS          | Low      | S      | QA-RED-8                                                     | `router.ts:19-23`                               |
| QA-22 | SSE heartbeat interval leaks on module reload              | Low      | S      | QA-REL-3                                                     | `sse-broadcaster.ts:15-23`                      |
| QA-23 | `handleUpdateDependencies` allows undefined `dependsOn`    | Low      | S      | QA-REL-11                                                    | `task-handlers.ts:488-521`                      |
| QA-24 | Route matching order-dependent with no documentation       | Low      | S      | QA-REL-13                                                    | `router.ts:77-88`                               |
| QA-25 | `handleHealth` not wrapped in try/catch                    | Low      | S      | QA-REL-14                                                    | `task-handlers.ts:96-112`                       |
| QA-26 | `handleCreateTask` uses `console` as logger                | Low      | S      | QA-REL-16                                                    | `task-handlers.ts:163-165`                      |
| QA-27 | Stale "Supabase proxy" JSDoc                               | Low      | S      | QA-UX-7                                                      | `server.ts:2-5`                                 |
| QA-28 | SSE event type always `task:output`                        | Low      | M      | QA-UX-8                                                      | `event-handlers.ts:68-69`                       |
| QA-29 | `handleTaskOutput` returns `{ok:true}` instead of resource | Low      | S      | QA-UX-9                                                      | `event-handlers.ts:100`                         |
| QA-30 | `handleTaskOutput` does not validate task existence        | Low      | S      | QA-UX-11                                                     | `event-handlers.ts:40-101`                      |
| QA-31 | Batch always returns 200 even when all ops fail            | Low      | S      | QA-UX-12                                                     | `task-handlers.ts:622-623`                      |
| QA-32 | SSE broadcaster test gap (no close/heartbeat coverage)     | Low      | S      | QA-REL-17                                                    | `sse-broadcaster.test.ts`                       |

### Sprint Pipeline

#### Critical/High

| ID   | Title                                                                   | Severity | Effort | Sources   | File(s)                       |
| ---- | ----------------------------------------------------------------------- | -------- | ------ | --------- | ----------------------------- |
| SP-1 | TOCTOU race in `sprint:update` -- async validation gap                  | Critical | M      | SP-REL-1  | `sprint-local.ts:98-153`      |
| SP-2 | `_onStatusTerminal` null-guard silently drops dependency resolution     | Critical | S      | SP-REL-2  | `sprint-local.ts:71-75`       |
| SP-3 | PR poller `onTaskTerminal` captures stale reference at construction     | Critical | S      | SP-REL-3  | `sprint-pr-poller.ts:106-117` |
| SP-4 | `sprint:batchUpdate` skips `_onStatusTerminal` for terminal transitions | High     | S      | SP-REL-5  | `sprint-local.ts:252-315`     |
| SP-5 | Symlink-based path traversal in `validateSpecPath`                      | High     | S      | SP-RED-4  | `sprint-spec.ts:27-37`        |
| SP-6 | IPC `sprint:update` accepts arbitrary fields without allowlist          | High     | S      | SP-RED-2  | `sprint-local.ts:98-154`      |
| SP-7 | ConflictDrawer and HealthCheckDrawer unreachable from pipeline UI       | High     | M      | SP-UX-001 | `SprintPipeline.tsx:110`      |

#### Medium

| ID    | Title                                                                      | Severity | Effort | Sources                        | File(s)                                                   |
| ----- | -------------------------------------------------------------------------- | -------- | ------ | ------------------------------ | --------------------------------------------------------- |
| SP-8  | `sprint:unblockTask` bypasses spec validation                              | Medium   | S      | SP-RED-3, SP-REL-7             | `sprint-local.ts:237-245`                                 |
| SP-9  | `sprint:readLog` agent ID not validated for path traversal                 | Medium   | S      | SP-RED-5                       | `sprint-local.ts:209-216`                                 |
| SP-10 | Unvalidated `href` from task notes (stored XSS via URL)                    | Medium   | S      | SP-RED-6                       | `TaskDetailDrawer.tsx:222-236`                            |
| SP-11 | Queue API status endpoint allows `blocked`->`queued` bypass                | Medium   | S      | SP-RED-11                      | `queue-api-contract.ts:43-50`, `task-handlers.ts:290-392` |
| SP-12 | `sprint:batchUpdate` allows status changes without spec validation         | Medium   | S      | SP-REL-6                       | `sprint-local.ts:274-291`                                 |
| SP-13 | `sanitizeDependsOn` silently coerces invalid data to null                  | Medium   | S      | SP-REL-8, DL-RED-11, DL-REL-20 | `sanitize-depends-on.ts:17-19`                            |
| SP-14 | Concurrent `updateTask` calls race on pendingUpdates cleanup               | Medium   | M      | SP-REL-9                       | `sprintTasks.ts:126-165`                                  |
| SP-15 | SpecPanel draft not synced when spec prop changes externally               | Medium   | S      | SP-REL-10                      | `SpecPanel.tsx:13`                                        |
| SP-16 | TicketEditor `createAll` partial failure causes duplicate tickets on retry | Medium   | S      | SP-REL-13                      | `TicketEditor.tsx:88-106`                                 |
| SP-17 | TaskDetailDrawer resize listeners leak on unmount                          | Medium   | S      | SP-REL-14                      | `TaskDetailDrawer.tsx:96-121`                             |
| SP-18 | "Unblock" button force-launches bypassing dependencies                     | Medium   | S      | SP-UX-004                      | `TaskDetailDrawer.tsx:329-333`                            |
| SP-19 | `onMarkDone` unused -- no manual "Mark Done" button                        | Medium   | S      | SP-UX-005                      | `TaskDetailDrawer.tsx:263`                                |
| SP-20 | SpecPanel no save success/failure feedback                                 | Medium   | S      | SP-UX-006                      | `SpecPanel.tsx:15-17`                                     |
| SP-21 | "Add to queue" validation failure causes visual snap-back                  | Medium   | M      | SP-UX-010                      | `SprintPipeline.tsx:131-136`                              |
| SP-22 | HealthCheckDrawer "Rescue" does not clear `claimed_by`                     | Medium   | S      | SP-UX-024                      | `HealthCheckDrawer.tsx:27`                                |
| SP-23 | `sprint:healthCheck` per-row writes without transaction                    | Medium   | S      | SP-REL-4                       | `sprint-local.ts:191-207`                                 |

#### Low

| ID    | Title                                                                         | Severity | Effort | Sources                         | File(s)                                 |
| ----- | ----------------------------------------------------------------------------- | -------- | ------ | ------------------------------- | --------------------------------------- |
| SP-24 | `sprint:delete` has no status guard (active tasks deletable)                  | Low      | S      | SP-RED-7                        | `sprint-local.ts:156-163`               |
| SP-25 | `pr_url` rendered as clickable link without URL validation                    | Low      | S      | SP-RED-9                        | `TaskDetailDrawer.tsx:369-377`          |
| SP-26 | CircuitPipeline in sprint/ is dead code                                       | Low      | S      | SP-UX-002, SP-REL-18            | `CircuitPipeline.tsx`                   |
| SP-27 | DoneHistoryPanel items lack keyboard accessibility                            | Low      | S      | SP-UX-007                       | `DoneHistoryPanel.tsx:19-23`            |
| SP-28 | SpecPanel/DoneHistoryPanel no Escape key dismiss                              | Low      | S      | SP-UX-008, SP-UX-009            | `SpecPanel.tsx`, `DoneHistoryPanel.tsx` |
| SP-29 | Loading state shows only text, no spinner                                     | Low      | S      | SP-UX-012                       | `SprintPipeline.tsx:172-176`            |
| SP-30 | Failed notes truncated to 40 chars, no tooltip                                | Low      | S      | SP-UX-013                       | `PipelineBacklog.tsx:79`                |
| SP-31 | TicketEditor uses 30+ inline `tokens.*` styles                                | Low      | M      | SP-UX-014                       | `TicketEditor.tsx:288-430`              |
| SP-32 | "Re-run" creates duplicate task -- misleading label                           | Low      | S      | SP-UX-016                       | `useSprintTaskActions.ts:127-145`       |
| SP-33 | Duplicate `sanitizeDeps` in store weaker than shared version                  | Low      | S      | SP-REL-16                       | `sprintTasks.ts:23-32`                  |
| SP-34 | Duplicate `formatElapsed`/`getDotColor` functions                             | Low      | S      | SP-REL-19, SP-UX-022            | `TaskPill.tsx`, `TaskDetailDrawer.tsx`  |
| SP-35 | No tests for ConflictDrawer, HealthCheckDrawer, TicketEditor, CircuitPipeline | Low      | M      | SP-REL-20                       | `sprint/__tests__/`                     |
| SP-36 | Create handler uses raw path, update uses service-layer (inconsistent)        | Low      | S      | SP-REL-17                       | `sprint-local.ts:92-94`                 |
| SP-37 | Drawer resize handle has no ARIA/visual affordance                            | Low      | S      | SP-UX-011                       | `TaskDetailDrawer.tsx:129`              |
| SP-38 | ConflictDrawer stale branchInfo, missing deps, no retry                       | Low      | S      | SP-REL-12, SP-UX-017, SP-UX-023 | `ConflictDrawer.tsx`                    |

### IDE

#### Critical/High

| ID    | Title                                                       | Severity | Effort | Sources                | File(s)                      |
| ----- | ----------------------------------------------------------- | -------- | ------ | ---------------------- | ---------------------------- |
| IDE-1 | `fs:watchDir` accepts any path as IDE root -- no validation | High     | S      | IDE-RED-1, IDE-REL-005 | `ide-fs-handlers.ts:140-151` |

#### Medium

| ID     | Title                                                                       | Severity | Effort | Sources                            | File(s)                    |
| ------ | --------------------------------------------------------------------------- | -------- | ------ | ---------------------------------- | -------------------------- |
| IDE-2  | `validateIdePath` returns pre-symlink path (TOCTOU)                         | Medium   | S      | IDE-RED-2                          | `ide-fs-handlers.ts:47`    |
| IDE-3  | Fallback path for non-existent files skips symlink resolution               | Medium   | S      | IDE-RED-3                          | `ide-fs-handlers.ts:32-42` |
| IDE-4  | No filename sanitization in create/rename operations                        | Medium   | S      | IDE-RED-4                          | `FileSidebar.tsx:30-63`    |
| IDE-5  | `fileContents` in component state -- data loss on view switch + memory leak | Medium   | M      | IDE-REL-001, IDE-REL-003, IDE-UX-4 | `IDEView.tsx:103`          |
| IDE-6  | File watcher has no error handler -- crash on EMFILE/EACCES                 | Medium   | S      | IDE-REL-002                        | `ide-fs-handlers.ts:144`   |
| IDE-7  | Race condition between save and file-read on tab switch                     | Medium   | S      | IDE-REL-004                        | `IDEView.tsx:107-127`      |
| IDE-8  | File read error silently shows empty content                                | Medium   | S      | IDE-UX-1                           | `IDEView.tsx:113-114`      |
| IDE-9  | No loading indicator while file content is fetched                          | Medium   | S      | IDE-UX-2                           | `IDEView.tsx:107-115`      |
| IDE-10 | No `beforeunload` guard for unsaved changes                                 | Medium   | S      | IDE-UX-3                           | `IDEView.tsx`              |
| IDE-11 | Expanded dirs not persisted across restart                                  | Medium   | S      | IDE-UX-5                           | `ide.ts:216-233`           |
| IDE-12 | `Cmd+S` silently fails when terminal panel focused                          | Medium   | S      | IDE-UX-6                           | `IDEView.tsx:190-195`      |
| IDE-13 | FileTreeNode expanded subdirs never refresh on FS changes                   | Medium   | S      | IDE-REL-007, IDE-UX-13             | `FileTreeNode.tsx:53-69`   |
| IDE-14 | `setRootPath` leaves stale tabs from old root open                          | Medium   | S      | IDE-REL-011                        | `ide.ts:113-119`           |

#### Low

| ID     | Title                                                             | Severity | Effort | Sources                | File(s)                      |
| ------ | ----------------------------------------------------------------- | -------- | ------ | ---------------------- | ---------------------------- |
| IDE-15 | `readFileAsBase64`/`readFileAsText` not scoped to IDE root        | Low      | M      | IDE-RED-5              | `fs.ts:116-124`              |
| IDE-16 | Predictable temp file path / collision on rapid saves             | Low      | S      | IDE-RED-6, IDE-REL-009 | `ide-fs-handlers.ts:106`     |
| IDE-17 | No symlink integration test for SEC-2 fix                         | Low      | S      | IDE-RED-7, IDE-REL-014 | `ide-path-traversal.test.ts` |
| IDE-18 | Binary detection only checks null bytes                           | Low      | S      | IDE-REL-008            | `ide-fs-handlers.ts:92-98`   |
| IDE-19 | No test coverage for TerminalPanel                                | Low      | S      | IDE-REL-010            | `TerminalPanel.tsx`          |
| IDE-20 | Persistence subscriber fires on all state changes                 | Low      | S      | IDE-REL-012            | `ide.ts:216-233`             |
| IDE-21 | `fs:watchDir` returns undefined -- renderer can't detect failure  | Low      | S      | IDE-REL-013            | `ide-fs-handlers.ts:140-151` |
| IDE-22 | `readFileContent` reads full file before binary check             | Low      | S      | IDE-REL-015            | `ide-fs-handlers.ts:84-101`  |
| IDE-23 | FileTreeNode selector causes all nodes to re-render on tab switch | Low      | S      | IDE-REL-016            | `FileTreeNode.tsx:44-47`     |
| IDE-24 | Copy Path has no success feedback                                 | Low      | S      | IDE-UX-7               | `FileSidebar.tsx:80-82`      |
| IDE-25 | File tree nodes not keyboard-navigable                            | Low      | S      | IDE-UX-8               | `FileTreeNode.tsx:76-108`    |
| IDE-26 | Delete confirmation says "cannot be undone" but uses Trash        | Low      | S      | IDE-UX-9               | `FileSidebar.tsx:68-69`      |
| IDE-27 | Tab reorder action in store but not exposed in UI                 | Low      | S      | IDE-UX-10              | `ide.ts:89`                  |
| IDE-28 | `sidebarWidth`/`terminalHeight` dead state                        | Low      | S      | IDE-UX-11              | `ide.ts:78-79`               |
| IDE-29 | Context menu renders off-screen                                   | Low      | S      | IDE-UX-12              | `FileContextMenu.tsx:51`     |
| IDE-30 | Recent folder click fails silently if deleted                     | Low      | S      | IDE-UX-14              | `IDEEmptyState.tsx:12-15`    |
| IDE-31 | No external file change detection                                 | Low      | M      | IDE-UX-17              | `IDEView.tsx:110`            |
| IDE-32 | Same-named files show identical tab labels                        | Low      | S      | IDE-UX-18              | `ide.ts:61-64`               |
| IDE-33 | Context menu/tree nodes lack keyboard navigation                  | Low      | S      | IDE-UX-15              | `FileContextMenu.tsx:45-113` |
| IDE-34 | Persistence 2s debounce with no flush on close                    | Low      | S      | IDE-UX-16              | `ide.ts:229-232`             |

### PR Station

#### Critical/High

| ID   | Title                                                           | Severity | Effort | Sources                      | File(s)                 |
| ---- | --------------------------------------------------------------- | -------- | ------ | ---------------------------- | ----------------------- |
| PR-1 | Merge button has no confirmation dialog                         | High     | S      | PR-RED-5, PR-REL-05, PR-UX-1 | `MergeButton.tsx:51-65` |
| PR-2 | Close button has no confirmation dialog                         | High     | S      | PR-RED-5, PR-REL-05, PR-UX-2 | `CloseButton.tsx:20-33` |
| PR-3 | Allowlist regex permits overly broad GET reads on any repo      | High     | S      | PR-RED-1                     | `git-handlers.ts:32-36` |
| PR-4 | PATCH allowlist permits arbitrary PR field mutation on any repo | High     | S      | PR-RED-2                     | `git-handlers.ts:40`    |

#### Medium

| ID    | Title                                                       | Severity | Effort | Sources            | File(s)                                  |
| ----- | ----------------------------------------------------------- | -------- | ------ | ------------------ | ---------------------------------------- |
| PR-5  | DOMPurify default config allows style tags, tracking pixels | Medium   | S      | PR-RED-4           | `render-markdown.ts:20`                  |
| PR-6  | CSS injection via unvalidated PR label colors               | Medium   | S      | PR-RED-3, PR-UX-13 | `PRStationDetail.tsx:201`                |
| PR-7  | Virtualized diff silently disables commenting, no indicator | Medium   | M      | PR-REL-06, PR-UX-3 | `DiffViewer.tsx:444`                     |
| PR-8  | Pending review comments lost on 500ms debounce window       | Medium   | S      | PR-REL-04, PR-UX-5 | `pendingReview.ts:76-88`                 |
| PR-9  | `getPrMergeability` abort signal unused -- stale data risk  | Medium   | S      | PR-REL-02, PR-UX-4 | `github-api.ts:61-76`                    |
| PR-10 | Cache invalidation doesn't trigger detail refetch           | Medium   | M      | PR-REL-03          | `github-cache.ts`, `PRStationDetail.tsx` |
| PR-11 | Review submission causes full unmount/remount flash         | Medium   | M      | PR-UX-6            | `PRStationView.tsx:207-212`              |
| PR-12 | PR detail error state has no retry button                   | Medium   | S      | PR-UX-7            | `PRStationDetail.tsx:166-173`            |
| PR-13 | Race between repo settings load and initial API calls       | Medium   | S      | PR-REL-01          | `useRepoOptions.ts:24-42`                |
| PR-14 | Pending review localStorage restore lacks field validation  | Medium   | S      | PR-RED-6           | `pendingReview.ts:62-73`                 |
| PR-15 | `repoOptions` ref instability causes double API calls       | Medium   | S      | PR-REL-09          | `PRStationDetail.tsx:81-145`             |

#### Low

| ID    | Title                                                           | Severity | Effort | Sources             | File(s)                         |
| ----- | --------------------------------------------------------------- | -------- | ------ | ------------------- | ------------------------------- |
| PR-16 | GitHub error messages leaked verbatim                           | Low      | S      | PR-RED-7            | `github-api.ts:195-197`         |
| PR-17 | Check run `html_url` not validated as GitHub URL                | Low      | S      | PR-RED-8            | `PRStationChecks.tsx:56-64`     |
| PR-18 | `invalidatePRCache` uses `includes()` causing over-invalidation | Low      | S      | PR-RED-9            | `github-cache.ts:73-81`         |
| PR-19 | `fetchAllPages` has no pagination depth limit                   | Low      | S      | PR-REL-07           | `github-api.ts:13-28`           |
| PR-20 | PR poller has no error backoff, console-only logging            | Low      | S      | PR-REL-08           | `pr-poller.ts:96-103`           |
| PR-21 | Keyboard handler fires in contentEditable                       | Low      | S      | PR-REL-11           | `DiffViewer.tsx:607-653`        |
| PR-22 | Filter state not persisted across view switches                 | Low      | S      | PR-UX-8             | `PRStationView.tsx:29`          |
| PR-23 | Conflict banner swallows fetch errors silently                  | Low      | S      | PR-UX-11, PR-REL-17 | `PRStationConflictBanner.tsx`   |
| PR-24 | Diff comment selection only works on RIGHT side                 | Low      | M      | PR-UX-14            | `DiffViewer.tsx:317-330`        |
| PR-25 | No reply-to-comment UI despite API support                      | Low      | M      | PR-UX-15            | `DiffCommentWidget.tsx`         |
| PR-26 | No CloseButton test coverage                                    | Low      | S      | PR-REL-13           | `CloseButton.tsx`               |
| PR-27 | `PRStationDiff` uses uncached `getReviewComments`               | Low      | S      | PR-REL-18           | `PRStationDiff.tsx`             |
| PR-28 | Review submit dialog has no focus trap                          | Low      | S      | PR-UX-19            | `ReviewSubmitDialog.tsx:70-118` |
| PR-29 | PR poller swallows per-repo fetch errors silently               | Low      | S      | PR-REL-16           | `pr-poller.ts:19-28`            |
| PR-30 | Diff size warning doesn't mention commenting impact             | Low      | S      | PR-UX-10            | `DiffSizeWarning.tsx:19-28`     |

### Data Layer

#### Critical/High

| ID   | Title                                                                        | Severity | Effort | Sources           | File(s)                     |
| ---- | ---------------------------------------------------------------------------- | -------- | ------ | ----------------- | --------------------------- |
| DL-1 | Migration v9 disables `foreign_keys` without guaranteed re-enable on failure | High     | S      | DL-REL-1          | `db.ts:205-259`             |
| DL-2 | `updateTask` read + audit + write not in single transaction                  | High     | S      | DL-REL-2          | `sprint-queries.ts:180-233` |
| DL-3 | `markTaskDone/Cancelled` bypass audit trail entirely                         | High     | S      | DL-REL-3, DL-UX-3 | `sprint-queries.ts:351-415` |
| DL-4 | `backupDatabase` regex allows path traversal sequences                       | High     | S      | DL-RED-3          | `db.ts:32`                  |
| DL-5 | `pr_status` CHECK constraint missing `branch_only` -- schema/type mismatch   | High     | S      | DL-UX-1           | `db.ts:389`, `types.ts:46`  |

#### Medium

| ID    | Title                                                           | Severity | Effort | Sources                        | File(s)                                   |
| ----- | --------------------------------------------------------------- | -------- | ------ | ------------------------------ | ----------------------------------------- |
| DL-6  | Supabase credentials stored in plaintext after import           | Medium   | S      | DL-RED-4                       | `supabase-import.ts:64-65`                |
| DL-7  | OAuth token file has no permission enforcement                  | Medium   | S      | DL-RED-5                       | `env-utils.ts:36-38`                      |
| DL-8  | Migrations run in single transaction -- no individual isolation | Medium   | M      | DL-RED-7                       | `db.ts:440-446`                           |
| DL-9  | `getSettingJson` unsafe generic deserialization                 | Medium   | M      | DL-RED-8                       | `settings-queries.ts:26-34`               |
| DL-10 | Supabase import TOCTOU race on "table is empty" check           | Medium   | S      | DL-REL-4                       | `supabase-import.ts:54-61`                |
| DL-11 | `backupDatabase` silently swallows VACUUM INTO failures         | Medium   | S      | DL-REL-5, DL-UX-4              | `db.ts:36-40`                             |
| DL-12 | No WAL checkpoint on shutdown                                   | Medium   | S      | DL-REL-6, DL-REL-7             | `db.ts:22-25`                             |
| DL-13 | `claimTask`/`releaseTask` skip audit trail                      | Medium   | S      | DL-REL-8, DL-REL-9             | `sprint-queries.ts:269-302`               |
| DL-14 | `deleteTask` leaves orphaned audit records, no deletion audit   | Medium   | S      | DL-REL-10                      | `sprint-queries.ts:235-241`               |
| DL-15 | Supabase import silently drops rows with invalid status         | Medium   | S      | DL-REL-11, DL-UX-10, DL-RED-12 | `supabase-import.ts:128`                  |
| DL-16 | `ensureSubscriptionAuth` env var cleanup is bypassable          | Medium   | S      | DL-RED-6                       | `auth-guard.ts:101-102`                   |
| DL-17 | Inconsistent error patterns across sprint-queries               | Medium   | M      | DL-UX-2                        | `sprint-queries.ts`                       |
| DL-18 | Incompatible DI patterns across query modules                   | Medium   | M      | DL-UX-7                        | `agent-queries.ts` vs `sprint-queries.ts` |
| DL-19 | `runMigrations` no error context on individual failure          | Medium   | S      | DL-UX-9                        | `db.ts:440-447`                           |
| DL-20 | `recordTaskChanges` not transactional for multi-field patches   | Medium   | S      | DL-REL-12                      | `task-changes.ts:18-41`                   |

#### Low

| ID    | Title                                                                    | Severity | Effort | Sources            | File(s)                          |
| ----- | ------------------------------------------------------------------------ | -------- | ------ | ------------------ | -------------------------------- |
| DL-21 | `migration.version` interpolated into pragma without validation          | Low      | S      | DL-RED-10          | `db.ts:443`                      |
| DL-22 | `AuthGuard` Keychain read not rate-limited                               | Low      | S      | DL-RED-13          | `auth-guard.ts:43-48`            |
| DL-23 | Database file permissions not explicitly set                             | Low      | S      | DL-RED-14          | `db.ts:9-10`                     |
| DL-24 | VACUUM INTO backup has no integrity verification                         | Low      | S      | DL-RED-15          | `db.ts:37`                       |
| DL-25 | `getSettingJson` swallows parse errors silently                          | Low      | S      | DL-REL-19, DL-UX-5 | `settings-queries.ts:30-33`      |
| DL-26 | `cost_events` table created but never used                               | Low      | S      | DL-REL-21          | `db.ts:118-130`                  |
| DL-27 | `pruneEventsByAgentIds` vulnerable to large IN clause                    | Low      | S      | DL-REL-16          | `event-queries.ts:121-126`       |
| DL-28 | Supabase import counter overcounts on IGNORE                             | Low      | S      | DL-REL-17          | `supabase-import.ts:156-157`     |
| DL-29 | Missing compound index on `task_changes`                                 | Low      | S      | DL-REL-18          | `db.ts:367-368`                  |
| DL-30 | `changedBy` always `'unknown'` in audit trail                            | Low      | S      | DL-UX-12           | `task-changes.ts:23`             |
| DL-31 | `ISprintTaskRepository` covers only 7 of 20 query functions              | Low      | M      | DL-UX-13           | `sprint-task-repository.ts:9-17` |
| DL-32 | `deleteTask` returns void -- caller can't confirm deletion               | Low      | S      | DL-UX-14           | `sprint-queries.ts:235-241`      |
| DL-33 | `updateAgentMeta` returns raw row (snake_case) while peers return mapped | Low      | S      | DL-UX-15           | `agent-queries.ts:120-143`       |
| DL-34 | `cost-queries` hardcodes `NULL AS pr_url` -- vestigial                   | Low      | S      | DL-UX-16           | `cost-queries.ts:83,170`         |
| DL-35 | Hybrid DI with awkward positional `db?` as 5th parameter                 | Low      | S      | DL-UX-17           | `task-changes.ts:24-25`          |

---

## Remediation Task Map

One row = one sprint task. Findings within each bucket are ordered by impact.

| Task Name                      | Feature         | Severity Bucket | Finding IDs                              | Finding Count | Est. Effort | Depends On                     |
| ------------------------------ | --------------- | --------------- | ---------------------------------------- | ------------- | ----------- | ------------------------------ |
| audit-agent-manager-critical   | Agent Manager   | Critical/High   | AM-1, AM-2, AM-3, AM-4, AM-5, AM-6       | 6             | L           | none                           |
| audit-agent-manager-medium     | Agent Manager   | Medium          | AM-7 thru AM-28                          | 22            | L           | audit-agent-manager-critical   |
| audit-agent-manager-low        | Agent Manager   | Low             | AM-29 thru AM-40                         | 12            | M           | audit-agent-manager-medium     |
| audit-queue-api-critical       | Queue API       | Critical/High   | QA-1, QA-2                               | 2             | M           | none                           |
| audit-queue-api-medium         | Queue API       | Medium          | QA-3 thru QA-17                          | 15            | L           | audit-queue-api-critical       |
| audit-queue-api-low            | Queue API       | Low             | QA-18 thru QA-32                         | 15            | M           | audit-queue-api-medium         |
| audit-sprint-pipeline-critical | Sprint Pipeline | Critical/High   | SP-1, SP-2, SP-3, SP-4, SP-5, SP-6, SP-7 | 7             | M           | none                           |
| audit-sprint-pipeline-medium   | Sprint Pipeline | Medium          | SP-8 thru SP-23                          | 16            | L           | audit-sprint-pipeline-critical |
| audit-sprint-pipeline-low      | Sprint Pipeline | Low             | SP-24 thru SP-38                         | 15            | M           | audit-sprint-pipeline-medium   |
| audit-ide-critical             | IDE             | Critical/High   | IDE-1                                    | 1             | S           | none                           |
| audit-ide-medium               | IDE             | Medium          | IDE-2 thru IDE-14                        | 13            | L           | audit-ide-critical             |
| audit-ide-low                  | IDE             | Low             | IDE-15 thru IDE-34                       | 20            | M           | audit-ide-medium               |
| audit-pr-station-critical      | PR Station      | Critical/High   | PR-1, PR-2, PR-3, PR-4                   | 4             | S           | none                           |
| audit-pr-station-medium        | PR Station      | Medium          | PR-5 thru PR-15                          | 11            | L           | audit-pr-station-critical      |
| audit-pr-station-low           | PR Station      | Low             | PR-16 thru PR-30                         | 15            | M           | audit-pr-station-medium        |
| audit-data-layer-critical      | Data Layer      | Critical/High   | DL-1, DL-2, DL-3, DL-4, DL-5             | 5             | M           | none                           |
| audit-data-layer-medium        | Data Layer      | Medium          | DL-6 thru DL-20                          | 15            | L           | audit-data-layer-critical      |
| audit-data-layer-low           | Data Layer      | Low             | DL-21 thru DL-35                         | 15            | M           | audit-data-layer-medium        |
