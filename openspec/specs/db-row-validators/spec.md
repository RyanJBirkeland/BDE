## ADDED Requirements

### Requirement: SprintTask rows are fully validated at the DB boundary
Every field of `SprintTask` SHALL be explicitly extracted and validated in `mapRowToTask` before the object is constructed. The `...row as SprintTask` spread MUST be removed. Fields with invalid values SHALL use a logged safe default or cause the row to be skipped by the surrounding `mapRowsToTasks` call.

#### Scenario: Row with valid fields maps correctly
- **WHEN** `mapRowToTask` receives a well-formed SQLite row
- **THEN** it returns a `SprintTask` with all fields correctly typed and no `as` cast

#### Scenario: Row with invalid status value is rejected
- **WHEN** `mapRowToTask` receives a row where `status` is not in the `TaskStatus` union
- **THEN** it throws a validation error with the row id and the invalid value

#### Scenario: Row with null optional string field uses safe default
- **WHEN** `mapRowToTask` receives a row where an optional string field (e.g. `pr_url`) is `null`
- **THEN** the resulting `SprintTask` has `pr_url: null` (not `undefined` or a crash)

---

### Requirement: Sprint rows are validated by a mapRowToSprint boundary function
A `mapRowToSprint(row: Record<string, unknown>): Sprint` function SHALL exist in `sprint-planning-queries.ts`. It MUST validate at minimum `id` (non-empty string), `status` (union membership), and coerce nullable fields to safe defaults. All Sprint query functions MUST use it.

#### Scenario: Sprint row with known status maps correctly
- **WHEN** `mapRowToSprint` receives a row with `status: 'active'`
- **THEN** it returns a `Sprint` with `status: 'active'`

#### Scenario: Sprint row with unknown status is rejected
- **WHEN** `mapRowToSprint` receives a row with `status: 'legacy'`
- **THEN** it throws a validation error identifying the row id and invalid status

#### Scenario: Sprint row with null id is rejected
- **WHEN** `mapRowToSprint` receives a row with `id: null`
- **THEN** it throws a validation error

---

### Requirement: AgentRun rows validate status and source union membership
`agent-queries.ts` SHALL validate `row.status` and `row.source` against their respective `AgentMeta` union allowlists before constructing an `AgentMeta` object. Rows with unknown values SHALL be logged and skipped.

#### Scenario: Row with known status and source maps correctly
- **WHEN** the agent-queries mapper receives a row with valid `status` and `source` values
- **THEN** it returns a correctly typed `AgentMeta`

#### Scenario: Row with unknown status is skipped
- **WHEN** the mapper receives a row with `status: 'defunct'`
- **THEN** a warning is logged with the row id; the row is excluded from results

---

### Requirement: TaskGroup rows validate status union membership
`task-group-queries.ts` SHALL replace `String(row.status) as TaskGroup['status']` with an `isTaskGroupStatus` guard. Invalid values SHALL be logged and replaced with `'draft'`.

#### Scenario: TaskGroup row with valid status maps correctly
- **WHEN** `mapRowToTaskGroup` receives `status: 'ready'`
- **THEN** the resulting object has `status: 'ready'`

#### Scenario: TaskGroup row with unknown status defaults to draft
- **WHEN** `mapRowToTaskGroup` receives `status: 'archived'`
- **THEN** a warning is logged; the resulting object has `status: 'draft'`

---

### Requirement: sprint-pr-ops validates row.status before state-machine calls
`sprint-pr-ops.ts` SHALL use an `isTaskStatus(row.status)` guard before passing the value to `validateTransition`. Rows that fail the guard SHALL be logged and skipped.

#### Scenario: Row with valid status proceeds through state machine
- **WHEN** `transitionTasksByPrNumber` processes a row with `status: 'active'`
- **THEN** `validateTransition` is called with the typed `TaskStatus` value

#### Scenario: Row with invalid status is skipped
- **WHEN** `transitionTasksByPrNumber` encounters a row with `status: 'legacy_active'`
- **THEN** a warning is logged with the task id; the row is not passed to `validateTransition`

---

### Requirement: review-repository validates findings_json parse result
`review-repository.ts` SHALL validate the result of `JSON.parse(row.findings_json)` before returning it. If the result is not an array, the function SHALL return `[]` and log an error with the task id.

#### Scenario: Valid findings_json array is returned
- **WHEN** `findings_json` contains a valid JSON array of `FileFinding` objects
- **THEN** the parsed array is returned

#### Scenario: Corrupt findings_json returns empty array
- **WHEN** `findings_json` contains `null` or a non-array JSON value
- **THEN** an error is logged; `[]` is returned; no exception propagates across IPC

---

### Requirement: agent-history validates JSON import shape before SQLite insert
`agent-history.ts` SHALL validate the result of `JSON.parse(raw)` as an array before iterating. Each element SHALL pass an `isAgentMeta(entry)` guard before being passed to `insert.run()`. Invalid entries SHALL be logged and skipped.

#### Scenario: Valid agents.json imports all entries
- **WHEN** `agents.json` contains a valid array of `AgentMeta` objects
- **THEN** all entries are inserted into `agent_runs`

#### Scenario: Corrupt agents.json skips invalid entries
- **WHEN** one entry is missing the required `id` field
- **THEN** a warning is logged for that entry; remaining valid entries are still inserted

#### Scenario: Non-array agents.json exits early
- **WHEN** `agents.json` parses to an object (not an array)
- **THEN** an error is logged; no inserts are attempted

---

### Requirement: tearoff-window-manager validates settings read result
`tearoff-window-manager.ts` SHALL validate the result of `getSettingJson('tearoff.windows')` before iterating entries. Each entry MUST have `views` (non-empty array), `bounds` (object), and `windowId` (non-empty string). Invalid entries SHALL be logged and skipped; app startup SHALL NOT crash.

#### Scenario: Valid persisted tearoffs restore correctly
- **WHEN** the settings value is a well-formed `PersistedTearoff[]`
- **THEN** all tear-off windows are restored

#### Scenario: Malformed settings entry is skipped
- **WHEN** one entry is missing `views`
- **THEN** a warning is logged for that entry; other valid entries are still restored; startup proceeds normally
