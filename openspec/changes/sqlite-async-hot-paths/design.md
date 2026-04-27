## Context

BDE runs SQLite in WAL mode on the Electron main thread. `withRetry` (sync) backs off on `SQLITE_BUSY` via `Atomics.wait`, which blocks the OS thread — including Electron's main-thread event loop — for the full backoff duration (up to ~5 s under heavy contention). `withRetryAsync` (already in `sqlite-retry.ts`) performs identical retry logic but yields between attempts via `setTimeout`, so the event loop keeps spinning.

The three hot-path data modules all import `withRetry`:

| Module | Functions using `withRetry` |
|---|---|
| `sprint-task-crud.ts` | `writeTaskUpdate` (called by `updateTask`, `forceUpdateTask`, `createReviewTaskFromAdhoc`) |
| `sprint-queue-ops.ts` | `claimTask` (the WIP-check + claim transaction) |
| `sprint-pr-ops.ts` | none yet — but `markTaskDoneByPrNumber`, `markTaskCancelledByPrNumber`, `updateTaskMergeableState` wrap `conn.transaction()` without a retry guard; adding `withRetryAsync` here closes a latent contention hole |

These are called from the agent-manager drain loop, watchdog, completion pipeline, and Sprint PR poller — all on the main thread, all in paths that run concurrently with renderer IPC.

`releaseTask` in `sprint-queue-ops.ts` uses a bare `conn.transaction()` with no retry guard. It is called from watchdog and shutdown paths and should also be wrapped.

## Goals / Non-Goals

**Goals:**
- All hot-path SQLite write operations yield to the event loop during `SQLITE_BUSY` backoff.
- The repository interface (`ISprintTaskRepository` sub-interfaces) accurately reflects async return types so call sites are type-checked by the compiler.
- No change to observable behavior: same retry counts, same backoff math, same audit trail, same transaction semantics.
- Cold-path callers (migrations, IPC handlers via `sprint-service`, `createTask` called from IPC context) stay synchronous — no unnecessary async infection.
- All existing tests remain green; new tests cover the async retry path.

**Non-Goals:**
- Migrating read-only queries (`getTask`, `listTasks`, `getQueuedTasks`, `getActiveTaskCount`, `listTasksWithOpenPrs`) — reads do not acquire write locks and cannot produce `SQLITE_BUSY` in WAL mode.
- Moving SQLite to a worker thread or changing the WAL configuration.
- Changing `withRetry` itself — it stays for cold-path code.
- Touching IPC handler implementations or `sprint-service.ts` — they call non-hot-path helpers.

## Decisions

### D1 — Async at the data-function boundary, not the repository boundary

**Decision**: Make the three data-layer functions async at their own level; update repository interface signatures to match. Do not add an async wrapper at the `ISprintTaskRepository` delegation site.

**Rationale**: Putting the async boundary inside the data function keeps the repository implementation a thin passthrough and avoids duplicating async wrapping in two places. TypeScript will propagate `Promise<T>` through the interface automatically.

**Alternative considered**: Wrap every call inside `createSprintTaskRepository()` in `Promise.resolve()`. Rejected — it hides the real async from the type system and silently allows callers to forget `await`.

---

### D2 — `better-sqlite3` transactions stay synchronous inside the async wrapper

**Decision**: Continue using `conn.transaction()(...)` (synchronous `better-sqlite3` transactions) as the inner function passed to `withRetryAsync`. Do not switch to `begin/commit/rollback` manual SQL.

**Rationale**: `better-sqlite3` transactions are synchronous by design and run atomically within a single Node.js tick. The async layer only surrounds the retry loop — each attempt is still a single synchronous transaction. This preserves ACID semantics and avoids rewriting all transaction bodies.

**Constraint**: The inner transaction must never `await` anything. This is already true; no change needed.

---

### D3 — `sprint-pr-ops.ts` adds `withRetryAsync` even though it lacked `withRetry`

**Decision**: Wrap the write transactions in `markTaskDoneByPrNumber`, `markTaskCancelledByPrNumber`, and `updateTaskMergeableState` with `withRetryAsync` (they currently use bare `conn.transaction()()`).

**Rationale**: The Sprint PR poller runs every 60 s on the main thread. Without a retry guard, a single `SQLITE_BUSY` throws and the poller logs an error, silently skipping the PR transition. Adding the guard here fixes a latent reliability hole and keeps all hot-path write paths consistent.

---

### D4 — `IAgentTaskRepository.updateTask` and `claimTask` go async; `ISprintPollerRepository` methods go async

**Decision**: Update only the three sub-interfaces that contain the hot-path methods. `IDashboardRepository` methods that call `createTask` or `releaseTask` go async too because those functions' return types change.

**Rationale**: Minimal interface surface change. Cold-path IPC handlers use `sprint-service.ts` and the concrete repository; they will simply `await` the now-async methods already wired through the service layer or update their own signatures as needed.

---

### D5 — Test strategy: mock the repository interface, not the SQLite module

**Decision**: Update existing agent-manager test mocks (`IAgentTaskRepository` mock objects) to return `Promise`-wrapped values. Add a focused `sqlite-retry.async.test.ts` that exercises `withRetryAsync` through a real `claimTask`/`updateTask` call against an in-memory DB.

**Rationale**: The agent-manager tests already mock the repository; updating mock return types is low-effort and ensures compile-time correctness. The focused integration test proves the async path is actually taken in the data layer without the overhead of wiring the full agent manager.

## Risks / Trade-offs

- **Unintentional sync callers** — any call site that drops `await` on a now-async method becomes a silent no-op (the `Promise` is returned but never resolved in the caller's flow). TypeScript strict mode will flag `Promise<SprintTask | null>` used as `SprintTask | null` in most places, but `void`-typed call sites (fire-and-forget patterns) won't be caught. → Mitigation: `typecheck` is a mandatory pre-commit gate; the CI pipeline will surface every missed `await`.

- **Transaction isolation during retry** — each retry attempt runs a fresh transaction. If the DB state changed between the failed attempt and the retry, the transaction reads the updated state. This is the correct WAL behavior and matches `withRetry`'s existing semantics. → No mitigation needed.

- **Performance overhead from `Promise` wrapping** — `withRetryAsync` always returns a `Promise` even on the first successful attempt (no contention case). The microtask overhead is negligible (~microseconds) relative to SQLite I/O. → Acceptable trade-off.

- **Test mock sprawl** — 10+ agent-manager test files mock `IAgentTaskRepository`; all need their mock signatures touched. → Mitigation: the mock update is mechanical (add `Promise.resolve(...)` wrappers); a systematic grep for `mockRepo` before starting implementation keeps the count accurate.

## Migration Plan

1. Update `sqlite-retry.ts` — no functional changes; add an explicit comment reserving `withRetry` for cold-path/migration code only.
2. Update the three data modules to use `withRetryAsync`.
3. Update repository interface signatures.
4. Update `createSprintTaskRepository()` delegation — signatures already match, TypeScript will confirm.
5. Cascade `await` to all call sites in `agent-manager/` (drain-loop, task-claimer, run-agent, resolve-*-phases, watchdog-loop, completion, terminal-handler, orphan-recovery, shutdown-coordinator).
6. Cascade `await` to Sprint PR poller call sites.
7. Update agent-manager test mocks.
8. Add focused async-path integration tests.
9. `npm run typecheck && npm test && npm run lint` — must all pass before commit.

**Rollback**: revert the three data modules to `withRetry` and restore sync signatures. No DB schema change, no migration needed.

## Open Questions

*(none — the design is self-contained)*
