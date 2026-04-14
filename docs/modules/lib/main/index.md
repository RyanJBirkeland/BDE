# Lib — Main

Utility functions and shared helpers for the main process.
Source: `src/main/lib/`

| Module | Purpose | Key Exports |
|--------|---------|-------------|
| `async-utils.ts` | Promisified `execFile` and `sleep` | `execFileAsync`, `sleep` |
| `patch-validation.ts` | Validates and filters patch content before applying | `validateAndFilterPatch` |
| `review-paths.ts` | Path validators for review git refs, worktree paths, and file paths | `validateGitRef`, `validateWorktreePath`, `validateFilePath`, `getWorktreeBase` |
| `git-operations.ts` | Git branch/commit operations — rebase, push, fetch, ff-merge, auto-commit, squash merge. Re-exports PR operations and worktree lifecycle for backward compatibility. Moved from `agent-manager/` (consumed by services outside agent orchestration) | `rebaseOntoMain`, `pushBranch`, `fetchMain`, `ffMergeMain`, `autoCommitIfDirty`, `executeSquashMerge`, `SquashMergeOpts` |
| `post-merge-dedup.ts` | Post-merge CSS deduplication orchestrator — identifies changed CSS files, deduplicates, and commits. Always non-fatal. Moved from `services/` (imported by agent-manager, not purely a service) | `runPostMergeDedup`, `DedupReport` |
| `prompt-composer.ts` | Central prompt dispatcher — `PROMPT_BUILDERS` registry maps each `AgentType` to its builder; routes `BuildPromptInput` to the registered builder. Moved from `agent-manager/` (consumed by services/handlers outside agent orchestration) | `buildAgentPrompt`, `BuildPromptInput`, `AgentType`, `classifyTask`, `TaskClass` |
| `resolve-dependents.ts` | Resolves blocked dependents when a task reaches terminal status. Supports cascade cancellation and epic-level dependency resolution. Moved from `agent-manager/` (consumed by `task-terminal-service`) | `resolveDependents` |
