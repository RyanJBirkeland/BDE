## 1. task-terminal-service.ts

- [x] 1.1 Add optional `broadcast?: (channel: string, payload?: Record<string, unknown>) => void` to `TaskTerminalServiceDeps` in `src/main/services/task-terminal-service.ts`; replace the direct `broadcast(...)` call with `deps.broadcast?.(...)` and remove the top-level `broadcast` import
- [x] 1.2 Update `src/main/index.ts` to pass `broadcast` in the `createTaskTerminalService` deps object
- [x] 1.3 Update `src/main/services/__tests__/task-terminal-service.test.ts`: remove `vi.mock('../../broadcast')` and add a test asserting the injected `broadcast` is called on resolution error

## 2. sprint-mutation-broadcaster.ts

- [x] 2.1 Add a module-level `_broadcastFn` variable and `setSprintBroadcaster(fn)` export to `src/main/services/sprint-mutation-broadcaster.ts`; replace `broadcast('sprint:externalChange')` with `_broadcastFn?.()` and remove the top-level `broadcast` import
- [x] 2.2 Update `src/main/index.ts` to call `setSprintBroadcaster(broadcast)` at startup (before any mutations can fire)
- [x] 2.3 Update any test that `vi.mock('../../broadcast')` for this module to instead call `setSprintBroadcaster(mockFn)` and assert on `mockFn`

## 3. status-server.ts

- [x] 3.1 Add optional `broadcast?: (channel: string, payload?: Record<string, unknown>) => void` as 3rd parameter to `createStatusServer` in `src/main/services/status-server.ts`; replace the direct call with the parameter and remove the top-level import
- [x] 3.2 Update `src/main/index.ts` call site: `createStatusServer(agentManager, core.repo, broadcast)`

## 4. circuit-breaker.ts

- [x] 4.1 Add optional `onCircuitOpen?: (payload: { consecutiveFailures: number; openUntil: number }) => void` as 2nd constructor parameter in `src/main/agent-manager/circuit-breaker.ts`; replace the `try { broadcast(...) }` block with `try { this.onCircuitOpen?.(payload) }` and remove the top-level `broadcast` import
- [x] 4.2 Update `src/main/agent-manager/index.ts`: `new CircuitBreaker(logger, (p) => broadcast('agent-manager:circuit-breaker-open', p))`
- [x] 4.3 Update circuit-breaker tests: remove `vi.mock('../broadcast')` and add a test asserting `onCircuitOpen` is called when the circuit trips

## 5. pr-operations.ts

- [x] 5.1 Add optional `broadcast?: (channel: string, payload: unknown) => void` as last parameter to both `createNewPr` and `findOrCreatePR` in `src/main/agent-manager/pr-operations.ts`; replace the direct `broadcast(...)` call with the parameter and remove the top-level import; `findOrCreatePR` forwards the parameter to `createNewPr`
- [x] 5.2 Update `src/main/lib/git-operations.ts` re-exports (and `completion.ts` wrapper) to forward the `broadcast` parameter through to `pr-operations` functions
- [x] 5.3 Update the agent-manager's completion path in `src/main/agent-manager/completion.ts` to pass `broadcast` to `findOrCreatePR`

## 6. resolve-success-phases.ts

- [x] 6.1 Add optional `broadcastCoalesced?: (channel: string, payload: unknown) => void` as last parameter to `failTaskWithError` in `src/main/agent-manager/resolve-success-phases.ts`; replace the direct call with the parameter and remove the top-level `broadcastCoalesced` import
- [x] 6.2 Update all callers of `failTaskWithError` in `src/main/agent-manager/completion.ts` to pass `broadcastCoalesced` from `'../broadcast'`

## 7. Module docs

- [x] 7.1 Update `docs/modules/services/index.md` rows for `task-terminal-service.ts`, `sprint-mutation-broadcaster.ts`, and `status-server.ts` to note the injected broadcast pattern
- [x] 7.2 Update `docs/modules/agent-manager/index.md` rows for `circuit-breaker.ts`, `pr-operations.ts`, and `resolve-success-phases.ts`
