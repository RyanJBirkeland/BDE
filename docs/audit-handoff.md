# Multi-Lens Audit — Phased Refactor Handoff

Handoff document for continuing the clean-code / clean-architecture audit of `src/main/` (~35k LOC) across 10 planned phases. This doc is self-contained — a fresh Claude Code session can pick up the work by reading only this file plus the commit history.

---

## 1. Snapshot at time of handoff (2026-04-21)

**Audit complete.** 57 findings across architecture + clean-code lenses, consolidated into **67 discrete tasks** spanning 10 phases.

**Phase 1a shipped to `main`:**

| Commit | Content |
|---|---|
| `81226c7b` | T-3 (delete CircuitBreaker compat delegates) + T-18 (TurnTracker DI port) |
| `c57b3cc3` | docs update + prettier fixup |

**Verification at time of handoff:**
- `npm run typecheck`: clean
- `npm test`: 312 files / 3740 passed (6 skipped)
- `npm run test:main`: 205 files / 3258 passed
- `npm run lint`: 0 errors, 32 warnings (matches baseline)

**Progress: 2 / 67 tasks complete.** Phase 1b onwards remains.

---

## 2. Start the next session

Paste this verbatim into a fresh Claude Code session on `main`:

> I'm continuing a phased multi-lens clean-code / clean-architecture refactor of `src/main/`. Read `docs/audit-handoff.md` for the full plan.
>
> Start **Phase 1b** — three tasks:
> - **T-4** — Extract `start()`'s 8 inline responsibilities into named helpers in `src/main/agent-manager/index.ts:484-585`. Helpers should include `clearStaleClaims()`, `initDependencyIndex()`, `scheduleDrainLoop()`, `scheduleWatchdogLoop()`, `scheduleOrphanLoop()`, `schedulePruneLoop()`. After the split, `start()` reads as a sequence of named calls.
> - **T-17** — Remove direct `getDb` imports from `src/main/agent-manager/terminal-handler.ts`, `src/main/agent-manager/auto-merge-coordinator.ts`, and `src/main/agent-manager/worktree.ts`. Route the operations each needs through `IAgentTaskRepository` (add repository methods where needed) or a small `UnitOfWork`. `turn-tracker.ts` was already handled in T-18 — leave it alone.
> - **T-5** — Collapse the 3-5 line rationale comments above each `_`-prefixed field in `src/main/agent-manager/index.ts:97-147` into struct-scoped docs where related fields group naturally (e.g. drain runtime, spawn tracking).
>
> Workflow:
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

| # | Title | Tasks | Rationale |
|---|---|---|---|
| 1a | ✅ Quick wins: compat delegates + TurnTracker DI | T-3, T-18 | Tractable warmup, already shipped. |
| 1b | start() extraction + getDb removal + field JSDoc | T-4, T-17, T-5 | Medium, contained, no class split yet. |
| 1c | AgentManagerImpl class split | T-1, T-2 | The big refactor. Own dedicated session. Risky. |
| 2 | Prompt graph + planner-MCP relocation | T-19, T-20, T-21, T-22 | Resolves `lib/ ↔ agent-manager/` cycle. |
| 3 | Handler thinning (enforces CLAUDE.md's handlers-are-thin rule) | T-27, T-28, T-29, T-30, T-31, T-33 | High visibility pattern fix. |
| 4 | DI seams — remove module-level singletons | T-32, T-34, T-37, T-38, T-47, T-48, T-49 | Systematic DI cleanup. |
| 5 | Service/data layer rationalization | T-35, T-36, T-50, T-51, T-52, T-53, T-54 | sprint-service shim decision; `getRepoPaths` out of `git.ts`. |
| 6 | run-agent + completion internals | T-6, T-7, T-8, T-9, T-10, T-11, T-12 | Interior cleanup of agent-manager. |
| 7 | worktree + drain-loop splits | T-13, T-14, T-15, T-16 | Smaller contained chunk. |
| 8 | Review action policy + executor | T-39, T-40, T-41, T-42, T-43, T-44, T-45, T-46 | Self-contained 2-file cluster. |
| 9 | Composition root + env/bootstrap polish | T-23, T-24, T-25, T-26, T-60, T-61, T-62, T-63 | `index.ts` is conflict-prone — do when queue is quiet. |
| 10 | History/adhoc/github-fetch + structural moves | T-55, T-56, T-57, T-58, T-59, T-64, T-65, T-66, T-67 | T-66 is a big rename — do last. |

**Note: Phase 1 was originally one phase; the class split (T-1, T-2) proved scope-heavy enough to deserve its own session. The split is reflected as 1a / 1b / 1c above.**

---

## 4. Full task list — 67 tasks

Status key: ✅ done · ⏳ pending.

### `src/main/agent-manager/index.ts`

| ID | Sev | Status | Lens(es) | Summary |
|---|---|---|---|---|
| T-1 | P1 | ⏳ | arch, clean-code | Split `AgentManagerImpl` (600-LOC god class) into `DrainCoordinator`, `SpawnTracker`, `AgentLifecycle`, `AgentStatusReporter`. Many collaborators already extracted but the shell still holds all state. |
| T-2 | P1 | ⏳ | arch, clean-code | Drop `_`-prefix backdoors (20+ fields/methods exposed for test access). Replaces convention-based privacy with real seams from T-1. **Depends on T-1.** |
| T-3 | P1 | ✅ | clean-code | Delete 5 CircuitBreaker compat delegates + 1 static `_depsFingerprint`. **Shipped in `81226c7b`.** |
| T-4 | P1 | ⏳ | clean-code | Extract `start()`'s 8 inline responsibilities (lines 484-585): clearStaleClaims, initDependencyIndex, scheduleDrainLoop/Watchdog/Orphan/Prune. |
| T-5 | P3 | ⏳ | clean-code | Collapse 3-5 line JSDoc rationale above each `_`-prefixed field into struct-scoped docs. **Depends on T-1.** |

### `src/main/agent-manager/` — other files

| ID | Sev | Status | Lens(es) | Summary |
|---|---|---|---|---|
| T-6 | P1 | ⏳ | clean-code | `resolveAgentExit` (run-agent.ts:197-287) — 10 positional args + tri-state branch. Deps bag + dispatch to `handleFastFailExhausted`/`handleFastFailRequeue`/`resolveNormalExit`. |
| T-7 | P1 | ⏳ | clean-code | Extract fast-fail-exhausted failure message to `FAST_FAIL_EXHAUSTED_NOTE` constant (run-agent.ts:212-223). Create `failure-messages.ts`. |
| T-8 | P2 | ⏳ | clean-code | Split `cleanupWorktreeWithRetry` retry-loop from final-failure path (run-agent.ts:152-191). |
| T-9 | P2 | ⏳ | clean-code | Split `finalizeAgentRun` (9 params, 70 LOC) into emit/handle-supersession/persist-and-clean (run-agent.ts:315-385). |
| T-10 | P2 | ⏳ | arch | Replace exception-as-control-flow in `runAgent` (run-agent.ts:387+) with discriminated-union Result types per phase. |
| T-11 | P1 | ⏳ | clean-code | Express `resolveSuccess` (completion.ts:90-157) as a named pipeline (runPhases combinator) instead of 8 early-return guards. |
| T-12 | P2 | ⏳ | clean-code | `NOOP_RUN_NOTE` constant for `detectNoOpAndFailIfSo` (completion.ts:169-192). **Depends on T-7.** |
| T-13 | P2 | ⏳ | clean-code | Split `cleanupStaleWorktrees` four-phase body (worktree.ts:74-151). Extract `removeWorktreesForBranch`, `removeWorktreeAtPath`, `deleteBranchRobustly`. |
| T-14 | P2 | ⏳ | clean-code | Replace `branchNameForTask` positional-optional flag pattern (worktree.ts:39-50) with two named factories. |
| T-15 | P2 | ⏳ | clean-code | Split `pruneStaleWorktrees` triple-nested loop (worktree.ts:310-376). Extract `enumerateCandidates`/`isPrunable`/`deleteWorktreeDir`. |
| T-16 | P2 | ⏳ | clean-code | Split `handleSpecLevelFailure` (drain-loop.ts:225-257). Extract `shouldQuarantine`/`quarantineStatusFor(task)`/`applyQuarantine`. |
| T-17 | P1 | ⏳ | arch | Remove direct `getDb` import from `terminal-handler.ts:12`, `auto-merge-coordinator.ts`, `worktree.ts`. Route through `IAgentTaskRepository` or `UnitOfWork`. turn-tracker.ts already done in T-18. |
| T-18 | P3 | ✅ | arch | TurnTracker: replace `Database` handle with injected `InsertTurnFn`. **Shipped in `81226c7b`.** |
| T-19 | P1 | ⏳ | arch | Move `planner-mcp-server.ts` out of `agent-manager/` — it's a services concern. |
| T-20 | P2 | ⏳ | arch | Split `buildAssistantPrompt` (prompt-assistant.ts:28) into separate `buildAssistantPrompt` + `buildAdhocPrompt`. |
| T-21 | P2 | ⏳ | arch | Move `BuildPromptInput` to `src/shared/types/agent-prompt.ts` to break lib↔agent-manager cycle. |
| T-22 | P1 | ⏳ | arch | Resolve the `lib/prompt-composer.ts` ↔ `agent-manager/prompt-*` bidirectional import cycle. **Depends on T-21.** |

### `src/main/index.ts`

| ID | Sev | Status | Lens(es) | Summary |
|---|---|---|---|---|
| T-23 | P1 | ⏳ | clean-code | Extract `wireAgentManagerAndMcp` (index.ts:344-429) 6 responsibilities into named helpers. Move MCP lifecycle to its own file. |
| T-24 | P1 | ⏳ | clean-code | Hoist imports and extract `runStartupPreflight()` — side effects currently fire between imports at lines 32-77. |
| T-25 | P2 | ⏳ | arch | Split 557-LOC composition root into `createMainWindow.ts`, `setupProxyDispatcher.ts`, `enforceNodeVersion.ts`, `installCrashHandlers.ts`. |
| T-26 | P3 | ⏳ | clean-code | Extract `assertNodeVersion()` from inline check (index.ts:80-86). **Depends on T-25.** |

### `src/main/handlers/*`

| ID | Sev | Status | Lens(es) | Summary |
|---|---|---|---|---|
| T-27 | P1 | ⏳ | arch, clean-code | Move `sprintUpdateHandler` business logic (sprint-local.ts:121-172) into `SprintTaskService.update(id, patch)`. |
| T-28 | P1 | ⏳ | arch | Move `sprint:validateDependencies` cycle-detection (sprint-local.ts:243) into `dependency-service.validateDependencyGraph()`. |
| T-29 | P2 | ⏳ | arch | Move `overrideTaskStatus`/`buildOverridePatch` (sprint-local.ts:294-327) into `task-state-service`. |
| T-30 | P1 | ⏳ | arch | Move `review:getDiff` git-shell-out (review.ts:58+) + `review:getCommits` into a review query service. |
| T-31 | P1 | ⏳ | arch | Extract `GitHubProxyService` from `github:fetch` (git-handlers.ts:155). |
| T-32 | P2 | ⏳ | arch | Replace module-level `ideRootPath`/`watcher`/`debounceTimer` in ide-fs-handlers.ts with an `IdeFsSession` class. |
| T-33 | P2 | ⏳ | clean-code | Extract `canonicalizeTargetPath` from `validateIdePath` (ide-fs-handlers.ts:53-94). |
| T-34 | P2 | ⏳ | arch | Remove module-level `specQualityService` singleton (workbench.ts:22) — pass via `AppHandlerDeps`. |

### `src/main/services/*`

| ID | Sev | Status | Lens(es) | Summary |
|---|---|---|---|---|
| T-35 | P1 | ⏳ | arch | Resolve `sprint-service` shim: delete the barrel and update imports, OR promote it to the real service and delete the split. (15+ consumers.) |
| T-36 | P2 | ⏳ | arch | Move `getRepoPaths` out of top-level `git.ts` into a repo-config service. Touches 5 importers. |
| T-37 | P1 | ⏳ | arch | Remove module-level `repo = createSprintTaskRepository()` singleton from sprint-mutations.ts (and siblings in review-orchestration-service, review-ship-batch). |
| T-38 | P1 | ⏳ | arch | Introduce a port for services→agent-manager; fix 6 services that import `AgentManager` type directly (operational-checks, status-server, review-service, spec-generation-service, spec-synthesizer, task-terminal-service). |
| T-39 | P1 | ⏳ | clean-code | Split `classifyReviewAction` (review-action-policy.ts:112-336) into per-action builders + dispatch map. |
| T-40 | P1 | ⏳ | clean-code | Replace 5× `new Date().toISOString()` (review-action-policy.ts:173,210,234,276,326) with `nowIso()`. |
| T-41 | P3 | ⏳ | clean-code | Delete ASCII banner comments in review-action-policy.ts. **Depends on T-39.** |
| T-42 | P2 | ⏳ | clean-code | Replace `executeGitOp` switch (review-action-executor.ts:68-277) with per-op-type strategy. |
| T-43 | P2 | ⏳ | arch | Inject `fs`/`execFile` deps in review-action-executor.ts OR drop "all I/O via deps" doc claim. |
| T-44 | P3 | ⏳ | arch | Replace `ExecutorState` state-bag (review-action-executor.ts:47-58) with typed per-op results. |
| T-45 | P2 | ⏳ | clean-code | Extract condition predicates from `areDependenciesSatisfied` (dependency-service.ts:109-149). |
| T-46 | P2 | ⏳ | clean-code | Extract classifiers from `resolveClaude`/`resolveGithub` (credential-service.ts:194-245). |
| T-47 | P2 | ⏳ | arch | Fix `getDefaultCredentialService` (credential-service.ts:286) — caches first logger, silently ignores subsequent. |
| T-48 | P3 | ⏳ | arch | Wrap `loadedPlugins` in a `PluginRegistry` class (plugin-loader.ts:10). |
| T-49 | P3 | ⏳ | arch | Wrap sampler globals in a `LoadSampler` class (load-sampler.ts:13). |

### `src/main/data/*`

| ID | Sev | Status | Lens(es) | Summary |
|---|---|---|---|---|
| T-50 | P1 | ⏳ | clean-code | Split `writeTaskUpdate` (sprint-task-crud.ts:352-462) — 110 LOC god function. Extract `enforceTransitionOrThrow`, `computeChangedEntries`, `buildUpdateSql`, `buildAuditPatch`. |
| T-51 | P2 | ⏳ | clean-code | Separate SET-clause assembly from audit-patch build (sprint-task-crud.ts:392-427). **Depends on T-50.** |
| T-52 | P3 | ⏳ | clean-code | Inline or rename thin-cast helpers `asSprintTaskField`/`toAuditableTask` (sprint-task-crud.ts:333-350). |
| T-53 | P2 | ⏳ | arch | Delete composite `ISprintTaskRepository` (sprint-task-repository.ts:121); force sub-interface imports. |
| T-54 | P2 | ⏳ | arch | Move `WebhookConfig` (webhook-queries.ts:8) from services/ import to `src/shared/types/`. |

### `src/main/` (top level)

| ID | Sev | Status | Lens(es) | Summary |
|---|---|---|---|---|
| T-55 | P2 | ⏳ | clean-code | Move one-time migrations out of `agent-history.ts:39-81,250-309,387-429` into `src/main/migrations/`. |
| T-56 | P2 | ⏳ | clean-code | Split `pruneOldAgents` (agent-history.ts:243-277) into db/fs/empty-dir passes. |
| T-57 | P2 | ⏳ | clean-code | Split `spawnAdhocAgent` (adhoc-agent.ts:82-437) — 355 LOC — into `AdhocSessionBuilder`. |
| T-58 | P2 | ⏳ | clean-code | Remove inline `require('./db')` with eslint-disable (adhoc-agent.ts:324). |
| T-59 | P3 | ⏳ | clean-code | Rename/rewrap single-yield multimodal generator (adhoc-agent.ts:210-237). |
| T-60 | P2 | ⏳ | clean-code | Split `refreshOAuthTokenFromKeychain` (env-utils.ts:304-392) into read/refresh/persist. |
| T-61 | P2 | ⏳ | clean-code | Replace `console.warn` with `logger.warn` in env-utils.ts:367-369,378-379. |
| T-62 | P2 | ⏳ | clean-code | Replace `isNonTrivialError` substring-matching (bootstrap.ts:51-63) with typed errors. |
| T-63 | P2 | ⏳ | clean-code | Introduce `schedulePeriodic` helper; declare 4 cleanup tasks declaratively (bootstrap.ts:238-314). |
| T-64 | P2 | ⏳ | clean-code | Split github-fetch.ts:158-216 retry loop into per-failure-mode handlers. |
| T-65 | P2 | ⏳ | clean-code | Replace `classifyHttpError` if-cascade (github-fetch.ts:302-355) with status→factory lookup. |
| T-66 | P2 | ⏳ | arch | Re-home 40 top-level `src/main/*.ts` files into domain folders: `agents/`, `github/`, `windowing/`, `settings/`, `platform/`. **Do last.** |
| T-67 | P2 | ⏳ | arch | Delete top-level `src/main/cost-queries.ts` shim; update 5 callers to import from `src/main/data/cost-queries.ts`. |

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

| Suite | Files | Tests |
|---|---|---|
| `npm test` | 312 | 3740 passed + 6 skipped |
| `npm run test:main` | 205 | 3258 |
| Lint | — | 0 errors / 32 warnings |

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

The Edit-tool security hook pattern-matches shell-style invocations. If you pass a backtick template literal directly to a `db.exec(...)` call on the same line, the hook will block the edit. Workaround: assign the SQL to `const sql = \`...\`` on one line, then pass `sql` to the db method on the next. Pattern visible in `src/main/db.ts` and any multi-statement migration.

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
