## Context

`agent-event-mapper.ts` accumulates agent events and flushes them to SQLite in batches. The circuit breaker tracks consecutive failures. On the 5th failure it calls `pending.splice(0)` — permanently dropping all pending events. There is no log of how many rows were lost or which agents they belonged to. The `toolNameByUseId` Map that resolves tool-use IDs to names is declared at module scope — shared across all batcher instances.

## Goals / Non-Goals

**Goals:**
- On 5th consecutive batch failure: log a WARN with `{ droppedCount, sampleAgentIds, reason }` and reset — a "DLQ sentinel"
- Move `toolNameByUseId` Map inside the per-run scope (reset on `agent start` event)
- Ensure `MAX_EVENTS_PER_AGENT` constant is 500 (canonical)

**Non-Goals:**
- Durable DLQ to disk/SQLite (adds schema migration; too heavy for this epic)
- Retry with exponential backoff (the circuit breaker already provides a cool-down)
- Changing batch size or flush interval

## Decisions

### D1: DLQ sentinel is a WARN log + metrics increment, not persistent storage

```ts
if (consecutiveFailures >= MAX_BATCH_FAILURES) {
  logger.warn('[event-batcher] permanent batch failure — events dropped', {
    droppedCount: pending.length,
    sampleAgentIds: [...new Set(pending.slice(0,5).map(e => e.agentId))],
    reason: lastError?.message
  })
  droppedEventCount += pending.length  // module-level counter for metrics
  pending.splice(0)
  consecutiveFailures = 0
}
```

_Alternative_: write dropped events to a separate SQLite table. Adds schema + migration complexity. The WARN log is actionable enough for incident diagnosis.

### D2: `toolNameByUseId` Map reset via `agent:start` event hook

The mapper already processes event types. On an `agent_start`-equivalent event for a given `agentId`, reset that agent's tool-name map slice. Since the Map is keyed by `toolUseId` (globally unique UUIDs from the SDK), collisions between agents are already impossible — the scope change is about test isolation, not correctness. Move to a `WeakMap<agentRunId → Map>` or a flat Map with `agentId:toolUseId` composite keys.

## Risks / Trade-offs

- **Risk**: DLQ WARN fires during a SQLite outage and floods the log → Mitigation: the circuit breaker already throttles to one attempt per cool-down window; the WARN fires at most once per circuit-open event
- **Trade-off**: In-memory DLQ sentinel means dropped events are unrecoverable after restart — acceptable since the alternative (silent drop) is strictly worse
