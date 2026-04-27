## Why

The agent-event batch circuit breaker splices rows out of the pending array before the write attempt. If the write fails 5 times, those rows are gone permanently — no DLQ, no retry, no log of what was lost. The tool-name tracking Map is module-global, so two concurrent `AgentManagerImpl` instances (possible in tests or future multi-repo mode) share state and corrupt each other's tool-name resolution.

## What Changes

- **BREAKING (internal)** Batch retry path moves rows to a dead-letter queue (in-memory sentinel + warn log) instead of dropping them on 5th failure
- Tool-name tracking Map scoped per manager instance, not module-global
- Per-run tool-name map reset on agent start
- `MAX_EVENTS_PER_AGENT` alignment confirmed (500, canonical from CLAUDE.md) — already done in EP-11 if EP-11 landed first

## Capabilities

### New Capabilities

- `event-batcher-dlq`: Failed batches enter a DLQ sentinel (logged at WARN with row count + sample IDs) instead of being silently dropped after 5 failures

### Modified Capabilities

<!-- No spec-level behavior changes visible to users -->

## Impact

- `src/main/agent-event-mapper.ts` — DLQ sentinel on permanent batch failure; per-run tool-name map
- `src/main/agent-manager/index.ts` — pass per-instance batcher/tracker to `AgentManagerImpl`
