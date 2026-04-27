## Context

`AgentManagerImpl` (`src/main/agent-manager/index.ts`) started as the monolithic orchestrator for all pipeline-agent lifecycle concerns. Phase-A work extracted `LifecycleController` (timer handles), `WipTracker` (slot queries), `ErrorRegistry` (circuit-breaker + fast-fail), and `AgentManagerTestInternals` (typed test seam). That work left five problems unresolved:

1. **`_activeAgents`, `_processingTasks`, `_agentPromises`, `_pendingSpawns`** — four mutable collections still on `AgentManagerImpl`; every consumer (`run-agent`, `task-claimer`, `watchdog-loop`, `shutdown-coordinator`) receives them as raw Map/Set refs, coupling each to the manager's field layout.
2. **`_terminalCalled`** — idempotency Map for `onTaskTerminal` lives inline on the manager; there is no named concept for "guard a terminal call".
3. **`_spawnAgent`** — 80-line method mixes metrics increment, concurrency accounting, `runAgent` dispatch, circuit-breaker recording, and claim-release fallback in one body.
4. **`_drainFailureCounts`** getter exposes `ErrorRegistry`'s internal Map by reference — the Map leaks across the `ErrorRegistry` boundary and is mutated externally in `drain-loop.ts`.
5. **`_`-prefix convention** — "private by convention" is not enforced by the compiler; tests currently reach through `_` directly, and any rename breaks 35+ sites.

The existing `AgentManagerTestInternals` seam already decouples tests from field names. This change completes the structural work so the seam is the only test-access path, all collections live in named collaborators, and `AgentManagerImpl` reads as a thin composition root.

## Goals / Non-Goals

**Goals:**
- Introduce `SpawnRegistry` to own `activeAgents`, `processingTasks`, `agentPromises`, and `pendingSpawns` with a verb-shaped mutation API.
- Introduce `TerminalGuard` to own the `_terminalCalled` idempotency Map and expose `guardedCall(taskId, fn)`.
- Decompose `_spawnAgent` into `incrementSpawnAccounting`, `dispatchToRunAgent`, `recordCircuitBreakerFailure`, `releaseClaimAsLastResort`.
- Replace the `drainFailureCounts` Map ref on `ErrorRegistry` with `incrementFailure` / `clearFailure` / `failureCountFor` verb methods; update `DrainLoopDeps` accordingly.
- Convert all remaining `_`-prefix fields on `AgentManagerImpl` to real TypeScript `private`; expose through `__testInternals` only.
- Serialize startup orphan recovery so it runs exactly once before the first drain tick.
- Zero behavior change — observable behavior (task status transitions, event emission, concurrency limits, error handling) stays identical.

**Non-Goals:**
- Moving `run-agent.ts`, `task-claimer.ts`, or `drain-loop.ts` business logic.
- Changing IPC channels or renderer-facing contracts.
- Introducing new npm packages.
- Addressing T-36 (phase-a-bypass in `_spawnAgent` claim release) — that is a separate concern.

## Decisions

### D1 — `SpawnRegistry` owns the four mutable spawn-tracking collections

**Decision:** Create `src/main/agent-manager/spawn-registry.ts` with a class that holds `activeAgents`, `processingTasks`, `agentPromises`, and `pendingSpawns` and exposes named verb methods.

**Rationale:** All four collections answer the question "what agents are in-flight right now?" — they belong together in one cohesive class. Verb methods (`registerAgent`, `removeAgent`, `trackPromise`, `incrementPendingSpawns`, etc.) make call sites read like prose and prevent callers from reaching past the abstraction to mutate the Map directly.

**API sketch:**
```typescript
class SpawnRegistry {
  registerAgent(agent: ActiveAgent): void
  removeAgent(taskId: string): void
  getAgent(taskId: string): ActiveAgent | undefined
  hasActiveAgent(taskId: string): boolean
  allAgents(): IterableIterator<ActiveAgent>
  activeAgentCount(): number

  markProcessing(taskId: string): void
  unmarkProcessing(taskId: string): void
  isProcessing(taskId: string): boolean

  trackPromise(p: Promise<void>): void
  forgetPromise(p: Promise<void>): void
  allPromises(): IterableIterator<Promise<void>>

  incrementPendingSpawns(): void
  decrementPendingSpawns(): void
  pendingSpawnCount(): number
}
```

**Alternative considered:** Keep the four collections on `AgentManagerImpl` but add accessor methods. Rejected: accessors that return the underlying Map still let callers mutate through the reference — the abstraction leaks.

### D2 — `TerminalGuard` wraps the idempotency Map

**Decision:** Create `src/main/agent-manager/terminal-guard.ts` with a class that owns the `taskId → Promise<void>` Map and exposes `guardedCall(taskId: string, fn: () => Promise<void>): Promise<void>`.

**Rationale:** The idempotency pattern (check map, if present return existing promise, else run fn + store + cleanup in finally) is a reusable concept that belongs in its own file with a name. `TerminalGuard` is unambiguous: it guards the terminal-call entry point.

**Alternative considered:** Keep the Map on `AgentManagerImpl` and document the pattern in comments. Rejected: comments explain; class names communicate intent to the reader at a glance.

### D3 — `ErrorRegistry` verb API replaces the exposed Map ref

**Decision:** Add `incrementFailure(taskId)`, `clearFailure(taskId)`, `failureCountFor(taskId)` to `ErrorRegistry`. Make `drainFailureCounts` private. Update `DrainLoopDeps` to accept a `drainErrorRegistry` interface (or the three verb callbacks) instead of `drainFailureCounts: Map<string, number>`.

**Rationale:** `drain-loop.ts` currently receives the Map by reference and mutates it externally — this crosses the `ErrorRegistry` boundary. Verb methods restore encapsulation. `DrainLoopDeps` is already a well-defined struct; replacing `drainFailureCounts` with verb callbacks or a sub-interface is a localized change with no behavioral impact.

**DrainLoopDeps change:**
```typescript
// Before
drainFailureCounts: Map<string, number>

// After — option A: three callbacks (preferred, no new type)
incrementDrainFailure: (taskId: string) => void
clearDrainFailure: (taskId: string) => void
drainFailureCountFor: (taskId: string) => number
```

Option A is preferred: pure verb injection with zero new types, consistent with how `onTaskTerminal` and `isShuttingDown` are already expressed in `DrainLoopDeps`.

### D4 — `_spawnAgent` decomposed into four named functions

**Decision:** Keep `_spawnAgent` as the orchestrating function; extract its four responsibilities as private methods or inner functions in the same file: `incrementSpawnAccounting`, `dispatchToRunAgent`, `recordCircuitBreakerFailure`, `releaseClaimAsLastResort`.

**Rationale:** The current body mixes concerns at three different abstraction levels (metrics, concurrency accounting, agent dispatch, error recovery). Each extracted name is self-documenting at the call site; the orchestrating method reads like a four-line story.

**Extracted helpers:**
```typescript
private incrementSpawnAccounting(): { decrementPendingOnce: () => void }
private async dispatchToRunAgent(task, worktree, repoPath, deps): Promise<void>
private recordCircuitBreakerFailure(taskId: string, err: unknown, spawnPhaseReported: boolean): void
private releaseClaimAsLastResort(taskId: string, err: unknown): void
```

### D5 — Startup orphan race serialized via promise chaining

**Decision:** Remove the fire-and-forget `kickOffOrphanRecovery()` call in `start()`. Let `_scheduleInitialDrain()` remain the single site that runs orphan recovery before the first drain tick. The periodic orphan timer continues to run independently (it checks `isActiveAgent` before re-queueing, so a re-run is safe but wasteful — eliminating the duplicate is the goal).

**Rationale:** Two concurrent orphan-recovery calls can produce duplicate re-queue writes: the first run marks a task `queued`, and the second run sees it `active` (or vice versa depending on timing) and makes an inconsistent decision. Serializing removes the race without changing observable behavior — orphan recovery still completes before the first drain tick.

**Alternative considered:** Add a guard flag. Rejected: a flag is just a comment in code; removing the duplicate call is cleaner.

### D6 — Real `private` keyword, single `__testInternals` seam

**Decision:** Convert all remaining `_`-prefix fields on `AgentManagerImpl` to TypeScript `private`. The `AgentManagerTestInternals` seam in `agent-manager-test-internals.ts` is updated to delegate through `SpawnRegistry` and `TerminalGuard` for the moved fields. Tests that currently access `mgr._activeAgents` etc. are updated to use `mgr.__testInternals.activeAgents`.

**Rationale:** `private` is enforced at compile time; `_` is enforced by trust. The seam already exists and is the right place for test access — making it the only path is the completion of work that started in Phase-A.

## Risks / Trade-offs

- **`SpawnRegistry` passed to multiple modules** — `run-agent.ts`, `task-claimer.ts`, `watchdog-loop.ts`, and `shutdown-coordinator.ts` all accept the spawn-tracking collections today. Passing `SpawnRegistry` instead requires updating their `*Deps` interfaces. Risk: merge conflicts if another branch also touches those interfaces. Mitigation: keep changes minimal — replace the four Map/Set fields with a single `spawnRegistry: SpawnRegistry` field in each deps struct.

- **`DrainLoopDeps` change** — adding three verb callbacks to `DrainLoopDeps` is a non-breaking addition if the old `drainFailureCounts` field is kept as optional during transition. Risk: tests that stub `DrainLoopDeps` must be updated. Mitigation: update all test stubs in the same commit; the test surface is localized to `__tests__/drain-loop.test.ts`.

- **Startup race fix changes test timing** — tests that call `start()` and expect orphan recovery to fire twice will no longer see the duplicate. Risk: a test assertion breaks. Mitigation: review `__tests__/index*.test.ts` for orphan-recovery call count assertions before committing.

- **`TerminalGuard` seam in tests** — tests that set `_terminalCalled` directly (e.g., to pre-seed a duplicate-call scenario) must be updated to use `__testInternals.terminalGuard`. Mitigation: the seam makes this a one-file change.

## Migration Plan

1. Create `SpawnRegistry` and its tests (`spawn-registry.test.ts`).
2. Create `TerminalGuard` and its tests (`terminal-guard.test.ts`).
3. Update `ErrorRegistry` with verb methods; update `DrainLoopDeps`; update `drain-loop.ts` call sites.
4. Update `AgentManagerImpl` constructor to instantiate `SpawnRegistry` and `TerminalGuard`; wire into `runAgentDeps`.
5. Decompose `_spawnAgent` into named helpers.
6. Update all `*Deps` interfaces that currently accept the raw Maps (`run-agent.ts`, `task-claimer.ts`, `watchdog-loop.ts`, `shutdown-coordinator.ts`).
7. Serialize startup orphan recovery.
8. Convert remaining `_` fields to `private`; update `AgentManagerTestInternals` seam.
9. Update tests (all `__tests__/index*.test.ts`, `drain-loop.test.ts`, any test that accesses `_activeAgents` / `_processingTasks` etc. directly).
10. Run full suite: `npm run typecheck && npm test && npm run test:main && npm run lint`.

Rollback: all changes are in-process TypeScript with no schema migrations or external contracts — revert the branch.

## Open Questions

- *Should `SpawnRegistry` expose `activeAgents` as a `ReadonlyMap` for read-only consumers (e.g., `getStatus()`) or via an `allAgents()` iterator?* — Iterator preferred; it prevents callers from caching the reference.
- *`DrainLoopDeps` three-callback approach vs. a typed `DrainErrorRegistry` sub-interface?* — Three callbacks decided (D3), but confirm with reviewer that the verbosity is acceptable given `DrainLoopDeps` is already 20+ fields.
