## Why

The sprint PR poller has no per-poll timeout and no single-flight guard — a slow GitHub API response can stack multiple in-flight poll cycles. Auth failures and rate-limit errors are only logged to file; there's no in-app signal so users don't know why their merged PRs aren't transitioning. When `notifyTaskTerminalBatch` fails, the task's `pr_status` has already flipped so the next cycle won't retry — the dependency chain stays blocked with no recovery path. The legacy singleton (`_instance`) should be removed now that the DI constructor pattern is established.

## What Changes

- Per-poll timeout (`Promise.race` with 30s deadline) prevents stacked poll cycles
- Single-flight guard: if a poll is already running when the interval fires, skip the tick
- Auth/rate-limit failures broadcast a `manager:warning` toast to the renderer
- Failed terminal notifications entered into a durable in-memory retry queue (cleared on next successful terminal for that task)
- Legacy `startSprintPrPoller` / `stopSprintPrPoller` singleton removed; callers use the DI constructor
- DEBUG-only heartbeat log so idle poll ticks don't flood `bde.log`

## Capabilities

### New Capabilities

- `pr-poll-retry-queue`: In-memory retry queue for failed `onTaskTerminal` calls — prevents broken dependency chains when GitHub is temporarily slow

### Modified Capabilities

<!-- No spec-level behavior changes to end users except the new warning toast -->

## Impact

- `src/main/sprint-pr-poller.ts` — timeout, single-flight, retry queue, toast broadcast, heartbeat demotion, legacy singleton removal
- `src/main/index.ts` — update call site to DI constructor
