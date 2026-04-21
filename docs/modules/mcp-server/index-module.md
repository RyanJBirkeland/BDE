# index (mcp-server)

**Layer:** mcp-server
**Source:** `src/main/mcp-server/index.ts`

## Purpose
Factory that assembles the full MCP server: registers all tool groups, creates the Streamable HTTP transport, and binds to `127.0.0.1:<port>`. Returns a `{ start, stop }` handle for lifecycle management.

## Public API
- `createMcpServer(deps, config)` — returns `McpServerHandle`
- `McpServerHandle` — `start(): Promise<number>` (resolves to actual port), `stop(): Promise<void>`
- `McpServerDeps` — `epicService: EpicGroupService`, `onStatusTerminal: (taskId, status) => void | Promise<void>`
- `McpServerConfig` — `port: number`
- `translateCancelError(err)` — maps `TaskTransitionError` throws from `cancelTask` into `McpDomainError(McpErrorCode.InvalidTransition)` with `{ taskId, fromStatus, toStatus }` data; passes unknown errors through unchanged. Exported for unit testing of the cancel-tool error-translation contract.

## Key Dependencies
- `transport.ts` — HTTP layer with bearer-token auth
- `tools/tasks.ts`, `tools/epics.ts`, `tools/meta.ts` — tool registrations
- `services/sprint-service.ts` — task CRUD injected into task tools; also supplies `TaskTransitionError` so the MCP `tasks.cancel` closure can translate invalid-transition throws into structured JSON-RPC errors
- `data/task-changes.ts` — audit history injected into task tools
- `token-store.ts` — reads or generates the bearer token on `start()`
- `safe-tool-handler.ts` — `wrapServerWithSafeToolHandlers()` intercepts every `server.tool(...)` registration so unknown throws from any tool handler are logged with the tool name before propagating
- `errors.ts` — `writeJsonRpcError()` used by the top-level catch handler; emits a valid JSON-RPC 2.0 envelope on unhandled transport errors
