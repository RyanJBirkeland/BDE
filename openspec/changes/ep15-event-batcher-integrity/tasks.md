## 1. DLQ Sentinel on Permanent Batch Failure

- [ ] 1.1 Read `src/main/agent-event-mapper.ts` — find the circuit-breaker / `splice(0)` path
- [ ] 1.2 Replace silent `pending.splice(0)` with: log `logger.warn('event-batcher: permanent failure — dropping events', { droppedCount, sampleAgentIds, reason })` then clear
- [ ] 1.3 Add `droppedEventCount` module-level counter incremented on every drop (for future metrics)
- [ ] 1.4 Add unit test: 5 consecutive failures → WARN logged with droppedCount > 0, pending cleared, counter resets

## 2. Per-Run Tool-Name Map Isolation

- [ ] 2.1 Find `toolNameByUseId` Map in `agent-event-mapper.ts` — confirm it is module-global
- [ ] 2.2 Change to composite key `agentId:toolUseId` OR move to a Map keyed by agentId (nested Map) — pick whichever is simpler
- [ ] 2.3 On agent-run-start event (or first event for a new agentId), clear that agent's tool-name entries
- [ ] 2.4 Add unit test: two concurrent agents don't share tool-name entries

## 3. Verification

- [ ] 3.1 `npm run typecheck` — zero errors
- [ ] 3.2 `npx vitest run --config src/main/vitest.main.config.ts` — all pass  
- [ ] 3.3 `npm run lint` — zero errors
- [ ] 3.4 Update `docs/modules/agent-manager/index.md` for `agent-event-mapper.ts`
