# Clean Architecture Audit — Synthesis Report
**Date:** 2026-04-14  
**Lenses:** 9 (dep-rule, ipc-thin, proc-bound, srp, naming, complexity, cohesion, react-comp, stores)  
**Files examined:** src/main, src/renderer/src, src/shared, src/preload

---

## 1. Overall Grade

**Grade: B−**

The BDE codebase is in solid mid-production shape. The core architectural boundaries (main/preload/renderer separation, IPC type safety, data-layer isolation) are respected throughout, and no lens found category-level correctness defects caused by clean-code violations. The handler layer is largely disciplined — most handlers are genuine thin wrappers — and the agent-manager subsystem shows exemplary stepdown decomposition. The sprint data layer (focused query modules, repository interface) is a model for the rest of the codebase.

What pulls the grade down is a cluster of concentrated violations rather than widespread systemic rot. Three files — `completion.ts`, `useSingleTaskReviewActions.ts`, and `sprint-local.ts` — are flagged independently by 3–4 lenses each, suggesting unchecked accumulation rather than structural design. The Zustand store layer has two correctness-adjacent issues (cross-store coupling, missing memoized selectors) that compound at scale. And a set of mis-located business utilities in `agent-manager/` creates real friction for the dependency graph. None of these are blocking correctness today, but several will become maintenance blockers within 1–2 sprints of continued feature growth if left unaddressed.

---

## 2. Top 10 Ranked Actions

| Rank | Finding ID(s) | Title | Score | Severity | Effort | Source Lens(es) |
|------|--------------|-------|-------|----------|--------|-----------------|
| 1 | F-t3-stores-1 | Move cross-store coupling out of healthCheck store | 12.0 | High | S | stores |
| 2 | F-t1-dep-rule-2 | Move `post-merge-dedup.ts` to `lib/` | 12.0 | Medium | S | dep-rule |
| 3 | F-t2-srp-3 | Extract generic batch action executor in useBatchReviewActions | 9.0 | Medium | S | srp |
| 4 | F-t2-srp-4, F-t2-complexity-1 | Extract retry backoff + failure classification from completion.ts | 9.0 | Medium | S | srp, complexity |
| 5 | F-t3-stores-3 | Replace getUnreadCount action with exported memoized selector | 9.0 | Medium | S | stores |
| 6 | F-t2-complexity-4 | Extract `_scheduleInitialDrain()` from AgentManager.start() | 9.0 | Medium | S | complexity |
| 7 | F-t2-complexity-6 | Extract `AGENT_ID_PATTERN` regex to `lib/validation.ts` | 6.0 | Low | S | complexity |
| 8 | F-t3-stores-2 | Add memoized field selectors to sprintSelection and sprintFilters stores | 4.5 | High | M | stores |
| 9 | F-t1-ipc-thin-1, F-t1-ipc-thin-2, F-t1-ipc-thin-3 | Extract business logic from three IPC handlers (promotion, webhook, checkpoint) | 4.5 | Medium | S×3 | ipc-thin |
| 10 | F-t2-srp-1, F-t3-cohesion-1 | Split completion.ts into focused phase modules | 4.5 | High | M | srp, cohesion |

**Scoring notes:** Score = (Severity × Confidence) / Effort. Severity: Critical=4, High=3, Medium=2, Low=1. Confidence: High=3, Medium=2, Low=1. Effort: S=1, M=2, L=4.

---

### Rank 1 — F-t3-stores-1: Cross-Store Coupling in healthCheck (Score 12.0)

`src/renderer/src/stores/healthCheck.ts` imports and calls a Zustand selector from `useSprintTasks` directly inside the store module. This is a reactive component hook masquerading as a store-level helper. The coupling means that `healthCheck` breaks silently if `sprintTasks` changes shape, and unit tests must mount both stores. Moving `useVisibleStuckTasks()` to a custom hook in `hooks/` is a small, safe, isolated change that eliminates a genuine architectural boundary violation.

### Rank 2 — F-t1-dep-rule-2: Move post-merge-dedup.ts to lib/ (Score 12.0)

`src/main/agent-manager/git-operations.ts` imports `runPostMergeDedup` from `services/post-merge-dedup`, while multiple services import from `agent-manager/git-operations`. This creates an ambiguous circular-style dependency between the services and agent-manager directories. Moving `post-merge-dedup.ts` to `src/main/lib/` resolves the cycle, costs only 2 import-site updates, and is a safe prerequisite for the larger dep-rule cleanup in finding F-t1-dep-rule-1.

### Rank 3 — F-t2-srp-3: Generic Batch Action Executor (Score 9.0)

`src/renderer/src/hooks/useBatchReviewActions.ts` implements the loop-count-toast pattern four times, once per action, with only the API call changing. Extracting `executeBatchAction<T>()` as a generic utility eliminates 60–80 lines of boilerplate duplication and means future batch actions are one-liners. High confidence, small effort, and the fix is self-contained.

### Rank 4 — F-t2-srp-4 + F-t2-complexity-1: Retry Backoff Extraction from completion.ts (Score 9.0)

`src/main/agent-manager/completion.ts:resolveFailure()` inlines the exponential backoff formula and the terminal-retry-limit check directly, inconsistently with `resolveSuccess()` which delegates to helpers. Extracting `calculateRetryBackoff()` into a standalone function (or into `failure-classifier.ts`) is a one-function change that makes retry policy independently testable and removes the silent duplication risk flagged by both the SRP and complexity lenses.

### Rank 5 — F-t3-stores-3: getUnreadCount as Memoized Selector (Score 9.0)

`src/renderer/src/stores/notifications.ts` exposes `getUnreadCount()` as an action method rather than a reactive selector. Components calling this imperatively can hold stale counts across renders. Replacing it with an exported `selectUnreadCount` selector restores Zustand's reactivity guarantee with a trivial two-line change.

### Rank 6 — F-t2-complexity-4: Extract _scheduleInitialDrain() (Score 9.0)

`src/main/agent-manager/index.ts:499–513` wraps deferred orphan recovery in a `setTimeout` → async IIFE → try/catch nesting three levels deep. Extracting this into a named `_scheduleInitialDrain()` method flattens the nesting, makes the startup sequence readable in `start()`, and costs a single function extraction.

### Rank 7 — F-t2-complexity-6: Named AGENT_ID_PATTERN Constant (Score 6.0)

`src/main/handlers/sprint-local.ts:157–162` validates `agentId` with an unnamed inline regex. The pattern comment explains the intent (prevent path traversal), but the regex is not reusable. Moving it to `src/main/lib/validation.ts` as `AGENT_ID_PATTERN` / `isValidAgentId()` makes it importable, testable, and discoverable by other handlers.

### Rank 8 — F-t3-stores-2: Memoized Field Selectors for Sprint UI Stores (Score 4.5)

`sprintSelection.ts` and `sprintFilters.ts` export no selectors at all. Every subscriber uses `useShallow` over multi-field objects, which masks over-subscription: a `searchQuery` change causes components waiting only for `statusFilter` to re-render. Adding per-field exported selectors is a straightforward mechanical change that scales with the codebase and prevents compounding performance issues.

### Rank 9 — F-t1-ipc-thin-1/2/3: Extract Three Handler Business Logic Blobs (Score 4.5)

Three IPC handlers contain business logic that belongs in services: `agent-handlers.ts` (commit validation + title derivation for promotion), `webhook-handlers.ts` (HMAC signing + HTTP delivery for test webhooks), and `agent-manager-handlers.ts` (staged-diff check + message normalization for checkpoints). Each is an S-effort extraction into a new service file. These are independent changes that can be parallelized; ranking them together because they share the same pattern and priority tier.

### Rank 10 — F-t2-srp-1 + F-t3-cohesion-1: Split completion.ts (Score 4.5)

`src/main/agent-manager/completion.ts` is flagged by four lenses (SRP, cohesion, complexity, naming) as a god module bundling success resolution, failure/retry, rebase orchestration, PR creation, and auto-merge evaluation across 472 LOC. Splitting into `resolve-completion.ts`, `auto-merge-coordinator.ts`, and `review-transition-orchestrator.ts` with a thin dispatcher is the correct structural fix — and unblocks several of the lower-ranked findings that all touch this file. Ranked here (not higher) because the effort is M and the correctness risk of the refactor is non-trivial; it should be preceded by strengthening test coverage of the existing behavior.

---

## 3. Cross-Cutting Themes

### Theme A: `completion.ts` Is a Hotspot (4 lenses)
`src/main/agent-manager/completion.ts` is the single most-cited file in this audit. It is flagged by:
- **SRP lens** (F-t2-srp-1, F-t2-srp-4, F-t2-srp-10): phases not separated, failure/success patterns inconsistent, retry logic inlined
- **Cohesion lens** (F-t3-cohesion-1): 472 LOC mixing 5 independent workflows
- **Complexity lens** (F-t2-complexity-2, F-t2-complexity-3): context object re-fragmented, hasCommitsAheadOfMain has side effects
- **Naming lens** (F-t2-naming-4): "RunAgentTask" terminology ambiguous with sprint tasks

This file is the product of incremental growth rather than deliberate design. It should be treated as a refactoring target in the next available sprint, with coverage added first.

### Theme B: Agent-Manager Namespace Leakage (2 lenses)
Both the dep-rule and cohesion lenses independently flag that `agent-manager/` has become a grab-bag: `git-operations.ts`, `prompt-composer.ts`, and `resolve-dependents.ts` are imported by services and handlers that are not part of the agent orchestration engine. This creates inbound dependency rule violations and makes the agent-manager harder to isolate. A `src/main/utils/` or `src/main/operations/` layer would clarify intent.

### Theme C: Zustand Store Correctness (1 lens, 2 findings)
Two store findings are architecturally consequential: `healthCheck` importing `useSprintTasks` (cross-store coupling) and missing field selectors in `sprintSelection`/`sprintFilters` (over-subscription). These are in the same lens but represent different failure modes — the first is an architectural boundary violation, the second a scalability tax. Both are easily fixed and should not wait.

### Theme D: `useSingleTaskReviewActions` Is a God Hook (2 lenses)
`src/renderer/src/hooks/useSingleTaskReviewActions.ts` is flagged by:
- **SRP lens** (F-t2-srp-2, F-t2-srp-7): 250+ lines owning state, modals, polling, 6 actions, and navigation
- **Cohesion lens** (implicitly, as a result of the review actions coupling)

The hook violates the "one reason to change" rule at scale — adding a new review action, changing confirmation UX, or updating navigation logic all require editing the same file. Splitting into `useReviewActionState()`, `useReviewActionModals()`, and per-action hooks is the right direction, but effort is L and should be sequenced after test coverage is added.

### Theme E: Handler Business Logic Accumulation (1 lens, 3 files)
The IPC handler thinness audit found that three older handler files (`agent-handlers.ts`, `webhook-handlers.ts`, `agent-manager-handlers.ts`) each contain one logical block of business logic that predates the current thin-handler convention. The pattern is not systemic — most handlers are correct — but the violations are in high-traffic areas and each requires its own service extraction.

---

## 4. Quick Wins

Items with Score >= 6.0 AND Effort=S:

- [ ] **F-t3-stores-1** — Move `useVisibleStuckTasks()` from `healthCheck.ts` to `hooks/useVisibleStuckTasks.ts`
- [ ] **F-t1-dep-rule-2** — Move `post-merge-dedup.ts` from `agent-manager/` to `src/main/lib/`
- [ ] **F-t2-srp-3** — Extract `executeBatchAction<T>()` from `useBatchReviewActions.ts`
- [ ] **F-t2-srp-4** — Extract `calculateRetryBackoff()` from `completion.ts:resolveFailure()`
- [ ] **F-t3-stores-3** — Replace `getUnreadCount()` action with `selectUnreadCount` selector in `notifications.ts`
- [ ] **F-t2-complexity-4** — Extract `_scheduleInitialDrain()` from `AgentManager.start()`
- [ ] **F-t2-complexity-6** — Move inline path-traversal regex to `src/main/lib/validation.ts` as `isValidAgentId()`
- [ ] **F-t3-cohesion-4** — Stop re-exporting disk-space and file-lock from `worktree.ts`; callers import directly
- [ ] **F-t3-stores-5** — Replace inline activeCount filter in `launchTask()` with `selectActiveTaskCount`
- [ ] **F-t1-proc-bound-3** — Fix stale comment on dashboard IPC channel namespace in `ui-channels.ts`
- [ ] **F-t1-proc-bound-4** — Wrap `agent:event:batch` payload in an object type for consistency

---

## 5. Deferred / Out of Scope

**F-t1-dep-rule-3 — Full utilities layer extraction (Effort L, Confidence Medium)**  
Moving `git-operations.ts`, `prompt-composer.ts`, and `resolve-dependents.ts` out of `agent-manager/` into a new `src/main/utils/` or `src/main/operations/` layer is the correct long-term fix, but it's blocked on F-t1-dep-rule-2 and requires 8+ import-site updates with careful regression testing. Defer to a dedicated refactoring sprint; it's not urgent while the inbound violations are isolated.

**F-t2-naming-4 — Rename RunAgentTask → SprintTaskClaim (Effort L)**  
The terminology mismatch between sprint tasks and agent runs is real, but the rename propagates through drain-loop, message-consumer, completion, and all active-agents tracking. This is correctness-neutral and should wait until the completion.ts split (Rank 10) is completed; the refactor there will naturally expose the right abstraction boundaries.

**F-t2-naming-7 — IPC channel naming standardization (Confidence Low)**  
Renaming channels like `review:shipIt` → `review:mergeAndPush` is cosmetic and low-confidence. Channels are machine-verified by TypeScript and are not user-facing strings. Not worth the churn of touching 30+ call sites across preload, handlers, and stores.

**F-t3-stores-4 — Extract window.api calls from Zustand stores (Effort L)**  
The pattern of stores calling `window.api.*` directly is widespread and documented as the current architecture. Extracting a renderer-side service layer is the right eventual shape, but it's a large cross-cutting refactor with no urgent functional cost. Defer to a dedicated architectural sprint.

**F-t2-complexity-7 — github-fetch.ts module-level singleton state (Confidence Low)**  
Rate-limit state via a module-level singleton is technically a testability concern, but the lens explicitly deferred it pending independent tracking needs. Not actionable now.

**F-t3-react-comp-3 — SprintPipeline refactor (Effort L, Confidence Medium)**  
The component correctly delegates to sub-components and extracted hooks. The remaining coordination concerns are inherent to a pipeline orchestration view. The refactor is low-risk but large and does not unblock any other work. Defer.

**F-t2-srp-2 — Split useSingleTaskReviewActions (Effort L)**  
Real violation, but the L effort and the need for strong test coverage first places this beyond the next 1–2 sprints. The quick wins in Rank 9 and the batch executor extraction address the most egregious duplication; the full hook split can follow.

---

## 6. Open Questions

**Q1: Are tearoff payload shapes actually mismatched at runtime? (F-t1-proc-bound-2)**  
The proc-bound lens reported that `api-utilities.ts` and `broadcast-channels.ts` define different field names for `tearoff:tabRemoved` (`sourcePanelId/sourceTabIndex` vs `windowId/view`). If this is a live mismatch, it is a correctness bug affecting tearoff window drag-drop. Needs verification by comparing what the main process actually sends against what the preload type claims. High priority to confirm or rule out before closing.

**Q2: Does F-t1-proc-bound-5 reflect a safeOn/safeHandle mismatch in practice?**  
The lens noted that `tearoff:returnToMain` and `tearoff:dropComplete` are typed as request/reply in channel definitions but implemented as one-way `ipcRenderer.send()` calls in the preload. If the main-side handler was registered with `safeHandle()` (invoke), there is a runtime mismatch. Needs inspection of `registry.ts` and the tearoff handler to confirm whether `safeOn()` or `safeHandle()` is actually used.

**Q3: Is `sprint-local.ts` the right unit of concern, or is the handler-per-file pattern mature enough to split now?**  
The SRP lens recommends splitting `sprint-local.ts` (11 handlers, 4 domains) into sub-modules. However, the CLAUDE.md baseline intentionally consolidated sprint IPC into one file. Before splitting, confirm whether the 4 domains genuinely have different rates of change. If CRUD, workflows, and inspection all change together (likely during sprint system evolution), the split may add cost without benefit.

**Q4: Is the `RunAgentTask` / sprint task terminology ambiguity causing actual bugs?**  
The naming lens identified that `RunAgentTask` is used as both a sprint task reference and a runtime claim. In retry scenarios, multiple `RunAgentTask` instances exist for the same `taskId`. Does the `activeAgents` Map (keyed by `taskId`) correctly handle concurrent retries, or does the second attempt overwrite the first? This could be a latent correctness issue worth a targeted code review even if the rename is deferred.

**Q5: Does `checkTaskDependencies()` in `dependency-service.ts` create a temporary index rather than reusing the persistent one?**  
The SRP lens flagged that `checkTaskDependencies()` (line 206) constructs a fresh dependency index rather than using the in-memory `DependencyIndex` from context. If true, this is a performance and consistency issue — dependency checks could diverge from the cached index used by the drain loop. Needs verification against the actual implementation before deciding whether to promote this finding.
