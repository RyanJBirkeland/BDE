## Why

Every pipeline log line today is an unstructured string. There is no way to grep for "all events related to task X" or correlate a spawn → watchdog kill → terminal sequence without manually parsing freeform text. When something goes wrong at 2am, the log is noise. Wave 3 added a handful of enriched log lines (T-19/20/30/72/145/146) — this epic makes that pattern the standard everywhere.

## What Changes

- **NEW** Structured JSON log helper `logger.event(eventName, fields)` added to the existing `createLogger` factory
- All pipeline hot-path log lines (spawn, watchdog kill, terminal, drain tick, stream error) converted to structured JSON with `{event, taskId, agentRunId, phase, ...}` fields
- Drain heartbeat demoted to DEBUG level — stops drowning real incidents in idle noise
- `console.warn` and `console.log` calls in all main-process modules replaced with the shared logger
- Skills and failure messages that referenced the stale `agent-manager.log` path already fixed (wave 3 / T-143) — no rework needed
- **NEW** Tick correlation IDs propagated through drain → claim → spawn for cross-event joins
- No secrets or user-controlled content in any log line — XML-boundary pattern enforced at interpolation sites

## Capabilities

### New Capabilities

- `structured-log-events`: `logger.event()` helper + standard field schema (`event`, `taskId`, `agentRunId`, `tickId`, `phase`, `durationMs`) applied to spawn/terminal/watchdog/drain log paths

### Modified Capabilities

<!-- No spec-level behavior changes — this is observability infrastructure, not feature behavior -->

## Impact

- `src/main/logger.ts` — adds `event()` method to the Logger type returned by `createLogger`
- `src/main/agent-manager/spawn-sdk.ts` — structured spawn event (T-72 done; extend with tickId)
- `src/main/agent-manager/watchdog-loop.ts` — structured kill event (T-30 done; already has taskId/runtimeMs)
- `src/main/agent-manager/terminal-handler.ts` — structured terminal event
- `src/main/agent-manager/drain-loop.ts` — tick-id generation, heartbeat → DEBUG
- `src/main/agent-manager/run-agent.ts` — structured completion + stream-error events (T-19/20 done)
- `src/main/agent-manager/index.ts` — remove legacy duplicate log lines (T-9 done)
- Any remaining `console.warn`/`console.log` in main-process modules
