## Why

The circuit breaker counts any `runAgent` failure — including mid-run OOMs and stream errors — as a spawn failure. Five mid-run crashes with no spawn issue will pause the entire drain for all repos. Fast-fail only counts the number of failures, not whether they happened within the claimed 30-second window — the temporal boundary it advertises is never tested. `retry_count` and `fast_fail_count` diverge confusingly (one resets on retry, the other doesn't). Watchdog kill notifications can double-fire if orphan recovery runs while a watchdog kill is in progress.

## What Changes

- Circuit breaker scoped to spawn-phase failures only (before the SDK stream starts) — mid-run failures don't count
- Circuit breaker OPEN state logs the contributing task IDs and failure reasons
- Fast-fail temporal boundary enforced: failures older than 30s are evicted before the count check
- `retry_count` and `fast_fail_count` consolidated — surface both clearly or merge into one counter with context
- Watchdog kill path is idempotent against orphan recovery (won't double-notify terminal)
- `classifyExit` decisions logged at DEBUG with the matched pattern name

## Capabilities

### New Capabilities

- `spawn-phase-circuit-breaker`: Circuit breaker counts only spawn-phase failures, not mid-run crashes — reduces false drain pauses

### Modified Capabilities

<!-- No spec-level behavior changes to end users — same failure thresholds, more accurate counting -->

## Impact

- `src/main/agent-manager/drain-loop.ts` — circuit breaker scope tightened to spawn phase
- `src/main/agent-manager/run-agent.ts` — mark spawn vs stream failure boundary
- `src/main/agent-manager/watchdog-loop.ts` — idempotency guard vs orphan recovery
- `src/main/agent-manager/failure-classifier.ts` — log matched pattern on `classifyExit`
- `src/main/agent-manager/__tests__/failure-classifier.test.ts` — determinize precedence tests
