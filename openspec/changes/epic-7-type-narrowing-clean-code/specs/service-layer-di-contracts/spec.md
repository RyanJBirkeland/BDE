## MODIFIED Requirements

### Requirement: ISprintPollerRepository returns narrow types for subset queries
`ISprintPollerRepository` SHALL declare narrow view-type returns for query methods that only expose a subset of task fields, so callers cannot accidentally depend on fields outside the intended contract.

#### Scenario: listTasksWithOpenPrs returns SprintTaskPR array
- **WHEN** `ISprintPollerRepository.listTasksWithOpenPrs()` is defined
- **THEN** the return type is `SprintTaskPR[]`
- **THEN** callers outside the PR poller that access non-PR fields produce a compile error

#### Scenario: getOrphanedTasks returns SprintTaskExecution array
- **WHEN** `ISprintPollerRepository.getOrphanedTasks()` is defined
- **THEN** the return type is `SprintTaskExecution[]`

#### Scenario: getHealthCheckTasks returns SprintTaskCore array
- **WHEN** `ISprintPollerRepository.getHealthCheckTasks()` is defined
- **THEN** the return type is `SprintTaskCore[]`

#### Scenario: Concrete repository implementation satisfies narrowed interface
- **WHEN** the SQLite-backed concrete repository is compiled against the narrowed interface
- **THEN** there are no type errors because SprintTask structurally satisfies all narrow view types
