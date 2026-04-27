## ADDED Requirements

### Requirement: Hot-path write functions return Promises
The data layer functions `updateTask`, `forceUpdateTask`, `createTask`, `createReviewTaskFromAdhoc`, `claimTask`, `releaseTask`, `markTaskDoneByPrNumber`, `markTaskCancelledByPrNumber`, and `updateTaskMergeableState` SHALL return `Promise<T>` instead of `T` synchronously. All these functions SHALL internally use `withRetryAsync` for their write transactions.

#### Scenario: Successful write on first attempt
- **WHEN** a hot-path write function is called and no `SQLITE_BUSY` error occurs
- **THEN** the function SHALL resolve its returned Promise with the written row on the next microtask tick

#### Scenario: Write succeeds after SQLITE_BUSY retry
- **WHEN** a hot-path write function encounters `SQLITE_BUSY` on one or more attempts
- **THEN** the function SHALL yield to the event loop between each retry attempt (via `setTimeout`) and ultimately resolve its Promise with the written row once the transaction succeeds

#### Scenario: Write exhausts all retries
- **WHEN** a hot-path write function encounters `SQLITE_BUSY` on every retry attempt up to `maxRetries`
- **THEN** the function SHALL reject its returned Promise with the final `SQLITE_BUSY` error

### Requirement: Event loop remains responsive during SQLite backoff
The Electron main thread SHALL NOT block for more than one event-loop tick during any SQLite backoff interval on a hot-path write.

#### Scenario: IPC request during contended write
- **WHEN** a hot-path write is in backoff (waiting between `SQLITE_BUSY` retries)
- **THEN** the Electron main thread SHALL process IPC messages and UI events during the backoff interval rather than spinning or sleeping synchronously

### Requirement: Repository interface reflects async write signatures
`IAgentTaskRepository`, `IDashboardRepository`, and `ISprintPollerRepository` in `sprint-task-repository.ts` SHALL declare the hot-path write methods with `Promise`-returning signatures matching the updated data-layer functions.

#### Scenario: TypeScript compilation with awaited repo calls
- **WHEN** a call site awaits a repository write method
- **THEN** the TypeScript compiler SHALL accept the expression without error and infer the correct unwrapped return type

#### Scenario: TypeScript compilation with unawaited repo calls
- **WHEN** a call site uses a repository write method result without `await`
- **THEN** the TypeScript compiler SHALL emit a type error if the result is used as the non-Promise type (e.g., assigning `Promise<SprintTask | null>` to `SprintTask | null`)

### Requirement: Cold-path callers remain synchronous
Data-layer functions not on the hot path — including all read-only queries (`getTask`, `listTasks`, `getQueuedTasks`, `getActiveTaskCount`, `listTasksWithOpenPrs`) and write helpers called only from IPC handlers or migrations — SHALL continue to use `withRetry` (sync) and return synchronous values.

#### Scenario: Migration call to synchronous query helper
- **WHEN** a database migration calls a synchronous data-layer function
- **THEN** the call SHALL complete synchronously without needing `await`

### Requirement: withRetry reserved for cold-path and migration code
`withRetry` (synchronous) in `sqlite-retry.ts` SHALL include a code comment explicitly stating it is reserved for cold-path callers and MUST NOT be called from the Electron main-thread hot paths (agent-manager drain loop, watchdog, completion pipeline, Sprint PR poller).

#### Scenario: Developer adds a new hot-path write
- **WHEN** a developer adds a new write function intended for the agent-manager or PR poller hot paths
- **THEN** the comment on `withRetry` SHALL make it clear the developer must use `withRetryAsync` instead

### Requirement: Async retry path is covered by tests
The `withRetryAsync` path through `claimTask` and `updateTask` SHALL be verified by at least one integration test that uses an in-memory SQLite database, confirms a Promise is returned, and confirms the written row is resolved correctly.

#### Scenario: claimTask resolves a Promise
- **WHEN** `claimTask` is called with a valid queued task in an in-memory database
- **THEN** the call SHALL return a Promise that resolves to the claimed `SprintTask`

#### Scenario: updateTask resolves a Promise
- **WHEN** `updateTask` is called with a valid patch against an existing task in an in-memory database
- **THEN** the call SHALL return a Promise that resolves to the updated `SprintTask`

#### Scenario: Existing agent-manager mock signatures compile
- **WHEN** the agent-manager test suite is compiled after the interface update
- **THEN** TypeScript SHALL report zero errors related to mismatched return types on mock `IAgentTaskRepository` methods
