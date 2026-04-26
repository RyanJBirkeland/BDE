# ADR: Pipeline correctness baseline (Phase A)

**Date:** 2026-04-25
**Status:** Accepted
**Source:** Pipeline reliability/performance/product audit, 2026-04-25

## Context

The 2026-04-25 audit of BDE's core pipeline (Sprint Pipeline + Agent Manager + Code Review handoff) returned 73 findings across 6 lenses. Five P0 and twenty-two P1 issues share a common trait: each one can leave a sprint task in a corrupted or unrecoverable state — dependents stranded `blocked`, zombie Claude processes after shutdown, half-terminal rows the UI cannot resolve, retry queues that grow without bound, or high-blast-radius logic with zero direct test coverage.

These are correctness defects, not polish. They must land before any architectural refactor or performance work in this area. A faster god-class is still a god-class that loses tasks.

## Decision

We declare a named milestone called **Phase A — pipeline correctness baseline**. The milestone is owned by the openspec change `pipeline-stop-the-bleeding`, which is a *coordination* change: it does not introduce new application capabilities by itself. Instead it ratifies a set of testable invariants and gates the merge of a set of constituent `ep*` changes (`ep1`, `ep2`, `ep3`, `ep4`, `ep5`, `ep8`, `ep16`) plus a small set of net-new audit tasks on satisfying those invariants.

The invariants are mechanically verifiable by `scripts/audit-phase-a.mjs` (run via `npm run audit:phase-a`). CI invokes the script on every PR. While Phase A is in flight, the script is *advisory* in CI — it warns but does not block. Once every constituent change has landed, the script becomes a hard gate.

## Invariants

The script enforces nine invariants, all sourced from `openspec/changes/pipeline-stop-the-bleeding/specs/pipeline-correctness-baseline/spec.md`:

1. **Single chokepoint for terminal status writes.** No direct `repo.updateTask({ status: <terminal> })` outside `TaskStateService` (and the data-layer assertion in `sprint-task-crud.ts`).
2. **Bounded PR-poller retry queue.** `sprint-pr-poller.ts` defines `MAX_PENDING_TASKS` and emits `terminal-retry.evicted` / `terminal-retry.exhausted` structured events.
3. **`setupWorktree` releases its lock via try/finally.** No catch+release+rethrow patterns that can leak the lock when cleanup itself throws.
4. **`git rev-list` failure is failure.** `resolve-success-phases.ts` does not fall through to `return true` when the rev-list precondition check throws.
5. **Orphan recovery routes through `TaskStateService`.** The exhausted-orphan branch does not write `status='error'` directly; the call goes through `taskStateService.transition()` so dependents are resolved.
6. **High-blast-radius functions have direct unit tests.** Test files exist for `updateTaskFromUi`, `transitionToReview`, `handleWatchdogVerdict`, `resolveNodeExecutable`, the assistant/copilot/synthesizer prompt builders, and `sprint-export-handlers`.
7. **`forceReleaseClaim` aborts the live agent before re-queuing.** The handler invokes `cancelAgent` (or equivalent) and confirms the agent is gone before changing status.
8. **OAuth refresh is coordinated with the next spawn.** `agent-manager` exposes `awaitOAuthRefresh()` and `message-consumer` registers the in-flight refresh promise on it.
9. **The Phase A spec file exists** (`openspec/changes/pipeline-stop-the-bleeding/specs/pipeline-correctness-baseline/spec.md`).

## Consequences

**Positive.** Every reviewer of every Phase-A-relevant PR sees an immediate, mechanical signal of whether the change moves the pipeline correctness invariants forward or backward. The script is the single source of truth — invariants do not drift in someone's head.

**Trade-offs.**
- The grep-based gate is structural, not semantic. It catches "no direct status write outside TaskStateService" but not "the call you added to TaskStateService is wrong." Unit tests in the constituent changes own the semantic gate.
- The script depends on `ripgrep` being available. CI installs it; locally most developer machines already have `rg` via Homebrew or apt.
- Adding a new invariant means editing the script. This is intentional — the invariant must be code-checkable to count.

**Out of scope** (these belong to Phase B / Phase C, not this ADR):
- Architectural decomposition of `AgentManagerImpl` / `run-agent.ts` / `completion.ts`.
- Performance work (statement caching, dep-index narrowing, renderer virtualization).
- Product-completeness gaps (missing `case 'review'` action set, `max_runtime_ms` UI, etc.).

## Migration plan

1. The constituent `ep*` changes land independently in dependency order. Each adds back-references in its own `tasks.md` to the invariant it satisfies.
2. Net-new audit tasks (T-1, T-3, T-12, T-13, T-14, T-8, T-10, T-16, T-19, T-21, T-58, T-56, T-55, T-25, T-23, T-5, T-7, T-9, T-67, T-68, T-69, T-6) land as small focused PRs grouped by file.
3. Once `npm run audit:phase-a` is green on `main`, flip the CI step from advisory (`|| echo ::warning::`) to required.
4. Archive `pipeline-stop-the-bleeding` once every constituent `ep*` change is archived AND the script is green AND `test:coverage` and `test:main` are green on `main`.
