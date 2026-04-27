## Context

`createLogger(name)` in `src/main/logger.ts` returns `{ info, warn, error, debug }` — all accepting a plain string. There is no structured field support. Every log line is `[LEVEL] [module] free text`, which makes programmatic querying impossible. The drain loop emits an info-level heartbeat every tick (~30s), drowning `~/.bde/bde.log` under idle noise. Several main-process modules still fall back to `console.warn` (worktree, file-lock — partially fixed in waves 1-2 but not uniformly).

## Goals / Non-Goals

**Goals:**
- Add `logger.event(name, fields)` that writes a JSON line: `{"ts":"...","level":"INFO","module":"...","event":"...","taskId":"...","agentRunId":"...",...}`
- Apply to the 6 highest-value log sites: spawn, watchdog-kill, terminal, drain-tick, stream-error, completion
- Add tickId to drain loop for cross-event correlation
- Demote drain heartbeat to DEBUG
- Eliminate remaining `console.*` in main-process modules

**Non-Goals:**
- Full log pipeline (shipper, aggregator, Datadog/Loki integration)
- Changing log rotation or file location
- Structured logging in renderer process
- Retroactively converting every existing string log line — only the hot-path pipeline events

## Decisions

### D1: `logger.event()` appends JSON to the same file, same rotation

Same `appendFileSync` path as existing string logs. Format: one JSON object per line (NDJSON). Mixed with existing string lines — parsers that want only structured events filter by `{` prefix. Keeps the change contained to `logger.ts` + call sites.

_Alternative_: Separate structured log file. Rejected — doubles the rotation/cleanup surface.

### D2: `tickId` is a short random hex generated once per `runDrain()` invocation

```ts
const tickId = Math.random().toString(16).slice(2, 10)
```

Passed down to `processQueuedTask` → `spawnAgent` → spawn log. Drain heartbeat (now DEBUG) also carries it. Enables "show me everything that happened in drain tick abc12345" queries.

_Alternative_: Monotonic counter. Rejected — resets on restart, tickId from two processes could collide; random hex is collision-resistant and log-friendly.

### D3: Standard field set (required vs optional)

Required on every `logger.event()` call: `event` (dot-namespaced string, e.g. `agent.spawn`).  
Contextual (include when in scope): `taskId`, `agentRunId`, `tickId`, `phase`, `durationMs`, `model`, `costUsd`.  
No validation at runtime — TypeScript interface is the contract.

### D4: Existing `console.*` calls replaced by `createLogger('module-name')`

A grep pass identifies remaining `console.warn/log/error` in `src/main/`. Each is replaced with the module's logger (or a newly created one). No `console.*` should remain in main-process non-test code.

## Risks / Trade-offs

- **Risk**: Mixed NDJSON + string lines in bde.log confuse `tail -f` readers → Mitigation: document the format; existing string lines are unchanged and still human-readable
- **Risk**: `tickId` thread-through increases function arities → Mitigation: add `tickId` to the existing `DrainContext` / deps objects rather than as an extra parameter
- **Trade-off**: `logger.event()` is fire-and-forget (no awaiting slow writes) — consistent with current logger behavior; slow-write sentinel (T-145, done) will surface disk pressure
