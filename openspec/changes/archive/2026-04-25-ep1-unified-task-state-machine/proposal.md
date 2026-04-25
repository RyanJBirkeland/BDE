## Why

Sprint task status is written from 16 different call sites across handlers, services, agent-manager, and the data layer — with two competing `onTaskTerminal` implementations and state-machine validation buried inside a CRUD module. Every recurring "dependents not notified / claimed_by stale / double-write" incident traces back to this scatter.

## What Changes

- **NEW** `TaskStateService` with a single `transition(taskId, target, ctx)` method that owns every `sprint_tasks.status` write and its side-effects (audit trail, `onTaskTerminal`, broadcast)
- **BREAKING** All direct `updateTask({ status: ... })` calls outside `TaskStateService` are removed; callers use `transition()` instead
- `terminal-handler.ts` and `task-terminal-service.ts` collapse into thin strategy implementations injected into `TaskStateService` via a `TerminalDispatcher` port
- State-machine validation (`isValidTransition`) moves out of `sprint-task-crud.ts` into `TaskStateService`; data layer retains it only as defense-in-depth

## Capabilities

### New Capabilities

- `task-state-machine`: Centralized state transition service — `TaskStateService.transition()`, `TerminalDispatcher` port, transition validation, side-effect orchestration (audit trail, broadcast, terminal notify)

### Modified Capabilities

<!-- No existing spec-level behaviors are changing — this is an architectural consolidation, not a behavior change -->

## Impact

- `src/main/services/task-terminal-service.ts` — reduced to a `TerminalDispatcher` strategy
- `src/main/agent-manager/terminal-handler.ts` — reduced to a `TerminalDispatcher` strategy
- `src/main/data/sprint-task-crud.ts` — `isValidTransition` check becomes defense-in-depth only, not policy
- All IPC handlers and services that call `updateTask({ status })` directly — migrated to `TaskStateService.transition()`
- `src/main/data/sprint-task-repository.ts` — no interface change, but `updateTask` loses its status-validation responsibility
