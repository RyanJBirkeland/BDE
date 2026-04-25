## Context

Sprint task status is currently written from ~16 call sites: IPC handlers (`sprint-local.ts`), agent-manager internals (`terminal-handler.ts`, `run-agent.ts`, `already-done-check.ts`), services (`task-terminal-service.ts`, `sprint-mutations.ts`), and migrations. Two parallel `onTaskTerminal` implementations exist (`terminal-handler.ts` in agent-manager and `task-terminal-service.ts` in services) and are wired up at different points in the composition root. State-machine validation (`isValidTransition`) lives in `sprint-task-crud.ts`, mixing policy with data access.

## Goals / Non-Goals

**Goals:**
- Single `TaskStateService.transition(taskId, target, ctx)` entry point for all status writes
- `TerminalDispatcher` port so both existing terminal implementations become thin strategies
- Move `isValidTransition` out of the data layer into `TaskStateService`
- Zero behavior change — same transitions, same side-effects, same audit trail

**Non-Goals:**
- Changing which status transitions are valid
- Refactoring the dependency resolution logic inside `resolve-dependents.ts`
- Addressing the god-class issues in `AgentManagerImpl` (EP-2)
- Adding new status values or transition rules

## Decisions

### D1: `TaskStateService` as a service class, not a static module

A class instance receives `ISprintTaskRepository`, a `TerminalDispatcher`, and a logger via constructor injection — matching the existing DI style in agent-manager. Avoids module-scoped state and makes tests straightforward.

_Alternative considered_: Plain functions with explicit deps. Rejected because the composition root already wires class instances; mixing styles adds confusion.

### D2: `TerminalDispatcher` is a single-method port

```ts
interface TerminalDispatcher {
  dispatch(taskId: string, status: TaskStatus): void
}
```

Both `terminal-handler.ts` (agent-manager path) and `task-terminal-service.ts` (PR-poller / manual path) implement this interface. The composition root passes the appropriate one to `TaskStateService`.

_Alternative considered_: Merge both implementations into one. Deferred — the two implementations have different retry/cleanup semantics. Collapsing them is EP-3/EP-5 work that builds on this foundation.

### D3: Side-effects order inside `transition()`

1. Validate transition via `isValidTransition` (reject early if invalid)
2. Call `repo.updateTask(id, { status, ...ctx.fields })` (single DB write)
3. Emit audit trail (already happens inside `updateTask` — no change)
4. Broadcast `sprint:taskUpdated` (already happens via file-watcher — no change needed)
5. If terminal: call `terminalDispatcher.dispatch(taskId, status)`

This preserves the existing ordering guarantee: DB write before terminal dispatch.

### D4: Migration is call-site-by-call-site, not a flag

Each `updateTask({ status })` call outside `TaskStateService` is replaced with `taskStateService.transition()`. No feature flag or dual-write period. The change is internal-only with no external API surface change.

## Risks / Trade-offs

- **Risk**: Missed call site leaves a status write bypassing `TaskStateService` → Mitigation: grep for `updateTask.*status` + `status:` in patch objects as a post-migration check; add a lint rule or comment warning in `updateTask` signature
- **Risk**: Composition root wiring is complex — two `TerminalDispatcher` implementations for different contexts → Mitigation: explicit named constants (`agentTerminalDispatcher`, `pollerTerminalDispatcher`) in `index.ts`
- **Trade-off**: `TaskStateService` becomes a new dependency for every module that currently writes status directly — increases coupling at the service layer, but this is intentional (centralizing policy)

## Migration Plan

1. Create `TaskStateService` + `TerminalDispatcher` port in `src/main/services/task-state-service.ts`
2. Wire into composition root (`src/main/index.ts`) alongside existing services
3. Migrate each call site (grep: `updateTask.*status`, direct SQL `SET status=`)
4. Move `isValidTransition` import chain so `TaskStateService` is the sole policy enforcer
5. `sprint-task-crud.ts` retains `isValidTransition` call as a DB-layer assertion (throws if somehow bypassed), not as the primary gate
6. Remove dead wiring of the two `onTaskTerminal` implementations from the composition root once both are wrapped as `TerminalDispatcher` strategies
