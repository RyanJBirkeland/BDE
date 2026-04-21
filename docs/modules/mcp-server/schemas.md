# schemas

**Layer:** main/mcp-server
**Source:** `src/main/mcp-server/schemas.ts`

## Purpose

Zod schemas for every MCP tool argument shape — tasks and epics. Each length-capped or constrained field carries a `.describe()` string so MCP clients (Claude Code, Claude Desktop, Cursor) discover the constraints from tool metadata, and so `toJsonRpcError` can surface the constraint text in validation failures.

## Public API

- `TaskStatusSchema`, `TaskDependencySchema`, `TaskWriteFieldsSchema`, `TaskCreateSchema`, `TaskUpdateSchema`, `TaskListSchema`, `TaskIdSchema`, `TaskCancelSchema`, `TaskHistorySchema`
- `TASK_LIST_DEFAULT_LIMIT` (100), `TASK_LIST_DEFAULT_OFFSET` (0) — defaults the `tasks.list` handler applies when the caller omits `limit`/`offset`, shared across the schema, tool, and data layer so the default lives in one place
- `TASK_HISTORY_DEFAULT_LIMIT` (100), `TASK_HISTORY_MAX_WINDOW` (500) — constants the `tasks.history` handler uses to cap `limit + offset` so an unbounded pagination reach cannot hit the DB
- `EpicDependencySchema`, `EpicWriteFieldsSchema`, `EpicListSchema`, `EpicIdSchema`, `EpicUpdateSchema`, `EpicAddTaskSchema`, `EpicRemoveTaskSchema`, `EpicSetDependenciesSchema`

## Key Dependencies

- `zod` — schema definition + `.describe()` metadata used by `errors.ts::toJsonRpcError`
- `shared/task-state-machine` — `TASK_STATUSES` enum source of truth
