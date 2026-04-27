# T-37 · Enable DNS rebinding protection on the MCP HTTP transport

**Severity:** P1 · **Audit lens:** security

## Context

`src/main/mcp-server/transport.ts:44` constructs `StreamableHTTPServerTransport` with only `{ sessionIdGenerator: undefined }`. The MCP SDK supports `enableDnsRebindingProtection`, `allowedHosts`, and `allowedOrigins` but they are opt-in. Because the server binds to `127.0.0.1:18792` without checking `Host` or `Origin`, a malicious page the user visits can perform a DNS rebinding attack and issue credentialed requests against loopback from the browser. The bearer token reduces but does not eliminate risk — the token is on disk in `~/.fleet/mcp-token` and can leak via screenshare, clipboard, or any JS that reads the filesystem through a compromised extension. This is OWASP A10 (SSRF-adjacent) / A01 (broken access control).

## Files to Change

- `src/main/mcp-server/transport.ts` (line 44 — transport construction)
- `src/main/mcp-server/transport.test.ts` (new — unit test the rejection)
- Optionally `src/main/mcp-server/mcp-server.integration.test.ts` (add a Host-header rejection case)

## Implementation

In `createTransportHandler`, update the `StreamableHTTPServerTransport` construction to:

```ts
const transport = new StreamableHTTPServerTransport({
  sessionIdGenerator: undefined,
  enableDnsRebindingProtection: true,
  allowedHosts: ['127.0.0.1', 'localhost', '127.0.0.1:18792', 'localhost:18792'],
  allowedOrigins: []
})
```

Include port-qualified variants in `allowedHosts` because the SDK checks against the full `Host` header value. If `mcp.port` is user-configurable (it is — see `LocalMcpServerSection`), read the port from the config available at handler construction time and build the list dynamically. The existing `token: string` argument should be joined by a new `port: number` argument, passed by `createMcpServer` in `index.ts:38`.

Create `transport.test.ts` with a fake `IncomingMessage`/`ServerResponse` pair and these cases:
1. Valid `Host: 127.0.0.1:18792` + valid bearer → 200 path reached (mock `server.connect` + `transport.handleRequest` as no-ops).
2. `Host: evil.example.com` + valid bearer → transport rejects with non-2xx (the SDK emits a specific error; assert the rejected response).
3. Missing bearer → 401 with `WWW-Authenticate: Bearer realm="fleet-mcp"` (this path is already present; pin it here).
4. Wrong URL (`/api`) → 404.

Do not widen any other behavior. Do not weaken the bearer-token check. Do not add CORS headers; this is a local-only server.

## How to Test

```bash
npm run typecheck
npm run test:main -- transport
npm run test:main -- mcp-server.integration
npm run lint
```

Manual: enable the MCP server in Settings, run `curl -H "Host: evil.example.com" -H "Authorization: Bearer $(cat ~/.fleet/mcp-token)" http://127.0.0.1:18792/mcp` and confirm rejection.

## Acceptance

- Transport options include `enableDnsRebindingProtection: true` + port-qualified `allowedHosts` + empty `allowedOrigins`.
- Port plumbs from the outer `createMcpServer` call site, not a hardcoded literal.
- `transport.test.ts` covers the four cases above.
- Manual `curl` with a foreign `Host` header is rejected.
- Full suite green.
