## Why

A spawned agent that hits a slow Keychain read, a wedged credential refresh, or a stalled SDK stream will wait out the entire 1-hour watchdog with no feedback. The spawn path has no per-operation timeout. The CLI fallback path (`spawnViaSdk`) accepts a flag argument (`useSdk: boolean`) that forces callers to know about the internal routing decision instead of letting a strategy registry handle it.

Note: T-72 (spawn-time log), T-79 (drop steer body from log) are already done in wave 3. This epic covers the remaining hardening tasks.

## What Changes

- **NEW** Per-message deadline in `consumeMessages` — if no message arrives within N seconds, the stream is considered stalled and an error is emitted (T-70)
- **NEW** `credService.refreshCredential` call (if present in spawn path) gets a timeout so it can't hang the drain forever (T-71)
- `spawnAgent` / `spawnViaSdk` flag argument replaced with a `SpawnStrategy` interface + registry so backend dispatch is open for extension (T-73/74)
- Structured `agent.spawn` event already written (T-72 done); extend with resolved backend name (T-78)
- `parseMessages` preserves trailing stdout that arrives after the last structured message (T-80)

## Capabilities

### New Capabilities

- `spawn-timeouts`: Per-message stream deadline + credential-refresh timeout to prevent indefinite stalls in the spawn/stream path

### Modified Capabilities

<!-- No spec-level behavior changes — same spawn semantics, faster failure on stall -->

## Impact

- `src/main/agent-manager/message-consumer.ts` — per-message deadline (T-70)
- `src/main/agent-manager/spawn-sdk.ts` — credential timeout (T-71), resolved backend log (T-78)
- `src/main/agent-manager/sdk-adapter.ts` — SpawnStrategy registry replacing flag arg (T-73/74)
- `src/main/agent-manager/spawn-and-wire.ts` — thread strategy selection through (T-76)
