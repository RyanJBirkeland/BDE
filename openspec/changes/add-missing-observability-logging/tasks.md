## 1. sqlite-retry.ts — per-attempt retry logging

- [x] 1.1 Add optional `logger?: { warn: (msg: string) => void }` field to the `RetryOptions` interface in `src/main/data/sqlite-retry.ts`
- [x] 1.2 In `withRetryAsync`, after computing `delay` and before `await new Promise(...)`, emit `opts.logger?.warn(\`[sqlite-retry] SQLITE_BUSY retry attempt=${attempt + 1} backoffMs=${delay}\`)` — only when `attempt < maxRetries` and `isBusyError(err)` is true (the existing guard already ensures this)
- [x] 1.3 Verify `withRetry` (sync) is unchanged

## 2. sprint-queue-ops.ts — enrich claimTask warn and pass logger to withRetryAsync

- [x] 2.1 In `claimTask`'s `validateTransition` branch (around line 64), replace the existing warn with: `getSprintQueriesLogger().warn(\`[sprint-queue-ops] claimTask(id=${id}, title="${oldTask.title}"): invalid transition ${oldTask.status} → active — ${claimValidation.reason}\`)`
- [x] 2.2 Pass `getSprintQueriesLogger()` as `opts.logger` to the `withRetryAsync` call in `claimTask` so SQLite retry rounds are also visible in the log

## 3. drain-loop.ts — add taskId to env-failure warn

- [x] 3.1 In `handleEnvironmentalFailure`, add `taskId` to the existing `deps.logger.warn` call: `[drain-loop] environmental failure for task ${taskId} — pausing drain until ${new Date(pausedUntil).toISOString()}: ${reason}`

## 4. Module documentation

- [x] 4.1 Update `docs/modules/data/index.md` — add or update rows for `sqlite-retry.ts` and `sprint-queue-ops.ts` reflecting the observability additions
- [x] 4.2 Update `docs/modules/agent-manager/index.md` — update row for `drain-loop.ts` to note the enriched env-failure log

## 5. Verification

- [x] 5.1 Run `npm run typecheck` — zero errors required
- [x] 5.2 Run `npm test` — all tests must pass
- [x] 5.3 Run `npm run test:main` — all main-process tests must pass
- [x] 5.4 Run `npm run lint` — zero errors required
