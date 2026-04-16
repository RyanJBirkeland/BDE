# Lib — Main

Utility functions and shared helpers for the main process.
Source: `src/main/lib/`

| Module | Purpose | Key Exports |
|--------|---------|-------------|
| `env-utils.ts` | Environment setup — PATH augmentation (with optional `BDE_EXTRA_PATHS` prefix), OAuth token management with symlink/size guards, agent environment building | `ensureExtraPathsOnProcessEnv`, `buildAgentEnv`, `getOAuthToken`, `invalidateOAuthToken`, `buildAgentEnvWithAuth`, `refreshOAuthTokenFromKeychain` |
| `paths.ts` | BDE data-directory constants — `BDE_DIR` (overridable via `BDE_DATA_DIR`), `BDE_DB_PATH` (overridable via `BDE_DB_PATH` or `BDE_TEST_DB`), and derived paths. Also exports repo config helpers. | `BDE_DIR`, `BDE_DB_PATH`, `BDE_AGENTS_INDEX`, `BDE_MEMORY_DIR`, `validateWorktreeBase`, `validateTestDbPath`, `getConfiguredRepos`, `getRepoPath` |
| `async-utils.ts` | Promisified `execFile` and `sleep` | `execFileAsync`, `sleep` |
| `patch-validation.ts` | Validates and filters patch content before applying | `validateAndFilterPatch` |
| `review-paths.ts` | Path validators for review git refs, worktree paths, and file paths | `validateGitRef`, `validateWorktreePath`, `validateFilePath`, `getWorktreeBase` |
| `git-operations.ts` | Git branch/commit operations — rebase, push, fetch, ff-merge, auto-commit, squash merge. Moved from `agent-manager/` (consumed by services outside agent orchestration) | `rebaseOntoMain`, `pushBranch`, `fetchMain`, `ffMergeMain`, `autoCommitIfDirty`, `executeSquashMerge`, `SquashMergeOpts` |
| `post-merge-dedup.ts` | Post-merge CSS deduplication orchestrator — identifies changed CSS files, deduplicates, and commits. Moved from `services/` | `runPostMergeDedup`, `DedupReport` |
| `prompt-composer.ts` | Central prompt dispatcher — routes `BuildPromptInput` to per-agent-type builders. Moved from `agent-manager/` | `buildAgentPrompt`, `BuildPromptInput`, `AgentType`, `classifyTask`, `TaskClass` |
| `resolve-dependents.ts` | Resolves blocked dependents when a task reaches terminal status. Cascade cancel is condition-aware: `condition: 'on_success'` triggers cancel on failure; `condition: 'always'` never cancels (unblocks regardless); legacy `type: 'hard'` (no condition) preserved for backward compat. Calls `onTaskTerminal` before `updateTask` so a throw prevents partial DB transitions. | `resolveDependents` |
| `validation.ts` | Input validation helpers for IPC handlers — safe identifier checks to prevent path traversal | `isValidAgentId` |
| `secure-storage.ts` | Wraps `electron.safeStorage` for encrypting sensitive settings — `ENC:` prefix distinguishes encrypted values from legacy plaintext; falls back gracefully when encryption unavailable. Source: `src/main/secure-storage.ts` | `SENSITIVE_SETTING_KEYS`, `isEncryptionAvailable`, `encryptSetting`, `decryptSetting` |
