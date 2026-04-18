# transport

**Layer:** mcp-server
**Source:** `src/main/mcp-server/transport.ts`

## Purpose
Wraps the MCP SDK's `StreamableHTTPServerTransport` with bearer-token authentication and structured error logging. Returns a `TransportHandler` that guards all requests before delegating to the SDK.

## Public API
- `createTransportHandler(buildMcpServer, token, logger)` — creates the handler; accepts a factory that produces a fresh `McpServer` per request (required by the SDK's stateless transport, which cannot be reused across requests)
- `TransportHandler` — interface with `handle(req, res)` and `close()` methods

## Key Dependencies
- `auth.ts` — `checkBearerAuth` validates the `Authorization: Bearer` header
- `@modelcontextprotocol/sdk/server/streamableHttp.js` — underlying stateless transport
