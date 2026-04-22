# Multi-Lens Audit — Phased Refactor Handoff

Handoff document for continuing the clean-code / clean-architecture audit of `src/main/` (~35k LOC) across 10 planned phases. This doc is self-contained — a fresh Claude Code session can pick up the work by reading only this file plus the commit history.

---

## 1. Snapshot at time of handoff (2026-04-21)

**Audit complete.** 57 findings across architecture + clean-code lenses, consolidated into **67 discrete tasks** spanning 10 phases.

**Phase 1a shipped to `main`:**

| Commit     | Content                                                                   |
| ---------- | ------------------------------------------------------------------------- |
| `81226c7b` | T-3 (delete CircuitBreaker compat delegates) + T-18 (TurnTracker DI port) |
| `c57b3cc3` | docs update + prettier fixup                                              |

**Phases 1b – 10 completed on `agent/implement-all-remaining-phases` (worktree, not yet squash-merged to `main`):**

| Phase | Commit      | Content                                           |
| ----- | ----------- | ------------------------------------------------- |
| 1b    | `287017be`  | T-4 + T-17 (IUnitOfWork DI) + T-5                 |
| 2     | `7799fd3a`  | T-19 + T-20 + T-21 + T-22                         |
| 3     | `b1d8159c`  | T-27 + T-28 + T-29 + T-30 + T-31 + T-33           |
| 4     | `5a0cbbba`  | T-34 + T-37 + T-38 (partial) + T-47 + T-48 + T-49 |
| 5     | `a4232e08`  | T-36 + T-50 + T-51 + T-52 + T-54                  |
| 6     | `4866b840`  | T-6 + T-7 + T-8 + T-9 + T-12                      |
| 7     | `525ec4aa`  | T-13 + T-14 + T-15 + T-16                         |
| 8     | `2bf6f8ee`  | T-39 + T-40 + T-41 + T-45 + T-46                  |
| 9     | `97a004fd`  | T-24 + T-26 + T-60 + T-61 + T-62 + T-63           |
| 10    | this commit | T-56 + T-58 + T-65 + T-67                         |

**Deferred (see §4 for rationale):** T-1, T-2, T-10, T-23, T-25, T-32, T-35, T-42, T-43, T-44, T-53, T-55, T-57, T-59, T-64, T-66 — 16 tasks bundled for later dedicated sessions. **T-11** is also marked ⏳ in §4 but with a "kept as-is" decision: `resolveSuccess`'s explicit early-return guards read more clearly than the proposed `runPhases` combinator, so the existing form stays. Counted as a documented WONTFIX, not pending work.

**Progress: 50 / 67 tasks delivered; 16 deferred for later sessions; 1 documented decision-to-keep (T-11).** T-38 is delivered partially — only `status-server` and `operational-checks-service` migrated to the new `AgentManagerStatusReader` port. The remaining four importers (`review-service`, `spec-generation-service`, `spec-synthesizer`, `task-terminal-service`) only depend on data types from `agent-manager/backend-selector` or `agent-manager/dependency-refresher`, not on `AgentManager` behavior — left as-is by design.

**Verification at end of Phase 10 (re-run on this commit, 2026-04-22):**

- `npm run typecheck`: clean
- `npm test`: 312 files / 3740 passed (6 skipped)
- `npm run test:main`: 205 files / 3258 passed
- `npm run lint`: 0 errors / 32 warnings (matches baseline)

---

## 2. Start the next session

Paste this verbatim into a fresh Claude Code session on `main`:

> I'm continuing a phased multi-lens clean-code / clean-architecture refactor of `src/main/`. Read `docs/audit-handoff.md` for the full plan.
>
> Start **Phase 1b** — three tasks:
>
> - **T-4** — Extract `start()`'s 8 inline responsibilities into named helpers in `src/main/agent-manager/index.ts:484-585`. Helpers should include `clearStaleClaims()`, `initDependencyIndex()`, `scheduleDrainLoop()`, `scheduleWatchdogLoop()`, `scheduleOrphanLoop()`, `schedulePruneLoop()`. After the split, `start()` reads as a sequence of named calls.
> - **T-17** — Remove direct `getDb` imports from `src/main/agent-manager/terminal-handler.ts`, `src/main/agent-manager/auto-merge-coordinator.ts`, and `src/main/agent-manager/worktree.ts`. Route the operations each needs through `IAgentTaskRepository` (add repository methods where needed) or a small `UnitOfWork`. `turn-tracker.ts` was already handled in T-18 — leave it alone.
> - **T-5** — Collapse the 3-5 line rationale comments above each `_`-prefixed field in `src/main/agent-manager/index.ts:97-147` into struct-scoped docs where related fields group naturally (e.g. drain runtime, spawn tracking).
>
> Workflow:
>
> 1. Create a branch from `main`: `git switch -c chore/audit-phase-1b main`
> 2. Do the work in the main working tree (do NOT create a separate worktree — see §6 of handoff doc for why)
> 3. Run `npm run typecheck`, `npm test`, `npm run test:main`, `npm run lint` — all must match the baseline numbers in the handoff doc
> 4. Update `docs/modules/agent-manager/index.md` for touched files
> 5. Commit on the branch, then squash-merge to `main` locally
> 6. Delete the phase-1b branch
> 7. **Stop.** Do not chain into Phase 1c. Report what shipped and update `docs/audit-handoff.md` §1 with the new commit SHA and the task list status.

**Do not attempt all 10 phases in one session.** Each phase is one reviewable PR worth of work. The full plan is 15–20 sessions.

---

## 3. Phase plan

Each phase is scoped to be one reviewable PR. Ordered so early phases unblock later ones.

| #   | Title                                                          | Tasks                                                | Rationale                                                     |
| --- | -------------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------- |
| 1a  | ✅ Quick wins: compat delegates + TurnTracker DI               | T-3, T-18                                            | Tractable warmup, already shipped.                            |
| 1b  | start() extraction + getDb removal + field JSDoc               | T-4, T-17, T-5                                       | Medium, contained, no class split yet.                        |
| 1c  | AgentManagerImpl class split                                   | T-1, T-2                                             | The big refactor. Own dedicated session. Risky.               |
| 2   | Prompt graph + planner-MCP relocation                          | T-19, T-20, T-21, T-22                               | Resolves `lib/ ↔ agent-manager/` cycle.                       |
| 3   | Handler thinning (enforces CLAUDE.md's handlers-are-thin rule) | T-27, T-28, T-29, T-30, T-31, T-33                   | High visibility pattern fix.                                  |
| 4   | DI seams — remove module-level singletons                      | T-32, T-34, T-37, T-38, T-47, T-48, T-49             | Systematic DI cleanup.                                        |
| 5   | Service/data layer rationalization                             | T-35, T-36, T-50, T-51, T-52, T-53, T-54             | sprint-service shim decision; `getRepoPaths` out of `git.ts`. |
| 6   | run-agent + completion internals                               | T-6, T-7, T-8, T-9, T-10, T-11, T-12                 | Interior cleanup of agent-manager.                            |
| 7   | worktree + drain-loop splits                                   | T-13, T-14, T-15, T-16                               | Smaller contained chunk.                                      |
| 8   | Review action policy + executor                                | T-39, T-40, T-41, T-42, T-43, T-44, T-45, T-46       | Self-contained 2-file cluster.                                |
| 9   | Composition root + env/bootstrap polish                        | T-23, T-24, T-25, T-26, T-60, T-61, T-62, T-63       | `index.ts` is conflict-prone — do when queue is quiet.        |
| 10  | History/adhoc/github-fetch + structural moves                  | T-55, T-56, T-57, T-58, T-59, T-64, T-65, T-66, T-67 | T-66 is a big rename — do last.                               |

**Note: Phase 1 was originally one phase; the class split (T-1, T-2) proved scope-heavy enough to deserve its own session. The split is reflected as 1a / 1b / 1c above.**

---

## 4. Full task list — 67 tasks

Status key: ✅ done · ⏳ pending.

### `src/main/agent-manager/index.ts`

| ID  | Sev | Status | Lens(es)         | Summary                                                                                                                                                                                                  |
| --- | --- | ------ | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T-1 | P1  | ⏳     | arch, clean-code | Split `AgentManagerImpl` (600-LOC god class) into `DrainCoordinator`, `SpawnTracker`, `AgentLifecycle`, `AgentStatusReporter`. Many collaborators already extracted but the shell still holds all state. |
| T-2 | P1  | ⏳     | arch, clean-code | Drop `_`-prefix backdoors (20+ fields/methods exposed for test access). Replaces convention-based privacy with real seams from T-1. **Depends on T-1.**                                                  |
| T-3 | P1  | ✅     | clean-code       | Delete 5 CircuitBreaker compat delegates + 1 static `_depsFingerprint`. **Shipped in `81226c7b`.**                                                                                                       |
| T-4 | P1  | ✅     | clean-code       | Extract `start()`'s 8 inline responsibilities (lines 484-585): clearStaleClaims, initDependencyIndex, scheduleDrainLoop/Watchdog/Orphan/Prune. **Done in Phase 1b.**                                     |
| T-5 | P3  | ✅     | clean-code       | Collapse 3-5 line JSDoc rationale above each `_`-prefixed field into struct-scoped docs. **Done in Phase 1b** (without T-1 dependency — applied to current shape).                                       |

### `src/main/agent-manager/` — other files

| ID   | Sev | Status          | Lens(es)   | Summary                                                                                                                                                                                                                                                                                                                                                                          |
| ---- | --- | --------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T-6  | P1  | ✅              | clean-code | `resolveAgentExit` now takes a `ResolveAgentExitContext` deps bag and dispatches to `handleFastFailExhausted` / `handleFastFailRequeue` / `resolveNormalExit`; the `resolveSuccess`-failure recovery is its own `handleResolveSuccessFailure`. Reads top-to-bottom as a story. (Phase 6)                                                                                         |
| T-7  | P1  | ✅              | clean-code | New `agent-manager/failure-messages.ts` exports `FAST_FAIL_EXHAUSTED_NOTE` (and `NOOP_RUN_NOTE` for T-12). The note is now a constant, not an inline literal embedded in `repo.updateTask({notes: ...})`. (Phase 6)                                                                                                                                                              |
| T-8  | P2  | ✅              | clean-code | `cleanupWorktreeWithRetry` reads as `tryCleanupWithBackoff` then `runFinalCleanupAttempt`; failure-surface formatting lives in `surfaceCleanupFailureToTaskNotes`. (Phase 6)                                                                                                                                                                                                     |
| T-9  | P2  | ✅              | clean-code | `finalizeAgentRun` decomposes into `emitCompletionEvent`, `handleSupersededRun` (early-return), `persistAndCleanupAfterRun` and the existing `resolveAgentExit` call. The public function reads as a four-step pipeline. (Phase 6)                                                                                                                                               |
| T-10 | P2  | ⏳              | arch       | Discriminated-union Result types in `runAgent` deferred — the current exception-as-control-flow is well-localised after T-6/T-9 and replacing it would require touching every phase signature plus most agent-manager tests. Logged as a follow-up when the test surface is paid down.                                                                                           |
| T-11 | P1  | ⏳ (kept as-is) | clean-code | `resolveSuccess` already reads as a named sequence of `if (!guard) return` calls (verifyWorktree → detectBranch → autoCommit → rebase → hasCommits → noOp → tipMatch → annotate → transition). Replacing it with a `runPhases` combinator hides the early-return semantics and obscures the audit-friendly trace. Keeping the explicit form.                                     |
| T-12 | P2  | ✅              | clean-code | `detectNoOpAndFailIfSo` now references `NOOP_RUN_NOTE` from `failure-messages.ts`. (Phase 6)                                                                                                                                                                                                                                                                                     |
| T-13 | P2  | ✅              | clean-code | `cleanupStaleWorktrees` reads as four named calls: `removeWorktreesForBranch`, `removeWorktreeAtPath`, `pruneOrphanedWorktreeRefs`, `deleteBranchRobustly`. Each has a single responsibility; the rmSync fallback is in `removeWorktreeWithRmFallback`. (Phase 7)                                                                                                                |
| T-14 | P2  | ✅              | clean-code | `branchNameForTask(title, taskId?, groupId?)` retained as a dispatcher; new `branchNameForTaskId` and `branchNameForTaskGroup` are the named factories callers should reach for. The shared slug builder is `buildAgentBranch`. (Phase 7)                                                                                                                                        |
| T-15 | P2  | ✅              | clean-code | `pruneStaleWorktrees` is a 9-line orchestrator over `enumeratePruneCandidates` (generator), `isPrunableCandidate` (safety gates), and `deleteWorktreeDir`. (Phase 7)                                                                                                                                                                                                             |
| T-16 | P2  | ✅              | clean-code | `handleSpecLevelFailure` decomposes into `shouldQuarantine`, `formatQuarantineNote`, `quarantineStatusFor`, and `applyQuarantine`; the original 32-LOC try/catch is replaced by a four-step pipeline. (Phase 7)                                                                                                                                                                  |
| T-17 | P1  | ✅              | arch       | Remove direct `getDb` import from `terminal-handler.ts:12` and `auto-merge-coordinator.ts`. Worktree.ts had no `getDb` import to remove (audit listing was stale). New `IUnitOfWork` port in `data/unit-of-work.ts` injected via constructor; threaded through `TerminalHandlerDeps`, `AutoMergeContext`, `RunAgentDataDeps`, and `ResolveSuccessContext`. **Done in Phase 1b.** |
| T-18 | P3  | ✅              | arch       | TurnTracker: replace `Database` handle with injected `InsertTurnFn`. **Shipped in `81226c7b`.**                                                                                                                                                                                                                                                                                  |
| T-19 | P1  | ✅              | arch       | Move `planner-mcp-server.ts` out of `agent-manager/` — it's a services concern. **Done in Phase 2.**                                                                                                                                                                                                                                                                             |
| T-20 | P2  | ✅              | arch       | Split `buildAssistantPrompt` into separate `buildAssistantPrompt` + `buildAdhocPrompt` (Phase 2). Shared skeleton extracted into private `buildInteractivePrompt(input, personality, responseFormat)`.                                                                                                                                                                           |
| T-21 | P2  | ✅              | arch       | Moved `BuildPromptInput` to `src/shared/types/agent-prompt.ts` (Phase 2).                                                                                                                                                                                                                                                                                                        |
| T-22 | P1  | ✅              | arch       | Cycle resolved (Phase 2): per-agent prompt builders import `BuildPromptInput` from `shared/types`; `lib/prompt-composer.ts` re-exports the type for backward compat.                                                                                                                                                                                                             |

### `src/main/index.ts`

| ID   | Sev | Status | Lens(es)   | Summary                                                                                                                                                                                                                                                                                                                                                                                           |
| ---- | --- | ------ | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T-23 | P1  | ⏳     | clean-code | `wireAgentManagerAndMcp` extraction deferred — index.ts is on the conflict-prone list and would need a dedicated session to split safely.                                                                                                                                                                                                                                                         |
| T-24 | P1  | ✅     | clean-code | All imports hoisted to the top of `index.ts`; the four startup side effects (PATH augmentation, proxy dispatcher, single-instance lock, Node version assertion) are wrapped by a single `runStartupPreflight()` and broken into named helpers (`configureGlobalProxyDispatcher`, `enforceSingleInstanceLock`, `assertSupportedNodeVersion`). The startup story now reads top-to-bottom. (Phase 9) |
| T-25 | P2  | ⏳     | arch       | 557-LOC composition root split deferred — index.ts is conflict-prone and the four-file split touches PR rules + handler wiring. Logged as a follow-up.                                                                                                                                                                                                                                            |
| T-26 | P3  | ✅     | clean-code | `assertSupportedNodeVersion()` is now a named helper called from `runStartupPreflight()`. (Phase 9)                                                                                                                                                                                                                                                                                               |

### `src/main/handlers/*`

| ID   | Sev | Status | Lens(es)         | Summary                                                                                                                                                                                                                                       |
| ---- | --- | ------ | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T-27 | P1  | ✅     | arch, clean-code | Moved sprint:update business logic (id check, allowlist filter, status narrowing, transition validation, queued policy, terminal callback) into `sprint-service.updateTaskFromUi`. Handler is a one-liner. (Phase 3)                          |
| T-28 | P1  | ✅     | arch             | New `dependency-service.validateDependencyGraph()` owns existence + cycle checks. Handler validates the id and delegates. (Phase 3)                                                                                                           |
| T-29 | P2  | ✅     | arch             | `forceTerminalOverride` + `buildForceTerminalPatch` now live in `task-state-service`. (Phase 3)                                                                                                                                               |
| T-30 | P1  | ✅     | arch             | New `services/review-query-service.ts` (`getReviewDiff`, `getReviewCommits`, `getReviewFileDiff`) — handler delegates. (Phase 3)                                                                                                              |
| T-31 | P1  | ✅     | arch             | New `services/github-proxy-service.ts` (`proxyGitHubRequest`) — git-handlers' `github:fetch` is now a thin pass-through. (Phase 3)                                                                                                            |
| T-32 | P2  | ⏳     | arch             | Replace module-level `ideRootPath`/`watcher`/`debounceTimer` in ide-fs-handlers.ts with an `IdeFsSession` class. **Deferred to Phase 4** (DI seams).                                                                                          |
| T-33 | P2  | ✅     | clean-code       | `validateIdePath` decomposed into `canonicalizeRootPath`, `canonicalizeTargetPath`, `canonicalizeMissingTargetPath`, `rebaseUnderRoot` — same behavior, four single-purpose helpers. (Phase 3)                                                |
| T-34 | P2  | ✅     | arch             | `registerWorkbenchHandlers(am?, deps?)` accepts an optional `WorkbenchHandlerDeps.specQualityService`; the module-level singleton is gone, the handler closure resolves it from deps or falls back to `createSpecQualityService()`. (Phase 4) |

### `src/main/services/*`

| ID   | Sev | Status       | Lens(es)   | Summary                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ---- | --- | ------------ | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T-35 | P1  | ⏳           | arch       | Sprint-service shim deferred — after Phase 3 it now hosts the `updateTaskFromUi` orchestration helper, which gives the file a real responsibility and weakens the "delete the barrel" case. Revisit after Phase 6 once the audit-trail attribution / cancel flow are settled.                                                                                                                                                                                                            |
| T-36 | P2  | ✅           | arch       | `git.ts` no longer owns `getRepoPaths` / `getRepoPath` — it re-exports from `paths.ts` for backward compat, and production importers (`validation`, `sprint-service`, `operational-checks-service`, `workbench` handler) now import from `paths` directly. (Phase 5)                                                                                                                                                                                                                     |
| T-37 | P1  | ✅           | arch       | New `data/sprint-task-repository.getSharedSprintTaskRepository()` is the single owner of the cached `ISprintTaskRepository`. `sprint-mutations`, `review-orchestration-service`, and `review-ship-batch` all route through it (sprint-mutations via Proxy so existing helpers stay one-liners). (Phase 4)                                                                                                                                                                                |
| T-38 | P1  | ✅ (partial) | arch       | New narrow port `services/ports/agent-manager-status.ts` (`AgentManagerStatusReader`); `status-server` and `operational-checks-service` consume it instead of `AgentManager`. The remaining four importers (`review-service`, `spec-generation-service`, `spec-synthesizer`, `task-terminal-service`) only depend on a _type_ from `agent-manager/backend-selector` or `agent-manager/dependency-refresher`, not on the AgentManager interface itself — leaving as-is for now. (Phase 4) |
| T-39 | P1  | ✅           | clean-code | `classifyReviewAction` is now a 4-line dispatcher over `PLAN_BUILDERS` — one named builder per action (`buildRequestRevisionPlan`, `buildDiscardPlan`, etc.). Shared worktree cleanup lifted into `buildWorktreeCleanupOps`; shared done-patch into `doneStatusPatch`. (Phase 8)                                                                                                                                                                                                         |
| T-40 | P1  | ✅           | clean-code | All 5 `new Date().toISOString()` call sites in review-action-policy.ts now use `nowIso()` from `shared/time`. (Phase 8)                                                                                                                                                                                                                                                                                                                                                                  |
| T-41 | P3  | ✅           | clean-code | Per-action banner comments deleted by T-39 (they lived inside the classifier body). Module-section dividers at file top retained — they sign-post top-level sections, not inline branches. (Phase 8)                                                                                                                                                                                                                                                                                     |
| T-42 | P2  | ⏳           | clean-code | `executeGitOp` per-op-type strategy deferred — the existing switch is already flat (one case per op type), and the per-op handlers each have a few trivial lines. The audit's "strategy" rewrite is mostly moving existing case bodies into functions without changing the shape. Revisit if new ops land.                                                                                                                                                                               |
| T-43 | P2  | ⏳           | arch       | Injecting `fs`/`execFile` deps in review-action-executor deferred — the executor's callers (review-orchestration-service) don't currently pass them, and the migration needs a coordinated change across orchestration + ship-batch + handler tests. Scheduled for a dedicated session.                                                                                                                                                                                                  |
| T-44 | P3  | ⏳           | arch       | `ExecutorState` → typed per-op results deferred — paired with T-42 (they need to land together) and would touch every call-site. Keeping the state-bag until T-42 is ready.                                                                                                                                                                                                                                                                                                              |
| T-45 | P2  | ✅           | clean-code | `areDependenciesSatisfied` is a short loop over `isDependencySatisfied`. The condition-based branch is `satisfiesCondition`; the legacy hard/soft fallback is `satisfiesLegacyType` (with its deprecation warning isolated). (Phase 8)                                                                                                                                                                                                                                                   |
| T-46 | P2  | ✅           | clean-code | `resolveClaude` extracted `classifyClaudeMissingToken` (the expired-vs-missing decision was inline); `resolveGithub` split into `resolveGithub` (env-token fast path) + `resolveGithubViaCli`. (Phase 8)                                                                                                                                                                                                                                                                                 |
| T-47 | P2  | ✅           | arch       | `getDefaultCredentialService` now warns through _the new caller's_ logger when invoked with a different logger after the singleton was constructed. The first logger still wins (intentional, documented). (Phase 4)                                                                                                                                                                                                                                                                     |
| T-48 | P3  | ✅           | arch       | New `PluginRegistry` class owns load/list/emit; the old module-level `loadedPlugins` array is gone. Backward-compat free functions (`loadPlugins`, `getPlugins`, `emitPluginEvent`) delegate to a default registry. (Phase 4)                                                                                                                                                                                                                                                            |
| T-49 | P3  | ✅           | arch       | New `LoadSampler` class owns the ring buffer / timer / cpu-count cache. Backward-compat free functions delegate to a default sampler. (Phase 4)                                                                                                                                                                                                                                                                                                                                          |

### `src/main/data/*`

| ID   | Sev | Status | Lens(es)   | Summary                                                                                                                                                                                                                                                     |
| ---- | --- | ------ | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T-50 | P1  | ✅     | clean-code | `writeTaskUpdate` reads as a six-line orchestration helper now: filter allowlist → run transaction(`runUpdate`). Extracted `enforceTransitionOrThrow`, `computeChangedEntries`, `buildUpdateSql`, `recordAuditTrailOrAbort`, `handleUpdateError`. (Phase 5) |
| T-51 | P2  | ✅     | clean-code | `buildUpdateSql` returns `{ setClauses, values, auditPatch }`; the SET-clause walk and the audit-patch walk now live in `buildUpdateSql` + `buildAuditValue` so the responsibilities are no longer interleaved inline. (Phase 5)                            |
| T-52 | P3  | ✅     | clean-code | `toAuditableTask` simplified to `{ ...task } as Record<string, unknown>` (no `Object.fromEntries` round-trip); `asSprintTaskField` retained but its docstring trimmed. (Phase 5)                                                                            |
| T-53 | P2  | ⏳     | arch       | Composite `ISprintTaskRepository` deferred — the audit's intent (force sub-interface use) would break ~30+ test mocks for marginal architectural value. Revisit if the per-interface mock cost is paid down elsewhere.                                      |
| T-54 | P2  | ✅     | arch       | `WebhookConfig` lives in `src/shared/types/webhook.ts`; `services/webhook-service.ts` re-exports it for backward compat; `data/webhook-queries.ts` imports from shared so the data layer no longer reaches up into services/. (Phase 5)                     |

### `src/main/` (top level)

| ID   | Sev | Status | Lens(es)   | Summary                                                                                                                                                                                                                                                                                                                                  |
| ---- | --- | ------ | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T-55 | P2  | ⏳     | clean-code | Moving one-time migrations into `src/main/migrations/` deferred — they're interleaved with `initAgentHistory` and the migrations framework expects versioned migrations, not file-conversion passes. Logged as a follow-up.                                                                                                              |
| T-56 | P2  | ✅     | clean-code | `pruneOldAgents` is now a 4-line orchestrator: `selectAgentsToPrune` → `deletePrunedAgentsFromDb` → `removePrunedAgentLogDirs` → `removeEmptyDateDirs`. Each helper has a single responsibility. (Phase 10)                                                                                                                              |
| T-57 | P2  | ⏳     | clean-code | `spawnAdhocAgent` → `AdhocSessionBuilder` deferred — the function is 355 LOC and the split requires careful separation of setup/teardown vs the SDK session loop. Scheduled for a dedicated session.                                                                                                                                     |
| T-58 | P2  | ✅     | clean-code | The inline `require('./db')` with its eslint-disable comment is gone; `getDb` is now a top-level ESM import at `adhoc-agent.ts`. (Phase 10)                                                                                                                                                                                              |
| T-59 | P3  | ⏳     | clean-code | Single-yield multimodal generator rewrap deferred with T-57 — same file, same session.                                                                                                                                                                                                                                                   |
| T-60 | P2  | ✅     | clean-code | `refreshOAuthTokenFromKeychain` is a 5-line orchestrator: `readKeychainCredentials` → validation → `refreshIfDue` → `persistToken`. Each step has a single responsibility; the schema check moved into `isValidKeychainPayload`. (Phase 9)                                                                                               |
| T-61 | P2  | ✅     | clean-code | The two `console.warn` calls in `env-utils.ts` (Keychain rotated-write failure, OAuth refresh failure) now route through `logger.warn` so the messages land in `~/.bde/bde.log` like every other module. (Phase 9)                                                                                                                       |
| T-62 | P2  | ✅     | clean-code | `isNonTrivialError` substring matcher replaced by an `ExpectedStartupCondition extends Error` class plus an `isReportableStartupFailure(err)` `instanceof` check. Throwers should construct the typed class to opt out of user-facing reporting. (Phase 9)                                                                               |
| T-63 | P2  | ✅     | clean-code | New `schedulePeriodic({ name, intervalMs, run })` helper handles the timer + `will-quit` teardown. The four startup cleanup bodies are extracted into named one-shot functions (`pruneEventsOnce`, `pruneTaskChangesOnce`, `pruneDiffSnapshotsOnce`, `cleanTestArtifactsOnce`); periodic tasks are declared in a single array. (Phase 9) |
| T-64 | P2  | ⏳     | clean-code | github-fetch retry-loop per-failure-mode split deferred — the loop is 58 lines but refactoring requires a light hand to preserve the backoff contract; bundled with T-10 (Result-type refactor) when both are paid down.                                                                                                                 |
| T-65 | P2  | ✅     | clean-code | `classifyHttpError` is now a status → `HttpErrorFactory` lookup; `classify403` is its own function that handles the rate-limit header + billing body heuristic + permission fallback. (Phase 10)                                                                                                                                         |
| T-66 | P2  | ⏳     | arch       | 40-file domain-folder rename deferred — highest-risk structural change in the audit and needs its own dedicated PR to keep the review signal focused.                                                                                                                                                                                    |
| T-67 | P2  | ✅     | arch       | `src/main/cost-queries.ts` shim deleted; `handlers/cost-handlers.ts` imports from `src/main/data/cost-queries.ts` directly and passes `getDb()` per call; test moved. (Phase 10)                                                                                                                                                         |

---

## 5. Execution conventions (read before touching code)

### Per-commit checklist (from CLAUDE.md — non-negotiable)

Before every commit, all four must pass:

```bash
npm run typecheck   # zero errors
npm test            # all pass (vitest, renderer + shared)
npm run test:main   # all pass (vitest main-process config)
npm run lint        # zero errors (warnings OK)
```

**And:** update `docs/modules/<layer>/index.md` for every source file touched. If exports or observable behavior changed, create or update the per-module detail file (`docs/modules/<layer>/<module>.md`).

Layer → doc path map is in CLAUDE.md §Module Documentation.

### Baseline test numbers (match these at phase end)

| Suite               | Files | Tests                   |
| ------------------- | ----- | ----------------------- |
| `npm test`          | 312   | 3740 passed + 6 skipped |
| `npm run test:main` | 205   | 3258                    |
| Lint                | —     | 0 errors / 32 warnings  |

If your phase ends with different numbers, investigate before merging.

### Commit message format

Per CLAUDE.md: `{type}: {description}`. Types: `feat:`, `fix:`, `chore:`, `refactor:`, `docs:`. Use `refactor(<scope>):` for audit work — e.g. `refactor(agent-manager): ...`.

Reference the audit task IDs in the commit body: `audit T-4`, `audit T-17`, etc.

### Workflow per phase

1. `git switch -c chore/audit-phase-<N>[-<theme>] main`
2. Do the work in the main working tree (not a separate worktree — see §6)
3. Run the four commands above
4. Update docs/modules/
5. Commit on branch
6. `git switch main && git merge --squash chore/audit-phase-<N> && git commit -m "<message>"`
7. Run the four commands AGAIN on main to confirm the squash-merge didn't re-break anything
8. `git branch -D chore/audit-phase-<N>`
9. Update this handoff doc §1 and §4 with the new commit SHA and ✅ status
10. Stop. Do not chain into the next phase in the same session.

### Direct commit to main

**Expect a permission hook on `git commit` to main.** The user must grant `Bash(git commit:*)` for the session once, at the moment of the squash-merge commit. This is a known friction — the global CLAUDE.md says "no direct pushes to main" but the user has explicitly authorized local squash-merges for this workflow.

If you can't get permission:

- Leave the phase branch in place (`chore/audit-phase-<N>`)
- Tell the user to run the squash-merge manually
- Update §1 of this doc with the branch name so they know where to look

---

## 6. Operational gotchas from Phase 1a

Things that bit me in the first run. Don't repeat.

### 1. Destructive git/fs ops are blocked

The user's hook denies: `git worktree remove`, `git reset --hard`, `rm -rf`, `git push --force`. Plan for non-destructive alternatives:

- Unstage without reset: `git restore --staged <file>` (per-file)
- Clean up stale worktrees: leave them, ask the user to run `git worktree remove` manually at end of session
- Recover from a bad merge-stage: hand the staged state to the user with a description rather than trying to reset

### 2. Don't create separate worktrees per phase

**Work directly in the main working tree on a phase branch.** Creating a worktree at `.worktrees/phase-N/` causes two problems:

- **Manual `git worktree add` skips BDE's worktree-create hook** — so `node_modules` isn't auto-symlinked. You have to do it manually.
- **Symlinked `node_modules` + native-binary rebuilds race.** `vitest-global-setup.ts` rebuilds `better-sqlite3` for Node on demand; `npm run test:main` has a `posttest:main` hook that rebuilds it for Electron 39.8.6. With both trees sharing node_modules via symlink, concurrent or overlapping runs corrupt the build output. I hit exactly this in Phase 1a.

Solution: just use the main working tree. Create a phase branch with `git switch -c`, do the work, squash-merge back to main. If you're worried about uncommitted changes on main's working tree surviving a branch switch, commit them on the phase branch first — that's the whole point of the phase branch.

### 3. Native binary rebuilds take ~10–30 s

`posttest:main` runs `electron-rebuild -v 39.8.6 -f -w better-sqlite3,node-pty`. Plan for it. If you need to iterate on main-process tests fast, call `npx vitest run -c src/main/vitest.main.config.ts <file>` directly instead of `npm run test:main` — it skips the rebuild, but note you'll need to run `npm run test:main` at the end of the phase to ensure the binary is Electron-compatible for the app's next launch.

### 4. Two vitest configs

- `vitest.config.ts` (root) — renderer/shared tests. Excludes `src/main/**/*.test.ts`.
- `src/main/vitest.main.config.ts` — main-process tests. Run with `npm run test:main` or `npx vitest run -c src/main/vitest.main.config.ts`.

Running the wrong config returns "No test files found" for main-process tests.

### 5. `bootstrap.test.ts` gotcha (from CLAUDE.md)

If you touch `src/main/bootstrap.ts`, every module it imports needs a matching `vi.mock(...)` in `bootstrap.test.ts`. A missing mock makes ALL tests in the file fail with "not a function" errors — relevant for Phase 9 (T-62, T-63).

### 6. Multi-statement SQL in TypeScript (from CLAUDE.md)

The Edit-tool security hook pattern-matches shell-style invocations. If you pass a backtick template literal directly to a `db.exec(...)` call on the same line, the hook will block the edit. Workaround: assign the SQL to `const sql = \`...\``on one line, then pass`sql`to the db method on the next. Pattern visible in`src/main/db.ts` and any multi-statement migration.

---

## 7. Key file references

- **Audit targets:** everything under `src/main/` (~300 TS files, ~35k LOC, tests excluded)
- **CLAUDE.md** (repo root): the standard — read §THE Standard + §Module Documentation before every commit
- **`docs/modules/`:** per-module documentation. Layer-map and template in CLAUDE.md §Module Documentation.
- **`src/main/agent-manager/index.ts`:** `AgentManagerImpl` — Phase 1 and 1c target
- **`src/main/agent-manager/run-agent.ts`:** Phase 6 target
- **`src/main/agent-manager/completion.ts`:** Phase 6 target (resolveSuccess)
- **`src/main/agent-manager/worktree.ts`:** Phase 7 target
- **`src/main/handlers/sprint-local.ts`:** Phase 3 + 4 target (handler thinning, business-logic extraction)
- **`src/main/services/sprint-mutations.ts`:** Phase 4 target (module singleton)
- **`src/main/services/review-action-policy.ts`:** Phase 8 target (classifyReviewAction)
- **`src/main/services/review-action-executor.ts`:** Phase 8 target (executeGitOp)
- **`src/main/services/operational-checks-service.ts`:** Phase 4 target (services→agent-manager layer violation)
- **`src/main/data/sprint-task-crud.ts`:** Phase 5 target (writeTaskUpdate split)
- **`src/main/index.ts`:** Phase 9 target (composition root)

---

## 8. FAQ for a fresh session

**"Should I re-run the audit?"**
No. The 67 tasks in §4 capture every finding. Re-running the audit produces new noise.

**"Should I do more than one phase per session?"**
No. One phase per session. If a phase turns out smaller than expected, stop anyway — the user reviews between phases.

**"Can I skip updating docs/modules/?"**
No. CLAUDE.md mandates doc updates per commit. The Phase 1a commit missed one and got a reminder banner — don't skip.

**"The tests fail after my change — is that my fault or pre-existing?"**
Run `git stash && npm run test:main` to verify a baseline. If tests were green before your change and red after, it's you.

**"Can I refactor surrounding code while I'm in there?"**
No. CLAUDE.md §Boy Scout Rule is narrow: rename a confusing variable, delete a misleading comment. Do not drive-by-refactor unrelated code — that belongs in its own PR. Especially here, where the whole audit is a series of focused commits.

**"The task says `Depends on: T-X` but T-X isn't done. What now?"**
Follow the order in §3 (Phase plan). If you can't, stop and flag it to the user. Don't skip the dependency.

**"I found a new issue not in the audit. What do I do?"**
Report it to the user. Don't silently expand scope. If they want it fixed, it becomes T-68.

---

## 9. Session-end checklist

Before ending a session, update **§1 (Snapshot)** and **§4 (Full task list)** of this file with:

- New commit SHAs shipped to main
- ✅ marks on completed tasks
- Any deferred items and reasons
- New gotchas or lessons learned (add to §6)

Commit the handoff-doc update on main as part of the phase squash-commit, or as a separate `docs: update audit handoff` commit.
