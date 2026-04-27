## Context

`safeHandle()` in `ipc-utils.ts` supports an optional third `parseArgs` argument — an `IpcArgsParser<K>` that runs before the handler, replacing args with a validated/narrowed form. The pattern is already in use for `sprint:create` (`parseSprintCreateArgs`) and `sprint:update` (`parseSprintUpdateArgs`). The gap: 8 channels across 5 handler files either have no validation or rely solely on inline `isValidTaskId` calls without validating the full payload shape. This audit covers the highest-risk gaps.

**Current state by handler:**
- `review:getDiff` / `review:getCommits` / `review:getFileDiff` — `payload.worktreePath` and `payload.filePath` passed directly to git subprocess without `validateWorktreePath`/`validateFilePath` from `lib/review-paths.ts`
- `settings:setJson` — accepts any key string and any-size JSON value; SENSITIVE_SETTING_KEYS already blocks reads/deletes but not writes via this channel
- `terminal:create` — `validateShell` is present; `cwd` is passed unsanitized to `createPty` despite being a shell working directory argument
- `workbench:chatStream` — `input.formContext.repo` accessed without shape guard; malformed payload throws a null-deref instead of a validation error
- `workbench:researchRepo` — same: `input.query`/`input.repo` accessed without shape guard
- `sprint:createWorkflow` — `WorkflowTemplate` accepted as `unknown` with no structural validation

## Goals / Non-Goals

**Goals:**
- Add `parseArgs` validators to the 8 channels above
- Reuse existing validators (`validateWorktreePath`, `validateFilePath`, `validateGitRef`) — no new validation primitives
- Block sensitive key writes via `settings:setJson` (extend the existing `SENSITIVE_SETTING_KEYS` guard)
- Cap JSON value size for `settings:setJson` (1 MB serialised limit)
- Validate `terminal:create` `cwd` against configured repo paths and worktree bases
- Guard shape of `workbench:chatStream` and `workbench:researchRepo` inputs
- All validators throw descriptive errors caught and logged by `safeHandle`

**Non-Goals:**
- Channels with adequate inline validation (`sprint:forceFailTask`, `sprint:forceDoneTask`, `sprint:batchUpdate`, `sprint:delete`, all `git:*` with `validateRepoPath`)
- Exhaustive field-level validation of every payload field (focus on trust-boundary shape + path safety)
- Renderer-side changes — validation is main-process only

## Decisions

**D1 — Keep validators as named `parseArgs` functions, not inline lambdas**

Consistent with the existing `parseSprintCreateArgs`/`parseSprintUpdateArgs` precedent. Named functions are testable in isolation and show up in stack traces with meaningful names.

**D2 — `settings:setJson` key allowlist vs blocklist**

Allowlist (enumerate safe keys) is safer but would require maintenance on every new setting key. The practical choice is a _blocklist_ that extends the existing `SENSITIVE_SETTING_KEYS` guard: any key in `SENSITIVE_SETTING_KEYS` is rejected on write, plus a value size cap. The risk of an unknown key being written is lower than a sensitive key being overwritten.

**D3 — `terminal:create` cwd scope**

Validate that `cwd` (when provided) is either: a configured repo's `localPath`, a path under the pipeline worktree base, or a path under the adhoc worktree base. Uses existing `getConfiguredRepoPaths()` + `getWorktreeBase()` + `ADHOC_WORKTREE_BASE` — no new infrastructure. If `cwd` is absent (`undefined`), it passes through (PTY defaults to `process.cwd()`).

**D4 — `review:getFileDiff` filePath validation**

`validateFilePath` (from `lib/review-paths.ts`) already checks the file is within a known worktree; call it on `payload.filePath`. The `base` and `worktreePath` fields get `validateGitRef` and `validateWorktreePath` respectively.

## Risks / Trade-offs

**`settings:setJson` allowlist creep** → Accepted: blocklist approach means a net-new sensitive key must be added to `SENSITIVE_SETTING_KEYS` before it becomes write-protected. Risk is low because sensitive keys already must be added to `SENSITIVE_SETTING_KEYS` to be protected on read.

**`terminal:create` cwd false-positive** → A user with an unconventional repo location (e.g., symlinked outside the registered `localPath`) may get a validation error. Mitigation: the validator resolves symlinks via `resolve()` (consistent with `validateWorktreePath`) and the error message names the expected roots so users can diagnose.

**No renderer changes** → A validation error in `parseArgs` surfaces as a rejected promise in the renderer; existing error handling in each hook (`catch(e)` → error state) already handles it correctly.
