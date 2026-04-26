## ADDED Requirements

### Requirement: SpawnRegistry owns all in-flight agent tracking state
`SpawnRegistry` SHALL be a class in `src/main/agent-manager/spawn-registry.ts` that is the single owner of the four mutable collections tracking in-flight agents: `activeAgents` (Map), `processingTasks` (Set), `agentPromises` (Set), and `pendingSpawns` (counter). `AgentManagerImpl` SHALL hold one `SpawnRegistry` instance and SHALL NOT declare `activeAgents`, `processingTasks`, `agentPromises`, or `pendingSpawns` fields directly.

#### Scenario: Agent registered on spawn
- **WHEN** a pipeline agent successfully starts
- **THEN** `spawnRegistry.registerAgent(agent)` is called and subsequent calls to `spawnRegistry.hasActiveAgent(taskId)` return `true`

#### Scenario: Agent removed on completion
- **WHEN** a pipeline agent reaches a terminal state (done, failed, review, error, cancelled)
- **THEN** `spawnRegistry.removeAgent(taskId)` is called and subsequent calls to `spawnRegistry.hasActiveAgent(taskId)` return `false`

#### Scenario: Processing guard prevents duplicate claims
- **WHEN** a drain tick attempts to process a task that is already being processed
- **THEN** `spawnRegistry.isProcessing(taskId)` returns `true` and the task is skipped without re-claiming

#### Scenario: Pending spawn count tracks pre-registration window
- **WHEN** `_spawnAgent` is called but the agent has not yet called `onAgentRegistered`
- **THEN** `spawnRegistry.pendingSpawnCount()` reflects the increment so `availableSlots` sees the correct concurrency headroom

#### Scenario: Available slot computation uses SpawnRegistry counts
- **WHEN** the drain loop checks available capacity
- **THEN** it reads `spawnRegistry.activeAgentCount() + spawnRegistry.pendingSpawnCount()` to determine occupied slots

### Requirement: SpawnRegistry exposes a verb-shaped mutation API
`SpawnRegistry` SHALL expose the following methods and SHALL NOT expose the underlying Map/Set collections as public mutable references.

- `registerAgent(agent: ActiveAgent): void`
- `removeAgent(taskId: string): void`
- `getAgent(taskId: string): ActiveAgent | undefined`
- `hasActiveAgent(taskId: string): boolean`
- `allAgents(): IterableIterator<ActiveAgent>` — read-only iteration
- `activeAgentCount(): number`
- `markProcessing(taskId: string): void`
- `unmarkProcessing(taskId: string): void`
- `isProcessing(taskId: string): boolean`
- `trackPromise(p: Promise<void>): void`
- `forgetPromise(p: Promise<void>): void`
- `allPromises(): IterableIterator<Promise<void>>` — read-only iteration
- `incrementPendingSpawns(): void`
- `decrementPendingSpawns(): void`
- `pendingSpawnCount(): number`

#### Scenario: Verb methods enforce encapsulation
- **WHEN** any module outside `spawn-registry.ts` needs to mutate spawn-tracking state
- **THEN** it calls a verb method on the `SpawnRegistry` instance rather than accessing a Map or Set directly

#### Scenario: decrementPendingSpawns is safe below zero
- **WHEN** `decrementPendingSpawns` is called more times than `incrementPendingSpawns`
- **THEN** the counter floors at 0 and does not go negative

### Requirement: Dependent modules accept SpawnRegistry instead of raw collections
Modules that previously accepted `activeAgents: Map<string, ActiveAgent>`, `processingTasks: Set<string>`, or `agentPromises: Set<Promise<void>>` in their `*Deps` interfaces SHALL be updated to accept `spawnRegistry: SpawnRegistry` in the corresponding interface.

Affected interfaces:
- `RunAgentDeps` in `run-agent.ts`
- `TaskClaimerDeps` in `task-claimer.ts`
- `WatchdogLoopDeps` in `watchdog-loop.ts`
- `ShutdownDeps` in `shutdown-coordinator.ts`

#### Scenario: RunAgentDeps uses SpawnRegistry
- **WHEN** `runAgent` needs to register the agent in the active-agents map
- **THEN** it calls `deps.spawnRegistry.registerAgent(agent)` instead of `deps.activeAgents.set(taskId, agent)`

#### Scenario: ShutdownCoordinator drains via SpawnRegistry
- **WHEN** `executeShutdown` waits for in-flight agent promises
- **THEN** it iterates `deps.spawnRegistry.allPromises()` instead of `deps.agentPromises`
