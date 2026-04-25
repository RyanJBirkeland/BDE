## Context

`consumeMessages` in `message-consumer.ts` loops over an async generator from the SDK. If the SDK stream stalls (network partition, slow response), the loop simply waits. The watchdog fires after 1 hour. There is no intermediate deadline. `sdk-adapter.ts` has a boolean `useSdk` flag that routes to either the SDK path or the CLI fallback — callers must know about this internal routing detail.

## Goals / Non-Goals

**Goals:**
- Per-message timeout in `consumeMessages` that emits `agent.stream.error` with `reason: 'stalled'` if no message arrives within the deadline
- Timeout wrapper around credential refresh if that call exists in the spawn path
- Replace `useSdk` boolean with a `SpawnStrategy` discriminated type — cleaner extension point
- Log the resolved backend name (sdk/cli) in the existing `agent.spawn` structured event

**Non-Goals:**
- Changing the SDK itself or its timeout behavior
- Adding retry logic to the stream (watchdog handles retries at a higher level)
- Removing the CLI fallback path

## Decisions

### D1: Per-message deadline via `Promise.race`

```ts
const MESSAGE_STALL_TIMEOUT_MS = 120_000 // 2 minutes between messages

for await (const msg of stream) {
  // existing processing
}
// becomes:
async function nextWithTimeout(iter) {
  return Promise.race([
    iter.next(),
    sleep(MESSAGE_STALL_TIMEOUT_MS).then(() => ({ stalled: true }))
  ])
}
```

If stalled, emit `agent.stream.error` with `messagesConsumed`, `lastEventType`, `reason: 'stalled'` and break the loop. The existing stream-error handling in `runAgent` then classifies and retries normally.

_Alternative_: Abort signal passed to SDK. Requires SDK support; more invasive. `Promise.race` is self-contained.

### D2: SpawnStrategy as a discriminated union

```ts
type SpawnStrategy = { type: 'sdk' } | { type: 'cli'; claudePath: string }
```

`spawnWithTimeout` accepts `strategy: SpawnStrategy` instead of `useSdk: boolean`. The selection logic (currently in `sdk-adapter.ts`) moves to a `resolveSpawnStrategy(config)` function. The resolved strategy name is included in the `agent.spawn` structured log event.

### D3: Credential timeout via `Promise.race` with `sleep`

If `refreshCredential` is called in the spawn path, wrap it:
```ts
await Promise.race([
  credService.refreshCredential('claude'),
  sleep(CREDENTIAL_REFRESH_TIMEOUT_MS).then(() => { throw new Error('credential refresh timed out') })
])
```
`CREDENTIAL_REFRESH_TIMEOUT_MS = 10_000`. On timeout, classify as environmental failure so the drain pauses rather than retrying immediately.

## Risks / Trade-offs

- **Risk**: 2-minute per-message deadline is too tight for slow network → Mitigation: constant is named and easy to tune; 2 min is very conservative for a healthy connection
- **Risk**: SpawnStrategy refactor breaks existing callers → Mitigation: `useSdk` flag is only used internally in `sdk-adapter.ts`; no IPC surface change
