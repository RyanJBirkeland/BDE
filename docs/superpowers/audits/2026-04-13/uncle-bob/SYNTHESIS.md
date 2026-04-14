# Uncle Bob Audit — SYNTHESIS
**Date:** 2026-04-13
**Grade:** C+ — Disciplined scaffold with systemic DIP/ISP violations and concentrated god-class debt
**Findings processed:** 92 total across 11 lenses (naming lens absent)

---

## Overall Letter Grade: C+

BDE is not a codebase in crisis — it is a codebase mid-transformation. The scaffolding is correct: TypeScript strict mode, a working `ISprintTaskRepository` abstraction, `safeHandle()` typed IPC wrappers, `IpcChannelMap` compile-time safety, `task-state-machine.ts` for shared transitions, and a coherent domain model. These are not accidents; they reflect genuine architectural intent. The project earns a solid floor.

The ceiling is pulled down by two systemic patterns that appear across every team's findings. First, the Dependency Inversion Principle is violated at the module level throughout `agent-manager/`: `run-agent.ts`, `turn-tracker.ts`, `completion.ts`, and `agent-history.ts` all call `getDb()` directly, import `node:fs` inline, and dynamically `import('../settings')` — bypassing every abstraction the rest of the codebase works hard to maintain. This is not incidental; it is the agent execution hot path, and it makes the most important code in the product untestable without a real database and real filesystem. Second, SRP god-classes cluster at the highest-value seams: `AgentManagerImpl` (801 lines, 6 responsibilities), `run-agent.ts` (769 lines, 4 layers), `EpicDetail.tsx` (746 lines, 5 concerns), `tearoff-manager.ts` (633 lines, 4 domains), and `prompt-composer.ts` (682 lines, 6 agent types). These files are change bottlenecks today and regression traps tomorrow.

Supporting violations — 107+ hardcoded status strings, inconsistent error return patterns across `completion.ts`, 82+ copy-pasted try/catch blocks in the data layer, and a 557-line preload that exposes every platform capability as a flat API — confirm that the structural discipline applied at the domain boundary has not yet penetrated the implementation details. The grade reflects a codebase that knows the rules, has applied them selectively, and now needs a focused effort to close the gap between intent and reality.

---

## Top 10 Ranked Actions

Scored by (Severity × Confidence) / Effort. Scores shown in brackets.

### #1 [Score: 12.0] — Standardize error return pattern across completion.ts
**Finding IDs:** F-t4-errors-4, F-t4-errors-1, F-t4-errors-2
**Severity/Confidence/Effort:** High/High/S (F-t4-errors-1, -2); High/High/M (-4)
**Summary:** `completion.ts` mixes null returns, boolean returns, void + side effects, and Result objects across its sub-functions. Silent catch blocks in `run-agent.ts` swallow validation and spawn failures without logging. Pick one error pattern for the entire completion layer (throw-only or Result type) and apply it consistently. This is a correctness issue: callers currently have no reliable signal when critical phases fail.

---

### #2 [Score: 12.0] — Fix bare catch blocks that swallow errors in agent lifecycle
**Finding IDs:** F-t4-errors-2, F-t4-errors-3, F-t4-errors-6, F-t4-errors-9
**Severity/Confidence/Effort:** High/High/S
**Summary:** Four separate bare-catch or fire-and-forget patterns in the agent execution path lose critical error context: (1) validation/spawn failures in `runAgent` return silently, (2) `createAgentRecord` DB write failure is `.catch()`-logged but not propagated, (3) `onTaskTerminal` failure is `.catch()`-warned but execution continues, (4) `refreshOAuthTokenFromKeychain` is not awaited. Each of these can leave the system in an inconsistent state with no diagnostic signal. Fix: always use `logError(logger, context, err)` and propagate or explicitly document the decision to swallow.

---

### #3 [Score: 9.0] — Consolidate task status constants to a single source of truth
**Finding IDs:** F-t4-smells-7, F-t3-ocplsp-2, F-t3-ocplsp-6
**Severity/Confidence/Effort:** High/High/M
**Summary:** Task status strings are defined in four separate files (`constants.ts`, `task-state-machine.ts`, `task-status-ui.ts`, `sprint-task-types.ts`) and hardcoded as string literals in 107+ additional locations. Some code uses `TERMINAL_STATUSES.has()` correctly; most does not. Create one `src/shared/task-statuses.ts` that exports `ALL_TASK_STATUSES as const`, derives `TaskStatus`, `TERMINAL_STATUSES`, and `isTerminal()`/`isFailure()` predicates. Remove the parallel definitions. This blocks clean refactoring of the entire data layer.

---

### #4 [Score: 9.0] — Move STATUS_METADATA / BucketKey from renderer to shared
**Finding IDs:** F-t2-deprule-1
**Severity/Confidence/Effort:** Critical/High/S
**Summary:** `src/shared/__tests__/task-state-machine.test.ts` imports `STATUS_METADATA` and `BucketKey` from `src/renderer/src/lib/task-status-ui`. This inverts the dependency rule at the most critical boundary — shared code depending on renderer UI details. Move `STATUS_METADATA` to `src/shared/` so the renderer can import from shared, not the other way around. This is a one-file move with an import chain update.

---

### #5 [Score: 9.0] — Remove orphaned `getDb` import and make repo parameter required in sprint-local handlers
**Finding IDs:** F-t3-ispdip-2, F-t3-ispdip-7, F-t2-abstracts-8
**Severity/Confidence/Effort:** High/High/S
**Summary:** `sprint-local.ts` has an orphaned `import { getDb }` that is a symptom of incomplete DIP refactoring. Additionally, `registerSprintLocalHandlers` accepts an optional `repo` parameter and falls back to `createSprintTaskRepository()` — meaning tests that forget to pass a mock silently get a real database. Make `repo` required in all handler registration functions. Remove all direct `getDb()` calls from handler code.

---

### #6 [Score: 9.0] — Replace agent-type switch in prompt-composer with a registry
**Finding IDs:** F-t3-ocplsp-1, F-t3-srp-6
**Severity/Confidence/Effort:** High/High/S (OCP fix); Medium/High/M (SRP extraction)
**Summary:** The switch dispatch at `prompt-composer.ts:654-671` requires modifying existing code to add any new agent type — a textbook OCP violation. Replace with `Record<AgentType, BuilderFunction>`. As a follow-on (M effort), split the 682-line file into per-agent-type modules (`prompt-composer-pipeline.ts`, etc.) sharing a `prompt-composer-shared.ts`. The registry fix alone is S effort and unblocks parallel agent type work.

---

### #7 [Score: 6.0] — Inject TurnTracker and run-agent DB dependencies instead of calling getDb() directly
**Finding IDs:** F-t2-deprule-2, F-t2-deprule-4, F-t2-abstracts-1
**Severity/Confidence/Effort:** Critical/High/M
**Summary:** `TurnTracker` calls `getDb()` directly for turn persistence, and `run-agent.ts` calls `updateAgentRunCost(getDb(), ...)` inline. These are in the hottest path of the product. Add `recordTurn` and `updateAgentRunMetrics` callbacks to `RunAgentDeps` with no-op defaults. This makes cost/turn tracking injectable, enables in-memory test doubles, and removes the SQLite hard dependency from orchestration logic.

---

### #8 [Score: 6.0] — Extract AgentManagerImpl into single-responsibility components
**Finding IDs:** F-t3-srp-1, F-t1-funcs-3
**Severity/Confidence/Effort:** Critical/High/L
**Summary:** `AgentManagerImpl` (801 lines) mixes queue drain, watchdog management, orphan recovery, worktree lifecycle, concurrency state, and task terminal handling. `_drainLoop` itself bundles 7 concerns. Extract `WatchdogProcess`, `OrphanRecoverer`, and `WorktreeCoordinator` as separate classes; keep `AgentManagerImpl` as a thin facade. This is an L effort but unblocks every other agent-manager improvement — it is the structural debt that makes all other fixes in this area harder.

---

### #9 [Score: 6.0] — Fix DashboardEvent raw DB column leakage at IPC boundary
**Finding IDs:** F-t2-bounds-1, F-t2-bounds-3
**Severity/Confidence/Effort:** High/High/S (bounds-1 is High but scored with Medium in lens — using High); Medium/High/S
**Summary:** `DashboardEvent` exposes `agent_id`, `event_type` (snake_case DB columns) and `payload` as a raw JSON string directly to the renderer. `cost-queries.ts` does this transformation correctly (`rowToRecord`). Apply the same pattern to dashboard queries: transform at the data boundary, parse `payload` before it crosses IPC, and rename fields to camelCase domain terms. Two-file change with zero behavior change.

---

### #10 [Score: 6.0] — Consolidate data-layer try/catch pattern with a shared wrapper
**Finding IDs:** F-t4-smells-1, F-t4-smells-2
**Severity/Confidence/Effort:** High/High/M
**Summary:** The identical `try { db.prepare(Q).all() } catch (err) { logger.warn(...); return [] }` pattern appears 82+ times across 17 data files. `transitionTasksToDone` and `transitionTasksToCancelled` are near-identical functions differing only in target status. Extract `withDataLayerErrorHandling<T>(op, name, fallback)` and `transitionTasksByPrNumber(prNumber, targetStatus, ...)`. Single-point policy for all data layer error recovery.

---

## Cross-Cutting Themes

### Theme 1: Dependency Inversion Systematically Violated in Agent Execution
**Findings:** F-t2-deprule-2, F-t2-deprule-3, F-t2-deprule-4, F-t2-abstracts-1, F-t2-abstracts-3, F-t3-ispdip-2, F-t3-ispdip-3, F-t3-ispdip-4, F-t3-ispdip-5, F-t3-ispdip-8

The agent-manager modules (`run-agent.ts`, `turn-tracker.ts`, `completion.ts`, `agent-history.ts`) all reach downward to concrete infrastructure: `getDb()`, `node:fs`, `node:child_process`, `import('../settings')`. This pattern recurs across 10+ findings from three separate teams. The `ISprintTaskRepository` abstraction is present and used — but only in `agent-manager/index.ts`. The modules doing the actual work bypass it. Result: the most-executed code paths are untestable without real infrastructure.

### Theme 2: God Classes at Every Major Seam
**Findings:** F-t3-srp-1, F-t3-srp-2, F-t3-srp-3, F-t3-srp-4, F-t3-srp-5, F-t3-srp-6, F-t3-srp-7, F-t1-funcs-1, F-t1-funcs-2, F-t1-funcs-7

Five files over 600 lines each accumulate multiple reasons to change. `AgentManagerImpl` (801 lines), `run-agent.ts` (769 lines), `EpicDetail.tsx` (746 lines), `tearoff-manager.ts` (633 lines), `prompt-composer.ts` (682 lines). These are not accidents — they result from continuous feature addition without corresponding extraction. Each is a change bottleneck and a test hazard. The pattern spans both main process and renderer.

### Theme 3: Primitive Obsession Around Task Status
**Findings:** F-t4-smells-7, F-t3-ocplsp-2, F-t3-ocplsp-6, F-t3-ocplsp-3, F-t3-ocplsp-7, F-t2-deprule-1

Task status strings are the most pervasive primitive in the codebase, and they are treated inconsistently everywhere. Four separate definition sites, 107+ raw string usages, renderer test files importing from renderer UI modules, `getDotColor` switch statements, and metrics dispatch using hardcoded `'done'`/`'failed'` checks. A single status rename or addition would require shotgun surgery across the entire codebase.

### Theme 4: Inconsistent Error Handling Contracts
**Findings:** F-t4-errors-1 through -10, F-t4-smells-1, F-t4-smells-3

The codebase uses at least four different error return conventions simultaneously: throw, `null`, `boolean`, and `{ ok, error }` Result types — sometimes within the same file. Silent catch blocks, fire-and-forget `.catch()` handlers, and `${err}` string interpolation (which loses stack traces for non-Error objects) appear throughout the agent lifecycle. The data layer repeats the same `try/catch/warn/return []` pattern 82+ times. No layer has a documented or enforced contract.

### Theme 5: IPC Surface and Repository Abstraction Applied Selectively
**Findings:** F-t3-ispdip-1, F-t3-ispdip-6, F-t2-abstracts-4, F-t2-abstracts-6, F-t2-bounds-4, F-t3-srp-9, F-t3-ispdip-10

The preload bridge (557 lines, 176 channels) exposes the entire platform as a flat API — every renderer component implicitly depends on every capability. Meanwhile, `ISprintTaskRepository` is correctly role-segregated (`IAgentTaskRepository`, `ISprintPollerRepository`, `IDashboardRepository`) but callers — especially IPC handlers — bypass these interfaces and call sprint-service functions directly. The correct abstractions exist but are not enforced.

---

## Quick Wins
Items with score >= 6.0 AND Effort=S. Fixable in a single focused session.

| # | Finding | Score | What to do |
|---|---------|-------|------------|
| 1 | F-t2-deprule-1 | 12.0 | Move `STATUS_METADATA`/`BucketKey` from renderer to `src/shared/` |
| 2 | F-t4-errors-1 | 12.0 | Log the error in the silent catch in `completion.ts:191-193` |
| 3 | F-t4-errors-2 | 12.0 | Add `logError(logger, context, err)` to bare catch blocks in `runAgent` |
| 4 | F-t4-errors-3 | 12.0 | Await `createAgentRecord` and handle failure explicitly |
| 5 | F-t4-errors-6 | 12.0 | Escalate `onTaskTerminal` failure from warn to error; propagate or track |
| 6 | F-t4-errors-9 | 12.0 | Await `refreshOAuthTokenFromKeychain()` in `handleOAuthRefresh` |
| 7 | F-t3-ispdip-2 | 9.0 | Remove orphaned `import { getDb }` from `sprint-local.ts` |
| 8 | F-t3-ispdip-3 | 9.0 | Move `maxCostUsd` from inline `getSettingJson` call to `BatchHandlersDeps` |
| 9 | F-t3-ispdip-7 | 9.0 | Make `repo` parameter required in `registerSprintLocalHandlers` |
| 10 | F-t3-ocplsp-1 | 9.0 | Replace agent-type switch in prompt-composer with `Record<AgentType, BuilderFn>` |
| 11 | F-t3-ocplsp-3 | 9.0 | Replace metrics if/else dispatch with a `statusClass` map |
| 12 | F-t3-ocplsp-5 | 9.0 | Add `satisfies Personality` to all personality object definitions |
| 13 | F-t3-ocplsp-7 | 9.0 | Replace `getDotColor` switch with `STATUS_COLORS: Record<TaskStatus, string>` |
| 14 | F-t3-ocplsp-8 | 9.0 | Split `buildAssistantPrompt` into separate `buildAssistantPrompt` / `buildAdhocPrompt` |
| 15 | F-t2-bounds-3 | 9.0 | Parse `payload` JSON in `dashboard-queries.ts` before crossing IPC |
| 16 | F-t2-deprule-3 | 9.0 | Extract `WorktreePathValidator` abstraction; inject into `resolveSuccess` |
| 17 | F-t1-comments-1 | 6.0 | Delete the duplicate JSDoc block in `validateTaskForRun` |
| 18 | F-t1-comments-3 | 6.0 | Expand the "do NOT call" comment in completion.ts to explain why review isn't terminal |
| 19 | F-t1-comments-6 | 6.0 | Fix misleading "Get verdict decision" comment in `index.ts:483` |
| 20 | F-t4-smells-8 | 6.0 | Evaluate eliminating middle-man `sprint-mutations.ts` pass-through |
| 21 | F-t4-smells-10 | 6.0 | Remove `COLUMN_MAP` if it adds no validation beyond `UPDATE_ALLOWLIST` |
| 22 | F-t4-tests-1 | 6.0 | Remove 8 redundant handler registration tests in `review.test.ts` |
| 23 | F-t4-tests-4 | 6.0 | Extract `flushAsyncMicrotasks()` helper for cryptic timer-advance loops |
| 24 | F-t4-tests-5 | 6.0 | Either fix or rename misleading `review:createPr` test |
| 25 | F-t4-tests-8 | 6.0 | Add negative test for `UPDATE_ALLOWLIST` (sensitive fields must NOT be present) |

---

## Structural Debt (Effort=L items)
High-impact items that require multi-day refactors. Worth planning as sprint tasks.

**1. Extract AgentManagerImpl into focused subsystems (F-t3-srp-1)**
801-line god class with 6 distinct responsibilities. Extract `WatchdogProcess`, `OrphanRecoverer`, `WorktreeCoordinator`. Keep `AgentManagerImpl` as a thin facade. Unblocks: agent reliability work, watchdog improvements, worktree strategy changes. Estimated: 3-5 days.

**2. Introduce IAgentSpawner port abstracting SDK and CLI (F-t2-abstracts-2)**
`sdk-adapter.ts` directly couples to `@anthropic-ai/claude-agent-sdk` types and behavior. Create `IAgentSpawner` interface; make SDK and CLI spawning concrete implementations injected into `RunAgentDeps`. This is the highest-leverage testability improvement in the codebase. Estimated: 2-3 days.

**3. Introduce filesystem and git ports for agent-manager (F-t2-abstracts-3, F-t2-abstracts-7)**
`run-agent.ts` and `completion.ts` directly use `node:fs` and `execFileAsync`. Create `IFilesystemPort` and `IVersionControlPort`; inject into `RunAgentDeps`. Allows agent execution and completion logic to be unit-tested without real filesystem or git. Estimated: 3-4 days.

**4. Introduce IAgentHistoryStorage port for agent-history.ts (F-t2-abstracts-5)**
`agent-history.ts` mixes SQLite and filesystem operations without any abstraction. Create `IAgentHistoryStorage` encapsulating both; make the concrete implementation injectable. Estimated: 2 days.

**5. Segregate preload bridge into focused facades (F-t3-ispdip-1, F-t3-srp-9)**
The 557-line monolithic preload exposes 176 IPC channels as a flat API. Split into per-domain facades (`api-sprint.ts`, `api-git.ts`, `api-review.ts`, etc.) re-exported from `preload/index.ts`. Reduces renderer component coupling and attack surface. Estimated: 2-3 days.

**6. Standardize IPC handler result envelope (F-t4-smells-3)**
Handlers currently return raw data, `{ok, error}`, `{success, error}`, null, or throw — four incompatible conventions. Define `HandlerResult<T>` and migrate all handlers. Requires renderer store updates. Estimated: 4-5 days (renderer + handler changes).

**7. Right-size the preload channel surface (F-t2-bounds-4)**
176 IPC channels is difficult to reason about and audit. Analyze actual usage patterns, consolidate fine-grained channels into richer domain operations (e.g., `loadBoard()` instead of separate list/status/filter calls). Estimated: 1-2 weeks with measurement phase.

---

## Bright Spots

**1. ISprintTaskRepository role-segregation is exemplary (F-t3-ocplsp-9)**
The repository layer correctly applies ISP: `IAgentTaskRepository`, `ISprintPollerRepository`, `IDashboardRepository` are separate interfaces that compose into the full `ISprintTaskRepository`. Callers can depend on exactly the slice they need. The `rowToRecord()` transformation pattern in `cost-queries.ts` is the correct approach for all IPC boundary data. This is the pattern to replicate everywhere.

**2. IPC type safety is production-grade**
The `safeHandle<K extends keyof IpcChannelMap>` + `typedInvoke<K>` pattern in `ipc-utils.ts` and `preload/index.ts` provides compile-time guarantees on channel names, argument shapes, and return types. Context isolation is correctly enabled. No DOM manipulation in the main process. The IPC plumbing is a genuine strength — the problem is the surface area, not the safety mechanisms.

**3. task-state-machine.ts and async-utils.ts show the right consolidation instinct**
`TERMINAL_STATUSES`, `VALID_TRANSITIONS`, and `isValidTransition()` in `task-state-machine.ts` are the correct shape for a shared state machine — the finding is that they are not consistently used, not that they are poorly designed. Similarly, the recent `async-utils.ts` consolidation of `sleep` and `execFileAsync` is exactly the kind of incremental debt reduction the codebase needs more of.

---

## Deferred / Out of Scope

**F-t2-bounds-4 (176-channel preload surface):** Real finding, but the right fix requires usage analysis before restructuring. Defer until after domain facade split (F-t3-ispdip-1) is complete — that work naturally surfaces unused channels.

**F-t3-ispdip-9 (Zustand stores hiding window.api dependency):** Valid DIP concern, but Zustand stores calling `window.api` is a React-world norm. The cost of injecting `apiClient` into every store outweighs the testing benefit at current scale. Revisit if renderer unit tests become a priority.

**F-t1-comments-5 (F-t-* reference comments):** The audit-trail references are clutter but carry institutional context from recent refactoring cycles. Converting them to self-contained comments is correct in principle; defer until the referenced code is stabilized. High churn areas should get the comment cleanup last.

**F-t4-tests-7 (mock-centric integration tests):** Real concern about tests verifying mock interactions rather than behavior. However, the agent manager's dependency on real git and real SQLite makes behavioral testing genuinely hard until the port abstractions (Structural Debt items 2, 3) are in place. Fix the abstractions first; then the tests can improve.

**F-t3-srp-8 (panelLayout.ts tree/persistence mixing):** Low-risk medium finding. The panel system is stable and the coupling is mild. Defer.

---

## Open Questions

**1. Are F-t2-abstracts-4 and F-t2-abstracts-6 the same finding?**
Both report that `sprint-local.ts` IPC handlers bypass `ISprintTaskRepository` and call sprint-service functions directly. The deprule, abstracts, and ispdip lenses all flagged overlapping aspects of this same violation. The recommendation is consistent (inject repo), but the entry points vary. One sprint task should address all three.

**2. How deep is the F-t1-comments-5 audit-trail comment coupling?**
The lens reports "16+ occurrences" of `F-t-*` reference comments but didn't enumerate all files. The actual count could be significantly higher given the breadth of recent audit work. A codebase search for `// F-t` would clarify scope before committing to the cleanup effort.

**3. Is `sprint-mutations.ts` a middle man or a broadcast point?**
F-t4-smells-8 identifies it as a middle man, but the lens also notes it adds mutation broadcasting as its single concern. If broadcasting is the intended responsibility, it is not a middle man — it is a thin event-publisher layer. Clarify the intended ownership of mutation events before eliminating it.

**4. Should `ISprintTaskRepository` still compose the three role interfaces?**
F-t3-ispdip-6 recommends eliminating the `ISprintTaskRepository` union and requiring callers to depend on the specific interface they need. F-t3-ocplsp-9 names this pattern as a positive example. These findings disagree on whether the composed interface is good or bad. Resolution: keep the role interfaces as the primary abstraction; use the composed interface only at composition roots (e.g., `createSprintTaskRepository()` return type), not in function signatures.
