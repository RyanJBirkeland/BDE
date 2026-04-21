# safe-tool-handler

**Layer:** mcp-server
**Source:** `src/main/mcp-server/safe-tool-handler.ts`

## Purpose
Uniform error-logging wrapper for MCP tool callbacks — the MCP analog of the `safeHandle()` wrapper used by every IPC handler. Ensures any unknown throw from a tool handler is logged once with the tool name and stack before propagating to the SDK's error envelope.

## Public API
- `safeToolHandler(name, logger, fn)` — wrap a single tool callback; rethrows the original error after `logger.error` records it.
- `wrapServerWithSafeToolHandlers(server, logger)` — Proxy-replace the `McpServer.tool(...)` method so every registration's callback is passed through `safeToolHandler` automatically. `server.tool(...)` call sites are untouched.

## Key Dependencies
- `@modelcontextprotocol/sdk/server/mcp.js` — `McpServer` type whose `.tool()` method is intercepted
- `../logger.ts` — the `Logger` interface the wrapper narrows to `Pick<Logger, 'error'>`
