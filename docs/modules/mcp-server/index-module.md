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
- Internal `cancelTaskForMcp(id, reason?, options?)` closure accepts `{ caller? }` in the optional third argument and forwards it through `cancelTask` so MCP-originated cancels land in the `task_changes` audit trail as `changed_by='mcp'`.
- `summarizeListenError(err, configuredPort)` — builds the safe-to-broadcast summary used for the `manager:warning` renderer event when `httpServer.on('error', ...)` fires. Returns a targeted port-in-use message for `EADDRINUSE`; for every other listener failure it returns a generic "see the log" message so raw error codes, `err.message`, stack frames, and filesystem paths never reach the renderer. Full detail is written to `~/.bde/bde.log` separately via `logError` so operators still have a diagnosable log line.

## Lifecycle notes
- `start()` decomposes into named helpers (T-25): `bindHttpServer` creates + wires the HTTP server and applies timeouts; `routeRequest` forwards one request or answers `503` if the transport handler is not yet ready; `announceReady` logs and broadcasts the token path. Removes the `transportHandler!` non-null assertion — a request that arrives in the bind window now gets a JSON-RPC 503 instead of a crash.
- Server timeouts applied before `listen()` (T-26): `headersTimeout` (30 s), `requestTimeout` (60 s), `keepAliveTimeout` (5 s). A late `'error'` event closes the HTTP server before rejecting the start promise so nothing leaks on port-bind failure.
- `stop()` wraps the HTTP close with `closeHttpServerWithDeadline` (T-27): graceful `close()` races against a 3 s force-close timer (`closeAllConnections()`) and a 5 s hard deadline. The promise always resolves — Electron's `before-quit` cannot hang on a stuck socket.
- Transport teardown uses `closeQuietly` (T-32) so a failing transport close logs the full error (stack preserved) without derailing the HTTP teardown below it.

## Key Dependencies
- `transport.ts` — HTTP layer with bearer-token auth
- `tools/tasks.ts`, `tools/epics.ts`, `tools/meta.ts` — tool registrations
- `services/sprint-service.ts` — task CRUD + audit history (`getTaskChanges`) injected into task tools; also supplies `TaskTransitionError` so the MCP `tasks.cancel` closure can translate invalid-transition throws into structured JSON-RPC errors. All data access routes through the service layer — `data/task-changes` is no longer imported directly.
- `token-store.ts` — reads or generates the bearer token on `start()`
- `safe-tool-handler.ts` — `wrapServerWithSafeToolHandlers()` intercepts every `server.tool(...)` registration so unknown throws from any tool handler are logged with the tool name before propagating
- `errors.ts` — `writeJsonRpcError()` used by the top-level catch handler; emits a valid JSON-RPC 2.0 envelope on unhandled transport errors
- `close-quietly.ts` — `closeQuietly` swallows failed closes with a full-stack log during `stop()`
