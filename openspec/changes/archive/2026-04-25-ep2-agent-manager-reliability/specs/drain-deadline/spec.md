## ADDED Requirements

### Requirement: Drain loop has a hard per-tick deadline
The system SHALL enforce a maximum duration for each drain-loop tick's database read. If the read does not complete within `DRAIN_TICK_TIMEOUT_MS`, the tick SHALL be skipped with an error log and the loop SHALL continue to the next tick.

#### Scenario: Slow DB read times out
- **WHEN** `repo.getQueuedTasks()` takes longer than `DRAIN_TICK_TIMEOUT_MS`
- **THEN** the tick is aborted, a `drain.tick.timeout` error event is logged, and the next tick fires on schedule

#### Scenario: Normal DB read proceeds uninterrupted
- **WHEN** `repo.getQueuedTasks()` returns within the deadline
- **THEN** processing continues normally

### Requirement: Double-start is idempotent
The system SHALL ignore a second call to `AgentManagerImpl.start()` if the manager is already running, logging a WARN.

#### Scenario: start() called twice
- **WHEN** `start()` is called while the manager is already started
- **THEN** no duplicate timers are created and a WARN is logged

### Requirement: Shutdown coordinates with in-flight agents
The system SHALL give in-flight agents a grace period during shutdown before forcing re-queue. Tasks in `review` status SHALL NOT be re-queued during shutdown.

#### Scenario: Graceful shutdown with active agent
- **WHEN** `stop()` is called while an agent is active
- **THEN** the system waits up to the grace period for the agent to reach a terminal or review state before re-queuing it
