## Context

The agent-manager layer has accumulated four structural violations that each have the same root cause: code that grew organically past its original charter without a structural refactor to match.

- **`completion.ts`** (561 lines) was intended as a thin dispatcher. It now contains the full `SuccessPhase[]` pipeline, the `PreReviewAdvisor` registry and runner, and two gate functions (`verifyBranchTipOrFail`, `verifyWorktreeOrFail`). The file's own header says "no business logic lives here" — that claim is false.
- **`drain-loop.ts`** exports pure functions whose callers must carry a 19-field `DrainLoopDeps` bag. Four of those fields are mutating setters (`setDepIndexDirty`, `setConcurrency`) and two are plain mutable values (`drainPausedUntil`, `tickId`) that the drain loop writes directly on the struct it was handed. This is object-oriented design expressed as procedural code: the loop reaches back into its owner through setters instead of owning its state.
- **`circuit-breaker.ts`** is a domain object whose `recordFailure` method calls `this.onCircuitOpen?.()` — a callback that the composition root wires to the renderer broadcaster. The `CircuitBreaker` class has no import of `broadcast`, so the layering isn't broken at the import level, but the callback type is anonymous (`(payload) => void`), making the port implicit rather than named. Making it explicit as a `CircuitObserver` interface gives the port a name, makes the dependency direction legible, and lets tests stub it without knowledge of the IPC layer.
- **`sprint-mutations.ts`** holds a module-scope `_repo` that `setSprintMutationsRepo` overwrites. `sprint-task-repository.ts` holds a parallel `_sharedRepo` with the same setter pattern. Both are "DI through a mutable global" — the exact anti-pattern the service-layer DI work was meant to eliminate. They survive because removing them requires updating every caller that relied on the implicit shared instance.

## Goals / Non-Goals

**Goals:**
- Split `completion.ts` into three cohesive modules along natural seam lines; keep `completion.ts` as a backward-compatible barrel so callers need not change
- Give the drain loop a class (`DrainLoop`) that owns its own mutable state; slim `DrainLoopDeps` to read-only collaborators
- Name the `CircuitBreaker`'s observer port as `CircuitObserver`; wire it from the composition root
- Eliminate `_repo` / `setSprintMutationsRepo` from `sprint-mutations.ts` and `_sharedRepo` / `setSharedSprintTaskRepository` from `sprint-task-repository.ts`; update the composition root to inject directly

**Non-Goals:**
- Changing the external behavior of any of these modules — this is pure structural refactoring
- Moving drain-loop tests to class-based mocks (tests can be updated incrementally; the shape change is mechanical)
- Addressing other module-scope singletons not listed here (those are tracked separately)
- Splitting `drain-loop.ts` into multiple files (the class promotion is sufficient for this change)

## Decisions

### D1 — `completion.ts` split boundaries

The three natural seams are: (1) the ordered `SuccessPhase[]` array and the `resolveSuccess` dispatcher that runs it — this is the pipeline engine; (2) the `PreReviewAdvisor` port, its registry, and `runPreReviewAdvisors` — these are pluggable advisory checks with their own lifecycle; (3) `verifyBranchTipOrFail`, `verifyWorktreeOrFail`, and `appendAdvisoryNote` — these are gate functions that either pass or fail the task and share no state with the pipeline engine.

Alternatives considered: splitting into only two files (pipeline + advisors-and-gates). Rejected because the gate functions and the advisory functions have different purposes — gates write terminal status, advisors only annotate — and grouping them would reproduce the "too many responsibilities" problem at a smaller scale.

`completion.ts` becomes a barrel that re-exports everything from all three new files plus `deleteAgentBranchBeforeRetry`, `findOrCreatePR`, and the public types. The barrel approach means zero churn in callers outside the agent-manager directory.

### D2 — `DrainLoop` class shape

The `DrainLoop` class constructor accepts the read-only collaborators that were in `DrainLoopDeps`: `config`, `repo`, `depIndex`, `metrics`, `logger`, `isShuttingDown`, `isCircuitOpen`, `activeAgents`, `getConcurrency`, `getPendingSpawns`, `processQueuedTask`, `onTaskTerminal`, `taskStateService`, `emitDrainPaused`, `awaitOAuthRefresh`. The four items that were mutated by `runDrain` become private class fields: `drainFailureCounts: Map<string,number>`, `drainPausedUntil: number | undefined`, `lastTaskDeps: DepsFingerprint`, `recentlyProcessedTaskIds: Set<string>`, plus `_isDepIndexDirty: boolean` (replacing the getter/setter pair). `tickId` becomes a local variable inside `runDrain`.

`circuitOpenUntil` was read from deps but is actually owned by `CircuitBreaker`; the `DrainLoop` reads it via `isCircuitOpen()` (which auto-resets when elapsed), so `circuitOpenUntil` is dropped from deps entirely.

The existing exported functions (`validateDrainPreconditions`, `buildTaskStatusMap`, `drainQueuedTasks`, `runDrain`) are kept as the class's public methods (or private helpers) so the existing test suite requires only a mechanical update from function calls to method calls.

### D3 — `CircuitObserver` interface

Defined in `circuit-breaker.ts` as:
```typescript
export interface CircuitObserver {
  onCircuitOpen(payload: { consecutiveFailures: number; openUntil: number }): void
}
```
The `CircuitBreaker` constructor parameter changes from the anonymous callback to `CircuitObserver | undefined`. `recordFailure` calls `this.observer?.onCircuitOpen(payload)` instead of `this.onCircuitOpen?.(payload)`. The composition root (`index.ts`) implements the interface inline as an object literal that calls the broadcaster — no new class needed.

### D4 — Removing module-scope repo singletons

`sprint-mutations.ts` is converted to export a factory function `createSprintMutations(repo: ISprintTaskRepository)` that returns an object containing all the current exported functions, bound to the injected repo. The module-level free functions are replaced by the factory's output. The composition root calls `createSprintMutations(repo)` and passes the result where needed.

`sprint-task-repository.ts` drops `_sharedRepo`, `getSharedSprintTaskRepository`, `setSharedSprintTaskRepository`, and `_resetSharedSprintTaskRepository`. Callers that previously called `getSharedSprintTaskRepository()` receive the instance from the composition root instead. Since `sprint-mutations.ts` currently delegates to `getSharedSprintTaskRepository()` as a fallback, removing that fallback is safe once the factory injection is in place.

Alternatives considered: keeping `getSharedSprintTaskRepository` for test convenience. Rejected — tests should construct a repository directly; the shared singleton was the escape-hatch that made the DI seam leaky.

## Risks / Trade-offs

- [Barrel re-exports obscure which module owns what] → The barrel is a temporary compatibility shim. CLAUDE.md `Key File Locations` should be updated to point readers to the specific submodule, not the barrel.
- [DrainLoop class breaks existing drain-loop unit tests] → The shape change is mechanical: `runDrain(deps)` becomes `loop.runDrain()`. Tests can be updated in the same PR; no behavior changes.
- [Removing `_resetSharedSprintTaskRepository` breaks test isolation] → Tests that relied on the shared singleton must be updated to construct `createSprintTaskRepository()` directly. This is a one-time migration and the resulting tests are strictly better: isolated, no global state.
- [Sprint-mutations free-function callers must be updated] → Any module that `import { createTask } from '../services/sprint-mutations'` and calls it as a free function must now call it on the injected instance. The composition root holds the single instance; IPC handlers that currently import sprint-mutations free functions must receive the instance via injection or call through sprint-service (which already wraps sprint-mutations).

## Migration Plan

1. Create `success-pipeline.ts`, `pre-review-advisors.ts`, `verification-gate.ts` by moving code from `completion.ts`; convert `completion.ts` to barrel.
2. Add `CircuitObserver` interface to `circuit-breaker.ts`; update constructor; update `index.ts` composition root.
3. Create `DrainLoop` class in `drain-loop.ts`; keep exported functions as class methods; slim `DrainLoopDeps`.
4. Remove singleton from `sprint-task-repository.ts`; update composition root and test setup.
5. Remove singleton from `sprint-mutations.ts`; convert to factory; update all callers.
6. Update `docs/modules/agent-manager/index.md` and `services/index.md` for new/changed modules.

Each step compiles and tests independently — they can be implemented as separate tasks or a single sequential task.

## Open Questions

- Should `sprint-mutations.ts` become a class (`SprintMutations`) or a factory that returns a plain object? The factory approach (`createSprintMutations(repo)`) is preferred because it avoids introducing a class just to bind methods — the result is the same duck type. Confirm with the team if a class is preferred for consistency with other services.
- `getSharedSprintTaskRepository` is imported in a small number of non-composition-root files. Identify all callers before removing the export to avoid breaking imports (the tasks spec should enumerate them).
