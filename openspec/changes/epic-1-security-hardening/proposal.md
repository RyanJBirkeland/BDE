## Why

Eight findings from the multi-lens security audit expose silent-failure and trust-boundary violations in credential handling, secret storage, and the MCP server attack surface. None require new features — they are purely defensive fixes, each small and isolated.

The highest-severity issues are silent data-corruption bugs: `decryptSetting()` returns the raw encrypted blob on failure (callers read it as plaintext), and the Zod schemas that validate keychain payloads use `.passthrough()` (injected fields survive validation unstripped). Three further P2 findings remove specific bypass vectors in the OAuth token cache, webhook secret storage, and the MCP server's DNS-rebinding and SSRF defences. Two lower-risk findings tighten an EEXIST race in the MCP token store and add a focused contract test for the bearer-token whitespace-trim behaviour.

## What Changes

- **T-48** — `decryptSetting()` return type narrows to `string | undefined`; callers (`settings.ts`, `webhook-queries.ts`) handle `undefined` explicitly instead of silently propagating an encrypted blob as the setting value.
- **T-20** — `KeychainOAuthSchema` and `KeychainPayloadSchema` switch from `.passthrough()` to `.strict()`; unknown fields injected into a crafted keychain entry now fail schema validation.
- **T-24** — `getOAuthToken()` re-stats the token file on every call, not only on cache miss; permission drift detected mid-TTL invalidates the cache immediately and returns `null`.
- **T-36** — `encryptWebhookSecret()` removes both cleartext fallback paths; when `safeStorage` is unavailable or throws, the function raises a named `EncryptionUnavailableError` instead of silently writing the secret to SQLite in plaintext.
- **T-35** — `validateWebhookUrl()` replaces the manual IPv4 regex with `net.isIPv4()` / `net.isIPv6()` guards; adds IPv6-mapped loopback (`::ffff:127.0.0.1`), ULA (`fc`/`fd`), and link-local (`fe80`) rejection; removes the octal/decimal notation bypass vectors.
- **T-30** — `generateAndWrite()` in the MCP token store re-reads and validates the existing file on EEXIST before overwriting; a valid race-written token is returned as-is instead of being silently replaced.
- **T-31** — `allowedHosts` and `allowedOriginsFor` in the MCP transport extend to include IPv6 loopback (`[::1]`, `[::1]:${port}`, `http://[::1]:${port}`).
- **T-28** — Two focused contract tests added to `auth.test.ts` for the `parseBearerToken` whitespace-trim behaviour using short, readable token values.

## Capabilities

### New Capabilities

None. This is a defensive hardening epic — no user-facing features are added.

### Modified Capabilities

- **Credential decryption** (`secure-storage.ts`): failure path now returns `undefined` instead of the encrypted blob. Callers that previously accepted `string` must now handle `string | undefined`.
- **Keychain payload validation** (`credential-store.ts`): Zod schemas now reject unknown fields. A keychain entry with unexpected top-level or nested fields will fail `safeParse` and be treated as "no credential".
- **OAuth token caching** (`env-utils.ts`): per-call permission re-stat means a `chmod 644` applied after the first good read invalidates the cache within the same call, not after the TTL window.
- **Webhook secret storage** (`webhook-queries.ts`): creating or updating a webhook when `safeStorage` is unavailable now throws `EncryptionUnavailableError` rather than silently persisting the plaintext secret. The Settings UI webhook form will surface this as an error.
- **Webhook URL validation** (`webhook-handlers.ts`): additional IPv6 and non-decimal IPv4 representations are now blocked.
- **MCP token store** (`token-store.ts`): the EEXIST race window is handled safely; a valid concurrent write is honoured instead of overwritten.
- **MCP transport** (`transport.ts`): IPv6 loopback clients can connect to the local MCP server without `Host` header rejection.

## Impact

**Production files modified:**
- `src/main/secure-storage.ts`
- `src/main/settings.ts`
- `src/main/credential-store.ts`
- `src/main/env-utils.ts`
- `src/main/data/webhook-queries.ts`
- `src/main/handlers/webhook-handlers.ts`
- `src/main/mcp-server/token-store.ts`
- `src/main/mcp-server/transport.ts`

**Test files modified or created:**
- `src/main/__tests__/secure-storage.test.ts` — update 1 existing assertion; add 1 new case
- `src/main/__tests__/credential-store.test.ts` — new file; 4 cases for `.strict()` rejection
- `src/main/__tests__/env-utils.test.ts` — add 1 new permission-drift-mid-TTL case
- `src/main/data/__tests__/webhook-queries.test.ts` — add 1 case for `EncryptionUnavailableError`
- `src/main/handlers/__tests__/webhook-handlers.test.ts` — add 6 cases for new rejection vectors
- `src/main/mcp-server/token-store.test.ts` — add 1 case for EEXIST-race safe path
- `src/main/mcp-server/transport.ts` test — add IPv6 loopback host coverage
- `src/main/mcp-server/auth.test.ts` — add 2 cases for whitespace-trim contract

**No IPC surface changes. No new npm dependencies. No renderer changes.**
