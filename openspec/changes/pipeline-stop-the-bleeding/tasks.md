## 1. Constituent ep* changes — back-reference and gating

- [x] 1.1 Add a one-line back-reference in `openspec/changes/ep1-unified-task-state-machine/tasks.md` noting it satisfies the "single chokepoint" invariant in `pipeline-correctness-baseline`
- [x] 1.2 Add the same back-reference in `ep3-crash-recovery/tasks.md` for the "crash-loop cap" invariant
- [x] 1.3 Add the back-reference in `ep4-worktree-lock-concurrency/tasks.md` for the "setupWorktree never leaks the lock" invariant
- [x] 1.4 Add the back-reference in `ep5-watchdog-circuit-breaker/tasks.md` for the "force-kill escalation reaches SIGKILL on shutdown" invariant
- [x] 1.5 Add the back-reference in `ep8-pr-poller-liveness/tasks.md` for the "bounded retry queues" invariant
- [x] 1.6 Add the back-reference in `ep16-test-coverage-hygiene/tasks.md` for the "direct test coverage on high-blast-radius state mutators" invariant
- [x] 1.7 Confirm `ep2-agent-manager-reliability` covers drain-deadline (audit T-21 lives in this proposal, not ep2 — make sure ep2's tasks list does not also touch the dep-index dirty flag)

## 2. Net-new: terminal-write correctness (audit T-1, T-3, T-12, T-13, T-14, T-8)

- [ ] 2.1 (T-1) Replace `repo.updateTask({ status: 'error', ... })` in `src/main/agent-manager/orphan-recovery.ts:54` with `taskStateService.transition(taskId, 'error', { failure_reason: 'exhausted: orphan recovery cap reached' })`; ensure `onTaskTerminal(taskId, 'error')` fires
- [ ] 2.2 (T-1) Add a unit test asserting `resolveDependents` is invoked exactly once when the exhausted-orphan path runs
- [ ] 2.3 (T-3) In `src/main/agent-manager/resolve-failure-phases.ts:97`, change the catch block from `return isTerminal` to rethrow (or `return false`) and emit `logger.event('failure.persist_failed', { taskId })`
- [ ] 2.4 (T-3) Add a unit test that simulates `updateTask` throwing inside `resolveFailure` and asserts the caller does not invoke `onTaskTerminal`
- [ ] 2.5 (T-14) In `src/main/agent-manager/completion.ts:491`, replace the direct `repo.updateTask({ status: 'failed', ... })` on tip-mismatch with `taskStateService.transition(taskId, 'failed', ...)` followed by `await onTaskTerminal(taskId, 'failed')`
- [ ] 2.6 (T-14) Update the existing tip-mismatch test (or add one) to assert the audit-trail entry is created
- [ ] 2.7 (T-12) In `src/main/agent-manager/resolve-success-phases.ts:438`, change the `git rev-list` catch block from `return true` to call `taskStateService.transition(taskId, 'failed', { failure_reason: 'git-precondition-failed', notes: <git stderr> })`
- [ ] 2.8 (T-12) Add a unit test that mocks `execFileAsync('git', ['rev-list', ...])` rejecting and asserts the task does not reach `review`
- [ ] 2.9 (T-13) In `src/main/agent-manager/resolve-success-phases.ts:308`, route `autoCommitPendingChanges` failure to the failure pipeline instead of continuing to rebase; add `failure_reason: 'auto-commit-failed'`
- [ ] 2.10 (T-13) Add a unit test asserting that an auto-commit failure prevents the rebase phase and does not promote the task to `review`
- [ ] 2.11 (T-8) In `src/main/agent-manager/review-transition.ts:64`, on `transition(taskId, 'review', ...)` throw, call `taskStateService.transition(taskId, 'failed', { failure_reason: 'review-transition-failed' })` and emit `logger.event('review-transition.fallback', { taskId })`
- [ ] 2.12 (T-8) Add a unit test exercising the fallback path

## 3. Net-new: lifecycle race fixes (audit T-10, T-16, T-19, T-21, T-58, T-56, T-55, T-23)

- [ ] 3.1 (T-10) In `src/main/handlers/sprint-local.ts:253`, before changing `forceReleaseClaim`'s status to `queued`, await `agentManager.cancelAgent(taskId)` and verify the agent is removed from `activeAgents`; if cancellation fails within 10 s, surface a structured error to the IPC caller and do NOT change status
- [ ] 3.2 (T-10) Add an integration test that holds an agent live, calls `sprint:forceReleaseClaim`, and asserts the agent is gone before the task transitions
- [ ] 3.3 (T-16) Add an in-process `Map<taskId, Promise<void>>` "cleanup-in-flight" registry in `agent-manager` (likely in `worktree-lifecycle.ts`)
- [ ] 3.4 (T-16) Wire the watchdog's `cleanupAgentWorktree` invocation to register its promise in the registry; clear it on resolve/reject
- [ ] 3.5 (T-16) In `task-claimer.ts` (or wherever `setupWorktree` is invoked from the drain loop), await any registered cleanup promise for the same `taskId` before calling `setupWorktree`
- [ ] 3.6 (T-16) Add an integration test that watchdog-kills an agent and immediately re-queues the same task; assert no `git worktree add` ENOENT/EEXIST and assert ordering via the registry
- [ ] 3.7 (T-19) In `src/main/agent-manager/run-agent.ts:710`, before transitioning to `error` on dirty-main failure, call `cleanupWorktreeWithRetry(agent)` and assert no throw; log at WARN if cleanup itself fails
- [ ] 3.8 (T-19) Add a unit test asserting the worktree directory is removed after the dirty-main pre-spawn rejection
- [ ] 3.9 (T-21) In `src/main/agent-manager/drain-loop.ts:172`, change the catch block: do NOT clear `_depIndexDirty`, do NOT fall back to incremental refresh; emit `logger.event('drain.dep_rebuild_failed', { tickId, error })` and return early so the next tick retries the full rebuild
- [ ] 3.10 (T-21) Add a unit test that throws from `getTasksWithDependencies` and asserts `_depIndexDirty` remains true and `lastTaskDeps` is unchanged
- [ ] 3.11 (T-58) In `src/main/agent-manager/worktree.ts:330`, replace the manual catch+release pattern with `try { ... } finally { releaseLock(...) }` around the locked region; remove the duplicated success-path release
- [ ] 3.12 (T-58) Add a unit test that throws from `addWorktree` after `acquireLock` succeeds and asserts `releaseLock` is called exactly once
- [ ] 3.13 (T-56) In `src/main/agent-manager/spawn-and-wire.ts:158`, wrap the `onAgentRegistered` invocation in `try { ... } finally { decrementPendingSpawns() }`; ensure a throwing hook does not prevent decrement
- [ ] 3.14 (T-56) Add a unit test that throws from `onAgentRegistered` and asserts `getPendingSpawns()` returns 0 afterward
- [ ] 3.15 (T-55) Expose an `awaitOAuthRefresh()` (or in-flight-refresh promise) on `agentManager`; in `message-consumer.ts:82`, store the in-flight refresh promise on the manager
- [ ] 3.16 (T-55) In the drain loop pre-spawn check, await `awaitOAuthRefresh()` if a refresh is in flight before proceeding to spawn
- [ ] 3.17 (T-55) Add an integration test simulating concurrent auth-failure refresh and a drain-loop spawn; assert the spawn awaits the refresh
- [ ] 3.18 (T-23) In `src/main/agent-manager/drain-loop.ts:277`, change `readQueueDepth`'s `catch { return 0 }` to return `null` and have the broadcast payload show `affectedTaskCount: null`
- [ ] 3.19 (T-23) Add a unit test asserting the unknown-sentinel surface when stats query throws

## 4. Net-new: bounded retry queue (audit T-25)

- [ ] 4.1 (T-25) In `src/main/sprint-pr-poller.ts:130`, add `MAX_PENDING_TASKS` (default 256) and an LRU eviction strategy on `pendingTerminalRetries`
- [ ] 4.2 (T-25) Emit `logger.event('terminal-retry.evicted', { taskId, attempts })` on eviction
- [ ] 4.3 (T-25) Emit `logger.event('terminal-retry.exhausted', { taskId, attempts })` when a task hits `MAX_TERMINAL_RETRY_ATTEMPTS` and is dropped
- [ ] 4.4 (T-25) Add a unit test that pushes >256 distinct tasks into the queue and asserts the oldest entry is evicted with an event

## 5. Net-new: high-blast-radius test coverage (audit T-5, T-6, T-7, T-9, T-67, T-68, T-69)

- [ ] 5.1 (T-5) Create `src/main/services/__tests__/sprint-use-cases.update.test.ts` with ≥10 cases for `updateTaskFromUi`: allowlist rejection, status narrowing, queued→blocked auto-block trigger, optimistic update fields, validation-failure rollback
- [ ] 5.2 (T-7) Create `src/main/agent-manager/__tests__/review-transition.test.ts` with cases for: happy path, diff-snapshot failure, rebase fields present, rebase fields absent, fallback-to-`failed` on transition throw
- [ ] 5.3 (T-9) Create `src/main/agent-manager/__tests__/watchdog-handler.test.ts` with one test per verdict (`max-runtime`, `idle`, `rate-limit-loop`, `cost-budget-exceeded`) asserting `taskUpdate` shape, `shouldRequeue`, `applyBackpressure`
- [ ] 5.4 (T-67) Create `src/main/agent-manager/__tests__/resolve-node.test.ts` with cases for fnm probe, nvm highest-version probe, Homebrew arm64/x86_64 probes, ambient PATH fallback
- [ ] 5.5 (T-68) Create `src/main/agent-manager/__tests__/prompt-assistant.test.ts`, `prompt-copilot.test.ts`, `prompt-synthesizer.test.ts`; each must include at least one boundary-tag injection case (e.g. user content containing `</user_spec>`) and assert the resulting prompt's boundary tags survive
- [ ] 5.6 (T-69) Create `src/main/handlers/__tests__/sprint-export-handlers.test.ts` with cases for happy path, empty result, malformed input, IO failure
- [ ] 5.7 (T-6) In the existing `sprint-service.create.test.ts` (or equivalent), add a case that creates a task with `depends_on: [{id: <not-done>, type: 'hard'}]` and asserts `status: 'blocked'`
- [ ] 5.8 Add per-file vitest coverage thresholds (≥90% line and branch) for: `sprint-use-cases.ts:updateTaskFromUi`, `review-transition.ts`, `watchdog-handler.ts`, `resolve-node.ts`, `prompt-assistant.ts`, `prompt-copilot.ts`, `prompt-synthesizer.ts`

## 6. Audit script and CI gate

- [x] 6.1 Create `scripts/audit-phase-a.mjs` that mechanically verifies each invariant in `pipeline-correctness-baseline/spec.md` (9 invariants implemented; written as `.mjs` since the project has no `tsx`/`ts-node` devDep)
- [x] 6.2 Add `npm run audit:phase-a` script in `package.json`
- [x] 6.3 Add a CI step that runs `npm run audit:phase-a` on every PR. Currently advisory (`|| echo ::warning::`); flip to required once the script is green on `main`. Also installs `ripgrep` in CI.
- [x] 6.4 Document the script and the invariants it checks in `docs/architecture-decisions/pipeline-correctness-baseline.md`

## 7. Archive criteria

- [ ] 7.1 Confirm every constituent `ep*` change listed in §1 is itself archived (not just merged)
- [ ] 7.2 Confirm `npm run audit:phase-a` is green on `main`
- [ ] 7.3 Confirm `npm run test:coverage` and `npm run test:main` are green on `main`
- [ ] 7.4 Run `openspec archive pipeline-stop-the-bleeding`
