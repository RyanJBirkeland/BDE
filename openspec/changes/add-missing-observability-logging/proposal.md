## Why

Operators debugging production issues have no visibility into SQLite retry contention, which task triggered a drain pause, or why a claim was rejected — they must guess from timing and context. These three targeted log additions make each failure mode self-describing in `~/.bde/bde.log` without any behavior change.

## What Changes

- **`sqlite-retry.ts` `withRetryAsync`**: emit a `warn` on each retry round (attempts 1–N) with `{ attempt, backoffMs }`. A new optional `logger` field on `RetryOptions` accepts a minimal `{ warn }` interface so existing call sites are unaffected.
- **`drain-loop.ts` `handleEnvironmentalFailure`**: add `taskId` to the existing warn log line so the triggering task is immediately visible without a secondary grep.
- **`sprint-queue-ops.ts` `claimTask`**: enrich the existing `validateTransition` warn with `oldTask.title` and the from/to status pair (`${oldTask.status} → active`). All data is already in scope — no new queries needed.
- **`sprint-pr-poller.ts`**: no change — per-cycle observability already sufficient (`pr-poller.tick.idle` event + in-progress guard log).

## Capabilities

### New Capabilities

- `sqlite-retry-observability`: `withRetryAsync` surfaces per-attempt retry context via an injected logger, giving operators a concrete signal when SQLite contention is occurring and how severe it is.

### Modified Capabilities

<!-- No existing spec-level behavior is changing — these are purely additive log lines. -->

## Impact

- `src/main/data/sqlite-retry.ts` — `RetryOptions` interface + `withRetryAsync` signature (backward-compatible; `logger` is optional)
- `src/main/agent-manager/drain-loop.ts` — `handleEnvironmentalFailure` log line only
- `src/main/data/sprint-queue-ops.ts` — `claimTask` validation warn line only
- No IPC surface changes, no schema changes, no test additions required
