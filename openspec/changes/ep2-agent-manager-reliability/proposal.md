## Why

The drain loop has no hard deadline — a hung SQLite read silently kills it forever with no recovery. `AgentManagerImpl` is a ~25-field god class that mixes orchestration, timer management, WIP accounting, and error tracking in one object, making it nearly impossible to test individual concerns. Double-calling `start()` creates duplicate timers. Shutdown races in-flight cleanup against forced re-queue. `run-agent.ts` is 675 LOC doing orchestration, SDK wiring, error handling, and playground I/O at the same level of abstraction.

## What Changes

- `_drainLoop()` wraps the per-tick SQLite read in a deadline (`Promise.race` with a timeout) so a hung DB can't freeze the loop forever — T-1
- `AgentManagerImpl` split into focused collaborators: `DrainCoordinator`, `WipTracker`, `ErrorRegistry` — T-2
- `start()` is idempotent (double-start guard) — T-6
- Shutdown path coordinates with in-flight cleanup before forced re-queue — T-34
- `run-agent.ts` split into stepdown levels: orchestrator → phase runners → leaf operations — T-16
- `LifecycleController` timer offsets staggered so drain/watchdog/prune don't all fire at t=0 — T-83

## Capabilities

### New Capabilities

- `drain-deadline`: Hard timeout on per-tick DB reads so a hung SQLite never freezes the drain loop

### Modified Capabilities

<!-- Architectural refactor — same behavior, better structure and reliability -->

## Impact

- `src/main/agent-manager/index.ts` — `AgentManagerImpl` split, double-start guard, shutdown coordination
- `src/main/agent-manager/drain-loop.ts` — per-tick deadline
- `src/main/agent-manager/run-agent.ts` — split into stepdown levels
- `src/main/agent-manager/lifecycle-controller.ts` — staggered timer offsets
