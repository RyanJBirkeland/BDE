# transport

**Layer:** mcp-server
**Source:** `src/main/mcp-server/transport.ts`

## Purpose
Wraps the MCP SDK's `StreamableHTTPServerTransport` with bearer-token authentication, defense-in-depth request gating, and structured error logging. Returns a `TransportHandler` that guards every request before delegating to the SDK.

## Public API
- `createTransportHandler(buildMcpServer, token, port, logger)` — creates the handler; accepts a factory that produces a fresh `McpServer` per request (required by the SDK's stateless transport, which cannot be reused across requests)
- `TransportHandler` — interface with `handle(req, res)` and `close()` methods

## Request gates (applied in order before the SDK sees the request)
1. **URL allow-list** — only `/mcp` is accepted; anything else returns `404`.
2. **HTTP method allow-list (T-44)** — only `POST` is accepted; any other method returns `405` with an `Allow: POST` header and a JSON-RPC error envelope (`code: -32600`).
3. **Bearer token auth** — `Authorization: Bearer <token>` required; failures return `401` with a `WWW-Authenticate` header and JSON-RPC envelope (`code: -32000`).
4. **Request body size cap (T-46)** — `MAX_BODY_BYTES = 2 MB`. If `Content-Length` exceeds the cap, returns `413` immediately. Otherwise the body is buffered into memory up to the cap; overflow returns `413` and destroys the connection; malformed JSON returns `400` with `code: -32700`. The parsed body is forwarded to the SDK as `handleRequest(req, res, parsedBody)` so the SDK does not re-read the stream.

The SDK then applies DNS-rebinding (Host) validation and the explicit Origin allow-list (T-45) configured at transport construction.

## Origin allow-list (T-45)
The handler passes an explicit `allowedOrigins` list to every transport instance — `['null', 'http://127.0.0.1:<port>', 'http://localhost:<port>']` — instead of relying on the SDK's disabled-when-empty default. MCP clients typically send no Origin header and the SDK only enforces when one is present, so absent-Origin requests are still accepted.

## Response close cleanup (T-47)
On `res.on('close')`, both `transport.close()` and `server.close()` are invoked through a local `closeWithTimeout` helper that races them against `CLOSE_TIMEOUT_MS = 5s`. Timeouts and close failures log a structured `logger.warn` that preserves the stack for non-Error throws.

## Key Dependencies
- `auth.ts` — `checkBearerAuth` validates the `Authorization: Bearer` header
- `errors.ts` — `writeJsonRpcError()` is used by the catch-all 500 path; `JSON_RPC_UNAUTHORIZED` names the 401 error code. Other non-2xx paths (405, 413, 400) build the JSON-RPC 2.0 envelope inline with explicit codes (`-32600`, `-32700`) so the shape stays readable at the call site.
- `@modelcontextprotocol/sdk/server/streamableHttp.js` — underlying stateless transport
