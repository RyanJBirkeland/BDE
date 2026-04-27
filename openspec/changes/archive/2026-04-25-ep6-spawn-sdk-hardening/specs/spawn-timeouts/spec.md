## ADDED Requirements

### Requirement: Per-message stream deadline
The system SHALL enforce a maximum inter-message gap in `consumeMessages`. If no message arrives within `MESSAGE_STALL_TIMEOUT_MS` (2 minutes), the stream SHALL be considered stalled, an `agent.stream.error` event SHALL be emitted with `reason: 'stalled'`, and the message loop SHALL exit.

#### Scenario: Stream stalls mid-run
- **WHEN** an agent's SDK stream produces no message for longer than `MESSAGE_STALL_TIMEOUT_MS`
- **THEN** `consumeMessages` exits with a `streamError` containing `reason: 'stalled'`, `messagesConsumed`, and `lastEventType`

#### Scenario: Active stream is not interrupted
- **WHEN** messages arrive within the deadline
- **THEN** processing continues normally with no timeout interference

### Requirement: SpawnStrategy replaces useSdk boolean
The system SHALL use a `SpawnStrategy` discriminated union (`{ type: 'sdk' } | { type: 'cli'; claudePath: string }`) instead of a `useSdk: boolean` flag in the spawn path. The resolved strategy type SHALL be logged in the `agent.spawn` structured event.

#### Scenario: SDK strategy selected and logged
- **WHEN** conditions favor the SDK path
- **THEN** the `agent.spawn` event contains `backend: 'sdk'`

#### Scenario: CLI strategy selected and logged
- **WHEN** the SDK is unavailable and CLI fallback is used
- **THEN** the `agent.spawn` event contains `backend: 'cli'`
