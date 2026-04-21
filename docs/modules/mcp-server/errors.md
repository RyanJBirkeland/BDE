# errors

**Layer:** main/mcp-server
**Source:** `src/main/mcp-server/errors.ts`

## Purpose

Translates service exceptions and domain rule violations into JSON-RPC error bodies. Provides `McpDomainError` for throwing domain-specific errors, `toJsonRpcError()` for converting caught exceptions to standardized RPC response format, and `writeJsonRpcError()` for emitting a full JSON-RPC 2.0 envelope directly onto an HTTP response.

## Public API

- `McpErrorCode` — enum of domain error types: `NotFound` (-32001), `InvalidTransition` (-32002), `Cycle` (-32003), `ForbiddenField` (-32004), `ValidationFailed` (-32005), `Conflict` (-32006), `RepoUnconfigured` (-32007)
- `JSON_RPC_UNAUTHORIZED`, `JSON_RPC_NOT_FOUND`, `JSON_RPC_INVALID_TRANSITION`, `JSON_RPC_CYCLE`, `JSON_RPC_FORBIDDEN_FIELD`, `JSON_RPC_VALIDATION_FAILED`, `JSON_RPC_CONFLICT`, `JSON_RPC_REPO_UNCONFIGURED` — named constants for the numeric codes so call sites never embed raw numbers
- `McpDomainError` — thrown by tool handlers when a domain rule fails; carries error code, message, and optional context data
- `McpZodError` — wraps a `ZodError` together with the schema that rejected the input so user-facing messages can include field `.describe()` text
- `JsonRpcErrorBody` — interface for the mapped error response: `{ code: number; message: string; data?: unknown }`
- `toJsonRpcError(err, schema?, logger?)` — converts zod validation errors (-32602), domain errors (domain-specific codes), or unknown errors (-32603) to `JsonRpcErrorBody`. When `err` is an `McpZodError` or the optional `schema` arg is provided, top-level object fields are enriched with their `.describe()` text in the rendered message. The optional `logger` receives a diagnostic line for any unknown throw before the sanitized `Internal error` is returned
- `writeJsonRpcError(res, status, err, opts?)` — writes a JSON-RPC 2.0 envelope (`{ jsonrpc, id, error }`) to an `http.ServerResponse`; defaults `id` to `null`, forwards `opts.schema` + `opts.logger` to `toJsonRpcError`, and skips `writeHead` when headers are already sent
- `parseToolArgs(schema, raw)` — strict parse helper for MCP tool handlers; on failure throws an `McpZodError` carrying the schema, which `toJsonRpcError` then uses to enrich the message

## Key Dependencies

- `zod` — for `ZodError` detection, issue extraction, and `.describe()` metadata lookup
- `../logger` — `Logger` type used for the optional `error`-channel sink in `toJsonRpcError` / `writeJsonRpcError`
