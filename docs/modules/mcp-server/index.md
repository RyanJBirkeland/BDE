# MCP Server

Anthropic MCP (Model Context Protocol) server for exposing BDE capabilities to Claude Code and other clients.
Source: `src/main/mcp-server/`

| Module | Purpose | Key Exports |
|--------|---------|-------------|
| [`auth.ts`](./auth.md) | Bearer-token authentication middleware with constant-time comparison for HTTP requests | `checkBearerAuth`, `AuthResult` |
| [`errors.ts`](./errors.md) | JSON-RPC error mapping for service exceptions and domain rule violations | `toJsonRpcError`, `McpDomainError`, `McpErrorCode`, `JsonRpcErrorBody` |
| [`settings-events.ts`](./settings-events.md) | In-process event bus for settings-change notifications — allows main-process modules to hot-respond to config changes without IPC round-trips | `emitSettingChanged`, `onSettingChanged`, `SettingChangedEvent` |
| [`token-store.ts`](./token-store.md) | Persistent bearer token storage at `~/.bde/mcp-token` — generates 64-char hex token on first read, returns existing token on subsequent reads, supports regeneration | `readOrCreateToken`, `regenerateToken`, `tokenFilePath` |
| `tools/` | MCP tool implementations — read-only introspection and CRUD operations | See subdirectory |
| [`tools/meta.ts`](./meta.md) | Read-only meta tools exposing BDE enums and configuration: `meta.repos`, `meta.taskStatuses`, `meta.dependencyConditions` | `registerMetaTools`, `defaultGetRepos`, `MetaToolsDeps` |
| `tools/tasks.ts` | Task CRUD tools (`tasks.list`, `tasks.get`, `tasks.history`, `tasks.create`, `tasks.update`, `tasks.cancel`) | `registerTaskTools`, `TaskToolsDeps` |
| [`transport.ts`](./transport.md) | Thin HTTP wrapper around the MCP SDK's Streamable HTTP transport — adds bearer-token auth and structured error logging | `createTransportHandler`, `TransportHandler` |
| [`index.ts`](./index.md) | `createMcpServer()` factory — wires tool registrations, binds to `127.0.0.1:<port>`, returns `{ start, stop }` handle | `createMcpServer`, `McpServerHandle`, `McpServerDeps`, `McpServerConfig` |
