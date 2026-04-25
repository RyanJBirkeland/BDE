## ADDED Requirements

### Requirement: Per-poll timeout
The system SHALL abort a poll cycle that does not complete within `POLL_TIMEOUT_MS` (30 seconds) and log a WARN.

#### Scenario: Slow GitHub response times out
- **WHEN** `pollPrStatuses` takes longer than `POLL_TIMEOUT_MS`
- **THEN** the poll cycle is aborted, a WARN is logged, and the next cycle fires on schedule

### Requirement: Single-flight poll execution
The system SHALL skip a poll cycle if the previous cycle is still running.

#### Scenario: Slow poll skips next interval tick
- **WHEN** the 60s interval fires while a poll is still in progress
- **THEN** the new tick is skipped and a DEBUG log is emitted

### Requirement: Failed terminal notifies retry on next poll
The system SHALL retain failed `onTaskTerminal` calls in an in-memory retry queue and re-attempt them on the next successful poll cycle.

#### Scenario: Terminal notify fails then succeeds on retry
- **WHEN** `onTaskTerminal` throws on the first attempt
- **THEN** the entry is queued and retried on the next poll cycle; on success, the entry is removed from the queue

### Requirement: Auth/rate-limit errors surface as user-visible warning
The system SHALL broadcast a `manager:warning` toast when the poll fails due to an auth or rate-limit error.

#### Scenario: 401/403/rate-limit response triggers toast
- **WHEN** `pollPrStatuses` throws with an auth or rate-limit error
- **THEN** a `manager:warning` broadcast fires with a human-readable message
