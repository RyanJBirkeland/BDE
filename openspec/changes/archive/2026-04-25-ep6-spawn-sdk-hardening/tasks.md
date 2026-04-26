## 1. Per-Message Stream Deadline (T-70)

- [x] 1.1 Read `src/main/agent-manager/message-consumer.ts` in full before editing
- [x] 1.2 Add `MESSAGE_STALL_TIMEOUT_MS = 120_000` constant; wrap the `for await` loop with a `Promise.race` against a per-iteration sleep so stalls are detected
- [x] 1.3 On stall: emit `agent.stream.error` event via existing `logger.event()` with `{ reason: 'stalled', messagesConsumed, lastEventType, taskId }` and break the loop with a `streamError`
- [x] 1.4 Add unit test: mock stream that stalls → `streamError` with `reason: 'stalled'`

## 2. SpawnStrategy Registry (T-73/74/78)

- [x] 2.1 Read `src/main/agent-manager/sdk-adapter.ts` and `spawn-sdk.ts` to understand current `useSdk` flag routing
- [x] 2.2 Define `SpawnStrategy = { type: 'sdk' } | { type: 'cli'; claudePath: string }` in `sdk-adapter.ts` or a shared types file
- [x] 2.3 Add `resolveSpawnStrategy(config): SpawnStrategy` function that encapsulates the current `useSdk` decision logic
- [x] 2.4 Replace `useSdk: boolean` parameter with `strategy: SpawnStrategy` through the call chain (`spawnWithTimeout`, `spawnViaSdk`, etc.)
- [x] 2.5 Extend the existing `agent.spawn` structured log event to include `backend: strategy.type`

## 3. Verification

- [x] 3.1 `npm run typecheck` — zero errors
- [x] 3.2 `npx vitest run --config src/main/vitest.main.config.ts` — all pass
- [x] 3.3 `npm run lint` — zero errors
- [x] 3.4 Update `docs/modules/agent-manager/index.md` for `message-consumer.ts` and `sdk-adapter.ts`
