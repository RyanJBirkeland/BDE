# meta

**Layer:** MCP Server
**Source:** `src/main/mcp-server/tools/meta.ts`

## Purpose
Read-only meta tools that expose BDE enums and configuration to MCP clients without hard-coding values. Allows clients to discover valid statuses, transitions, dependency types, and configured repositories at runtime.

## Public API
- `registerMetaTools(server, deps)` — Registers three MCP tools: `meta.repos`, `meta.taskStatuses`, `meta.dependencyConditions`
- `MetaToolsDeps` — Dependency injection interface; callers provide `getRepos: () => RepoConfig[]`

## Tools
- `meta.repos` — Returns the `RepoConfig[]` value from `deps.getRepos()`. The production wiring in `index.ts` points this at a memoized `createReposCache()` reader so repeated calls don't re-parse the setting.
- `meta.taskStatuses` — Returns a frozen `{ statuses, transitions }` payload precomputed at module load from `TASK_STATUSES` and `VALID_TRANSITIONS`. Transitions are a plain adjacency object (`Set` values flattened to arrays) so it serializes cleanly over JSON-RPC.
- `meta.dependencyConditions` — Returns a frozen payload `{ task: ['hard','soft'], epic: ['on_success','always','manual'] }` precomputed at module load.

## Key Dependencies
- `task-state-machine.ts` — Source of truth for `TASK_STATUSES` and `VALID_TRANSITIONS`
- `paths.ts` — `RepoConfig` type definition
- `response.ts` — `jsonContent()` envelope builder
