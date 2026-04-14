# God Module Audit — Synthesis
*Date: 2026-04-13 | Repo SHA: deaf2413e18ef4dc92cd44e2a486c748ae7cef21 | Lenses: 8 (amgr, hdlr, data, stor, comp, hook, type, pre)*

---

## Scoring Reference

Score = (Severity × Confidence) / Effort  
Severity: Critical=4, High=3, Medium=2, Low=1 | Confidence: High=3, Medium=2, Low=1 | Effort: S=1, M=2, L=4  
Ties broken by Severity first, then Effort (smaller wins).

---

## Top 10 Ranked Actions

| Rank | Finding ID(s) | Title | Score | Severity | Effort | Source Lens |
|------|---------------|-------|-------|----------|--------|-------------|
| 1 | F-t1-amgr-4 | Move OAuth check into `_validateDrainPreconditions()` | 9.0 | High | S | lens-amgr |
| 2 | F-t1-hdlr-3 | Extract review path validation utilities to shared module | 6.0 | Medium | S | lens-hdlr |
| 3 | F-t2-stor-7 | Extract WIP policy out of `sprintTasks.launchTask` | 6.0 | Medium | S | lens-stor |
| 4 | F-t2-stor-4 | Add memoized selectors to sprintUI store | 6.0 | Medium | S | lens-stor |
| 5 | F-t2-hook-3 | Inline `useAppInitialization`'s 5 independent effects into App.tsx | 6.0 | Medium | S | lens-hook |
| 6 | F-t2-lib-1 | Merge duplicate `formatElapsed` into canonical `format.ts` | 6.0 | Medium | S | lens-hook |
| 7 | F-t3-type-3 | Convert inline `import()` calls in agent-channels.ts to top-level imports | 6.0 | Medium | S | lens-type |
| 8 | F-t1-hdlr-1 | Extract `workbench:checkOperational` logic to WorkbenchChecksService | 4.5 | High | M | lens-hdlr |
| 9 | F-t1-hdlr-2 | Extract `review:checkAutoReview` rule evaluation to AutoReviewService | 4.5 | High | M | lens-hdlr |
| 10 | F-t1-data-1 | Move sanitizeDependsOn/sanitizeTags to service layer; remove re-sanitization from mapper | 4.5 | High | M | lens-data |

**Notable findings just outside top 10:** F-t2-stor-2 (sprintUI split, 4.5, High/M), F-t2-comp-2 (TopBar batch actions, 4.5, High/M), F-t3-type-1 (SprintTask 46-field interface, 4.5, High/M). All score 4.5 but were edged out by the three-way tie at rank 8–10 resolved by finding IDs.

---

### Rank 1 — F-t1-amgr-4: OAuth check into drain preconditions
`_drainLoop` mixes high-level orchestration with a mid-stream OAuth check at line 430. If OAuth fails mid-loop, the loop silently returns without logging, leaving queued tasks in limbo. `_validateDrainPreconditions()` already exists — move the `checkOAuthToken` call into it with consistent logging. This is a one-function change with high correctness impact.

### Rank 2 — F-t1-hdlr-3: Shared review path validation
Five security-critical helpers (`getRepoConfig`, `validateGitRef`, `validateWorktreePath`, `validateFilePath`, `getWorktreeBase`) are private to `review.ts` but are needed by agent-handlers and workbench. Move them to `src/main/validation/review-paths.ts` so other handlers can import them rather than duplicating or skipping validation.

### Rank 3 — F-t2-stor-7: WIP policy extraction
`sprintTasks.launchTask` enforces the WIP limit inline (lines 317–326), burying a business rule in store plumbing. Extract to `src/renderer/src/lib/wip-policy.ts` (`canLaunchTask(task, activeCount)`), making the rule independently testable without Zustand mocks and reusable from other callsites.

### Rank 4 — F-t2-stor-4: sprintUI selectors
Components call `useSprintUI((s) => s.generatingIds.includes(taskId))` everywhere instead of using a selector. Missing selectors force repeated filter logic in components, causing unnecessary re-renders on unrelated state changes. Add `selectIsGenerating(taskId)`, `selectOpenDrawers`, and filter selector factories to sprintUI.

### Rank 5 — F-t2-hook-3: useAppInitialization kitchen sink
Five independent `useEffect` blocks (cost data, keybindings, panel layout, pending review, filter presets) are bundled with no data flow between them. Inline directly into App.tsx with explanatory comments — each effect is 3 LOC, this improves readability and allows each concern to be modified or removed independently.

### Rank 6 — F-t2-lib-1: formatElapsed duplication
`format.ts:formatElapsed(ms: number)` and `task-format.ts:formatElapsed(startedAt: string)` implement identical logic with different input types. Merge into a single overloaded function in `format.ts` and remove the duplicate from `task-format.ts` to prevent diverging bug fixes.

### Rank 7 — F-t3-type-3: Inline import() in agent-channels.ts
Three cost-related types (`CostSummary`, `AgentRunCostRow`, `AgentCostRecord`) use inline `import()` while all other types in the file use static `import type`. This inconsistency signals a possible papered-over circular dependency. Move to top-level imports and verify no real circular dep exists first.

### Rank 8 — F-t1-hdlr-1: workbench:checkOperational service extraction
A 145-line handler performs 5 independent operational checks (auth, repo path, git status, task conflicts, agent slots) as inline conditional blocks with duplicated error handling. Extract to `src/main/services/workbench-checks-service.ts` with one pure function per check, making each independently testable without mocking the full IPC layer.

### Rank 9 — F-t1-hdlr-2: review:checkAutoReview service extraction
The handler inlines git diff parsing (`git diff --numstat`) and auto-review rule evaluation, duplicating `parseNumstat` logic that already exists in `review-merge-service.ts`. Extract to `src/main/services/auto-review-service.ts`; the handler becomes a 3-line delegate that validates preconditions and calls the service.

### Rank 10 — F-t1-data-1: Sanitization boundary violation
`sanitizeDependsOn` and `sanitizeTags` are called at CREATE time (correct), then called again on every READ in `sprint-task-mapper.ts` and `sprint-agent-queries.ts` (redundant O(n) re-parsing). Move sanitization to service layer entry points; add a comment to the mapper that "DB data is pre-sanitized — mapper assumes valid JSON."

---

## Cross-Cutting Themes

### Theme 1: Business Logic Leaking Across Layers (lens-hdlr, lens-data, lens-stor, lens-hook, lens-pre)
The most prevalent pattern across all 8 lenses: logic embedded in the wrong layer.
- Handlers own orchestration that belongs in services (F-t1-hdlr-1, F-t1-hdlr-2, F-t1-hdlr-5)
- Data layer owns sanitization that belongs at the service boundary (F-t1-data-1)
- Stores own WIP policy and task transition rules that belong in policy objects (F-t2-stor-7, F-t1-data-2)
- Preload owns batch aggregation logic that belongs in main process (F-t3-pre-5)
- Agent manager mixes drain orchestration with OAuth token I/O (F-t1-amgr-4)

### Theme 2: God Aggregators — Single Files Owning Too Many Concerns (lens-amgr, lens-comp, lens-stor, lens-hook, lens-pre, lens-type)
Multiple modules are growing into catch-all containers:
- `_processQueuedTask` in index.ts: 125-line method performing 9 distinct operations (F-t1-amgr-2)
- `SprintPipeline.tsx`: 485 lines subscribing to 6 stores, managing 7 drawers, registering 4 palette commands (F-t2-comp-1)
- `useReviewActions` hook: 393 lines owning 10 actions + modal + state + IPC (F-t2-hook-1)
- `sprintUI` store: 5 semantic categories in 42 fields (F-t2-stor-2)
- `sprintTasks` store: domain mutations + optimistic update machinery + WIP policy (F-t2-stor-1, F-t2-stor-7)
- `SprintTask` interface: 46 fields across 6 lifecycle stages (F-t3-type-1)
- Preload `index.d.ts`: 497-line flat type file (F-t3-pre-3)

### Theme 3: IPC Pattern Inconsistency (lens-pre, lens-type, lens-hdlr)
Three layers of IPC abstraction have diverged from the established patterns:
- `typedInvoke` for request/reply and `onBroadcast` for main→renderer exist, but raw `ipcRenderer.send/on` is scattered in 9+ places (F-t3-pre-4)
- `agentEvents.onEvent` and `terminal.onData` bypass `onBroadcast` with custom listener logic (F-t3-pre-2, F-t3-pre-5)
- Inline `import()` in agent-channels suggests a past circular dependency worked around rather than resolved (F-t3-type-3)

### Theme 4: Selector and Dedup Gaps in Renderer State (lens-stor, lens-hook)
Derived state is computed in components instead of stores, and module-level mutable state is used for dedup:
- `sprintUI` has no memoized selectors, forcing components to repeat filter logic (F-t2-stor-4)
- `useTaskNotifications` uses a module-level `Set` for dedup that survives unmount and cannot be reset in tests (F-t2-hook-6)
- `healthCheck` hook duplicates filtering logic that should be a store selector (F-t2-stor-8)

### Theme 5: Duplication of Parsing and Validation Utilities (lens-hdlr, lens-data, lens-hook)
The same logic appears in multiple places without a canonical home:
- `parseNumstat` defined in both `review.ts` and `review-merge-service.ts` (F-t1-hdlr-2)
- `sanitizeDependsOn` called at CREATE, READ, and QUERY paths (F-t1-data-1)
- `formatElapsed` defined in both `format.ts` and `task-format.ts` (F-t2-lib-1)
- Review path validators private to `review.ts` despite being needed by other handlers (F-t1-hdlr-3)

### Theme 6: Agent Manager Orchestration Fragmentation (lens-amgr — new)
Completion and watchdog logic are split across too many files with no clear ownership:
- `onTaskTerminal` called from 8 callsites with a shared idempotency guard that has a race window (F-t1-amgr-6)
- Dependency index rebuilt in 3 separate places, risking missed unblocking under concurrent completions (F-t1-amgr-7)
- `completion.ts` conflates git operations, task state transitions, auto-merge policy, and failure classification in 479 lines (F-t1-amgr-3)
- Watchdog verdict application split across `watchdog.ts`, `watchdog-handler.ts`, and `index.ts` (F-t1-amgr-5)

---

## Quick Wins

Findings with Score >= 6.0 AND Effort = S:

| Finding ID | Score | Action |
|------------|-------|--------|
| F-t1-amgr-4 | 9.0 | Move `checkOAuthToken` into the existing `_validateDrainPreconditions()` function with a log line on failure |
| F-t1-hdlr-3 | 6.0 | Move 5 review path validation helpers to `src/main/validation/review-paths.ts` |
| F-t2-stor-7 | 6.0 | Extract WIP check from `sprintTasks.launchTask` to `src/renderer/src/lib/wip-policy.ts` |
| F-t2-stor-4 | 6.0 | Add `selectIsGenerating`, `selectOpenDrawers`, and filter factory selectors to sprintUI |
| F-t2-hook-3 | 6.0 | Inline 5 effects from `useAppInitialization` directly into App.tsx |
| F-t2-lib-1 | 6.0 | Merge `task-format.ts:formatElapsed` into `format.ts` with an input-type overload |
| F-t3-type-3 | 6.0 | Convert 3 inline `import()` calls in `agent-channels.ts` to top-level `import type` |

These 7 findings can likely all be addressed in a single focused session (~3 hours total). F-t1-amgr-4 is highest priority because a silent drain-loop exit leaves tasks stuck with no log evidence.

---

## Deferred / Out of Scope

| Finding ID | Title | Reason |
|------------|-------|--------|
| F-t1-amgr-2 | `_processQueuedTask` decomposition | L effort; 9-operation method is high complexity but works correctly. Schedule as a dedicated refactor after quick wins clear the way. |
| F-t1-amgr-3 | `completion.ts` CompletionPipeline extraction | L effort; 479-line module is the highest-risk file in the agent manager but correct. Refactor when adding new completion behavior (e.g., new auto-merge rules). |
| F-t1-amgr-1 | `runAgent` Phase 1/2 intertwining | M effort; prompt assembly and guard phases can be separated, but not urgent. Do this when run-agent.ts next needs a new pre-spawn check. |
| F-t1-amgr-5 | Watchdog verdict application scattered | S effort, Medium confidence; extract `applyWatchdogVerdict()` when extending the verdict type set. |
| F-t1-amgr-6 | `onTaskTerminal` idempotency race | M effort, Medium confidence; race window is narrow (10s). Harden with `Map<taskId, Promise>` pattern before scaling concurrent agents beyond the current WIP limit. |
| F-t1-amgr-7 | Dependency index rebuild scatter | M effort, Medium confidence; correctness risk grows with concurrent completions. Consolidate to drain loop when agent concurrency is increased. |
| F-t2-hook-1 | `useReviewActions` god hook | L effort; highest-impact renderer refactor but the hook works correctly. Schedule as a dedicated sprint task. |
| F-t3-type-1 | SprintTask 46-field god interface | M effort but a breaking change requiring a handler adapter layer. Needs design decision on discriminated union vs. view types before implementation. |
| F-t2-comp-1 | SprintPipeline god component | L effort; extracting `<TaskDetailPane>` and `useSelectedTask()` is valuable but wide. Do incrementally while touching the pipeline for new features. |
| F-t2-comp-2 | TopBar batch action duplication | M effort; 4 nearly-identical handlers create maintenance risk. Extract `<BatchActionHandler>` when adding a fifth batch action. |
| F-t2-comp-3 | AgentsView command routing | M effort; extract `useAgentViewLifecycle()` and `<AgentCommands>` when adding new slash commands. |
| F-t2-comp-4 | IDEView mixed concerns | M effort; extract 4 focused hooks (`useIDEStateRestoration`, `useFileOperations`, `useUnsavedGuard`, `useIDECommands`) when next touching IDEView. |
| F-t2-stor-2 | sprintUI god store split | M effort; wide renderer refactor. Run `useSprintUI` blast-radius grep first. Schedule after quick wins. |
| F-t2-stor-1 | sprintTasks OptimisticUpdateManager | L effort; optimistic machinery works correctly. Address only if sprintTasks becomes a change-risk bottleneck. |
| F-t3-pre-1 | Preload flat namespace (76 props) | M effort but touches every renderer callsite. Group when adding new domains, not as a standalone pass. |
| F-t3-pre-2 | Inconsistent `onBroadcast` usage | M effort; fix `agentEvents.onEvent` and `terminal.onData` to use the factory — do this before F-t3-pre-4. |
| F-t3-pre-3 | `index.d.ts` 497-line type file | Follows naturally from F-t3-pre-1 namespace grouping; defer until preload namespaces are restructured. |
| F-t3-pre-4 | Scattered `ipcRenderer.send()` calls | Implement `safeOn()` factory only after F-t3-pre-2 onBroadcast consistency is addressed first. |
| F-t3-pre-5 | Batch aggregation logic in preload | Correct today; move to main process during a batch-event refactor, not standalone. |
| F-t3-type-2 | AgentMeta conflates process + cost | Valid; requires IPC contract changes across dashboard and history queries. Defer to a cost/metrics refactor sprint. |
| F-t3-type-5 | Task state machine SSoT ambiguity | Add compile-time coverage check and a clarifying comment (S); no behavioral change needed. |
| F-t1-data-2 | State transition validation in data layer | Dual validation is defense-in-depth; document it (S) but do not remove from data layer (risky). |
| F-t1-data-4 | Maintenance function observability | Add logger param and reference `TERMINAL_STATUSES`; do when next touching sprint-maintenance.ts. |
| F-t1-data-5 | Bulk operations error handling | Correct behavior; add JSDoc comments clarifying throw/catch contract when next touching sprint-pr-ops.ts. |
| F-t1-hdlr-5 | sprint:update vs batch handler divergence | Medium duplication risk; acceptable until it becomes a demonstrated bug source. |
| F-t1-hdlr-6 | review.ts query + parse logic | Parsers work correctly; extract to service when review.ts grows or parsed structures need to be shared. |
| F-t2-stor-3 | taskGroups createGroupFromTemplate logic | Works correctly; extract to service when partial-failure policy needs to change. |
| F-t2-stor-5 | taskWorkbench validation/form state mix | Functional; extract validationStore only if staleness bugs appear or more validation types are added. |
| F-t2-stor-6 | gitTree mixed domain/UI | Low blast radius; refactor when git view adds features that need selectedFile in other contexts. |
| F-t3-type-4 | Runtime constant in type file | Cosmetic; move `GENERAL_PATCH_FIELDS` to a constants file when next touching task-types.ts. |
| F-t3-type-6 | IpcChannelMap inline import style | Cosmetic; consistent within its file. Address during a channels reorganization. |
| F-t1-hdlr-7 | Handler registrar type safety | Low confidence; registry.ts is thin and correct. Optional quality improvement only. |
| F-t1-hdlr-8 | review:checkAutoReview naming | Rename to `review:canAutoMerge` when touching review.ts for F-t1-hdlr-2; no standalone value. |
| F-t1-amgr-8 | git-operations.ts hardcoded retry params | Low confidence; extract `RetryableAsyncTask` only if retry parameters need per-deployment tuning. |
| F-t2-hook-2 | `useDesktopNotifications` multiplexing | M effort; split into focused hooks when adding a new notification type (the current preference-drift bug is the only correctness concern). |
| F-t2-hook-4 | `useIDEKeyboard` mixed concerns | M effort; split into `useEditorKeyboard` + `useTerminalKeyboard` when extending IDE keyboard shortcuts. |
| F-t2-hook-5 | `useAppShortcuts` view repetition | Lens flagged as "borderline acceptable as-is"; deduplicate with a lookup table when the shortcut list grows. |
| F-t2-hook-6 | `useTaskNotifications` module-level dedup Set | Move to hook-local state when testability becomes a blocker; current behavior is correct. |
| F-t2-comp-5–10 | TerminalTabBar, WorkbenchForm, DiffViewer, GitTreeView, DashboardView, WorkbenchCopilot | Medium-severity component decompositions; each is a natural incremental refactor, not urgent. |
| F-t2-stor-8 | healthCheck cross-store hook coupling | Acceptable in practice; revisit only if stuck-task detection becomes a render hotspot. |
| F-t2-stor-9 | taskGroups optimistic update revert | Cache `prev` state when next modifying updateGroup; UX flicker on error is minor. |
| F-t2-stor-10 | ide.ts file content eviction | Add eviction only if memory complaints surface. |
| F-t3-pre-6 | Inconsistent broadcast handler signatures | Standardize parameter names when index.d.ts is restructured for F-t3-pre-3. |

---

## Open Questions

1. **F-t3-type-3: inline imports — circular dependency or intentional?** The lens notes the inline `import()` "suggests possible circular dependency that was papered over." Verify before refactoring: run `npx madge --circular src/shared/ipc-channels/agent-channels.ts` to confirm whether top-level imports introduce a real circular dep.

2. **F-t1-hdlr-2 vs F-t1-hdlr-8: numstat deduplication.** The lens flags `parseNumstat` as duplicated between `review.ts` and `review-merge-service.ts`, but does not confirm which is the canonical version or whether they have diverged. Before implementing F-t1-hdlr-2, diff both implementations and verify the service version is a strict superset.

3. **F-t2-stor-2 blast radius: sprintUI consumers.** Splitting sprintUI into 3 stores is a broad renderer refactor. The lens does not enumerate all component consumers of `useSprintUI`. Run `grep -r "useSprintUI" src/renderer --include="*.tsx"` to assess blast radius before scheduling.

4. **F-t1-amgr-6 race window severity.** The idempotency race on `onTaskTerminal` (two completions within 10s) is flagged as Medium confidence. Determine whether this race has been observed in practice (check `~/.bde/bde.log` for double-terminal log entries) before prioritizing the Map<taskId, Promise> fix.

5. **F-t3-pre-1 sequencing relative to F-t3-pre-4.** Grouping the preload namespace (F-t3-pre-1) and introducing `safeOn()` (F-t3-pre-4) are sequential — F-t3-pre-4 should target the grouped namespaces, not the current flat ones. Confirm ordering before planning the preload refactor sprint.

6. **lens-comp finding impact on Top 10.** Five of the comp findings (F-t2-comp-1 through F-t2-comp-5) score 4.5 or higher but all carry M or L effort. SprintPipeline (F-t2-comp-1, L effort, High/High) scores 2.25 — it did not displace any top-10 entry. The comp lens added significant context to Theme 2 (god aggregators) but did not change the top-10 ranking once all 8 lenses were factored in.
