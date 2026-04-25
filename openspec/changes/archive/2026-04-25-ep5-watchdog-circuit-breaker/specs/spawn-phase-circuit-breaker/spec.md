## ADDED Requirements

### Requirement: Circuit breaker counts spawn-phase failures only
The system SHALL only increment the drain circuit breaker counter for failures that occur during the spawn phase (before the SDK stream starts). Stream errors, mid-run OOMs, and post-run cleanup errors SHALL NOT increment the counter.

#### Scenario: Mid-run stream error does not trip breaker
- **WHEN** an agent's SDK stream errors after the spawn phase succeeds
- **THEN** the circuit breaker counter is NOT incremented

#### Scenario: Spawn failure trips breaker
- **WHEN** `spawnWithTimeout` throws before the SDK stream is established
- **THEN** the circuit breaker counter IS incremented

### Requirement: Fast-fail uses a true sliding window
The system SHALL evaluate fast-fail by counting only failures that occurred within the last `FAST_FAIL_WINDOW_MS` (30 seconds). Failures older than this window SHALL be evicted before the count check.

#### Scenario: Old failure does not contribute to fast-fail
- **WHEN** a task has one failure older than 30s and two recent failures
- **THEN** the fast-fail count is 2, not 3, and the task is NOT exhausted

#### Scenario: Three failures within 30s triggers exhaustion
- **WHEN** a task has three failures all within the last 30s
- **THEN** the task is marked `error` as fast-fail exhausted

### Requirement: Watchdog kill is idempotent against concurrent orphan recovery
The system SHALL check that an agent is still in the active map before dispatching terminal notification from the watchdog kill path.

#### Scenario: Orphan recovery wins the race
- **WHEN** orphan recovery removes an agent from the active map before the watchdog fires terminal notify
- **THEN** the watchdog logs a DEBUG message and returns without dispatching a duplicate terminal notification
