## ADDED Requirements

### Requirement: CircuitObserver is a named interface in circuit-breaker.ts
`circuit-breaker.ts` SHALL export a `CircuitObserver` interface with a single method: `onCircuitOpen(payload: { consecutiveFailures: number; openUntil: number }): void`. The `CircuitBreaker` constructor SHALL accept `CircuitObserver | undefined` as its second parameter instead of an anonymous callback type.

#### Scenario: CircuitBreaker is constructed with an observer
- **WHEN** `new CircuitBreaker(logger, observer)` is called with an object implementing `CircuitObserver`
- **THEN** the instance is created and the observer is stored

#### Scenario: CircuitBreaker is constructed without an observer
- **WHEN** `new CircuitBreaker(logger)` is called without a second argument
- **THEN** the instance is created without error

### Requirement: CircuitBreaker calls observer.onCircuitOpen when the circuit trips
`CircuitBreaker.recordFailure` SHALL call `this.observer?.onCircuitOpen(payload)` (instead of the anonymous callback) when the consecutive failure count crosses `SPAWN_CIRCUIT_FAILURE_THRESHOLD`.

#### Scenario: observer is notified when circuit opens
- **WHEN** `recordFailure` is called enough times to trip the breaker
- **THEN** `observer.onCircuitOpen` is called once with `{ consecutiveFailures, openUntil }`

#### Scenario: observer error is caught and logged
- **WHEN** `observer.onCircuitOpen` throws
- **THEN** `CircuitBreaker` catches the error and logs a warning without rethrowing

### Requirement: composition root wires CircuitObserver to the broadcaster
`src/main/agent-manager/index.ts` SHALL construct `CircuitBreaker` with an inline `CircuitObserver` object literal whose `onCircuitOpen` method calls `broadcast('agent-manager:circuit-breaker-open', payload)`.

#### Scenario: circuit breaker open event reaches the renderer
- **WHEN** the circuit breaker trips in a running app
- **THEN** `broadcast('agent-manager:circuit-breaker-open', payload)` is called with the correct payload
