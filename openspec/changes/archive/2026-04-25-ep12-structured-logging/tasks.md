## 1. Logger Infrastructure

- [ ] 1.1 Add `event(name: string, fields: Record<string, unknown>): void` to the `Logger` type and `createLogger()` implementation in `src/main/logger.ts` — writes NDJSON line with `{ts, level, module, event, ...fields}`
- [ ] 1.2 Add unit test for `logger.event()`: output parses as JSON, contains required fields, extra fields pass through, missing optional fields absent

## 2. Tick Correlation

- [ ] 2.1 Generate `tickId` (short random hex) at the top of `runDrain()` in `src/main/agent-manager/drain-loop.ts`
- [ ] 2.2 Thread `tickId` through `drainQueuedTasks` → `processQueuedTask` → spawn call (add to existing deps/context object, not as a new parameter)
- [ ] 2.3 Demote the drain idle heartbeat from `logger.info` to `logger.debug` and convert it to `logger.event('drain.tick.idle', { tickId, queuedCount: 0 })`

## 3. Hot-Path Structured Events

- [ ] 3.1 Convert the agent spawn log in `src/main/agent-manager/spawn-sdk.ts` to `logger.event('agent.spawn', { taskId, tickId, agentType, model, maxBudgetUsd, cwd })` — extend the T-72 log line already present
- [ ] 3.2 Convert the watchdog kill log in `src/main/agent-manager/watchdog-loop.ts` to `logger.event('agent.watchdog.kill', { taskId, runtimeMs, limitMs, agentType, verdict })` — extend the T-30 log line already present
- [ ] 3.3 Convert the agent completion log in `src/main/agent-manager/run-agent.ts` to `logger.event('agent.completed', { taskId, status, durationMs, model, costUsd })` — extend the T-19 log line already present
- [ ] 3.4 Convert the stream-error log in `src/main/agent-manager/message-consumer.ts` to `logger.event('agent.stream.error', { taskId, messagesConsumed, lastEventType, error })` — extend the T-20 log line already present
- [ ] 3.5 Add `logger.event('agent.terminal', { taskId, status, source })` in `src/main/agent-manager/terminal-handler.ts` at the point the terminal status is written

## 4. Eliminate console.* in main-process

- [ ] 4.1 Grep `src/main/` for `console\.warn|console\.log|console\.error` (excluding test files and intentional one-off startup logs in `index.ts`)
- [ ] 4.2 Replace each found instance with the module's named logger — create a module-scoped `const log = createLogger('module-name')` where none exists

## 5. Verification

- [ ] 5.1 `grep -rn "console\.\(warn\|log\|error\)" src/main/ --include="*.ts" | grep -v "\.test\."` returns zero results (excluding intentional index.ts startup console)
- [ ] 5.2 All gates pass: `npm run typecheck` + `npx vitest run --config src/main/vitest.main.config.ts` + `npm test` + `npm run lint`
- [ ] 5.3 Update `docs/modules/agent-manager/index.md` rows for modified files; update `docs/modules/lib/main/index.md` for logger.ts change
