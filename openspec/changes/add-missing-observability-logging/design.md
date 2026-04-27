## Context

BDE's main-process log at `~/.bde/bde.log` is the primary debugging tool for operators. Three observable failure modes currently emit no actionable log context:

1. **SQLite retry contention** — `withRetryAsync` retries silently up to 5 times with exponential backoff. A query that takes 5 retries at ~1s each looks identical in the log to one that succeeds on the first attempt. Operators cannot distinguish a healthy system from one where WAL contention is degrading throughput.

2. **Drain env-failure taskId** — When `handleEnvironmentalFailure` pauses the drain loop, the log line says which reason triggered the pause but not which task caused it. Operators must correlate timestamps across log lines to find the task.

3. **Claim validation failure** — When `claimTask` rejects a state-transition (e.g., `queued → active` blocked by an invalid current state), the warn includes only `id` and the state-machine reason string. The task title and the actual from/to status pair are omitted, making the log entry harder to act on without a follow-up DB query.

All three are additive log-line enrichments. No behavior changes.

## Goals / Non-Goals

**Goals:**
- Make each failure mode self-describing in a single log line
- Keep `sqlite-retry.ts` dependency-free of main-process modules (no import of `Logger` from `src/main/logger.ts`)
- All existing call sites of `withRetryAsync` must compile without modification (logger injection is opt-in)
- Zero behavior changes — log additions only

**Non-Goals:**
- Adding metrics counters or structured events for retry attempts (observability enhancement, not instrumentation)
- Logging retry attempts in the synchronous `withRetry` (cold-path only; Atomics.wait blocks the thread, so a logger call there would require the same synchronous constraint — out of scope)
- Per-retry logging in the `claimTask` retry loop itself (the `validateTransition` branch fires before retries, so enriching it is sufficient)
- Adding a per-cycle "starting poll" log to `sprint-pr-poller.ts` (idle path already observable via `pr-poller.tick.idle` event)

## Decisions

### D1 — Minimal logger interface on `RetryOptions`, not full `Logger` import

**Decision**: Add `logger?: { warn: (msg: string, fields?: Record<string, unknown>) => void }` to `RetryOptions`. Do not import `Logger` from `src/main/logger.ts`.

**Rationale**: `sqlite-retry.ts` is a pure utility with no main-process dependencies. Importing `Logger` from `src/main/logger.ts` would create a coupling from the data layer to the logging infrastructure — violating the dependency direction. The minimal interface is a structural subtype of every logger in the codebase (`Logger`, `console`, test mocks), so callers pass their existing logger without any adapter.

**Alternative considered**: Import `Logger` type only (no runtime dependency). Rejected — type-only imports still create a conceptual dependency and make the file harder to test in isolation.

### D2 — Log retry rounds only (not attempt 0, not final throw)

**Decision**: In `withRetryAsync`, emit the warn after the backoff delay is computed but before `await new Promise(resolve => setTimeout(resolve, delay))`, on every iteration where `attempt < maxRetries` and `isBusyError(err)` is true. Attempt 0 is never logged (no backoff yet). The final throw after `maxRetries` is already surfaced by the caller.

**Rationale**: Logging attempt 0 would emit a warn on every transient single-retry, which is expected behavior under light WAL contention and would produce noise. Logging the final throw is redundant — the caller already logs it. Logging rounds 1–N gives the signal operators need (contention is recurring) without spam.

### D3 — Enrich existing warn lines, do not add new log statements

**Decision**: For `handleEnvironmentalFailure` and `claimTask`, modify the existing `logger.warn` / `getSprintQueriesLogger().warn` call to include the missing fields. Do not add a second log statement.

**Rationale**: Two log lines for the same event create parsing complexity and can be split across a log rotation boundary. One enriched line is atomic and grep-friendly.

## Risks / Trade-offs

- **Logger field on RetryOptions is optional — callers must opt in**: The retry observability only fires when a logger is passed. Call sites that don't pass a logger (all current ones) remain silent. This is the correct default (no behavior change), but the benefit only materializes when callers are updated to pass a logger. `claimTask` in `sprint-queue-ops.ts` is the highest-value call site and should be updated as part of this change.

  → Mitigation: The task list includes updating `claimTask`'s `withRetryAsync` call to pass `getSprintQueriesLogger()` as the logger.

- **`fields` parameter on the minimal logger interface**: The `warn(msg, fields?)` signature assumes callers pass structured fields as a second argument. BDE's `Logger` type accepts `(msg: string, ...args: unknown[])` (variadic). If the shapes diverge, TypeScript will reject the assignment.

  → Mitigation: Verify `Logger`'s `warn` signature accepts a single optional object as the second argument, or use `warn: (msg: string) => void` (no fields) if not. The proposal calls for `{ attempt, backoffMs }` in the message string, which can be interpolated directly without a structured fields object.

## Open Questions

None — all decisions are resolved. Implementation is straightforward.
