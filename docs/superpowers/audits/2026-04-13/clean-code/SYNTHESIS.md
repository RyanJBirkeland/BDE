# BDE Clean Code Audit — Synthesis & Ranked Action Roadmap

**Date:** 2026-04-13  
**Lenses:** 10 (god-functions, nesting, naming, fat-files, cohesion, duplication, layers, ipc-handlers, store-design, error-patterns)  
**Scoring formula:** `(Severity × Confidence) / Effort`  
- Severity: Critical=4, High=3, Medium=2, Low=1  
- Confidence: High=3, Medium=2, Low=1  
- Effort: S=1, M=2, L=4  
- Ties broken by: Severity first, then Effort (smaller wins)

---

## 1. Top 10 Ranked Actions

> When two lenses identified the same underlying issue, they are merged into one entry; both finding IDs are cited and the score is computed from the combined evidence (highest severity/confidence across lenses, shared effort).

| Rank | Finding ID(s) | Title | Score | Sev | Conf | Effort | Source Lens(es) |
|------|--------------|-------|-------|-----|------|--------|----------------|
| 1 | F-t1-naming-3 | Magic timing constants in agent-manager | 9.0 | H | H | S | lens-naming |
| 2 | F-t1-naming-8 | Magic strings in `classifyFailureReason` | 9.0 | H | H | S | lens-naming |
| 3 | F-t4-storeDesign-2 | `activeTaskCount` stored instead of computed | 9.0 | H | H | S | lens-storeDesign |
| 4 | F-t1-godFunc-6 | `onTaskTerminal` mixes metrics + deps + timer | 6.0 | M | H | S | lens-godFunc |
| 5 | F-t1-godFunc-7 + F-t1-nesting-2 | `poll()` duplicated terminal-notify blocks | 6.0 | M | H | S | lens-godFunc, lens-nesting |
| 6 | F-t2-duplication-1 | `sleep()` / `execFileAsync` reimplemented 25+ files | 6.0 | M | H | S | lens-duplication |
| 7 | F-t2-duplication-7 | `TERMINAL_STATUSES` check defined in 3+ service files | 6.0 | M | H | S | lens-duplication |
| 8 | F-t4-errorPatterns-7 | Worktree cleanup errors silently swallowed | 6.0 | M | H | S | lens-errorPatterns |
| 9 | F-t3-ipcHandlers-4 | `workbench:researchRepo` grep parsing inline in handler | 6.0 | M | H | S | lens-ipcHandlers |
| 10 | F-t4-storeDesign-5 | `latestEvents` stored as redundant derived state | 6.0 | M | H | S | lens-storeDesign |

---

### Rank 1 — F-t1-naming-3: Magic Timing Constants in Agent-Manager

Raw numeric literals (`30_000`, `60_000`, `300_000`, `3_600_000`) appear across multiple agent-manager files with no names to distinguish watchdog intervals from retry delays from OAuth cooldowns. When a timeout needs changing you must grep for the raw value and hope to find all occurrences, and different files using the same literal independently are already drifting. Create `src/main/agent-manager/constants.ts` exporting `WATCHDOG_POLL_INTERVAL_MS`, `OAUTH_REFRESH_COOLDOWN_MS`, `MAX_AGENT_RUNTIME_MS`, etc., and replace every raw literal with an import. This is the fastest way to make the intent of every timeout legible at a glance.

### Rank 2 — F-t1-naming-8: Magic Strings in `classifyFailureReason`

Multiple `lowerNotes.includes('some hardcoded string')` checks classify agent failures against invisible string literals. When the SDK or git upgrades changes an error message, the classification silently breaks with no compiler guard and no central registry to audit. Extract all patterns to a named lookup table — `FAILURE_PATTERNS: Array<{ type: FailureReason; keywords: string[] }>` — and reduce the function body to a single `.find()` call (see F-t1-nesting-6 for the identical data-driven refactor). The two changes together take under an hour and eliminate the entire silent-break risk.

### Rank 3 — F-t4-storeDesign-2: `activeTaskCount` Stored Instead of Computed

`activeTaskCount` is a derived number always equal to `tasks.filter(t => t.status === 'active').length`, but it is stored as first-class state and recalculated in at least four separate `set()` calls. If any mutation path misses the update, the Dashboard and WIP-limit logic silently show stale data. Remove the field from the state interface and replace every consumer with a Zustand selector (`useSprintTasks(s => s.tasks.filter(...).length)`); Zustand memoizes selectors so there is no re-render cost. This eliminates a whole class of consistency bugs for a single afternoon of work.

### Rank 4 — F-t1-godFunc-6: `onTaskTerminal` Mixes Metrics + Dependency Resolution + Cleanup Timer

The `onTaskTerminal` method in `AgentManager` combines an idempotency guard, a metrics increment, a conditional callback or inline dependency resolution (with an 11-argument `resolveDependents` call), and a 5-second cleanup timer in a single 55-line function. Any change to one of these concerns requires reading all the others. Extract `recordTerminalMetrics()`, `resolveDependent()`, and `scheduleTerminalCleanup()` as named helpers — the method body shrinks to five readable lines, and each helper can be tested in isolation.

### Rank 5 — F-t1-godFunc-7 + F-t1-nesting-2: `poll()` Duplicated Terminal-Notify Blocks

The `merged` and `CLOSED` branches of `sprint-pr-poller.ts`'s poll loop contain byte-for-byte identical logic: `ids.map → Promise.allSettled → filter rejected → log.warn`. Both lenses flagged this independently. Extract `notifyTaskTerminalBatch(ids, status, onTaskTerminal, log)` — the two branches collapse to two-line calls. Any future fix to the Promise.allSettled error handling (e.g., adding retry counts; see F-t4-errorPatterns-6) will only need to be made once.

### Rank 6 — F-t2-duplication-1: `sleep()` / `execFileAsync` Reimplemented in 25+ Files

Both `sleep(ms)` and `promisify(execFile)` are independently implemented in every file that needs them, with no central export. Changing all sleep calls to add logging for debugging requires 25+ individual edits. Create `src/main/lib/async-utils.ts` exporting these two utilities and update all import sites. Because this is pure mechanical replacement with no behavior change, it can be done safely with a one-time search-and-replace pass and confirmed by TypeScript compilation.

### Rank 7 — F-t2-duplication-7: `TERMINAL_STATUSES` Membership Check Defined in 3+ Files

The `TERMINAL_STATUSES` set (or equivalent boolean check) is independently defined in `task-terminal-service.ts`, `dependency-service.ts`, and `sprint-queries.ts`. When a new terminal status is added, at least one of these is likely to be missed, causing inconsistent terminal detection across the app. The canonical home already exists: `src/shared/task-transitions.ts`. Audit all local redefinitions, delete them, and import from the shared source. The TypeScript compiler will then enforce the single source of truth.

### Rank 8 — F-t4-errorPatterns-7: Worktree Cleanup Errors Silently Swallowed

`cleanupStaleWorktrees` contains three nested `catch {}` blocks — including a bare `/* best effort */` — that produce zero log output when cleanup fails. Stale worktrees accumulate silently, consuming disk, with no metric or warning in `~/.bde/bde.log`. At minimum add `logger.warn('[worktree] cleanup failed', { path, err })` inside every catch. For better observability, return a `{ cleaned: number; failed: Array<{ path; reason }> }` result and log a post-cleanup summary. This is one of the highest-confidence fixes in the audit: it adds visibility without changing any behavior.

### Rank 9 — F-t3-ipcHandlers-4: `workbench:researchRepo` Grep Parsing Inline in Handler

The `workbench:researchRepo` IPC handler contains a regex for parsing grep output, a `Map<string, string[]>` accumulator, result truncation logic, and a special-case for `exit code 1` (grep found no matches), all inline. This is domain logic for a "search repository" operation, not transport/serialization. Extract a `searchRepo(repoPath, query)` service function and a pure `parseGrepOutput(stdout)` helper — the handler shrinks to a three-line thin adapter. The service function becomes independently testable without spawning a subprocess or an IPC context.

### Rank 10 — F-t4-storeDesign-5: `latestEvents` Stored as Redundant Derived State in `sprintEvents`

`latestEvents[taskId]` is always `taskEvents[taskId][taskEvents[taskId].length - 1]`. Storing both duplicates data and creates a sync risk: a bug that omits updating `latestEvents` causes the UI to show a stale "latest" event indefinitely. Replace with a Zustand selector `useLatestEvent(taskId)` that reads directly from `taskEvents`. Like Rank 3, this is a single-field removal with a selector replacement — low risk, immediate consistency improvement.

---

## 2. Cross-Cutting Themes

### Theme A: No Shared Utility Library — Reinvent-in-Place Culture

**Finding IDs:** F-t2-duplication-1, F-t2-duplication-2, F-t2-duplication-3, F-t2-duplication-4, F-t2-duplication-7, F-t1-naming-3, F-t1-naming-8, F-t4-storeDesign-9

Every time a developer needs `sleep()`, a retry loop, a terminal-status check, or a debounced persister, they write a new local implementation rather than finding or creating a central module. The result is 25+ reimplementations of `sleep`, three different retry strategies with diverging jitter/cap formulas, and `TERMINAL_STATUSES` defined in at least three places. This pattern will continue until a deliberate `src/main/lib/` and `src/renderer/src/lib/` convention is established with well-known exports. The quick wins in Ranks 1, 2, 6, and 7 are the entry point for establishing that convention.

### Theme B: God Objects at Every Layer — Functions, Files, Classes, and Stores

**Finding IDs:** F-t1-godFunc-1 through F-t1-godFunc-4, F-t2-fatFiles-1, F-t2-fatFiles-2, F-t2-fatFiles-3, F-t4-storeDesign-6, F-t2-cohesion-1, F-t2-cohesion-2

`resolveSuccess`, `finalizeAgentRun`, `setupWorktree`, `_processQueuedTask`, `sprint-queries.ts`, `AgentManager/index.ts`, `run-agent.ts`, and `sprintTasks.ts` all violate SRP at different granularities. The consistent pattern is that code grows inside a single file or function until it becomes the natural place to add the next related thing. This is not a design failing unique to one module — it is a codebase-wide habit of colocation over separation. Tackling the god objects (Ranks 16–25 in the scored list) one at a time is the right long-term strategy, starting with the highest-traffic files.

### Theme C: Error Handling Has No Canonical Strategy

**Finding IDs:** F-t4-errorPatterns-1, F-t4-errorPatterns-2, F-t4-errorPatterns-3, F-t4-errorPatterns-5, F-t4-errorPatterns-7, F-t1-godFunc-1 (mixed strategies in resolveSuccess)

Three incompatible error strategies coexist within a single function (`resolveSuccess`): early return via `failTaskWithError`, silent continuation with a `logger.warn`, and result objects from `rebaseOntoMain`. Across the codebase, some modules throw, others return `{ ok: false }`, and some swallow errors entirely (the worktree cleanup triple-catch). The root cause: the project never committed to one model. The consequence: callers cannot predict what a partial failure means for system state. A one-page architecture decision record (ADR) choosing between "result objects everywhere" vs "throw everywhere" would let every module author make consistent choices going forward.

### Theme D: IPC Handlers Absorb Business Logic That Belongs in Services

**Finding IDs:** F-t3-ipcHandlers-1, F-t3-ipcHandlers-2, F-t3-ipcHandlers-3, F-t3-ipcHandlers-4, F-t3-ipcHandlers-5, F-t3-ipcHandlers-6, F-t2-cohesion-5

The principle "handlers are thin adapters" is stated in CLAUDE.md and enforced in most places, but five high-traffic handlers have absorbed substantial business logic: `workbench:checkOperational` is 145 lines of conditional auth, git, and concurrency checks; `review:checkAutoReview` parses numstat output; `workbench:researchRepo` owns grep output parsing; `sprint:batchUpdate` reimplements patch-field filtering from `sprint-local.ts`. These violations are individually Medium severity but together represent a consistent pressure: when a handler needs to do something new, it is easier to add it inline than to find or create the right service. Establishing a service-per-domain pattern (Rank 9 is the entry point) will reverse the drift.

### Theme E: Renderer Stores Are Over-Engineered State Machines

**Finding IDs:** F-t4-storeDesign-1, F-t4-storeDesign-2, F-t4-storeDesign-3, F-t4-storeDesign-4, F-t4-storeDesign-5, F-t4-storeDesign-6, F-t4-storeDesign-7, F-t4-storeDesign-8, F-t4-storeDesign-9, F-t2-fatFiles-7, F-t2-cohesion-6

The renderer stores — especially `sprintTasks.ts` — have become orchestration engines rather than state containers. They own optimistic-update TTL logic, subscription lifecycle, WIP-limit enforcement, batch operation coordination, and derived-state computation, all inside Zustand slices. The consequence: 439 lines for one store, derived state that can fall out of sync, and business logic that cannot be tested without mocking Zustand internals. The quick wins (Ranks 3 and 10) start the unwinding; the major refactors (F-t4-storeDesign-1 and -6) complete it.

---

## 3. Quick Wins Table

All findings with Effort=S and Score ≥ 4.0:

| Finding ID | Title | Score | What to do |
|-----------|-------|-------|-----------|
| F-t1-naming-3 | Magic timing constants in agent-manager | 9.0 | Create `src/main/agent-manager/constants.ts`; replace all raw `30_000`/`60_000`/etc. literals with named exports. |
| F-t1-naming-8 | Magic strings in `classifyFailureReason` | 9.0 | Extract `FAILURE_PATTERNS` lookup table; reduce function to a `.find()` + `.some()` call. |
| F-t4-storeDesign-2 | `activeTaskCount` stored instead of computed | 9.0 | Remove field from `SprintTasksState`; add `useActiveTaskCount` selector; fix all 4+ call sites. |
| F-t1-godFunc-6 | `onTaskTerminal` mixes metrics + deps + timer | 6.0 | Extract `recordTerminalMetrics()`, `resolveDependent()`, `scheduleTerminalCleanup()` as named helpers. |
| F-t1-godFunc-7 + F-t1-nesting-2 | `poll()` duplicated terminal-notify blocks | 6.0 | Extract `notifyTaskTerminalBatch(ids, status, onTaskTerminal, log)` and call it in both branches. |
| F-t2-duplication-1 | `sleep()` / `execFileAsync` reimplemented 25+ files | 6.0 | Create `src/main/lib/async-utils.ts`; replace all local reimplementations with imports. |
| F-t2-duplication-4 | Field allowlist filtering duplicated | 6.0 | Extract `validateAndFilterPatch(patch, allowlist, logger?)` in `src/main/lib/patch-validation.ts`; import in both handlers. |
| F-t2-duplication-7 | `TERMINAL_STATUSES` check in 3+ service files | 6.0 | Delete local redefinitions; import `TERMINAL_STATUSES` and `isTerminalStatus()` from `src/shared/task-transitions.ts`. |
| F-t3-ipcHandlers-4 | `workbench:researchRepo` grep parsing in handler | 6.0 | Extract `searchRepo(path, query)` service and `parseGrepOutput(stdout)` pure helper; handler becomes 3 lines. |
| F-t4-storeDesign-5 | `latestEvents` stored as redundant derived state | 6.0 | Remove `latestEvents` from `sprintEvents` state; add `useLatestEvent(taskId)` selector. |
| F-t4-errorPatterns-7 | Worktree cleanup errors silently swallowed | 6.0 | Add `logger.warn(...)` in every bare `catch {}`; return cleanup result summary to caller. |
| F-t1-naming-5 | `msg`/`message` used for two different concepts | 6.0 | Rename SDK protocol objects to `sdkMessage`/`rawMessage`; error strings to `errorMessage`/`errorText`. |
| F-t1-naming-1 | `handleOAuthRefresh` vague verb | 6.0 | Rename to `refreshOAuthTokenFromKeychain()` to communicate the actual action. |
| F-t1-naming-4 | `opts` parameter naming | 6.0 | Replace `opts` parameters with type-derived names: `spawnOptions`, `completionOptions`, etc. |
| F-t1-godFunc-8 | `sprint:batchUpdate` mixed concerns | 4.0 | Extract `validateOperation()`, `processUpdate()`, `processDelete()`, `buildResult()` helpers. |
| F-t1-nesting-7 | `SprintPipeline` complex filter predicate | 4.0 | Extract `isConflictingTask(t)` named predicate to replace the 4-condition inline arrow function. |
| F-t2-cohesion-4 | `task-terminal-service` batching + resolution + broadcast | 4.0 | Separate timeout-coalescing scheduler from `resolveDependents` call; scheduler calls resolver and then broadcasts. |
| F-t2-cohesion-7 | `git-operations.ts` low-level git + PR policy + commit format | 4.0 | Split into `git-commands.ts` (raw git) and `pr-workflow.ts` (agent-specific PR policy and body generation). |
| F-t3-layers-3 | Preload broadcast listener pattern inconsistency | 4.0 | Create `onBroadcast<K>()` factory in preload; refactor `agentEvents.onEvent` and similar duplicates to use it. |
| F-t4-storeDesign-8 | `taskGroups` cross-store action coupling | 4.0 | Remove `loadGroupTasks()` call from inside `selectGroup()`; add `useGroupTasks` hook that triggers load via `useEffect`. |
| F-t4-errorPatterns-4 | Fire-and-forget promises on critical state | 4.0 | Await `createAgentRecord()`; add `.stack` to fire-and-forget warn logs; document intent with a comment. |
| F-t4-storeDesign-9 | Debounced persistence duplicated in 4 stores | 4.0 | Create `createDebouncedPersister(selector, onPersist, ms)` utility; replace 4 store implementations. |

---

## 4. Major Refactors (Effort=L)

Listed in descending score order:

| Finding ID | Title | Score | Worth Tackling? |
|-----------|-------|-------|----------------|
| F-t2-fatFiles-1 + F-t2-cohesion-3 | `sprint-queries.ts` 805-line mixed module (data mapping, CRUD, state machine, audit trail, WIP limits) | 3.0 | **Yes — highest structural priority.** This is the single most-edited file in the data layer. A split into 5 focused modules reduces merge conflict surface by ~80% and makes each concern testable in isolation. Start by extracting the pure data-mapper (`mapRowToTask`, `serializeFieldForStorage`) — zero behavior change, immediate payoff. |
| F-t2-fatFiles-2 | `AgentManager index.ts` 713-line god class (orchestration, dependency graph, watchdog, lifecycle, metrics, config) | 3.0 | **Yes — but incrementally.** Extract `AgentWatchdog` first (self-contained timer loop), then `DependencyGraphService`, then `AgentConcurrencyManager`. Each extraction can be merged independently. The class becomes a thin facade after three PRs instead of one risky big-bang. |
| F-t4-storeDesign-1 | Optimistic update orchestration as business logic in `sprintTasks` store | 3.0 | **Yes — after the quick wins above clear the ground.** The TTL-based field merging logic is genuinely complex business logic masquerading as state management. Extracting it to `services/optimisticUpdateService.ts` as pure functions makes it unit-testable and reusable for `taskGroups` or future stores. |
| F-t2-cohesion-2 | `run-agent.ts` lifecycle + state + cost tracking + message processing (689 lines) | 2.25 | **Yes — after `sprint-queries.ts`.** The four axes (spawn lifecycle, message processing, cost tracking, task state) are individually understandable; extracting them reduces cognitive load for the most frequently debugged file in the pipeline. Effort is genuinely L because the message-consumption loop is tightly coupled to all four. |
| F-t2-cohesion-3 | `sprint-queries.ts` data + state machine + audit + WIP limits | 2.25 | Merged with F-t2-fatFiles-1 above. |
| F-t4-storeDesign-6 | `sprintTasks` god store — 6 domains in 439 lines | 2.25 | **Yes — phase 2.** Dependent on F-t4-storeDesign-1 extraction first. Once optimistic update logic is a service, the remaining store split into `sprintTaskData` + `sprintOptimisticUpdates` + `sprintTaskService` is more straightforward. |
| F-t4-errorPatterns-2 | `resolveSuccess` three incompatible error strategies | 2.25 | **Yes, but combine with god-function refactor.** F-t1-godFunc-1 and F-t1-nesting-1 already call for decomposing `resolveSuccess`; choosing a single error strategy (result objects throughout) is part of that same refactor, not a separate L-effort item. Treat as M when combined. |
| F-t3-ipcHandlers-8 | Preload API surface lacks semantic grouping | 0.25 | **No — defer.** Low confidence, style-only, no correctness impact. The preload surface works correctly; grouping is a cosmetic concern with breaking-change risk (renderer call sites). |

---

## 5. Deferred / Out of Scope

Real findings that are genuine problems but not worth fixing now:

| Finding ID | Title | Reason for Deferral |
|-----------|-------|---------------------|
| F-t1-naming-6 | `hasCommits`/`rebaseSucceeded` imprecise boolean names | Low severity; rename is safe but changes are only meaningful if the surrounding god-function (F-t1-godFunc-1) is decomposed first. Do it then. |
| F-t1-naming-7 | `err` as universal catch variable | Low severity; project-wide rename with zero behavior change and high noise-to-value ratio. Better tackled via a linting rule (`@typescript-eslint/no-shadow`) than manual edits. |
| F-t1-naming-9 | `ttl` abbreviation ambiguity | Low severity; isolated to one or two files. Fix opportunistically when touching those files. |
| F-t1-nesting-6 | `classifyFailureReason` sequential if-clauses | Already fully addressed by F-t1-naming-8 (the data-driven lookup table refactor). Not a separate action. |
| F-t2-duplication-5 | Zustand async fetch pattern duplicated in 30+ stores | Medium but L-adjacent effort and high breakage risk. Worth doing after store-design major refactors settle the canonical pattern. |
| F-t2-duplication-6 | `effectiveRepo` fallback in all handler files | The right fix (always inject non-optional repo) requires touching all 25+ handler registration call sites in `index.ts`. Valid but creates a large, risky diff for moderate gain. Tackle after DI patterns stabilize. |
| F-t2-duplication-8 | Git command execution pattern varies across files | Medium confidence; the right shape of a `runGit()` abstraction is unclear until the module splits in Theme B are further along. |
| F-t2-duplication-9 | `useElapsedTime` hook duplicated in TaskRow/TaskPill | Low severity; two-file duplication is below the threshold for a dedicated extraction sprint. |
| F-t3-layers-2 | Dynamic channel string `tearoff:closeResponse:{windowId}` | The parameterized channel pattern is a deliberate design choice for per-window responses. The recommendation to use a fixed channel with windowId in payload is valid but requires coordinated renderer and main changes. Defer until tearoff-manager is otherwise being touched. |
| F-t3-ipcHandlers-7 | `agents:promoteToReview` fat handler | Largely subsumed by F-t3-ipcHandlers-2 (domain construction). Once title derivation is extracted, the handler is already meaningfully leaner. Remaining decomposition is low priority. |
| F-t3-ipcHandlers-8 | Preload API surface semantic grouping | Cosmetic; breaking-change risk; confidence Low. Out of scope. |
| F-t4-storeDesign-7 | Store error handling fallback-only, no retry | The recommended solution (per-error retry tracking) is a significant UX and architecture change. Valid goal, but requires agreement on error UX patterns before implementation. |

---

## 6. Open Questions

**Q1 — Error model: result objects vs throw?**  
F-t4-errorPatterns-2 found three incompatible strategies in a single function. F-t4-errorPatterns-1 found swallowed errors that return a success shape. The codebase has never committed to one error model. Before any error-handling refactor, a one-page ADR should answer: does the agent-manager layer throw on failure, or return `{ ok: boolean; error?: string }`? Both lenses independently arrived at "result objects" as the recommendation, but this needs an explicit decision.

**Q2 — Where does `onTaskTerminal` / `onStatusTerminal` live canonically?**  
F-t2-duplication-3 found the callback type defined in 7 locations with two different names. The fix requires picking a canonical file (`src/main/lib/task-terminal-types.ts` is the recommendation). But the name inconsistency (`onTaskTerminal` in agent-manager vs `onStatusTerminal` in IPC handlers) suggests a deeper disagreement about whether the callback is agent-manager–specific or app-wide. This should be decided before the type is centralized.

**Q3 — How far should the store decomposition go?**  
F-t4-storeDesign-6 recommends splitting `sprintTasks` into 3 stores + services. F-t4-storeDesign-1 recommends a separate `optimisticUpdateService`. F-t2-fatFiles-7 recommends 4 sub-hooks. These are partially overlapping proposals from different lenses with no single reconciled target state. Before executing any of these, a brief design sketch of the final store topology (`sprintTaskData` + `sprintOptimisticUpdates` + `sprintTaskService` + selectors) should be agreed upon to avoid incremental steps that contradict each other.

**Q4 — Is `buildAgentPrompt`'s size a code smell or a domain requirement?**  
F-t1-godFunc-5 and F-t2-fatFiles-8 both flag `prompt-composer.ts` as too large. The five personality builders are genuinely distinct, but they share overlapping sections (memory, skills, personality). The confidence for both findings is Medium because it is unclear whether the current monolithic structure reflects intentional isolation between personality types (don't want accidental sharing) or is simply accumulated growth. The right architecture — composable sections vs. isolated full builders — should be decided with the team that owns prompt design before refactoring.

**Q5 — Evidence gaps in the layers lens.**  
F-t3-layers-3 (preload broadcast pattern) has Medium confidence and the recommendation (a factory function) depends on whether the existing batch-consolidation behavior for agent events is intentional or incidental. The tearoff-manager findings (F-t3-layers-1, -2) are high confidence but the tearoff feature itself may be changing; verify the refactor is worthwhile before scheduling it.
