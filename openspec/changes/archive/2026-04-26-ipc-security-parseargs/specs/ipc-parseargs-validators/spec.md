## ADDED Requirements

### Requirement: review channels validate worktreePath before git operations
IPC channels `review:getDiff`, `review:getCommits`, and `review:getFileDiff` SHALL validate `payload.worktreePath` via `validateWorktreePath` (from `lib/review-paths.ts`) before dispatching to the handler. `review:getFileDiff` SHALL additionally validate `payload.filePath` via `validateFilePath` and `payload.base` via `validateGitRef`. If validation fails, the channel SHALL throw with a descriptive error message.

#### Scenario: valid worktreePath is accepted
- **WHEN** the renderer calls `review:getDiff` with a `worktreePath` inside the configured worktree base
- **THEN** the handler proceeds and returns the diff result

#### Scenario: path outside worktree base is rejected
- **WHEN** the renderer calls `review:getDiff` with `worktreePath` set to `/etc/passwd` or another path outside worktree bases
- **THEN** `safeHandle` rejects the call with a validation error containing "worktree"

#### Scenario: filePath outside worktree is rejected for getFileDiff
- **WHEN** the renderer calls `review:getFileDiff` with `filePath` containing `../../../etc/shadow`
- **THEN** `safeHandle` rejects the call with a validation error

#### Scenario: invalid git ref is rejected for base parameter
- **WHEN** the renderer calls `review:getFileDiff` with `base` set to `; rm -rf ~`
- **THEN** `safeHandle` rejects the call with a validation error containing "git ref"

### Requirement: settings:setJson blocks sensitive key writes and caps value size
The `settings:setJson` IPC channel SHALL reject writes where the key appears in `SENSITIVE_SETTING_KEYS`. It SHALL also reject payloads whose serialised JSON value exceeds 1 MB. Legitimate renderer writes to allowed keys SHALL proceed unchanged.

#### Scenario: sensitive key write is blocked
- **WHEN** the renderer calls `settings:setJson` with a key in `SENSITIVE_SETTING_KEYS`
- **THEN** the handler throws with an error mentioning the key and "sensitive"

#### Scenario: oversized value is rejected
- **WHEN** the renderer calls `settings:setJson` with a value whose JSON serialisation exceeds 1 048 576 bytes
- **THEN** the handler throws with an error mentioning "too large"

#### Scenario: normal key/value is accepted
- **WHEN** the renderer calls `settings:setJson` with an allowed key and a small JSON value
- **THEN** the setting is persisted and the handler returns without error

### Requirement: terminal:create validates cwd against known safe roots
The `terminal:create` IPC channel SHALL validate the optional `cwd` argument, when present, to be within one of: a configured repo's `localPath`, the pipeline worktree base, or the adhoc worktree base. If `cwd` is absent or `undefined` the check SHALL be skipped. Paths outside these roots SHALL cause the channel to throw before spawning a PTY.

#### Scenario: cwd inside configured repo is accepted
- **WHEN** the renderer calls `terminal:create` with `cwd` set to a path under a repo registered in Settings → Repositories
- **THEN** the PTY is created successfully

#### Scenario: cwd outside all safe roots is rejected
- **WHEN** the renderer calls `terminal:create` with `cwd` set to `/tmp/evil`
- **THEN** the handler throws with a validation error describing the allowed roots

#### Scenario: absent cwd is accepted
- **WHEN** the renderer calls `terminal:create` without a `cwd` field
- **THEN** the PTY is created with its default working directory

### Requirement: workbench channels validate input shape before use
`workbench:researchRepo` SHALL validate that its `input` argument is an object with a non-empty string `query` and a non-empty string `repo` before proceeding. `workbench:chatStream` SHALL validate that `input` is an object with an `messages` array and a `formContext` object containing a non-empty string `repo`. Invalid inputs SHALL be rejected before any downstream calls.

#### Scenario: researchRepo with valid input proceeds
- **WHEN** the renderer calls `workbench:researchRepo` with `{ query: "findByTaskId", repo: "bde" }`
- **THEN** the handler performs the search and returns results

#### Scenario: researchRepo with missing query is rejected
- **WHEN** the renderer calls `workbench:researchRepo` with `{ query: "", repo: "bde" }`
- **THEN** the handler throws with a validation error mentioning "query"

#### Scenario: chatStream with malformed input is rejected before SDK call
- **WHEN** the renderer calls `workbench:chatStream` with an object missing `formContext`
- **THEN** the handler throws before any SDK streaming begins

### Requirement: sprint:createWorkflow validates WorkflowTemplate shape
The `sprint:createWorkflow` IPC channel SHALL validate that its argument is an object with a non-empty string `name` and an array `tasks` before passing it to `instantiateWorkflow`. Malformed templates SHALL be rejected before any task creation side effects occur.

#### Scenario: valid template is accepted
- **WHEN** the renderer calls `sprint:createWorkflow` with `{ name: "Feature", tasks: [...] }`
- **THEN** `instantiateWorkflow` is called and the result is returned

#### Scenario: missing name is rejected
- **WHEN** the renderer calls `sprint:createWorkflow` with `{ tasks: [] }` (no name field)
- **THEN** the handler throws with a validation error mentioning "name"

#### Scenario: non-array tasks field is rejected
- **WHEN** the renderer calls `sprint:createWorkflow` with `{ name: "X", tasks: "not-an-array" }`
- **THEN** the handler throws with a validation error mentioning "tasks"
