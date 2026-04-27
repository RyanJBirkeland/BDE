## Context

The circuit breaker in `AgentManagerImpl` (being extracted to `ErrorRegistry` in EP-2) increments on any `runAgent` rejection. `runAgent` can fail for many reasons: spawn failure (pre-stream), SDK stream error (mid-run), worktree cleanup error (post-run). Only spawn failures justify pausing the drain — mid-run failures indicate a problem with a specific task, not with the spawning infrastructure.

The fast-fail check counts failures but doesn't evict entries older than 30s before evaluating the count — a task that fails once, idles for an hour, then fails twice more will be exhausted even though no three failures occurred within 30s. `classifyExit` applies patterns in array order with no logging of which pattern matched, making it hard to debug misclassifications.

## Goals / Non-Goals

**Goals:**
- Distinguish spawn-phase vs stream-phase failures in `runAgent`; only spawn-phase increments the circuit breaker
- Circuit breaker OPEN logs `{ triggeringTask, failureCount, recentFailures: [{taskId, reason}] }`
- Fast-fail evicts entries older than 30s before the count check (true temporal sliding window)
- `classifyExit` logs `logger.debug('classifyExit matched', { pattern: p.name, verdict })` on each match
- Watchdog `runWatchdog` checks `activeAgents.has(agentRunId)` before calling terminal notify — idempotent against orphan recovery racing in

**Non-Goals:**
- Changing the circuit breaker threshold (still 5 failures)
- Changing the fast-fail threshold (still 3 in 30s)
- Merging `retry_count` and `fast_fail_count` into one field (data model change, deferred)

## Decisions

### D1: Spawn-phase boundary = before `sdk.query()` is called

`runAgent` → `spawnAndWireAgent` → `spawnWithTimeout` → `spawnViaSdk`. The spawn phase ends when `sdk.query()` successfully returns an async iterator. Any error thrown before that point is a spawn failure. Any error after (stream error, tool error, etc.) is a stream failure. Mark the boundary with a flag in `RunAgentResult` or by catching separately in `runAgent`.

### D2: Fast-fail sliding window uses timestamps

```ts
interface FastFailEntry { ts: number; reason: string }
// Before counting:
const recent = entries.filter(e => Date.now() - e.ts < FAST_FAIL_WINDOW_MS)
if (recent.length >= FAST_FAIL_THRESHOLD) { /* exhaust */ }
```

Replace the current simple count with a timestamped array. Evict stale entries at check time (not in a background interval — simpler).

### D3: `classifyExit` logs at DEBUG per match

Add `logger.debug('[failure-classifier] matched', { pattern: p.name, verdict: p.verdict, taskId })` inside the match loop. Only fires in debug mode so it doesn't pollute the default INFO log.

### D4: Watchdog idempotency via agentRunId map check

`runWatchdog` already has access to `activeAgents`. Add: `if (!activeAgents.has(agentRunId)) { logger.debug('watchdog: agent already removed, skipping terminal notify'); return }` before the terminal dispatch. This prevents double-notify if orphan recovery runs between the watchdog detecting timeout and executing the kill.

## Risks / Trade-offs

- **Risk**: Spawn-phase boundary detection requires changes to `spawnAndWireAgent` return type → Mitigation: a simple `{ spawnSucceeded: boolean }` result field is sufficient; no API surface change
- **Trade-off**: Timestamped fast-fail entries use more memory than a simple counter — negligible (at most 3 entries per task)
