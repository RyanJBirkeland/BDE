## Why

Six modules in the service and agent-manager layers import `broadcast` (or `broadcastCoalesced`) directly from `'../broadcast'`. `broadcast` is a framework adapter — it calls Electron's `BrowserWindow.getAllWindows()` and sends IPC messages to renderer windows. Per Clean Architecture, inner layers (use cases, services) must not depend on outer layers (framework adapters). The current coupling means:

- Unit tests for these services must `vi.mock('../../broadcast')` even when the test has no interest in broadcast behavior
- Services cannot be used in a non-Electron environment without the broadcast module loading
- The composition root has no visibility into which services emit which channels — the dependency is hidden in imports

## What Changes

Five services remove their direct `broadcast` import and accept the capability as an injected dependency. A sixth module (`resolve-success-phases.ts`) removes `broadcastCoalesced` in the same pass.

| Module | Current | After |
|--------|---------|-------|
| `services/task-terminal-service.ts` | `import { broadcast }` + hardcoded call | Optional `broadcast?` in `TaskTerminalServiceDeps` |
| `services/sprint-mutation-broadcaster.ts` | Module-level `import { broadcast }` | `setSprintBroadcaster(fn)` setter (matches existing `setSprintQueriesLogger` pattern) |
| `services/status-server.ts` | `import { broadcast }` in factory body | `broadcast` parameter added to `createStatusServer` |
| `agent-manager/circuit-breaker.ts` | `import { broadcast }` in class body | Optional `onOpen` callback in constructor |
| `agent-manager/pr-operations.ts` | Module-level `import { broadcast }` | Optional `broadcast` parameter on `findOrCreatePR` |
| `agent-manager/resolve-success-phases.ts` | `import { broadcastCoalesced }` | Optional `broadcastCoalesced` parameter on call site |

The composition root (`index.ts`) passes the real `broadcast` / `broadcastCoalesced` at wiring time. All call sites remain unchanged — only the import is moved outward.

## Capabilities

### New Capabilities

- None — this is a refactor

### Modified Capabilities

- None — no externally observable behavior changes

## Impact

- 6 source files modified (the modules above)
- `src/main/index.ts` updated to pass `broadcast` at each construction site
- Test files for `task-terminal-service` and `circuit-breaker` can drop their `vi.mock('../../broadcast')` mocks (the broadcast is now injected, so tests that don't care about it simply don't pass one)
- No IPC channel changes, no renderer changes, no DB changes
