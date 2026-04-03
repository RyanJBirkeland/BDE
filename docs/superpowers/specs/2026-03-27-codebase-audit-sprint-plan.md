# BDE Codebase Audit — Phased Sprint Plan

**Date:** 2026-03-27
**Source:** Full codebase audit by 5 expert perspectives (Principal Eng, Senior Dev, Architecture Eng, Product Design, System Designer)
**Total findings:** 97 (25 Critical/High, 35 Medium, 37 Low)
**Planned sprints:** 6 (~10 days total)
**Backlog:** 38 low-severity items not sprinted

---

## Sprint 1: Core Safety

**Goal:** Fix broken workflows, security holes, and crash vectors
**Estimated effort:** 1-2 days
**Findings addressed:** 12

### 1A. Dependency Resolution Unification

The single most impactful bug cluster. Three code paths change task status to terminal, but only the agent manager's path triggers `resolveDependents`. Tasks completed via UI or PR merge silently leave dependents permanently blocked.

**Approach:** Extract a single `onStatusTerminal(taskId, status)` service function, called from all paths.

| #   | Finding                                                                            | File(s)                                                            | Severity |
| --- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------ | -------- |
| 1   | IPC `sprint:update` doesn't trigger `resolveDependents` on terminal status         | `src/main/handlers/sprint-local.ts`                                | High     |
| 2   | Sprint PR poller bypasses dependency resolution — direct SQLite writes             | `src/main/handlers/git-handlers.ts:99-113`                         | High     |
| 3   | Sprint PR poller `onTaskTerminal` callback never wired (null)                      | `src/main/index.ts:104-105`, `src/main/sprint-pr-poller.ts:86-107` | High     |
| 4   | `resolveSuccess` doesn't call `onTaskTerminal` on push failure — task stuck active | `src/main/agent-manager/completion.ts:283-296`                     | High     |
| 5   | Queue API creates fresh DependencyIndex per call (wasteful, inconsistent)          | `src/main/queue-api/task-handlers.ts:402-415`                      | Medium   |

### 1B. Agent Kill Bug

| #   | Finding                                                                                                                            | File(s)                                                                                        | Severity |
| --- | ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | -------- |
| 6   | `handleStop` uses `agent_run_id` with `killAgent` but AgentManager indexes by `taskId` — pipeline agents cannot be stopped from UI | `src/renderer/src/hooks/useSprintTaskActions.ts:112`, `src/main/handlers/agent-handlers.ts:68` | High     |

### 1C. Security Fixes

| #   | Finding                                                         | File(s)                               | Severity |
| --- | --------------------------------------------------------------- | ------------------------------------- | -------- |
| 7   | OAuth token file written with 0644 permissions (world-readable) | `src/main/env-utils.ts:83`            | High     |
| 8   | Queue API defaults to open when no API key configured           | `src/main/queue-api/helpers.ts:16-19` | High     |
| 9   | CORS headers only on OPTIONS preflight, not actual responses    | `src/main/queue-api/router.ts:19-27`  | High     |

### 1D. Crash Prevention

| #   | Finding                                                                         | File(s)                                                          | Severity |
| --- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------- | -------- |
| 10  | Unhandled promise rejections in both pollers (`poll()` without `.catch()`)      | `src/main/sprint-pr-poller.ts:63`, `src/main/pr-poller.ts:97-98` | High     |
| 11  | No port conflict handling for Queue API (`EADDRINUSE` crashes silently)         | `src/main/queue-api/server.ts`                                   | Medium   |
| 12  | `gitStatus` result accessed without checking `.ok` — Source Control shows empty | `src/renderer/src/stores/gitTree.ts:65`                          | Low      |

---

## Sprint 2: Data Integrity & Operations

**Goal:** Protect data, improve CI gates, harden concurrency
**Estimated effort:** 2 days
**Findings addressed:** 10

| #   | Finding                                                               | File(s)                                       | Severity |
| --- | --------------------------------------------------------------------- | --------------------------------------------- | -------- |
| 13  | No database backup mechanism — single corruption = all data lost      | `src/main/db.ts`                              | High     |
| 14  | Log rotation destroys all history (truncates to 0, no archival)       | `src/main/logger.ts:22-31`                    | High     |
| 15  | Agent manager log has no rotation at all — grows unbounded            | `src/main/agent-manager/index.ts:37-42`       | Medium   |
| 16  | Main process tests (`test:main`) not in CI — only local pre-push hook | `.github/workflows/ci.yml`                    | High     |
| 17  | CI does not run `npm run lint`                                        | `.github/workflows/ci.yml`                    | Medium   |
| 18  | `build:mac` skips TypeScript type checking                            | `package.json`                                | Medium   |
| 19  | Shutdown doesn't re-queue active tasks — relies on orphan recovery    | `src/main/agent-manager/index.ts:527-571`     | High     |
| 20  | WIP limit TOCTOU race — concurrent claims can exceed MAX_ACTIVE_TASKS | `src/main/queue-api/task-handlers.ts:442-452` | Critical |
| 21  | Worktree lock uses PID file without atomic CAS (`O_EXCL`)             | `src/main/agent-manager/worktree.ts:41-68`    | Medium   |
| 22  | `agent_events` table grows unbounded between restarts                 | `src/main/db.ts`                              | Medium   |

---

## Sprint 3: UX Feedback Loops

**Goal:** Users should always know what happened — loading, success, failure
**Estimated effort:** 1.5 days
**Findings addressed:** 10

| #   | Finding                                                                  | File(s)                                                                | Severity |
| --- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------- | -------- |
| 23  | IDE file save clears dirty flag even on write failure — silent data loss | `src/renderer/src/views/IDEView.tsx:116-122`                           | High     |
| 24  | Dashboard has no loading state — shows zeros while fetching              | `src/renderer/src/views/DashboardView.tsx`                             | Medium   |
| 25  | Dashboard silently swallows all fetch errors                             | `src/renderer/src/views/DashboardView.tsx`                             | Medium   |
| 26  | Source Control commit/push has no success/error feedback                 | `src/renderer/src/views/GitTreeView.tsx`                               | Medium   |
| 27  | WorkbenchForm has no success toast on task creation                      | `src/renderer/src/components/task-workbench/WorkbenchForm.tsx`         | Medium   |
| 28  | WorkbenchForm `handleGenerate` has no catch block                        | `src/renderer/src/components/task-workbench/WorkbenchForm.tsx:259-271` | Medium   |
| 29  | No confirmation dialog before "Kill All" agents                          | `src/renderer/src/components/CommandPalette.tsx`                       | Medium   |
| 30  | No confirmation dialog before repository removal                         | `src/renderer/src/components/settings/RepositoriesSection.tsx`         | Medium   |
| 31  | Agent events store grows unboundedly — no max size, no eviction          | `src/renderer/src/stores/agentEvents.ts:14-22`                         | High     |
| 32  | Branch checkout error is unhandled                                       | `src/renderer/src/views/GitTreeView.tsx:75`                            | Medium   |

---

## Sprint 4: Finish What's Started

**Goal:** Wire up features that were built but never connected
**Estimated effort:** 1 day
**Findings addressed:** 8

| #   | Finding                                                                        | File(s)                                                       | Severity |
| --- | ------------------------------------------------------------------------------ | ------------------------------------------------------------- | -------- |
| 33  | PlaygroundCard click handler is TODO stub — PlaygroundModal exists but unwired | `src/renderer/src/components/agents/ChatRenderer.tsx:138`     | Medium   |
| 34  | NotificationBell viewLink navigation is TODO                                   | `src/renderer/src/components/layout/NotificationBell.tsx:66`  | Medium   |
| 35  | LiveActivityStrip "Spawn Agent" button is a console.log                        | `src/renderer/src/components/agents/LiveActivityStrip.tsx:73` | Low      |
| 36  | "Template saving coming soon" placeholder shown to users                       | `src/renderer/src/components/agents/AgentLaunchpad.tsx:134`   | Low      |
| 37  | Task Pipeline has no zero-state guidance                                       | `src/renderer/src/components/sprint/SprintPipeline.tsx`       | Low      |
| 38  | Optimistic update field tracking doesn't accumulate across rapid updates       | `src/renderer/src/stores/sprintTasks.ts:126-130`              | Medium   |
| 39  | `buildAgentEnv()` cache returns mutable reference                              | `src/main/env-utils.ts:17-24`                                 | Medium   |
| 40  | `console` used as logger in sprint-local.ts (invisible in bde.log)             | `src/main/handlers/sprint-local.ts:128,183`                   | Low      |

---

## Sprint 5: Architecture

**Goal:** Reduce coupling, eliminate duplication, improve testability
**Estimated effort:** 2 days
**Findings addressed:** 10

| #   | Finding                                                                             | File(s)                                                                        | Severity |
| --- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | -------- |
| 41  | Repository pattern leak — `dependency-helpers.ts` imports `sprint-queries` directly | `src/main/agent-manager/dependency-helpers.ts:7`                               | High     |
| 42  | Duplicated validation logic between Queue API and IPC handler (create task)         | `src/main/queue-api/task-handlers.ts`, `src/main/handlers/sprint-local.ts`     | Medium   |
| 43  | `sprint-local.ts` is dual-purpose (handler + service re-exports)                    | `src/main/handlers/sprint-local.ts`                                            | Medium   |
| 44  | `agent-manager:status` handler uses `as any` to bridge type mismatch                | `src/main/handlers/agent-manager-handlers.ts:12`                               | Medium   |
| 45  | Duplicate `Logger` and `AgentHandle` interface definitions                          | `src/main/logger.ts`, `src/main/agent-manager/types.ts`, `src/shared/types.ts` | Medium   |
| 46  | Two notification hooks with overlapping responsibility + separate dedup             | `useDesktopNotifications.ts`, `useTaskNotifications.ts`                        | Low      |
| 47  | Remove unused `@supabase/supabase-js` dependency                                    | `package.json`                                                                 | Low      |
| 48  | No unit tests for `ide-fs-handlers.ts` (11 security-sensitive IPC channels)         | `src/main/handlers/ide-fs-handlers.ts`                                         | High     |
| 49  | No tests for `useUnifiedAgents` hook (agent grouping logic)                         | `src/renderer/src/hooks/useUnifiedAgents.ts`                                   | Medium   |
| 50  | No tests for `sprint-listeners.ts` (mutation event bus)                             | `src/main/handlers/sprint-listeners.ts`                                        | Medium   |

---

## Sprint 6: Accessibility & Polish

**Goal:** ARIA compliance, keyboard navigation, visual consistency
**Estimated effort:** 1.5 days
**Findings addressed:** 9

| #   | Finding                                                                        | File(s)                                                                        | Severity |
| --- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ | -------- |
| 51  | PipelineBacklog cards — div with onClick, no keyboard access                   | `src/renderer/src/components/sprint/PipelineBacklog.tsx`                       | Medium   |
| 52  | PR Station tabs lack ARIA `role="tab"` / `aria-selected`                       | `src/renderer/src/views/PRStationView.tsx:151-163`                             | Medium   |
| 53  | Agent search, CommandBar inputs lack `aria-label`                              | `AgentList.tsx`, `CommandBar.tsx`                                              | Medium   |
| 54  | Color swatch buttons in Settings have no accessible label                      | `AppearanceSection.tsx`, `RepositoriesSection.tsx`                             | Medium   |
| 55  | Keyboard shortcut map only goes to 7 — docs say 9                              | `src/renderer/src/App.tsx:28-36`                                               | Medium   |
| 56  | Memory/Cost views missing from sidebar nav                                     | `NeonSidebar.tsx`                                                              | Medium   |
| 57  | Replace hardcoded `rgba()` with CSS custom properties (light theme)            | Multiple files (Dashboard, Agents, AgentList, LiveActivityStrip, AgentConsole) | Medium   |
| 58  | Inconsistent task action terminology — "Add to Queue" vs "Launch" vs "Unblock" | `TaskDetailDrawer.tsx`, `PipelineBacklog.tsx`                                  | Low      |
| 59  | Task Workbench uses GitBranch icon — confusing with Source Control             | `NeonSidebar.tsx:29`                                                           | Low      |

---

## Backlog (Low Priority — Not Sprinted)

These 38 findings are real but low-impact. Address opportunistically or in a future audit cycle.

- IDE persistence subscriber fires on every state change (should use `subscribeWithSelector`)
- PaneStatusBar CWD display hardcoded to `~`
- Within-column reorder is optimistic-only (no persistence)
- Redundant `sanitizeDeps` in renderer store
- Token TTL comment mismatch (5min actual vs 30min in docs)
- `pendingReview` localStorage writes without debounce
- `adhoc-agent` generator creates permanently pending promise (small leak per session)
- Mixed styling approaches between views (inline tokens vs CSS classes)
- Duplicate `matchRoute` calls in router
- `generatePrompt` returns empty spec (dead code path)
- `checkSpecSemantic` imported eagerly in Queue API (should be dynamic)
- `handleReorder` accesses store directly inside callback
- Log rotation only checked at logger creation time
- Swallowed errors in worktree.ts, orphan-recovery.ts, completion.ts catch blocks
- Missing tests for `useGitHubRateLimitWarning`, `useSidebarResize` hooks
- Queue API missing `DELETE` in CORS methods
- Sprint PR poller calls `onTaskTerminal` synchronously in loop
- Concurrent drain/watchdog loop conflict on same task
- No prepared statement caching in sprint-queries
- Redundant `buildAgentEnv()` calls in completion.ts
- `synchronous = NORMAL` pragma evaluation
- DB watcher misses files on fresh install
- Pollers start before window creation (wasted first poll)
- `sandbox: false` migration (large — separate initiative)
- Agent manager god module decomposition (large — separate initiative)
- Zustand store consolidation (23 stores, CustomEvent anti-pattern)
- Unsigned binary distribution / code signing
- No auto-update mechanism
- macOS ARM64 only (no Intel/universal)
- Version stuck at 0.1.0
- `task_changes` audit table has no FK constraint
- Migration v9/v10 table rebuild without pre-migration backup
- `agent:bypassPermissions` on spawned agents (accepted risk)
- CORS allows all origins on localhost Queue API
- UnifiedHeader logo click undiscoverable (no tooltip)
- `queue-api/task-handlers.ts` fires `resolveDependents` after sending 200 response

---

## Cross-Cutting Patterns

Two systemic patterns emerged across all 5 audits:

1. **Dependency resolution fragmentation** — The core workflow bug. Three paths modify task status, only one resolves dependents. Sprint 1 fixes this with a unified `onStatusTerminal()` service.

2. **Async operations without error feedback** — Save, commit, push, generate, and poll all swallow errors. Users get no indication that something failed. Sprint 3 addresses this systematically.

---

## Audit Sources

| Auditor               | Findings | Focus                                                                 |
| --------------------- | -------- | --------------------------------------------------------------------- |
| Principal Engineer    | 28       | Code quality, error handling, performance, concurrency, security      |
| Senior Developer      | 21       | Incomplete features, missing tests, API contracts, data flow          |
| Architecture Engineer | 11       | Module boundaries, dependency graph, scalability, pattern consistency |
| Product Designer      | 15       | Loading/error/empty states, accessibility, UX consistency             |
| System Designer       | 22       | Build/CI, config management, observability, data integrity, lifecycle |

Deduplicated total: 59 sprinted + 38 backlogged = 97 raw findings → 59 unique actionable items after dedup.
