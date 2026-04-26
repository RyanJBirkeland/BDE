## ADDED Requirements

### Requirement: sprint-mutations exports a factory function instead of a module-scope singleton
`src/main/services/sprint-mutations.ts` SHALL export a `createSprintMutations(repo: ISprintTaskRepository)` factory function that returns an object with all the current mutation and query functions bound to the injected repository. The module-scope `_repo` variable and `setSprintMutationsRepo` function SHALL be removed.

#### Scenario: factory returns a working mutations object
- **WHEN** `createSprintMutations(repo)` is called with a mock repository
- **THEN** the returned object's `createTask`, `updateTask`, `getTask`, and other methods delegate to the mock repository

#### Scenario: no module-scope singleton exists
- **WHEN** `sprint-mutations.ts` is imported
- **THEN** no `let _repo` module-level variable is initialized and no `setSprintMutationsRepo` export is present

### Requirement: sprint-task-repository.ts exposes no shared singleton
`src/main/data/sprint-task-repository.ts` SHALL NOT export `getSharedSprintTaskRepository`, `setSharedSprintTaskRepository`, or `_resetSharedSprintTaskRepository`. The composition root SHALL hold the single `ISprintTaskRepository` instance and pass it to all consumers.

#### Scenario: repository module has no singleton exports
- **WHEN** `sprint-task-repository.ts` is imported
- **THEN** the exports do not include `getSharedSprintTaskRepository`, `setSharedSprintTaskRepository`, or `_resetSharedSprintTaskRepository`

#### Scenario: createSprintTaskRepository creates a fresh instance
- **WHEN** `createSprintTaskRepository()` is called
- **THEN** it returns a new `ISprintTaskRepository` implementation without reading any module-scope state

### Requirement: composition root constructs and injects the repository
`src/main/index.ts` SHALL call `createSprintTaskRepository()` once, hold the result in a local `const repo`, and pass it to all consumers that previously relied on `getSharedSprintTaskRepository()` or `setSprintMutationsRepo()`.

#### Scenario: single repository instance is shared across the app
- **WHEN** the main process boots
- **THEN** `createSprintTaskRepository()` is called exactly once and the result is passed to `createSprintMutations`, `createAgentManager`, and any other consumer

#### Scenario: tests construct repository directly
- **WHEN** a unit test for a module that previously imported `getSharedSprintTaskRepository` is run
- **THEN** the test constructs `createSprintTaskRepository()` directly (or uses a mock) without calling any singleton setter
