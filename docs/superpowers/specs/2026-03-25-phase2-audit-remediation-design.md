# Phase 2 Audit Remediation — Per-Task MaxRuntime, Polling Backoff, Structured Logging

## Goal

Three targeted structural improvements from the BDE deep audit: allow per-task runtime limits, add backoff/jitter to renderer polling, and consolidate main-process logging to a shared file logger.

## Item 10: Per-Task maxRuntime Override

**Problem:** All agent tasks share a 1-hour runtime limit. Long-running data processing tasks get killed prematurely.

**Solution:**

- Add optional `max_runtime_ms` (nullable integer) to `SprintTask` type and Supabase schema
- Add to `UPDATE_ALLOWLIST` and `GENERAL_PATCH_FIELDS` for API access
- Store in `ActiveAgent` at spawn time
- Watchdog uses `task.max_runtime_ms ?? config.maxRuntimeMs` as the limit

## Item 12: Polling Backoff + Jitter

**Problem:** 13 fixed-interval pollers fire simultaneously, no error backoff. Thundering herd at every interval boundary.

**Solution:**

- Create `useBackoffInterval(callback, baseMs, options?)` hook
- Options: `maxMs` (default: 5x base), `jitterMs` (default: 10% of base), `backoffFactor` (default: 2)
- On error: double interval up to maxMs. On success: reset to base + jitter.
- Initial jitter: first fire offset by random(0, jitterMs)
- Apply to: Sprint, Dashboard, Git status, PR status pollers
- Keep health check (10m) on fixed interval

## Item 7: Structured Logging

**Problem:** 26 console.\* calls in 12 main-process files with no persistent file output. Agent manager has its own file logger but nothing else does.

**Solution:**

- Extract shared `createLogger(name)` to `src/main/logger.ts`
- Writes to `~/.bde/bde.log` with `[LEVEL] [name] message` format
- Basic rotation: truncate at startup if file > 10MB
- Replace all 26 console.\* calls with shared logger
- Agent manager keeps its own `agent-manager.log` (separate concern)
