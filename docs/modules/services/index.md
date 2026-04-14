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
| `settings.ts` (`src/main/`) | Thin wrapper delegating to `data/settings-queries`. All functions accept optional `db?: Database.Database` for injection. | `getSetting`, `setSetting`, `deleteSetting`, `getSettingJson`, `setSettingJson` |
| `agent-history.ts` (`src/main/`) | Agent run metadata and log management — persistent storage in SQLite agent_runs table. All exported functions accept optional `db?: Database.Database` for injection. | `listAgents`, `createAgentRecord`, `appendLog`, `readLog`, `getAgentMeta`, `updateAgentMeta`, `pruneOldAgents`, `hasAgent`, `findAgentByPid`, `listAgentRunsByTaskId`, `finalizeStaleAgentRuns`, `reconcileRunningAgentRuns`, `finalizeAllRunningAgentRuns`, `backfillUtcTimestamps` |
| `review-service.ts` | Orchestrates reviewer SDK calls, diff fetching, result caching, and result aggregation for auto-review | `ReviewService`, `ReviewServiceDeps`, `createReviewService`, `WorktreeMissingError` |
| `review-response-parser.ts` | Parses and validates raw reviewer model output into a typed `ParsedReview` shape | `parseReviewResponse`, `MalformedReviewError`, `ParsedReview` |
| `batch-import.ts` | Validates and bulk-creates sprint tasks from an import payload | `batchImportTasks`, `BatchImportResult` |
| `workflow-engine.ts` | Instantiates a workflow template as a set of linked sprint tasks | `instantiateWorkflow` |
