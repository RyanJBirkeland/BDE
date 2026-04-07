# Architectural Engineer — Team Alpha — BDE Audit 2026-04-07

## Summary

Team Alpha's surfaces (Task Workbench, Sprint Pipeline, Code Review, dependencies, sprint data layer) are structurally ambitious but carry load-bearing inconsistencies that will hurt the next 6 months. The sprint data layer has swollen to ~1,160 lines with SELECT column lists copy-pasted ~11 times, a repository interface that silently drops the atomic WIP-check parameter, two independent in-memory dependency indexes that can drift, and two migrations (v17, v20) that silently delete the `idx_sprint_tasks_claimed_by` and `idx_sprint_tasks_pr_number` indexes created in v15. The state machine (`VALID_TRANSITIONS`) disagrees with what the agent manager and handlers actually do (no `active → blocked`, no `active → review` for cancelled/error recovery in several paths, `review` accepted but some write paths don't route it through `_onStatusTerminal`). Polling uses `listTasksRecent()` (7-day window) as the only renderer data source, so any task older than 7 days becomes invisible in the UI while dependency, PR, and orphan logic still reference them. The task-workbench copilot is well-sandboxed, but readiness-check semantic gating happens in `sprint:update` (SDK call from an IPC handler, no timeout isolation from the UI) and is duplicated 1:1 in `sprint:batchUpdate` and `sprint:unblockTask`. Code Review actions each call `loadData()` (full `sprint:list`) after every click — multiplied by the polling loop this is several hundred rows of round-trip per interaction.

## Findings

### [CRITICAL] Repository interface drops `maxActive` — atomic WIP enforcement is unreachable from AgentManager

- **Category:** Race Condition
- **Location:** `src/main/data/sprint-task-repository.ts:28`, `src/main/data/sprint-queries.ts:433-524`, `src/main/agent-manager/index.ts:369-371`
- **Observation:** `sprint-queries.claimTask(id, claimedBy, maxActive?)` contains a carefully-designed TOCTOU-safe transaction that counts active tasks and rejects the claim if `count >= maxActive`. But `ISprintTaskRepository.claimTask(id, claimedBy)` only exposes the two-arg form, and `AgentManager._claimTask()` calls `this.repo.claimTask(taskId, EXECUTOR_ID)` — the atomic path is dead code from the agent manager. WIP enforcement in the drain loop falls back to a separate `getActiveTaskCount()` call before claiming, which is not transactional with the UPDATE.
- **Why it matters:** Two concurrent drains (or external writers) can both see `count < max`, both claim, and both spawn agents, violating `MAX_ACTIVE_TASKS`. The defensive code exists but is unused.
- **Recommendation:** Either (a) extend the interface to take `maxActive` and thread it through, or (b) delete the unused parameter and document that WIP is enforced only pre-UPDATE — then audit all sites that assume atomicity. Prefer (a).

### [CRITICAL] Two independent dependency indexes that can drift

- **Category:** Fragility / Coupling
- **Location:** `src/main/agent-manager/index.ts:258,286,386,468,655,665,805` and `src/main/services/task-terminal-service.ts:25-45`
- **Observation:** `AgentManager` maintains `this._depIndex` (rebuilt in `start()`, incrementally updated on drain via `.update()`/`.remove()`, consulted for `_checkAndBlockDeps` on every claim). `TaskTerminalService` creates its own `depIndex` and `rebuildIndex()`s it on every `onStatusTerminal` call. These two indexes never share state. When `config.onStatusTerminal` is set (the normal production wiring), the agent manager's index is used only for pre-claim checks; when it is not set, the agent manager uses its own index inline at line 386.
- **Why it matters:** Two sources of truth for the same graph is the textbook fragility shape. If the incremental updates at line 655/665 ever diverge from the full rebuild in `TaskTerminalService`, nothing will notice until a dependent task sits wedged in `blocked` forever. At 10x task volume the "rebuild on every terminal event" cost in `TaskTerminalService` (`getTasksWithDependencies()` = full table scan) compounds.
- **Recommendation:** One index, owned by `TaskTerminalService` or a new `DependencyGraphService`, injected into both the drain loop and terminal path. Kill the `_depIndex` field on `AgentManager`.

### [CRITICAL] Migrations v17 and v20 silently delete `claimed_by` and `pr_number` indexes

- **Category:** Migration Risk / Performance
- **Location:** `src/main/db.ts:443-445` (v15 creates them), `:504-522` (v17 recreates the table), `:594-612` (v20 recreates the table)
- **Observation:** v15 creates three indexes: `idx_sprint_tasks_status`, `idx_sprint_tasks_claimed_by`, `idx_sprint_tasks_pr_number`. v17 and v20 both do the full SQLite CHECK-constraint dance (CREATE new table → INSERT SELECT → DROP old → RENAME). In both cases the index-recreation block only recreates `idx_sprint_tasks_status`. After v20 runs, `claimed_by` and `pr_number` are unindexed.
- **Why it matters:** `getOrphanedTasks(claimedBy)` (line 866), `markTaskDoneByPrNumber`/`markTaskCancelledByPrNumber` (lines 620, 704), `updateTaskMergeableState` (line 811), and `listTasksWithOpenPrs` (line 788) all become full table scans. The sprint PR poller hits these every 60s. As the DB grows (audit trail, task history, `review_diff_snapshot`) this gets linearly worse.
- **Recommendation:** Add migration v36 that idempotently re-creates `idx_sprint_tasks_claimed_by` and `idx_sprint_tasks_pr_number`, and add a post-migration invariant check that asserts expected indexes exist.

### [CRITICAL] Renderer only sees last-7-day tasks but treats it as the full set

- **Category:** Boundary Violation / Data Integrity
- **Location:** `src/main/handlers/sprint-local.ts:84-86` (`sprint:list` → `listTasksRecent()`), `src/main/data/sprint-queries.ts:216-234`, `src/renderer/src/stores/sprintTasks.ts:65`
- **Observation:** `sprint:list` returns `listTasksRecent()`, which filters out `done/cancelled/failed/error` tasks whose `completed_at < now - 7 days`. The renderer's `useSprintTasks` store treats the result as the canonical task list, and `partitionSprintTasks`, the dependency picker, the DAG overlay, the conflict drawer, and the batch operations all iterate it. Meanwhile, the main process uses the full `listTasks()` for dep checks, orphan recovery, cycle detection, PR polling, etc.
- **Why it matters:** Dependencies targeting an old completed task render as "missing" in the renderer's DependencyPicker but still resolve correctly in main. UI can't show history beyond 7 days. A dependency referenced by id but not in `tasks` map silently becomes a blank row. Diverging views of "what tasks exist" is a recipe for ghost bugs.
- **Recommendation:** Either (a) add a second paginated IPC (`sprint:listFull`) for views that need full history, (b) make the limit explicit (`sprint:list({ since?: Date })`), or (c) document unambiguously that the renderer's `tasks` is "last 7 days only" and audit every consumer.

### [MAJOR] `VALID_TRANSITIONS` disagrees with the code that exercises it

- **Category:** Fragility
- **Location:** `src/shared/task-transitions.ts:1-11`, `src/main/handlers/sprint-local.ts:134-180`, `src/main/agent-manager/resolve-dependents.ts:67`
- **Observation:** The state machine allows `backlog → blocked` but not `queued → blocked` via manual update in the handler (the `sprint:update` path rewrites `patch.status = 'blocked'` when transitioning to `queued` and deps are unsatisfied — which is `queued → queued → blocked` and passes because `queued → blocked` is allowed, ok). But `review → blocked` is NOT in the set, yet a task in `review` whose upstream becomes unsatisfied via cascade cancellation in `resolve-dependents.ts:67` calls `updateTask(depId, { status: 'cancelled' })` — that's fine for cancel, but the cascade also inspects `task.status !== 'blocked'` and skips `review` dependents entirely. `done → cancelled` is allowed but there is no forward path once cancelled (empty set). More importantly: `active → blocked` is NOT allowed, so a running task can never be blocked by a new upstream, and `failed/error → blocked` is not allowed either, so failed tasks that should wait for a fix can't be re-parked.
- **Why it matters:** The "enforce at data layer" promise in CLAUDE.md is only partly met. Every new feature that invents a transition will trip this. Cancellation cascades through blocked dependents but silently no-ops on `review` dependents even though a review could still be waiting on an upstream that just failed.
- **Recommendation:** Make `VALID_TRANSITIONS` the single source of truth and write a test that enumerates every `updateTask({ status })` call-site to assert the transition is declared. Add `review → blocked` and `active → blocked` if you want those to work.

### [MAJOR] Terminal status resolution uses a module-level mutable function pointer

- **Category:** Boundary Violation / Fragility
- **Location:** `src/main/handlers/sprint-local.ts:75-79`, `:189-197`, `:518-532`
- **Observation:** `_onStatusTerminal` is a module-level `let` pointer set via `setOnStatusTerminal()` at bootstrap. `sprint:update` and `sprint:batchUpdate` both check `if (!_onStatusTerminal)` and merely log a warning — the task silently enters terminal state with no dependency resolution. There is no guarantee of initialization order; a faster IPC call during startup will lose dependency resolution forever (the task is already `done`, the `done → ...` set is empty, it never retriggers).
- **Why it matters:** Silent data corruption at startup. "Warning, will not fire" is not an error state; it is a bug. The service pattern was clearly intended to fix this but the hook-up is loose.
- **Recommendation:** Construct `TaskTerminalService` in bootstrap before IPC handlers register, inject it into the handler module via `registerSprintLocalHandlers(terminalService)`, and throw if missing. Remove the module-level mutable pointer.

### [MAJOR] Copy-pasted 35-column SELECT lists across 11+ query functions

- **Category:** Fragility / Maintainability
- **Location:** `src/main/data/sprint-queries.ts` — lines 165, 188, 373, 452, 494, 537, 627, 666, 711, 750, 792, 844, 870, 906
- **Observation:** The same `id, title, prompt, repo, status, priority, depends_on, spec, notes, pr_url, pr_number, pr_status, pr_mergeable_state, agent_run_id, retry_count, fast_fail_count, ...` list is copy-pasted in every SELECT and every RETURNING. Some variants drop `assigned_reviewer`; some drop `cross_repo_contract`; `updateTask`'s RETURNING at line 373 silently omits `assigned_reviewer` and `cross_repo_contract` and `rebase_base_sha` and `rebased_at` — so the returned task after `updateTask()` is missing fields that `getTask()` would have returned, which means optimistic updates can appear to "revert" rebase data.
- **Why it matters:** Every new column requires 11+ edits. At least one drift has already happened. At 10x schema churn the bug rate compounds. This is textbook "works but one edit from breaking."
- **Recommendation:** Extract a `SPRINT_TASK_COLUMNS` constant and a `rowToTask(row)` helper. Use `SELECT *` sparingly if you prefer, but at minimum centralize the column list. Add a test that does `INSERT ... RETURNING *` and asserts all columns are present.

### [MAJOR] `updateTask` audit-trail comparison uses JSON-stringified old task but non-serialized new patch

- **Category:** Error Path / Fragility
- **Location:** `src/main/data/sprint-queries.ts:329-398`, `src/main/data/task-changes.ts:33-43`
- **Observation:** `updateTask` passes `oldTask` (sanitized — booleans as `true/false`, depends_on as array) and `auditPatch` (original values or sanitized for depends_on/tags) to `recordTaskChanges`. Inside `recordTaskChanges`, both sides are `JSON.stringify`'d and compared. But for `playground_enabled`, the OLD row comes from `sanitizeTask()` which already coerced `1/0` → `true/false`, while the new patch value from the UI is `true/false` too — fine. But for a round-trip where the old value is missing (e.g. `undefined`), JSON.stringify of `undefined` is literally `undefined` (not the string `"undefined"`), meaning `JSON.stringify(undefined) === JSON.stringify(null)` evaluates to `false === true` — both are falsy-ish but not equal. More subtly, `recordTaskChanges` also logs `_deleted` events by stringifying the full task row — any new field with an object/Date not serializable cleanly will break audits silently.
- **Why it matters:** Audit trail is the only source of truth once `review_diff_snapshot` is pruned. Lost or duplicate audit rows destroy the "why did this change" story the UI depends on.
- **Recommendation:** Normalize both sides through a single `serializeForAudit()` function. Add a test that `updateTask()` with a no-op patch produces zero audit rows.

### [MAJOR] `sprint:update` does SDK semantic check synchronously inside an IPC handler

- **Category:** Performance / Error Path
- **Location:** `src/main/handlers/sprint-local.ts:152-166`, `:318-330` (unblock), `:497-513` (batch)
- **Observation:** Every transition to `queued` calls `checkSpecSemantic()`, which runs an SDK query. The IPC handler awaits this before returning. No timeout. No cancellation token. The same block is copy-pasted three times across `sprint:update`, `sprint:unblockTask`, and `sprint:batchUpdate`. In batch mode it runs sequentially per task.
- **Why it matters:** A single misbehaving SDK call freezes the Workbench submit button indefinitely. Batch-queueing 10 tasks is 10 × SDK calls serially — many seconds of UI stall. No structured error surface.
- **Recommendation:** Extract to `validateForQueue(task, patch)` in a service module. Add `AbortController` / timeout. Consider running semantic checks client-side via the existing `workbench:chatStream` readiness pipeline so by the time the user clicks Queue, the check is cached.

### [MAJOR] Code Review actions all call `loadData()` — full-table poll per click

- **Category:** Performance
- **Location:** `src/renderer/src/components/code-review/ReviewActions.tsx:72,100,128,174,189,214`
- **Observation:** Every action (ship, merge, createPr, revise, rebase, discard) calls `loadData()` after success. That reloads ALL sprint tasks via `sprint:list` — 7-day window, but still every row. The store already has optimistic update logic; these calls bypass it.
- **Why it matters:** With 200 tasks in the window, one click = 200 rows marshaled across IPC even though only one task changed. Combined with the 60s polling loop and the `sprint:externalChange` file watcher, the app fetches the same data three different ways per mutation.
- **Recommendation:** After a review action, trigger `sprint:externalChange` once and let the debounced polling/watch handle it, OR return the updated task from the `review.*` IPCs and merge it into the store.

### [MAJOR] `sanitizeDependsOn` silently drops deps with unknown `type` — but `TaskDependency` has an optional `condition` field that can make `type` redundant

- **Category:** Fragility
- **Location:** `src/shared/sanitize-depends-on.ts:27-34`, `src/shared/types.ts:41-44`, `src/main/agent-manager/dependency-index.ts:82-97`
- **Observation:** `TaskDependency` now has `{id, type: 'hard'|'soft', condition?: 'on_success'|'on_failure'|'always'}`. The condition-based logic in `areDependenciesSatisfied` treats `condition` as primary and `type` as a fallback. But `sanitizeDependsOn` REJECTS any dep where `type !== 'hard' && type !== 'soft'` — so a future migration that sets `condition` and leaves `type` missing/invalid will silently erase the dep at load time. The "required" field is structural debt: the code wants to drop `type` in favor of `condition`, but the sanitizer is a tripwire on that migration.
- **Why it matters:** This is the shape of code that "works but is one edit from breaking." The next engineer who tries to enforce condition-based deps will lose data silently and only notice when blocked tasks don't unblock.
- **Recommendation:** Make `type` optional with default `'hard'` if `condition` is present, or decide `type` is canonical and remove `condition`. Pick one representation and delete the other.

### [MAJOR] Polling merge uses naive fingerprint; SSE merge diverges from poll merge

- **Category:** Coupling / Fragility
- **Location:** `src/renderer/src/stores/sprintTasks.ts:73-138` (loadData), `:363-388` (mergeSseUpdate)
- **Observation:** Two different merge paths, each with its own "preserve pending fields" logic. `loadData` uses a `Map<id, task>` rebuild; `mergeSseUpdate` mutates in place with `.map()`. Both inline the 2-second TTL check. If one ever gets a bug fix the other won't. The polling fingerprint only compares `id:updated_at` — pending optimistic updates that touch the DB's `updated_at` trigger will invalidate the fingerprint even when nothing visibly changed.
- **Why it matters:** Any future "field preserved by optimistic update" bug has to be fixed in two places. Hidden second source of truth.
- **Recommendation:** Extract `mergeTaskUpdate(state, incoming, pending)` and call it from both paths.

### [MAJOR] `SprintPipeline.tsx` 675-line orchestrator with 18+ store subscriptions and 6 `useMemo` layers

- **Category:** Coupling / Performance
- **Location:** `src/renderer/src/components/sprint/SprintPipeline.tsx:40-460`
- **Observation:** The component subscribes to `useSprintTasks` (3 selectors + useShallow object), `useSprintUI` (useShallow object + 9 individual selectors), `usePanelLayoutStore`, `useTaskWorkbenchStore`, `useSprintEvents`, `useVisibleStuckTasks`, `useCodeReviewStore`, `useCommandPaletteStore`. It then derives `filteredTasks`, `partition`, `filteredPartition`, `selectedTask`, `conflictingTasks`, `headerStats` — five chained `useMemo`s over the task list. On every poll (every 60s) the entire chain re-runs. The `filteredPartition` switch statement (lines 250-327) is a 78-line case analysis that returns 7 different partial objects — each creates a new object identity even when the selected filter hasn't changed, busting downstream memoization in `PipelineStage`.
- **Why it matters:** React reconciliation + framer-motion `LayoutGroup` over 200 tasks already shows visible jank in stress tests. Adding another feature (e.g., grouping by tag) means adding another `useMemo` link to a chain that is already one of the longest in the codebase.
- **Recommendation:** Extract partition derivation into a selector or custom hook (`usePipelinePartition()`) that returns stable references when inputs are unchanged. Use `useSyncExternalStore` with a selector that returns partitioned data, computed lazily.

### [MAJOR] `sprint:batchUpdate` bypasses `UPDATE_ALLOWLIST` in favor of `GENERAL_PATCH_FIELDS`

- **Category:** Boundary Violation
- **Location:** `src/main/handlers/sprint-local.ts:441`, `:467-470`, `src/shared/types.ts:509` vs `src/main/data/sprint-queries.ts:61-99`
- **Observation:** `sprint:update` filters patches through `UPDATE_ALLOWLIST` (34 fields). `sprint:batchUpdate` filters through `GENERAL_PATCH_FIELDS` — a separate set that started in `shared/types.ts`. These are intended to be subsets but there's no typing that enforces they match. Any new column added to `UPDATE_ALLOWLIST` must be manually mirrored to `GENERAL_PATCH_FIELDS`.
- **Why it matters:** Fields that are updatable via single-update silently fail via batch, or vice versa. A field added to one but not the other is a silent "this sometimes works" bug.
- **Recommendation:** Define one canonical `UPDATABLE_TASK_FIELDS` in `shared/`, derive both allowlists from it (`GENERAL_PATCH_FIELDS = UPDATABLE_TASK_FIELDS \ INTERNAL_FIELDS`), and add a test asserting the subset relationship.

### [MINOR] IPC channel count is 144, not 138

- **Category:** Performance / Surface Bloat
- **Location:** `src/shared/ipc-channels.ts` (888 lines)
- **Observation:** CLAUDE.md says ~138 channels; current count via `: {$` pattern is 148 (subtracting nested object opens gives ~144 channels). That's not excessive for an Electron app of this scope, BUT 19 channels start with `sprint:` and 11 with `review:` — the two slices that Team Alpha owns already account for 20% of the surface. Several are redundant: `sprint:list` and `sprint:externalChange`-triggered reload fetch the same data; `sprint:batchUpdate` and `sprint:update` could be one channel with an array arg; `sprint:exportTasks` and `sprint:exportTaskHistory` share 80% logic.
- **Why it matters:** Every channel is a contract, a preload bridge entry, and a test target. At 144 channels the preload bridge is already hard to audit.
- **Recommendation:** Consolidate `sprint:update` / `sprint:batchUpdate` into one call and let the handler branch. Fold `sprint:export*` variants into one with a `kind` parameter. Update CLAUDE.md count.

### [MINOR] `AgentManager._checkAndBlockDeps` throws on malformed `depends_on` — then catches its own throw to set error status — then another catch

- **Category:** Error Path
- **Location:** `src/main/agent-manager/index.ts:460-505`
- **Observation:** Nested try/catch with "best-effort" swallowing. If the FIRST `updateTask` to set `error` throws, the outer catch logs and returns `true` — the task stays `queued` but `_processingTasks.has(taskId)` is cleared at the end, so the drain loop retries it, hitting the same malformed-data error forever. No backoff. No escalation.
- **Why it matters:** One bad row → infinite CPU loop in the drain.
- **Recommendation:** On hard parse failure, track the task id in a `_poisoned` set and refuse to touch it again until a reload.

### [MINOR] `task-changes` audit table has no FK to `sprint_tasks.id`

- **Category:** Data Integrity
- **Location:** `src/main/db.ts:394-407`
- **Observation:** `task_changes.task_id` is `TEXT NOT NULL` with no `REFERENCES sprint_tasks(id) ON DELETE CASCADE`. `deleteTask()` in sprint-queries.ts:411 logs a `_deleted` row but does not prune prior history. Over time, audit rows accumulate for deleted tasks and nothing cleans them — `pruneOldChanges` only trims by date.
- **Why it matters:** `task_changes` grows unbounded with orphaned history. Queries for "what ever happened to task X" return rows even after the task and all its context are gone.
- **Recommendation:** Either CASCADE delete (losing audit), or mark orphan rows explicitly, or run a periodic "prune orphaned audit rows older than N days" alongside the snapshot pruner.

### [MINOR] `listTasksWithOpenPrs` ORDER: no bound — full scan already unindexed after v20

- **Category:** Performance
- **Location:** `src/main/data/sprint-queries.ts:788-809`
- **Observation:** `WHERE pr_number IS NOT NULL AND pr_status = 'open'` with no index (the `pr_number` index from v15 was dropped in v17/v20). Called every 60s by the Sprint PR Poller. At 1,000 tasks this is a 1,000-row scan every minute.
- **Why it matters:** Combines with finding #3. Low impact today, quadratic cost as the task table grows.
- **Recommendation:** Restore the `pr_number` index via a new migration. Optionally add a partial index `WHERE pr_status = 'open'`.

### [MINOR] `recordTaskChanges` called inside `updateTask` transaction rethrows → aborts the UPDATE

- **Category:** Error Path
- **Location:** `src/main/data/sprint-queries.ts:386-397`
- **Observation:** The comment says "Re-throw to abort transaction" — so if audit recording fails (disk full, prepared-statement contention, schema drift), the user's update is silently rejected and returned as `null`. The caller gets "Task not found" in some paths.
- **Why it matters:** Audit trail should be additive, not a gate on data writes. A poisoned `task_changes` row blocks all task updates system-wide.
- **Recommendation:** Record audit in a separate, post-commit hook. Or log audit failure and swallow — the audit table is not authoritative state.

### [MINOR] `TaskDetailDrawer` writes `elapsed` state during render

- **Category:** Fragility
- **Location:** `src/renderer/src/components/sprint/TaskDetailDrawer.tsx:78-80`
- **Observation:** `if (isActive && !elapsed) { setElapsed(formatElapsed(task.started_at!)) }` at render time. Works, but it's a React anti-pattern that logs warnings and will misbehave in concurrent mode.
- **Why it matters:** Subtle class of bug — during React 18+ strict-mode double-render or suspense, this re-fires unexpectedly.
- **Recommendation:** Move to `useEffect` or compute elapsed inline in JSX without state.

### [MINOR] `migrations` v6/v9/v10/v15/v17/v20 drop/recreate `sprint_tasks` repeatedly — migration chain fragility

- **Category:** Migration Risk
- **Location:** `src/main/db.ts:181-620`
- **Observation:** Seven migrations involve full table recreation for `sprint_tasks`. Each one reimplements the schema. Each new CHECK constraint requires another recreate. There's no end-to-end integration test that runs all 35 migrations from a fresh DB against seed data and asserts row integrity. A production DB that last saw v15 will go through v17 → v20 table recreates — if intermediate index definitions or default values drift the data can silently lose NULL-vs-empty-string distinctions.
- **Why it matters:** Users' existing DBs are the one thing you cannot regenerate. Migration bugs hit hardest on early adopters.
- **Recommendation:** Add a test fixture that seeds a v6 DB and asserts it migrates cleanly to the current version with all column values preserved. Before every CHECK-constraint change, consider whether a new column flag would avoid the table recreate.

### [MINOR] CLAUDE.md says migration v34 is current; actual is v35

- **Category:** Documentation drift
- **Location:** `CLAUDE.md` (sprint DB description) vs `src/main/db.ts:874-886`
- **Observation:** Small but indicative — the CLAUDE.md note "currently at migration v34" hasn't been updated for v35 (adhoc worktree tracking on agent_runs).
- **Why it matters:** New contributors trust CLAUDE.md.
- **Recommendation:** Either stop hardcoding the version in CLAUDE.md or regenerate from code.
