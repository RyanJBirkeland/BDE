## ADDED Requirements

### Requirement: DrainLoop is a class that owns its mutable state
`drain-loop.ts` SHALL export a `DrainLoop` class. The class constructor SHALL accept the read-only collaborators currently in `DrainLoopDeps`. The following mutable values SHALL become private class fields rather than members of a passed-in struct: `drainFailureCounts`, `drainPausedUntil`, `lastTaskDeps`, `recentlyProcessedTaskIds`, `_isDepIndexDirty`. `tickId` SHALL be a local variable inside `runDrain`, not a field or dep member.

#### Scenario: DrainLoop is constructed with read-only collaborators
- **WHEN** `new DrainLoop(deps)` is called with `config`, `repo`, `depIndex`, `metrics`, `logger`, `isShuttingDown`, `isCircuitOpen`, `activeAgents`, `getConcurrency`, `getPendingSpawns`, `processQueuedTask`, `onTaskTerminal`, `taskStateService`, `emitDrainPaused`, and optional `awaitOAuthRefresh`
- **THEN** the instance is created without error

#### Scenario: mutable state is initialized to safe defaults
- **WHEN** a `DrainLoop` is constructed
- **THEN** `drainFailureCounts` is an empty `Map`, `drainPausedUntil` is `undefined`, `lastTaskDeps` is an empty `Map`, `recentlyProcessedTaskIds` is an empty `Set`, and `_isDepIndexDirty` is `false`

### Requirement: DrainLoopDeps no longer carries mutable setters or mutable values
The `DrainLoopDeps` interface SHALL NOT include `setDepIndexDirty`, `setConcurrency`, `drainPausedUntil`, `tickId`, `recentlyProcessedTaskIds`, `lastTaskDeps`, `drainFailureCounts`, or `circuitOpenUntil`. These are either owned by the class or readable through existing accessor methods.

#### Scenario: DrainLoopDeps has only read-only collaborators
- **WHEN** a TypeScript consumer creates a `DrainLoopDeps` object
- **THEN** the type does not require `setDepIndexDirty`, `setConcurrency`, `drainPausedUntil`, `tickId`, `recentlyProcessedTaskIds`, `lastTaskDeps`, `drainFailureCounts`, or `circuitOpenUntil`

### Requirement: runDrain is a method on DrainLoop
`DrainLoop.runDrain()` SHALL implement the same logic as the current exported `runDrain(deps)` function, reading collaborators from `this` and mutating private fields instead of the deps bag.

#### Scenario: runDrain skips the tick when drain is paused
- **WHEN** `DrainLoop.runDrain()` is called and `drainPausedUntil` is in the future
- **THEN** the method logs and returns without processing any tasks

#### Scenario: runDrain processes queued tasks when slots are available
- **WHEN** `DrainLoop.runDrain()` is called, preconditions pass, and available slots > 0
- **THEN** `drainQueuedTasks` is called and tasks are processed

#### Scenario: environmental failure pauses the drain
- **WHEN** a task in `drainQueuedTasks` throws an error classified as `environmental`
- **THEN** `drainPausedUntil` is set to a future timestamp and no more tasks are processed in that tick

### Requirement: AgentManagerImpl uses DrainLoop instance
`AgentManagerImpl` (in `index.ts`) SHALL construct a `DrainLoop` instance at startup and call `loop.runDrain()` in the polling interval. The 4 setter callbacks previously wired into `DrainLoopDeps` (`setDepIndexDirty`, `setConcurrency`) SHALL be removed from the deps object passed to the drain loop.

#### Scenario: agent manager drain calls DrainLoop method
- **WHEN** the agent manager's polling interval fires
- **THEN** it calls `this.drainLoop.runDrain()` rather than the standalone `runDrain(deps)` function
