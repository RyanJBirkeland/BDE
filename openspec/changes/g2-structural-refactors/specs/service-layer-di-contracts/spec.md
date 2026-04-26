## MODIFIED Requirements

### Requirement: composition root wires broadcast at construction time
The composition root (`src/main/index.ts` and `src/main/agent-manager/index.ts`) SHALL pass the `broadcast` / `broadcastCoalesced` functions from `'../broadcast'` to each module that previously imported it directly. Existing runtime behavior SHALL be preserved — every channel and payload that was previously broadcast SHALL continue to be broadcast with the same arguments.

The `CircuitBreaker` constructor SHALL now accept a `CircuitObserver` object (not a raw callback) as its second argument. The composition root SHALL pass an inline object literal implementing `CircuitObserver` whose `onCircuitOpen` method calls `broadcast('agent-manager:circuit-breaker-open', payload)`.

#### Scenario: circuit-breaker in agent-manager receives broadcast at construction
- **WHEN** the agent-manager is initialized
- **THEN** `CircuitBreaker` is constructed with a `CircuitObserver` whose `onCircuitOpen` calls `broadcast('agent-manager:circuit-breaker-open', payload)`

#### Scenario: sprint-mutation-broadcaster receives broadcast at startup
- **WHEN** the main process initializes the sprint mutation broadcasting
- **THEN** `setSprintBroadcaster` is called with the real `broadcast` function before any task mutations can fire
