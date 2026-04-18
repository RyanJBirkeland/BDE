# meta

**Layer:** MCP Server
**Source:** `src/main/mcp-server/tools/meta.ts`

## Purpose
Read-only meta tools that expose BDE enums and configuration to MCP clients without hard-coding values. Allows clients to discover valid statuses, transitions, dependency types, and configured repositories at runtime.

## Public API
- `registerMetaTools(server, deps)` — Registers three MCP tools: `meta.repos`, `meta.taskStatuses`, `meta.dependencyConditions`
- `defaultGetRepos()` — Default repo provider function that reads from BDE settings
- `MetaToolsDeps` — Dependency injection interface for providing repos list

## Tools
- `meta.repos` — Returns array of `RepoConfig` objects from BDE settings
- `meta.taskStatuses` — Returns object with `statuses` array and `transitions` adjacency object (Set→Array converted)
- `meta.dependencyConditions` — Returns object with `task` (hard/soft) and `epic` (on_success/always/manual) condition enums

## Key Dependencies
- `task-state-machine.ts` — Exports `TASK_STATUSES` and `VALID_TRANSITIONS`
- `settings.ts` — `getSettingJson()` for reading repos from SQLite
- `paths.ts` — `RepoConfig` type definition
