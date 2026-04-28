## 1. T-21 — Incremental dependency query (prerequisite for T-1)

- [x] 1.1 In `src/main/data/sprint-agent-queries.ts`, add `changedTaskIds?: Set<string>` parameter to `getTasksWithDependencies`; when non-empty emit `WHERE id IN (?)` via better-sqlite3 placeholder expansion; fall back to full scan when absent or empty
- [x] 1.2 In `src/main/data/sprint-task-repository.ts`, update `IAgentTaskRepository.getTasksWithDependencies` signature to accept `changedTaskIds?: Set<string>`
- [x] 1.3 In `src/main/data/sprint-task-repository.ts`, update the `createSprintTaskRepository` factory delegate for `getTasksWithDependencies` to forward the optional parameter
- [x] 1.4 Add or update unit tests for `getTasksWithDependencies`: full-scan with no arg, full-scan with empty set, scoped scan with non-empty set

## 2. T-1 — Pass task-ID hint in drain-loop dep-index refresh (depends on T-21)

- [x] 2.1 In `src/main/agent-manager/drain-loop.ts` `buildTaskStatusMap`, when `isDepIndexDirty()` is true and `_recentlyProcessedTaskIds` is non-empty, call `repo.getTasksWithDependencies(new Set(this._recentlyProcessedTaskIds))`; keep the existing full-scan call as the fallback when the set is empty
- [x] 2.2 Update drain-loop tests to verify that the hint set is passed when `_recentlyProcessedTaskIds` is non-empty, and that the full scan is used when it is empty

## 3. T-60 — SQLite circuit-breaker health broadcast

- [x] 3.1 In `src/main/agent-event-mapper.ts`, add `import { broadcast } from './broadcast'` at the top of the file
- [x] 3.2 In the queue-overflow path (`_pending.length > MAX_PENDING_EVENTS`), change `logger.warn` to `logger.error` and add `broadcast('manager:warning', { message: ... })` with a message including the drop count and affected agent IDs
- [x] 3.3 In the permanent-failure path (consecutive-failure ceiling), change `logger.warn` to `logger.error` and add `broadcast('manager:warning', { message: ... })` with a message including drop count, sample agent IDs, and failure reason
- [x] 3.4 Verify the rate-limited SQLite error context log (line ~321) remains `logger.warn` — no change needed there
- [x] 3.5 Add or update tests for the overflow and permanent-failure paths to assert `broadcast` is called with `'manager:warning'`

## 4. T-61 — Eliminate redundant clearTimeout call in event batcher hot path

- [x] 4.1 In `src/main/agent-event-mapper.ts` `emitAgentEvent`, guard the `clearTimeout(_flushTimer)` call with `if (_flushTimer)` before calling it on the batch-full path
- [x] 4.2 Verify existing batcher tests still pass after the change (no new tests required for this micro-fix)

## 5. T-62 — Eliminate intermediate array in sprint PR poller

- [x] 5.1 In `src/main/sprint-pr-poller.ts` `poll()`, replace the `.map(...).filter(...)` chain with a single `.flatMap((t) => t.pr_url ? [{ taskId: t.id, prUrl: t.pr_url }] : [])`, removing the non-null assertion
- [x] 5.2 Verify existing PR poller tests still pass after the change

## 6. T-23 — Raise WAL autocheckpoint threshold

- [x] 6.1 In `src/main/db.ts`, change `_db.pragma('wal_autocheckpoint=200')` to `_db.pragma('wal_autocheckpoint=1000')` and add an inline comment explaining the 1000-page / ~4 MB rationale
- [x] 6.2 Verify existing db/migration tests still pass after the change

## 7. Documentation and pre-commit checks

- [x] 7.1 Update `docs/modules/data/index.md` for `sprint-agent-queries.ts` and `sprint-task-repository.ts` (signature change)
- [x] 7.2 Update `docs/modules/agent-manager/index.md` for `drain-loop.ts`
- [x] 7.3 Confirm `npm run typecheck`, `npm test`, and `npm run lint` all pass before committing
