## ADDED Requirements

### Requirement: Structured event logger method
The system SHALL provide a `logger.event(name, fields)` method on the object returned by `createLogger()`. Calling it SHALL write a single NDJSON line to `~/.bde/bde.log` with at minimum `ts`, `level`, `module`, and `event` fields plus all provided `fields`.

#### Scenario: Event line is valid JSON
- **WHEN** `logger.event('agent.spawn', { taskId: 'abc', model: 'claude-opus-4-7' })` is called
- **THEN** a line is appended to bde.log that parses as JSON and contains `event: 'agent.spawn'`, `taskId: 'abc'`, `model: 'claude-opus-4-7'`, `ts`, `level`, and `module`

#### Scenario: Missing optional fields do not appear
- **WHEN** `logger.event('drain.tick', { tickId: 'x1' })` is called without `taskId`
- **THEN** the JSON line does not contain a `taskId` key

### Requirement: Pipeline hot-path events are structured
The system SHALL emit structured `logger.event()` calls (not plain string logs) for: agent spawn, watchdog kill, agent completion, stream error, and drain tick.

#### Scenario: Spawn event includes forensic fields
- **WHEN** the drain loop claims and spawns an agent for a task
- **THEN** a structured `agent.spawn` event is logged containing `taskId`, `tickId`, `model`, `maxBudgetUsd`, and `cwd`

#### Scenario: Watchdog kill event includes timing
- **WHEN** the watchdog kills an agent due to timeout
- **THEN** a structured `agent.watchdog.kill` event is logged containing `taskId`, `runtimeMs`, `limitMs`, and `agentType`

#### Scenario: Completion event includes cost
- **WHEN** an agent reaches a terminal status via the completion path
- **THEN** a structured `agent.completed` event is logged containing `taskId`, `durationMs`, `model`, and `costUsd`

### Requirement: Drain heartbeat demoted to DEBUG
The system SHALL emit the drain-loop "no queued tasks" heartbeat at DEBUG level, not INFO. It SHALL carry the current `tickId`.

#### Scenario: Idle drain does not pollute INFO log
- **WHEN** the drain loop finds zero queued tasks
- **THEN** no INFO-level line is written; only a DEBUG-level `drain.tick.idle` event is emitted

### Requirement: No console.* in main-process modules
The system SHALL have zero `console.warn`, `console.log`, or `console.error` calls in `src/main/` outside of test files. All such calls SHALL be replaced with the module's named logger.

#### Scenario: Packaged build surfaces warnings
- **WHEN** the app runs as a packaged `.app` (no terminal attached)
- **THEN** all warnings from main-process modules reach `~/.bde/bde.log` (not lost to a disconnected console)
