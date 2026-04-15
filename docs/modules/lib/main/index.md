# Lib — Main

Utility functions and shared helpers for the main process.
Source: `src/main/lib/`

| Module | Purpose | Key Exports |
|--------|---------|-------------|
| `async-utils.ts` | Promisified `execFile` and `sleep` | `execFileAsync`, `sleep` |
| `patch-validation.ts` | Validates and filters patch content before applying | `validateAndFilterPatch` |
| `review-paths.ts` | Path validators for review git refs, worktree paths, and file paths | `validateGitRef`, `validateWorktreePath`, `validateFilePath`, `getWorktreeBase` |
| `git-operations.ts` | Git branch/commit operations — rebase, push, fetch, ff-merge, auto-commit, squash merge. Moved from `agent-manager/` (consumed by services outside agent orchestration) | `rebaseOntoMain`, `pushBranch`, `fetchMain`, `ffMergeMain`, `autoCommitIfDirty`, `executeSquashMerge`, `SquashMergeOpts` |
| `post-merge-dedup.ts` | Post-merge CSS deduplication orchestrator — identifies changed CSS files, deduplicates, and commits. Moved from `services/` | `runPostMergeDedup`, `DedupReport` |
| `prompt-composer.ts` | Central prompt dispatcher — routes `BuildPromptInput` to per-agent-type builders. Moved from `agent-manager/` | `buildAgentPrompt`, `BuildPromptInput`, `AgentType`, `classifyTask`, `TaskClass` |
| `resolve-dependents.ts` | Resolves blocked dependents when a task reaches terminal status. Cascade cancel calls `onTaskTerminal` before `updateTask` so a throw prevents partial DB transitions. Moved from `agent-manager/` | `resolveDependents` |
| `validation.ts` | Input validation helpers for IPC handlers — safe identifier checks to prevent path traversal | `isValidAgentId` |
