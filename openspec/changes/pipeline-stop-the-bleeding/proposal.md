## Why

The 2026-04-25 pipeline audit (reliability + performance + product completeness, 6 lenses, 73 findings) surfaced five P0 and twenty-two P1 issues that share one trait: each one can leave a task in a corrupted or unrecoverable state — dependents stranded `blocked`, zombie Claude processes after shutdown, half-terminal rows the UI cannot resolve, retry queues that grow unbounded, and high-blast-radius functions (`updateTaskFromUi`, `transitionToReview`, `handleWatchdogVerdict`) with zero direct tests. These are correctness defects, not polish. They must land before any architectural refactor or performance work; a faster god-class is still a god-class that loses tasks. Phase A is the "stop the bleeding" milestone — when it merges, BDE's pipeline is *correct*, even if not yet pretty.

## What Changes

This is a **coordination change**: it doesn't introduce new application capabilities by itself. Instead it sequences and tightens the contract on a set of existing `ep*` change proposals plus a small set of net-new audit tasks, so that the union of their merges produces an observable correctness baseline.

- **NEW** Capability `pipeline-correctness-baseline` defining the testable invariants that mark Phase A complete (single terminal-write chokepoint; bounded retry queues; watchdog cleanup ordering; per-task crash-loop cap; test-coverage minimums on critical state-mutation functions)
- **Pulls forward and gates on**:
  - `ep1-unified-task-state-machine` (terminal-state chokepoint — covers audit T-1, T-3, T-14, T-34, T-35)
  - `ep2-agent-manager-reliability` (drain deadline, run-agent split — partial overlap with audit T-21)
  - `ep3-crash-recovery` (orphan-recovery cap — covers audit-adjacent crash-loop concerns)
  - `ep4-worktree-lock-concurrency` (atomic file lock, stale-lock detection — covers audit T-58)
  - `ep5-watchdog-circuit-breaker` (spawn-phase-only circuit breaker, fast-fail temporal window, watchdog double-fire — covers audit T-17)
  - `ep8-pr-poller-liveness` (per-poll timeout, retry queue, in-app auth/rate-limit signal — covers audit T-25)
  - `ep16-test-coverage-hygiene` (claim-race integration test, migration tests — partial overlap with audit T-5/T-7/T-9)
- **Net-new tasks not yet covered by existing `ep*` changes**:
  - T-12 — `git rev-list` failure must transition the task to `failed`, not assume success and promote to `review`
  - T-13 — `autoCommitPendingChanges` failure must route to the failure pipeline, not continue to rebase
  - T-8 — `transitionToReview` must have a fallback status (not log-and-swallow) when `transition()` itself throws
  - T-10 — `forceReleaseClaim` must abort the running agent before re-queuing
  - T-16 — Watchdog must await worktree cleanup (or hold a per-task lock) before allowing the next claim
  - T-19 — Pre-spawn dirty-main failure must clean up the already-created worktree
  - T-21 — Drain-loop dep-index full-rebuild failure must keep `_depIndexDirty=true`, not clear it
  - T-56 — `pendingSpawns` decrement must be try/finally-guarded so an `onAgentRegistered` throw cannot leak the counter
  - T-55 — OAuth refresh must coordinate with the next spawn (no fire-and-forget)
  - T-23 — `readQueueDepth` must distinguish "queue empty" from "stats query failed"
  - T-5 — Direct unit tests for `updateTaskFromUi`
  - T-7 — Direct unit tests for `transitionToReview`
  - T-9 — Direct unit tests for `handleWatchdogVerdict` four verdict branches
  - T-6 — Assert `createTaskWithValidation` auto-blocking branch
  - T-67 — Tests for `resolveNodeExecutable` fnm/nvm/Homebrew probing
  - T-68 — Tests for assistant/copilot/synthesizer prompt builders (XML-tag boundary cases)
  - T-69 — Tests for `sprint-export-handlers`
- **BREAKING**: none. Phase A is correctness-only; no public IPC surface or DB schema changes that aren't already absorbed by the constituent `ep*` proposals.

## Capabilities

### New Capabilities

- `pipeline-correctness-baseline`: A set of testable invariants that mark "Phase A done" — single chokepoint for terminal status writes, bounded growth on every retry/queue structure, watchdog kill→cleanup→reclaim ordering guarantee, per-task orphan-recovery cap, and a defined coverage floor on state-mutating functions. This capability does not own implementation; it owns the **contract** that the constituent `ep*` changes plus the net-new tasks above must satisfy.

### Modified Capabilities

(none — no existing requirement-level behaviors change beyond what is already declared in the constituent `ep*` proposals)

## Impact

- **Process**: every constituent `ep*` change listed above is gated on contributing to the `pipeline-correctness-baseline` invariants; their `tasks.md` files should reference this proposal as the milestone they sum to.
- **Code**:
  - `src/main/services/task-terminal-service.ts`, `src/main/agent-manager/terminal-handler.ts` — collapse via `ep1`
  - `src/main/agent-manager/orphan-recovery.ts` — terminal-state route via `ep1` + cap via `ep3`
  - `src/main/agent-manager/resolve-failure-phases.ts`, `resolve-success-phases.ts`, `completion.ts`, `review-transition.ts` — terminal write path corrections (T-3, T-12, T-13, T-14, T-8)
  - `src/main/agent-manager/watchdog-loop.ts`, `worktree.ts` — cleanup ordering and lock try/finally (T-16, T-17, T-58)
  - `src/main/agent-manager/run-agent.ts`, `spawn-and-wire.ts`, `message-consumer.ts`, `drain-loop.ts` — race and ordering fixes (T-19, T-21, T-55, T-56, T-23)
  - `src/main/handlers/sprint-local.ts` — `forceReleaseClaim` abort sequencing (T-10)
  - `src/main/sprint-pr-poller.ts` — bounded retry queue via `ep8` (T-25)
  - `src/main/services/sprint-use-cases.ts`, agent-manager prompt builders, sprint-export-handlers, `resolve-node.ts` — direct test coverage (T-5, T-6, T-7, T-9, T-67, T-68, T-69)
- **Tests**: all new tests must run inside the existing vitest config (no new test runner). CI gate: `npm run test:coverage` and `npm run test:main` both green; coverage on the listed state-mutation functions ≥90% line and branch.
- **Docs**: `docs/architecture-decisions/` gains an ADR snapshot describing the correctness baseline so future audits can grep for it.
- **Risk**: low — every change is local, additive, or replaces a buggy code path with a correct one. The constituent `ep*` changes already have their own design and task breakdown.
