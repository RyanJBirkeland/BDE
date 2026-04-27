## ADDED Requirements

### Requirement: Narrow view types at repository interface boundaries
Functions on `ISprintPollerRepository` and `ISprintTaskRepository` that only return subsets of task fields SHALL declare narrow view types (`SprintTaskPR`, `SprintTaskExecution`, `SprintTaskCore`) rather than the full `SprintTask` type.

#### Scenario: PR poller receives narrow PR type
- **WHEN** `listTasksWithOpenPrs()` is called on the repository
- **THEN** the return type is `SprintTaskPR[]`, not `SprintTask[]`
- **THEN** the TypeScript compiler rejects any caller that accesses a non-PR field on the result

#### Scenario: Orphan recovery receives narrow execution type
- **WHEN** `getOrphanedTasks()` is called on the repository
- **THEN** the return type is `SprintTaskExecution[]`
- **THEN** the TypeScript compiler rejects any caller that accesses spec or PR fields on the result

#### Scenario: Health check receives narrow core type
- **WHEN** `getHealthCheckTasks()` is called on the repository
- **THEN** the return type is `SprintTaskCore[]`

### Requirement: Narrow view types at sprint-queue-ops claim boundary
`sprint-queue-ops.claimTask()` SHALL return `SprintTaskExecution | null` because every caller of the claim operation subsequently reads execution fields (agent_run_id, worktree_path, claimed_by).

#### Scenario: Claim result carries execution view type
- **WHEN** `claimTask()` succeeds in sprint-queue-ops
- **THEN** the returned task satisfies `SprintTaskExecution`
- **THEN** drain-loop callers that read `agent_run_id` or `claimed_by` do not require a cast

#### Scenario: Claim result null on contention
- **WHEN** `claimTask()` returns null (task already claimed)
- **THEN** no type error occurs at call sites handling the null case

### Requirement: Narrow types at sprint-pr-ops PR listing
`sprint-pr-ops.listTasksWithOpenPrs()` SHALL return `SprintTaskPR[]` matching the repository interface.

#### Scenario: Data module and interface return type match
- **WHEN** the sprint-pr-ops implementation of listTasksWithOpenPrs is compiled
- **THEN** there is no type error from the concrete function assigning to the narrower interface return type

### Requirement: No runtime behavior changes from type narrowing
Type narrowing is a TypeScript compile-time contract change only. All narrowed functions SHALL continue returning the same runtime values as before.

#### Scenario: Full test suite passes after narrowing
- **WHEN** `npm test` is run after all type narrowing changes
- **THEN** all tests pass with zero failures
- **THEN** `npm run typecheck` reports zero errors
