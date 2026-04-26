## 1. review channel parseArgs validators

- [x] 1.1 Add `parseReviewWorktreeArgs` validator to `review:getDiff` and `review:getCommits` — calls `validateWorktreePath(payload.worktreePath)` before dispatch (`src/main/handlers/review.ts`)
- [x] 1.2 Add `parseReviewFileDiffArgs` validator to `review:getFileDiff` — calls `validateWorktreePath`, `validateFilePath(payload.filePath)`, and `validateGitRef(payload.base)` (`src/main/handlers/review.ts`)
- [x] 1.3 Write unit tests for `parseReviewWorktreeArgs` and `parseReviewFileDiffArgs` covering valid path, path-traversal rejection, and invalid git ref rejection (`src/main/handlers/__tests__/review-parseargs.test.ts`)

## 2. settings:setJson parseArgs validator

- [x] 2.1 Add `parseSetJsonArgs` validator to `settings:setJson` — rejects keys in `SENSITIVE_SETTING_KEYS` and rejects serialised values exceeding 1 048 576 bytes (`src/main/handlers/config-handlers.ts`)
- [x] 2.2 Write unit tests for `parseSetJsonArgs` covering sensitive key block, oversized value rejection, and allowed key pass-through (`src/main/handlers/__tests__/config-parseargs.test.ts`)

## 3. terminal:create cwd validation

- [x] 3.1 Add `validateTerminalCwd(cwd: string): void` helper to `src/main/handlers/terminal-handlers.ts` — resolves path and checks it is within a configured repo `localPath`, pipeline worktree base, or adhoc worktree base; throws with descriptive error naming the allowed roots
- [x] 3.2 Add `parseTerminalCreateArgs` validator to `terminal:create` that calls `validateTerminalCwd` when `cwd` is present (`src/main/handlers/terminal-handlers.ts`)
- [x] 3.3 Write unit tests for `validateTerminalCwd` covering repo path match, worktree base match, absent cwd pass-through, and out-of-scope path rejection (`src/main/handlers/__tests__/terminal-parseargs.test.ts`)

## 4. workbench channel parseArgs validators

- [x] 4.1 Add `parseResearchRepoArgs` validator to `workbench:researchRepo` — validates `input` is an object with non-empty `query: string` and non-empty `repo: string` (`src/main/handlers/workbench.ts`)
- [x] 4.2 Add `parseChatStreamArgs` validator to `workbench:chatStream` — validates `input` is an object with `messages` array and `formContext` object containing non-empty `repo: string` (`src/main/handlers/workbench.ts`)
- [x] 4.3 Write unit tests for both workbench validators covering valid shape, missing fields, and empty strings (`src/main/handlers/__tests__/workbench-parseargs.test.ts`)

## 5. sprint:createWorkflow parseArgs validator

- [x] 5.1 Add `parseCreateWorkflowArgs` validator to `sprint:createWorkflow` — validates argument has non-empty `name: string` and `tasks: unknown[]` (`src/main/handlers/sprint-local.ts`)
- [x] 5.2 Write unit tests for `parseCreateWorkflowArgs` covering valid template, missing name, non-array tasks, and empty name (`src/main/handlers/__tests__/sprint-createworkflow-parseargs.test.ts`)

## 6. Module docs

- [x] 6.1 Update `docs/modules/handlers/index.md` rows for `review.ts`, `config-handlers.ts`, `terminal-handlers.ts`, `workbench.ts`, and `sprint-local.ts` to note parseArgs validators added
