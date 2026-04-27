## Context

Six modules import `broadcast` or `broadcastCoalesced` from `'../broadcast'` — an Electron IPC adapter. Per Clean Architecture the dependency rule flows inward; service-layer modules must not reach into framework adapters. The existing codebase already uses dependency injection for this exact coupling: `setSprintQueriesLogger()` in `sprint-query-logger.ts` is the established pattern for injecting framework-layer collaborators into service-layer singletons.

Current state per module:

| Module | Injection status | `broadcast` usage |
|--------|-----------------|-------------------|
| `task-terminal-service.ts` | Has `TaskTerminalServiceDeps` interface | `broadcast('task-terminal:resolution-error', ...)` in error handler |
| `sprint-mutation-broadcaster.ts` | Module-level singleton; no DI today | `broadcast('sprint:externalChange')` in `notifySprintMutation` |
| `status-server.ts` | Factory `createStatusServer(mgr, repo)` | `broadcast('manager:warning', ...)` in server error handler |
| `circuit-breaker.ts` | Class; constructor takes only `Logger` | `broadcast('agent-manager:circuit-breaker-open', ...)` when tripped |
| `pr-operations.ts` | Module-level functions | `broadcast('manager:warning', ...)` in `createNewPr` on exhausted retries |
| `resolve-success-phases.ts` | Module-level functions, some with deps | `broadcastCoalesced('agent:event', ...)` in `failTaskWithError` |

## Goals / Non-Goals

**Goals:**
- Each module accepts its broadcast capability as an injected parameter instead of importing it directly
- All call sites pass `broadcast` / `broadcastCoalesced` from the composition root; if a caller omits it, the call is silently skipped (optional injection)
- Tests that don't care about broadcast behavior can drop their `vi.mock('../../broadcast')` mocks

**Non-Goals:**
- Changing what gets broadcast or to which channels (zero behavior change)
- Moving `broadcast` out of `index.ts` or `agent-manager/index.ts` — the composition roots are the correct owners
- Full DI framework — this is constructor/parameter injection only

## Decisions

**D1 — `task-terminal-service.ts`: add `broadcast?` to `TaskTerminalServiceDeps`**

The service already has a clean deps interface. Adding an optional `broadcast?: (channel: string, payload?: unknown) => void` field keeps the pattern consistent. The composition root passes the real `broadcast`; the existing test `makeDeps()` helper needs no change (field is optional).

**D2 — `sprint-mutation-broadcaster.ts`: `setSprintBroadcaster(fn)` setter**

The module uses module-level state (listener set, webhook service). Converting it to a factory would require updating every caller of `notifySprintMutation` and `onSprintMutation`. The `setSprintQueriesLogger` pattern is a proven lower-friction alternative: add a module-level `_broadcastFn` variable and a `setSprintBroadcaster(fn)` export. The composition root calls `setSprintBroadcaster(broadcast)` at startup.

**D3 — `status-server.ts`: `broadcast?` optional 3rd parameter on `createStatusServer`**

Two callers exist in `index.ts`; both can pass `broadcast` directly. Optional to avoid breaking any test-only usage.

**D4 — `circuit-breaker.ts`: `onCircuitOpen?` callback in constructor**

A typed callback is cleaner than a generic `broadcast` function leaking into the class — it decouples the class from channel naming. `agent-manager/index.ts` already imports `broadcast` and constructs `CircuitBreaker`; the update is one line: `new CircuitBreaker(logger, (payload) => broadcast('agent-manager:circuit-breaker-open', payload))`.

**D5 — `pr-operations.ts`: optional `broadcast?` on `createNewPr` and `findOrCreatePR`**

Both functions already take `logger` as last positional arg; append `broadcast?` after it. `findOrCreatePR` calls `createNewPr` — it forwards the optional. `git-operations.ts` re-exports these and will forward too.

**D6 — `resolve-success-phases.ts`: optional `broadcastCoalesced?` on `failTaskWithError`**

Same pattern as D5: append optional callback after existing args. `completion.ts` calls `failTaskWithError` — it will pass `broadcastCoalesced` from the agent-manager's import. The function's 8-arg count is already high; no parameter object introduced since this is a targeted fix (full function decomposition is Epic 8).

## Risks / Trade-offs

**Optional injection means silent no-op on missed wiring** → Acceptable at this scope. If a caller forgets to pass `broadcast`, the worst outcome is a missing UI notification for an edge case (circuit breaker open, PR creation failure). Logger calls in these paths ensure the event is still recorded.

**`sprint-mutation-broadcaster` setter pattern is stateful** → Same trade-off already accepted for `setSprintQueriesLogger`. The module is a singleton by design; the setter is called exactly once at startup before any mutations fire.

**Argument count growth in `createNewPr` / `failTaskWithError`** → These functions are already polyadic. The optional append is a stopgap until Epic 8 introduces parameter objects.
