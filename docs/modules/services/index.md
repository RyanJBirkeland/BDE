# Services

Business logic modules. IPC handlers delegate to these — they contain no business logic themselves.
Source: `src/main/services/`

| Module | Purpose | Key Exports |
|--------|---------|-------------|
| `repo-search-service.ts` | Grep-based codebase search for workbench research — literal fixed-string search to prevent ReDoS | `searchRepo`, `parseGrepOutput`, `RepoSearchResult`, `RepoSearchMatch` |
| `adhoc-promotion-service.ts` | Validates and promotes a completed adhoc agent worktree into the Code Review queue as a sprint task | `promoteAdhocToTask`, `PromoteAdhocParams`, `PromoteAdhocResult` |
| `webhook-delivery-service.ts` | Constructs and delivers test webhook events including HMAC-SHA256 signing and HTTP POST delivery | `deliverWebhookTestEvent`, `WebhookTestResult` |
| `checkpoint-service.ts` | Creates a git commit snapshot of the current agent worktree state without stopping the agent | `createCheckpoint`, `CheckpointResult` |
| `cost-queries.ts` (`src/main/`) | Thin wrapper delegating to `data/cost-queries`. All functions accept optional `db?: Database.Database` for injection. | `getCostSummary`, `getRecentAgentRunsWithCost`, `getAgentHistory` |
| `settings.ts` (`src/main/`) | Facade over `data/settings-queries` that transparently encrypts/decrypts sensitive keys (`SENSITIVE_SETTING_KEYS`) via `secure-storage.ts`. Lazy-migrates legacy plaintext values to encrypted form on first read. All functions accept optional `db?: Database.Database` for injection. | `getSetting`, `setSetting`, `deleteSetting`, `getSettingJson`, `setSettingJson` |
| `agent-history.ts` (`src/main/`) | Agent run metadata and log management — persistent storage in SQLite agent_runs table. All exported functions accept optional `db?: Database.Database` for injection. | `listAgents`, `createAgentRecord`, `appendLog`, `readLog`, `getAgentMeta`, `updateAgentMeta`, `pruneOldAgents`, `hasAgent`, `findAgentByPid`, `listAgentRunsByTaskId`, `finalizeStaleAgentRuns`, `reconcileRunningAgentRuns`, `finalizeAllRunningAgentRuns`, `backfillUtcTimestamps` |
| `review-service.ts` | Orchestrates reviewer SDK calls, diff fetching, result caching, and result aggregation for auto-review | `ReviewService`, `ReviewServiceDeps`, `createReviewService`, `WorktreeMissingError` |
| `review-response-parser.ts` | Parses and validates raw reviewer model output into a typed `ParsedReview` shape | `parseReviewResponse`, `MalformedReviewError`, `ParsedReview` |
| `batch-import.ts` | Validates and bulk-creates sprint tasks from an import payload. Validates status values against `TASK_STATUSES` and repo names against the configured repo list. | `batchImportTasks`, `BatchImportResult` |
| `workflow-engine.ts` | Instantiates a workflow template as a set of linked sprint tasks | `instantiateWorkflow` |
| `sprint-mutation-broadcaster.ts` | Notification orchestration for sprint task mutations — in-process listeners, debounced `sprint:externalChange` IPC broadcast (200ms), and webhook dispatch | `notifySprintMutation`, `onSprintMutation`, `SprintMutationEvent`, `SprintMutationListener` |
| `spec-quality/validators/sync-validators.ts` | Synchronous spec validators — `SizeWarningsValidator` blocks specs >1000 words (error) and warns at >500; `RequiredSectionsValidator`, `FilePathsValidator`, `NumberedStepsValidator`, `BannedPhrasesValidator` | `SizeWarningsValidator`, `RequiredSectionsValidator`, `FilePathsValidator`, `NumberedStepsValidator`, `BannedPhrasesValidator` |
| `spec-quality/validators/prescriptiveness-validator.ts` | Async AI-based check for exploration language in Implementation Steps — returns error (not warning) when design decisions detected; returns `PRESCRIPTIVENESS_CHECK_FAILED` warning on SDK failure instead of silently passing | `PrescriptivenessValidator` |
| `task-terminal-service.ts` | Unified handler for all task terminal-status paths — records metrics, schedules dependency resolution (via `scheduleDependencyResolution`), and schedules worktree cleanup. All terminal paths converge here. | `TaskTerminalService`, `createTaskTerminalService`, `TaskTerminalServiceDeps` |
