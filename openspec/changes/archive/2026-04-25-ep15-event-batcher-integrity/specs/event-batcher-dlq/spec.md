## ADDED Requirements

### Requirement: DLQ sentinel on permanent batch failure
The system SHALL NOT silently drop agent events. When the batch circuit breaker permanently drops a batch after max failures, it SHALL emit a WARN log with the count of dropped events and a sample of affected agent IDs.

#### Scenario: 5th consecutive failure triggers DLQ warn
- **WHEN** `flushAgentEventBatcher` fails 5 consecutive times for the same batch
- **THEN** a WARN is logged containing `droppedCount` and `sampleAgentIds`, the pending array is cleared, and the failure counter resets

### Requirement: Per-run tool-name map isolation
The system SHALL reset the tool-use-ID-to-name tracking map for an agent run when that run starts. Module-global tool-name state SHALL NOT bleed between concurrent or sequential runs.

#### Scenario: New run starts with clean tool map
- **WHEN** a new agent run begins (agent_start event received for a new agentId)
- **THEN** any prior tool-use-ID entries for that agentId are cleared
