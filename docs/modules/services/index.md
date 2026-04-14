# Services

Business logic modules. IPC handlers delegate to these — they contain no business logic themselves.
Source: `src/main/services/`

| Module | Purpose | Key Exports |
|--------|---------|-------------|
| `repo-search-service.ts` | Grep-based codebase search for workbench research — literal fixed-string search to prevent ReDoS | `searchRepo`, `parseGrepOutput`, `RepoSearchResult`, `RepoSearchMatch` |
| `cost-queries.ts` (`src/main/`) | Thin wrapper delegating to `data/cost-queries`. All functions accept optional `db?: Database.Database` for injection. | `getCostSummary`, `getRecentAgentRunsWithCost`, `getAgentHistory` |
| `settings.ts` (`src/main/`) | Thin wrapper delegating to `data/settings-queries`. All functions accept optional `db?: Database.Database` for injection. | `getSetting`, `setSetting`, `deleteSetting`, `getSettingJson`, `setSettingJson` |
| `agent-history.ts` (`src/main/`) | Agent run metadata and log management — persistent storage in SQLite agent_runs table. All exported functions accept optional `db?: Database.Database` for injection. | `listAgents`, `createAgentRecord`, `appendLog`, `readLog`, `getAgentMeta`, `updateAgentMeta`, `pruneOldAgents`, `hasAgent`, `findAgentByPid`, `listAgentRunsByTaskId`, `finalizeStaleAgentRuns`, `reconcileRunningAgentRuns`, `finalizeAllRunningAgentRuns`, `backfillUtcTimestamps` |
