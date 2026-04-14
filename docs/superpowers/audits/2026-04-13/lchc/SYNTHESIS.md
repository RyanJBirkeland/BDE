# LCHC Audit Synthesis
**Date:** 2026-04-13
**Lenses:** 7 across 4 teams (2 planned lenses — `lens-depdir` and `lens-handler-coh` — were not produced; findings below cover the 7 that ran)
**Total raw findings:** 47 (including 2 positive/N/A findings excluded from ranking)

---

## Grade

Overall LCHC grade: **C+**
The codebase has sound architectural intentions (repository abstraction, barrel facades, store splits) but consistently fails to follow through — facades hide volatile hubs, god components absorb cross-domain concerns, and shared module boundaries are polluted with renderer-only types.

Sub-grades:
- Main process coupling: **C** — sprint-queries barrel volatile, agent-manager black box, handlers bypass repository
- Main process cohesion: **C** — run-agent.ts and completion.ts span 4 abstraction levels; service layer fragmented across redundant facades
- Renderer coupling: **C+** — SprintPipeline is a god component; cross-domain store access in ReviewQueue and PlannerView; `getState()` antipattern in multiple components
- Renderer/shared cohesion: **B-** — store splits are well-intentioned but bleed; shared module has clear violations (tearoff channels, task templates) that are small, targeted fixes

---

## Top 10 Ranked Actions

| Rank | Finding ID(s) | Title | Score | Severity | Effort |
|------|--------------|-------|-------|----------|--------|
| 1 | F-t2-svc-3 | Rename WorkbenchChecksService — signal it's a composite, not a domain | 6.0 | High | S |
| 2 | F-t2-agent-6 | Extract agent tracking setup from `initializeAgentTracking` | 6.0 | Medium | S |
| 3 | F-t2-agent-7 | Split `resolveAgentExit` into classify → decide → execute | 6.0 | Medium | S |
| 4 | F-t2-svc-6 | Extract `review-response-parser.ts` from `review-service.ts` | 6.0 | Medium | S |
| 5 | F-t3-sc-4 | Replace `getState()` in TaskPill with proper Zustand subscription | 6.0 | Medium | S |
| 6 | F-t4-sh-2 | Move `DEFAULT_TASK_TEMPLATES` out of `shared/constants.ts` | 6.0 | Medium | S |
| 7 | F-t1-ipc-2 | Make review→sprint transitions atomic in main process | 4.5 | High | M |
| 8 | F-t2-svc-1 | Consolidate four review service files behind a single `ReviewActionService` facade | 4.5 | High | M |
| 9 | F-t2-agent-1 | Decompose `run-agent.ts` into process / tracking / telemetry / completion modules | 4.5 | High | M |
| 10 | F-t4-sh-1 | Move TearoffChannels out of `src/shared/ipc-channels/ui-channels.ts` | 4.5 | High | M |

---

### Action 1: Rename WorkbenchChecksService — signal it's a composite, not a domain
**Finding IDs:** F-t2-svc-3
**Score:** 6.0
**Summary:** `workbench-checks-service.ts` exports five independent checks (auth, repo path, git status, task conflicts, agent slots) with no shared state or helpers — it is a composite utility, not a domain service. The name implies cohesion that does not exist.
**Why now:** Zero behavior change, high clarity gain. New engineers reading this file spend time searching for the domain seam that isn't there.
**Concrete next step:** Rename to `operational-checks-service.ts`, add a JSDoc comment: `// Composite pre-flight checks. Each check is independent; grouped only because all must pass before task launch.`

---

### Action 2: Extract agent tracking setup from `initializeAgentTracking`
**Finding IDs:** F-t2-agent-6
**Score:** 6.0
**Summary:** `initializeAgentTracking` in `run-agent.ts` (lines 410–481) simultaneously wires stderr to IPC, mutates the `activeAgents` map, creates a `TurnTracker`, persists `agent_run_id` to DB, creates an agent history record, and emits `agent:started`. That is six side effects in one function.
**Why now:** Small effort, high testability gain. Mocking this function currently requires 4+ stubs. Extracting setup from side-effectors cuts that to 1.
**Concrete next step:** Create `src/main/agent-manager/agent-tracking-initializer.ts` with `setupAgentRecord()` (pure), `persistAgentTracking()` (DB), and `wireAgentIPC()` (events). Caller in `run-agent.ts` sequences them.

---

### Action 3: Split `resolveAgentExit` into classify → decide → execute
**Finding IDs:** F-t2-agent-7
**Score:** 6.0
**Summary:** `resolveAgentExit` in `run-agent.ts` (lines 557–624) chains fast-fail classification, task DB update, `onTaskTerminal` dispatch, and `resolveSuccess/resolveFailure` invocation in a single function. Exit classification errors are indistinguishable from update errors.
**Why now:** S effort, directly unblocks unit testing exit classification logic without spawning DB or IPC infrastructure.
**Concrete next step:** Extract `exit-classifier.ts` (pure enum return) as the first step. The rest of the chain can stay in-place initially.

---

### Action 4: Extract `review-response-parser.ts` from `review-service.ts`
**Finding IDs:** F-t2-svc-6
**Score:** 6.0
**Summary:** `review-service.ts` bundles parsing utilities (`parseReviewResponse`, `stripFences`, `extractFirstJsonObject`, `validateParsedReview`) alongside domain execution logic. Parsing is a pure utility reusable outside the service but is currently locked behind service dependencies.
**Why now:** S effort surgical extraction. Makes parsing independently testable and reusable by debugging/testing code.
**Concrete next step:** Create `src/main/services/review-response-parser.ts`, move the four parsing functions and `MalformedReviewError` there, update `review-service.ts` to import from it.

---

### Action 5: Replace `getState()` in TaskPill with proper Zustand subscription
**Finding IDs:** F-t3-sc-4
**Score:** 6.0
**Summary:** `TaskPill` calls `useSprintSelection.getState().toggleTaskSelection()` in a click handler instead of subscribing via `useSprintSelection()`. This bypasses React's render cycle and creates subtle out-of-sync risk between the store and the component subtree.
**Why now:** Single line change, eliminates an antipattern that could spread. The `getState()` pattern in event handlers is a footgun — fixing the canonical example signals the correct convention.
**Concrete next step:** In `TaskPill.tsx`, replace `useSprintSelection.getState().toggleTaskSelection(...)` with `const toggleTaskSelection = useSprintSelection(s => s.toggleTaskSelection)` and call it directly.

---

### Action 6: Move `DEFAULT_TASK_TEMPLATES` out of `shared/constants.ts`
**Finding IDs:** F-t4-sh-2
**Score:** 6.0
**Summary:** `shared/constants.ts` contains 50+ lines of renderer-specific markdown template prompts that reference `src/renderer/` paths, IPC channels, and preload bridge patterns. The main process loads these constants but never uses them for rendering.
**Why now:** S effort. Shared layer pollution actively misleads new engineers about what is a true cross-process contract.
**Concrete next step:** Move `DEFAULT_TASK_TEMPLATES` to `src/renderer/src/lib/default-templates.ts` (already imported by `promptTemplates.ts`). Keep `TASK_STATUS`, `PR_STATUS`, `MIN_SPEC_LENGTH`, etc. in shared.

---

### Action 7: Make review→sprint transitions atomic in main process
**Finding IDs:** F-t1-ipc-2
**Score:** 4.5
**Summary:** After `review:shipIt` or `review:requestRevision` completes in main, the renderer is expected to make a follow-up `sprint:update` call to synchronize task state. If the renderer crashes between the two IPC calls, the task is in an inconsistent state.
**Why now:** This is the only finding with a direct data-consistency risk. If a renderer crash or React error occurs between the two calls, a task is merged but never marked done.
**Concrete next step:** In `src/main/handlers/review.ts`, the `review:shipIt` handler should atomically execute merge + task status transition and return the updated `SprintTask` in its response. Remove the renderer-side follow-up `sprint:update` call in `useSingleTaskReviewActions.ts`.

---

### Action 8: Consolidate four review service files behind a single `ReviewActionService` facade
**Finding IDs:** F-t2-svc-1
**Score:** 4.5
**Summary:** The review workflow is split across `review-orchestration-service.ts`, `review-action-policy.ts`, `review-action-executor.ts`, and `review-merge-service.ts`. These four files share a single domain (PR review actions) but expose four separate import surfaces.
**Why now:** High confidence, directly reduces the import surface callers must understand. Testing the full review pipeline currently requires mocking across four boundaries.
**Concrete next step:** Create `src/main/services/review-action-service.ts` that exports only `{ classifyAction, executeAction }`. Move policy/executor to private helpers not exported from the index. Wire existing callers to the new facade.

---

### Action 9: Decompose `run-agent.ts` into process / tracking / telemetry / completion modules
**Finding IDs:** F-t2-agent-1
**Score:** 4.5
**Summary:** `run-agent.ts` (770 lines) operates simultaneously at four abstraction levels: process lifecycle (spawn/abort/exit), IPC event emission, database I/O (task updates, agent history), and multi-step orchestration pipeline. A test of spawn handling must mock 5+ dependencies.
**Why now:** The highest-churn file in the agent manager. Every sprint touching agent behavior (concurrency, watchdog, retry) currently requires reading the full 770-line context.
**Concrete next step:** Extract `agent-process-handler.ts` (spawn, consume stream, abort, exit code capture) first — it has no DB dependencies and is the clearest seam.

---

### Action 10: Move TearoffChannels out of `src/shared/ipc-channels/ui-channels.ts`
**Finding IDs:** F-t4-sh-1
**Score:** 4.5
**Summary:** `ui-channels.ts` exports `TearoffChannels` (tearoff:create, tearoff:closeConfirmed, zone, viewKey, sourcePanelId) which are renderer-internal multi-window concepts. Main process never registers tearoff:* handlers that need these types.
**Why now:** Pollutes the IPC contract surface. Auditing "what does main actually handle" is harder when renderer-internal broadcast types are in the shared type map.
**Concrete next step:** Move `TearoffChannels` and its associated types to `src/renderer/src/lib/tearoff-channels.ts`. Remove from `IpcChannelMap` in `src/shared/ipc-channels/index.ts`.

---

## Cross-Cutting Themes

### Theme: Facade Inversion — Abstraction Exists but Is Bypassed
**Lenses:** t1-hub (F-t1-hub-6), t1-ipc (F-t1-ipc-2), t2-svc (F-t2-svc-1, F-t2-svc-5), t3-cc (F-t3-cc-1)
**Pattern:** A repository abstraction (`ISprintTaskRepository`), service facade, or hook abstraction exists and is used in some paths, but callers in adjacent code bypass it and import the underlying module directly. The abstraction is present but not enforced.
**Systemic cause:** Abstractions were introduced incrementally (CLAUDE.md acknowledges "partially applied repository pattern"). New code takes the path of least resistance (direct import) because the abstraction doesn't yet cover the full surface area callers need.
**Lenses that saw this:** t1-hub (handlers bypass repo), t1-ipc (renderer orchestrates sprint updates post-review), t2-svc (sprint-service facade is optional), t3-cc (SprintPipeline bypasses navigation abstraction).

---

### Theme: God Objects at Every Layer
**Lenses:** t1-hub (F-t1-hub-4), t2-agent (F-t2-agent-1, F-t2-agent-3), t2-svc (F-t2-svc-3), t3-cc (F-t3-cc-1), t3-sc (F-t3-sc-1), t4-sc (F-t4-sc-1, F-t4-sc-4)
**Pattern:** At each architectural layer — agent manager (`index.ts`), service layer (`workbench-checks-service.ts`), run loop (`run-agent.ts`), renderer component (`SprintPipeline.tsx`), and store (`taskWorkbench.ts`) — there is at least one 350-770 line module absorbing responsibilities that belong in narrower collaborators.
**Systemic cause:** The codebase grew by extension (adding to existing files) rather than composition (extracting new modules). The Boy Scout Rule is stated in CLAUDE.md but god objects suggest it is applied selectively.

---

### Theme: Shared Module Contamination
**Lenses:** t4-sh (F-t4-sh-1, F-t4-sh-2, F-t4-sh-3, F-t4-sh-5), t3-sc (F-t3-sc-5)
**Pattern:** `src/shared/` accumulates renderer-only types (`StatusFilter`, `TearoffChannels`, `DEFAULT_TASK_TEMPLATES`, `ValidationProfile`) that the main process never uses. The shared boundary expands by inertia — it is easier to put a new type in shared than to determine which process owns it.
**Systemic cause:** No linting rule or convention enforces "main process must be able to import shared without pulling renderer concerns." The distinction between "contract types" (need both processes) and "convenience types" (renderer-only) is not enforced at the tooling level.

---

### Theme: Renderer Cross-Domain Navigation Without a Bus
**Lenses:** t3-cc (F-t3-cc-1, F-t3-cc-3), t3-sc (F-t3-sc-7), t4-sc (F-t4-sc-1)
**Pattern:** Components in one domain (SprintPipeline, PlannerView) directly call `getState()` or import stores from another domain (codeReview, taskWorkbench, panelLayout) to coordinate multi-step navigation workflows. No command bus, saga, or navigation service mediates these.
**Systemic cause:** The nine-view panel system encourages views to know about each other's stores for navigation. Without an explicit navigation abstraction (e.g., `useNavigateTo(view, payload)`), ad-hoc cross-domain coupling accumulates.

---

## Quick Wins

High-impact, low-effort items (score >= 4.0, Effort=S):

| Finding ID | Title | Score | What to do |
|-----------|-------|-------|-----------|
| F-t2-svc-3 | WorkbenchChecksService misleading name | 6.0 | Rename to `OperationalChecksService`, add composite pattern comment |
| F-t2-agent-6 | initializeAgentTracking 6 side effects | 6.0 | Extract to `agent-tracking-initializer.ts`; separate setup/persist/wire |
| F-t2-agent-7 | resolveAgentExit chains 4 concerns | 6.0 | Extract `exit-classifier.ts` (pure) as first step |
| F-t2-svc-6 | review-service bundles parsing utilities | 6.0 | Move parsers to `review-response-parser.ts` |
| F-t3-sc-4 | TaskPill uses `getState()` anti-pattern | 6.0 | Replace with `useSprintSelection(s => s.toggleTaskSelection)` |
| F-t4-sh-2 | Task templates in shared/constants | 6.0 | Move to `src/renderer/src/lib/default-templates.ts` |
| F-t2-agent-5 | terminal-handler.ts couples metrics + dep resolution | 4.0 | Extract `terminal-metrics.ts` as pure side-effect module |
| F-t3-cc-5 | AIAssistantPanel nested Zustand selectors | 4.0 | Extract `useAIReviewState()` hook |
| F-t3-cc-6 | FileTreePanel/DiffViewerPanel cross-store | 4.0 | Extract `useReviewFileState()` hook |
| F-t2-svc-2 | 6 spec validator files for small validators | 4.0 | Consolidate into single `validators.ts` with registration |
| F-t4-sh-3 | StatusFilter defined in shared, used only in renderer | 3.0 | Move type definition to `src/renderer/src/stores/sprintFilters.ts` |
| F-t4-sc-2 | SprintUI re-exports StatusFilter from sprintFilters | 3.0 | Remove re-export; callers import from sprintFilters directly |
| F-t4-sh-4 | `agent:completionsPerHour` wrong domain prefix | 2.0 | Rename to `dashboard:completionsPerHour` and `dashboard:recentEvents` |
| F-t2-agent-10 | Stepdown structure missing in run-agent.ts | 2.0 | Add Phase 1/2/3/4 section comments to make flow visible |

---

## Deferred / Out of Scope

Real findings not worth fixing now:

| Finding ID | Title | Reason to defer |
|-----------|-------|----------------|
| F-t1-hub-4 | agent-manager/index.ts black-box facade | L effort, Medium confidence. Massive refactor with behavioral risk; wait for agent-manager stabilization post-SDK options fix |
| F-t2-agent-3 | index.ts drain loop couples 3 concerns | L effort. Correct diagnosis but high churn area — dependency-refresher and terminal handling are still actively evolving |
| F-t4-sc-1 | taskWorkbench store mixes form + validation + persistence | L effort. The three-store split is correct architecturally but touches every workbench component; defer until a focused workbench sprint |
| F-t3-sc-3 | DashboardView imports 6 stores | L effort. The view itself is stable and a facade refactor would be pure boilerplate unless DashboardView becomes a test target |
| F-t2-svc-5 | sprint-service.ts facade layer is optional | Medium effort, Medium confidence. Callers can import sprint-mutations directly but behavior is unchanged; risk/reward unfavorable now |
| F-t4-sc-5 | sprintTasks store mixes optimistic bookkeeping | M effort, Low confidence. Optimistic update logic is tightly coupled to existing store subscribers; isolating it risks breaking the 2s TTL flush behavior |
| F-t4-sh-5 | Shared types export validation-heavy task types | M effort, Medium confidence. SpecType is used by main for storage; the correct subset is unclear without a more targeted audit |
| F-t2-agent-4 | sdk-adapter.ts mixes protocol + spawn | M effort, Medium confidence. Explicitly noted as "in-flux (SDK options fix)" — audit after stabilization |
| F-t2-agent-8 | failTaskWithError centralizes but couples error paths | S effort, Low confidence. The function is a reasonable consolidation point; pure-decision extraction may add ceremony without gain |
| F-t1-ipc-4 | FS and Memory channels near-duplicate | M effort, Medium confidence. Functional distinction (filesystem vs. in-memory store) is real; unification may be misleading rather than clarifying |

---

## Open Questions

1. **Handler cohesion lens was not run.** `lens-handler-coh.md` was planned for team-2 but not produced. The handler layer (29 modules, `src/main/handlers/`) was only viewed through the hub coupling lens (F-t1-hub-6). Are there handler-level god modules or business logic leaks not captured here?

2. **Dependency direction lens was not run.** `lens-depdir.md` was planned for team-1 but not produced. Dependency direction violations (e.g., lower-layer modules importing from higher layers) are a distinct failure mode from hub coupling. The hub lens found symptoms (handlers bypassing repo) but not the full picture.

3. **F-t1-ipc-3 groups index rebuilds vs. F-t1-hub-3 sprint-queries volatility — which is the higher-priority IPC concern?** The groups index rebuild O(n²) issue (F-t1-ipc-3) was rated Medium confidence because the lens couldn't confirm actual group count in production. If users create many epics, this becomes Critical; if typical usage is <10 epics, it can be deferred indefinitely.

4. **useFilteredTasks (F-t3-sc-8) vs. sprintFilters store selector — where does derived state belong?** The lens recommends moving filtering logic into the sprintFilters store, but CLAUDE.md documents `partitionSprintTasks()` as a selector on `sprintTasks`. The canonical home for filtering + partitioning derived state is unresolved across two stores.

5. **F-t2-svc-1 review service consolidation: is the policy-executor split for testability or architecture?** The four-file review service structure may have been intentionally designed for unit testing isolation (policy tests don't need git mocks). Consolidating behind a facade preserves external cohesion but may harm test granularity. The lens assumed testability > isolation; this should be validated before proceeding.

---

## Finding Index

All findings by ID for reference:

| ID | Title | Severity | Effort | Score | Lens File |
|----|-------|----------|--------|-------|-----------|
| F-t1-hub-1 | logger.ts — stable hub (positive) | Medium | N/A | N/A | lens-hub |
| F-t1-hub-2 | db.ts — singleton gateway (stable) | Medium | S | 3.0 | lens-hub |
| F-t1-hub-3 | sprint-queries.ts — volatile barrel | High | M | 4.5 | lens-hub |
| F-t1-hub-4 | agent-manager/index.ts — pipeline hub | High | L | 2.25 | lens-hub |
| F-t1-hub-5 | handlers/registry.ts — intentional hub (positive) | Low | N/A | N/A | lens-hub |
| F-t1-hub-6 | Handlers bypass repository abstraction | Medium | M | 3.0 | lens-hub |
| F-t1-hub-7 | agent-event-mapper dual write coupling | Medium | M | 2.0 | lens-hub |
| F-t1-hub-8 | settings.ts — stable hub (positive) | Low | N/A | N/A | lens-hub |
| F-t1-ipc-1 | Sprint domain 20 fine-grained CRUD channels | High | M | 4.5 | lens-ipc-coupling |
| F-t1-ipc-2 | Review domain bidirectional entanglement | High | M | 4.5 | lens-ipc-coupling |
| F-t1-ipc-3 | Groups domain cascading index rebuilds | Medium | M | 2.0 | lens-ipc-coupling |
| F-t1-ipc-4 | FS and Memory channel duplication | Medium | M | 2.0 | lens-ipc-coupling |
| F-t1-ipc-5 | Workbench 7 channels for single flow | Low | S | 2.0 | lens-ipc-coupling |
| F-t2-agent-1 | run-agent.ts spans 4 abstraction levels | High | M | 4.5 | lens-agent-coh |
| F-t2-agent-2 | completion.ts SRP violation (detect+rebase+commit+merge) | High | M | 4.5 | lens-agent-coh |
| F-t2-agent-3 | index.ts drain loop couples 3 concerns | High | L | 2.25 | lens-agent-coh |
| F-t2-agent-4 | sdk-adapter.ts mixed protocol+spawn | Medium | M | 2.0 | lens-agent-coh |
| F-t2-agent-5 | terminal-handler.ts couples metrics + dep resolution | Medium | S | 4.0 | lens-agent-coh |
| F-t2-agent-6 | initializeAgentTracking — 6 side effects | Medium | S | 6.0 | lens-agent-coh |
| F-t2-agent-7 | resolveAgentExit chains classify→update→terminal→chain | Medium | S | 6.0 | lens-agent-coh |
| F-t2-agent-8 | failTaskWithError centralizes but scatters | Low | S | 1.0 | lens-agent-coh |
| F-t2-agent-9 | 25+ imports in index.ts (diagnostic) | Low | N/A | N/A | lens-agent-coh |
| F-t2-agent-10 | Stepdown structure incomplete in run-agent.ts | Low | S | 2.0 | lens-agent-coh |
| F-t2-svc-1 | Review domain fragmented across 4 service files | High | M | 4.5 | lens-svc-coh |
| F-t2-svc-2 | Spec validators over-fragmented (6 files) | Medium | S | 4.0 | lens-svc-coh |
| F-t2-svc-3 | WorkbenchChecksService is a composite, not a domain | High | S | 6.0 | lens-svc-coh |
| F-t2-svc-4 | Dependency service overloaded with task + epic logic | Medium | M | 3.0 | lens-svc-coh |
| F-t2-svc-5 | sprint-service.ts is an optional facade layer | Medium | M | 2.0 | lens-svc-coh |
| F-t2-svc-6 | review-service.ts bundles parsing utilities | Medium | S | 6.0 | lens-svc-coh |
| F-t2-svc-7 | Data layer query modules — appropriate design (positive) | N/A | N/A | N/A | lens-svc-coh |
| F-t2-svc-8 | batch-import + csv-export incomplete abstraction | Low | N/A | N/A | lens-svc-coh |
| F-t3-sc-1 | SprintPipeline subscribes to 7+ stores | High | M | 4.5 | lens-store-coupling |
| F-t3-sc-2 | HealthCheck cross-imports sprintTasks | Medium | M | 3.0 | lens-store-coupling |
| F-t3-sc-3 | DashboardView imports 6 stores without facade | High | L | 2.25 | lens-store-coupling |
| F-t3-sc-4 | TaskPill uses `getState()` anti-pattern | Medium | S | 6.0 | lens-store-coupling |
| F-t3-sc-5 | FilterPresets type-imports sprintUI | Low | S | 2.0 | lens-store-coupling |
| F-t3-sc-6 | DashboardView mutates multiple filter stores | Medium | M | 2.0 | lens-store-coupling |
| F-t3-sc-7 | PlannerView uses `getState()` for cross-store navigation | Medium | M | 3.0 | lens-store-coupling |
| F-t3-sc-8 | useFilteredTasks couples sprintTasks + sprintFilters | High | M | 4.5 | lens-store-coupling |
| F-t3-cc-1 | SprintPipeline — god component (9 stores, 33 imports) | Critical | L | 3.0 | lens-comp-coupling |
| F-t3-cc-2 | TaskWorkbench — cross-domain orchestrator | High | M | 4.5 | lens-comp-coupling |
| F-t3-cc-3 | ReviewQueue — sprint→codereview cross-domain | High | M | 4.5 | lens-comp-coupling |
| F-t3-cc-4 | WorkbenchForm — 5 hook dependencies | High | M | 4.5 | lens-comp-coupling |
| F-t3-cc-5 | AIAssistantPanel — nested Zustand selector chains | Medium | S | 4.0 | lens-comp-coupling |
| F-t3-cc-6 | FileTreePanel/DiffViewerPanel — cross-store dependency | Medium | S | 4.0 | lens-comp-coupling |
| F-t4-sc-1 | TaskWorkbench store mixes form + validation + persistence | Medium | L | 1.5 | lens-store-coh-and-shared |
| F-t4-sc-2 | SprintUI re-exports StatusFilter from sprintFilters | Low | S | 3.0 | lens-store-coh-and-shared |
| F-t4-sc-3 | LocalAgents store mixes spawning + log polling | Medium | M | 3.0 | lens-store-coh-and-shared |
| F-t4-sc-4 | IDEStore conflates editor + file cache + settings | Medium | M | 3.0 | lens-store-coh-and-shared |
| F-t4-sc-5 | SprintTasks mixes optimistic bookkeeping | Low | M | 1.0 | lens-store-coh-and-shared |
| F-t4-sh-1 | TearoffChannels in shared IPC channels (renderer-only) | High | M | 4.5 | lens-store-coh-and-shared |
| F-t4-sh-2 | DEFAULT_TASK_TEMPLATES in shared/constants | Medium | S | 6.0 | lens-store-coh-and-shared |
| F-t4-sh-3 | StatusFilter defined in shared, renderer-only usage | Low | S | 3.0 | lens-store-coh-and-shared |
| F-t4-sh-4 | `agent:completionsPerHour` wrong domain prefix | Low | S | 2.0 | lens-store-coh-and-shared |
| F-t4-sh-5 | Shared types export renderer-only validation types | Low | M | 1.0 | lens-store-coh-and-shared |
