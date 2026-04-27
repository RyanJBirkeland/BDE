## ADDED Requirements

### Requirement: service modules do not import from the broadcast framework adapter
The modules `task-terminal-service.ts`, `sprint-mutation-broadcaster.ts`, `status-server.ts`, `circuit-breaker.ts`, `pr-operations.ts`, and `resolve-success-phases.ts` SHALL NOT contain a top-level `import { broadcast }` or `import { broadcastCoalesced }` statement from `'../broadcast'`. Each module SHALL accept its broadcast capability as an injected parameter or setter, and the composition root SHALL supply the real implementation.

#### Scenario: task-terminal-service accepts broadcast via deps
- **WHEN** `createTaskTerminalService` is called with a deps object that includes a `broadcast` function
- **THEN** the service uses that function when a terminal resolution error occurs instead of importing broadcast directly

#### Scenario: task-terminal-service skips broadcast when not provided
- **WHEN** `createTaskTerminalService` is called without a `broadcast` field in deps
- **THEN** the service handles resolution errors without throwing, emitting no broadcast event

#### Scenario: sprint-mutation-broadcaster accepts broadcast via setter
- **WHEN** `setSprintBroadcaster(fn)` is called before `notifySprintMutation`
- **THEN** the setter's `fn` is invoked with channel `'sprint:externalChange'` when a mutation is broadcast

#### Scenario: sprint-mutation-broadcaster skips broadcast when no setter called
- **WHEN** `notifySprintMutation` is called without a prior `setSprintBroadcaster` call
- **THEN** in-process listeners are still notified but no IPC broadcast is emitted

#### Scenario: status-server accepts broadcast parameter
- **WHEN** `createStatusServer` is called with a `broadcast` function as the third argument
- **THEN** the server uses that function on binding errors instead of importing broadcast directly

#### Scenario: circuit-breaker accepts onCircuitOpen callback
- **WHEN** `new CircuitBreaker(logger, onCircuitOpen)` is constructed with an `onCircuitOpen` callback
- **THEN** `onCircuitOpen` is called with the circuit payload when the breaker trips

#### Scenario: circuit-breaker skips callback when not provided
- **WHEN** `new CircuitBreaker(logger)` is constructed without a callback
- **THEN** the circuit breaker trips and logs normally but does not throw

#### Scenario: pr-operations accepts broadcast parameter on createNewPr
- **WHEN** `createNewPr` is called with a `broadcast` function
- **THEN** that function is called with `'manager:warning'` when all PR creation attempts are exhausted

#### Scenario: failTaskWithError accepts broadcastCoalesced parameter
- **WHEN** `failTaskWithError` is called with a `broadcastCoalesced` function
- **THEN** that function is called to emit the agent error event instead of the module-level import

### Requirement: composition root wires broadcast at construction time
The composition root (`src/main/index.ts` and `src/main/agent-manager/index.ts`) SHALL pass the `broadcast` / `broadcastCoalesced` functions from `'../broadcast'` to each module that previously imported it directly. Existing runtime behavior SHALL be preserved — every channel and payload that was previously broadcast SHALL continue to be broadcast with the same arguments.

#### Scenario: circuit-breaker in agent-manager receives broadcast at construction
- **WHEN** the agent-manager is initialized
- **THEN** `CircuitBreaker` is constructed with an `onCircuitOpen` callback that calls `broadcast('agent-manager:circuit-breaker-open', payload)`

#### Scenario: sprint-mutation-broadcaster receives broadcast at startup
- **WHEN** the main process initializes the sprint mutation broadcasting
- **THEN** `setSprintBroadcaster` is called with the real `broadcast` function before any task mutations can fire
