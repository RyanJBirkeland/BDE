## Why

Four modules in the agent-manager layer have grown past their single responsibility: `completion.ts` packs success-pipeline logic, advisory checks, and gate functions into one 560-line file; `drain-loop.ts` passes 19 mutable fields through a struct because the drain loop has no class to own its own state; `circuit-breaker.ts` imports the renderer broadcast layer directly, coupling a domain rule to IPC infrastructure; and `sprint-mutations.ts` / `sprint-task-repository.ts` defeat constructor injection with module-scope mutable singletons. Each of these is a Clean Architecture violation that makes the code harder to test, harder to read, and harder to extend safely.

## What Changes

- **Split `completion.ts`** into three focused modules:
  - `success-pipeline.ts` — owns `SuccessPhase[]`, `PipelineAbortError`, and the `resolveSuccess` dispatcher
  - `pre-review-advisors.ts` — owns `PreReviewAdvisor` port + registry + `runPreReviewAdvisors`
  - `verification-gate.ts` — owns `verifyBranchTipOrFail`, `verifyWorktreeOrFail`, `appendAdvisoryNote`
  - `completion.ts` becomes a thin barrel re-export (existing imports continue to work)
- **Promote `DrainLoop` to a class** — `drain-loop.ts` exports a `DrainLoop` class whose constructor receives the true read-only collaborators; mutable state (`drainFailureCounts`, `drainPausedUntil`, `tickId`, `recentlyProcessedTaskIds`) moves to private fields. The 4 setter callbacks (`setDepIndexDirty`, `setConcurrency`, `drainPausedUntil`, `tickId`) are removed from `DrainLoopDeps`.
- **Inject `CircuitObserver` port** — `circuit-breaker.ts` defines a `CircuitObserver` interface (`onOpen(payload)`) and accepts it via constructor. The composition root wires it to the broadcaster. The `onCircuitOpen` callback is renamed to match the port name.
- **Remove module-scope repo singletons** — `sprint-mutations.ts` drops `_repo` and `setSprintMutationsRepo`; receives the repository as a constructor parameter via a `SprintMutations` class or factory-injected functions. `sprint-task-repository.ts` drops `_sharedRepo` and `setSharedSprintTaskRepository`; the composition root holds the single instance directly.

## Capabilities

### New Capabilities

- `completion-split`: The success-pipeline, pre-review-advisory, and verification-gate concerns are split into separate modules with clear public APIs. `completion.ts` remains as a backward-compatible barrel.
- `drain-loop-class`: `DrainLoop` is a class that owns its own mutable state; the `DrainLoopDeps` bag is slimmed to read-only collaborators only.
- `circuit-observer-port`: `CircuitBreaker` depends on an abstract `CircuitObserver` interface, not on the concrete broadcast layer.
- `repo-constructor-injection`: `sprint-mutations.ts` and `sprint-task-repository.ts` no longer hold module-scope mutable singletons; the composition root injects the repository instance directly.

### Modified Capabilities

- `service-layer-di-contracts`: The DI seam for the sprint-mutations module changes from a setter (`setSprintMutationsRepo`) to constructor/factory injection. The shared-singleton escape-hatch in `sprint-task-repository.ts` is removed.

## Impact

- `src/main/agent-manager/completion.ts` — converted to barrel re-export
- `src/main/agent-manager/success-pipeline.ts` — new file
- `src/main/agent-manager/pre-review-advisors.ts` — new file
- `src/main/agent-manager/verification-gate.ts` — new file
- `src/main/agent-manager/drain-loop.ts` — `DrainLoopDeps` slimmed; `DrainLoop` class added
- `src/main/agent-manager/circuit-breaker.ts` — `CircuitObserver` interface; constructor signature updated
- `src/main/agent-manager/index.ts` — wires `CircuitObserver` to broadcaster at composition root
- `src/main/services/sprint-mutations.ts` — `_repo` singleton + setter removed; injection via class or factory
- `src/main/data/sprint-task-repository.ts` — `_sharedRepo` singleton + setter removed
- `src/main/index.ts` — composition root updated to inject repo directly
- All existing unit tests for these modules — updated to use new constructors/factories; no `vi.mock` of module-level setters
