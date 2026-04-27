## 1. T-48 — Fix `decryptSetting` silent-blob return on failure

- [x] 1.1 In `src/main/secure-storage.ts`, change `decryptSetting`'s return type from `string` to `string | undefined`. In the `catch` block, return `undefined` instead of `stored`. Update the JSDoc to document the `undefined` return on failure.
- [x] 1.2 In `src/main/settings.ts`, update `getSetting()` to handle `undefined` from `decryptSetting`: when `plaintext` is `undefined`, return `null` (the setting is unreadable). Remove the lazy-re-encryption block when `plaintext` is `undefined` (nothing to re-encrypt).
- [x] 1.3 In `src/main/data/webhook-queries.ts`, update `decryptWebhookSecret()` to handle `string | undefined` from `decryptSetting`: map `undefined` to `null`.
- [x] 1.4 In `src/main/__tests__/secure-storage.test.ts`, update the existing test "returns stored value and logs error when decryptString throws" (line 113) to assert `result` is `undefined`, not the encrypted blob string.
- [x] 1.5 Add a new test to `secure-storage.test.ts`: "returns undefined when decryptString throws (does not return the raw encrypted blob)" — verify the return value is `undefined` and the error logger was called.

## 2. T-20 — Harden Zod schemas in `credential-store.ts` against injected fields

- [x] 2.1 In `src/main/credential-store.ts`, change `KeychainOAuthSchema` from `.passthrough()` to `.strict()`.
- [x] 2.2 Change `KeychainPayloadSchema` from `.passthrough()` to `.strict()`.
- [x] 2.3 Create `src/main/__tests__/credential-store.test.ts`. Mock `node:child_process`, `node:fs`, and `./env-utils` at module level (following the pattern in `auth-guard.test.ts`).
- [x] 2.4 Add test: `KeychainOAuthSchema` rejects an object with an extra field (`{ accessToken: 'x', expiresAt: '1', injected: true }`) — `safeParse` returns `success: false`.
- [x] 2.5 Add test: `KeychainPayloadSchema` rejects an object with an extra top-level field (`{ claudeAiOauth: { accessToken: 'x' }, extra: 1 }`) — `safeParse` returns `success: false`.
- [x] 2.6 Add test: `KeychainOAuthSchema` accepts a valid object with only the known fields — `safeParse` returns `success: true`.
- [x] 2.7 Add test: `KeychainPayloadSchema` accepts a valid object with only `claudeAiOauth` — `safeParse` returns `success: true`.

## 3. T-24 — Re-stat OAuth token file permissions on every `getOAuthToken()` call

- [x] 3.1 In `src/main/env-utils.ts`, extract a helper `tokenFilePermissionsAreSecure(tokenPath: string): boolean` that calls `lstatSync` and returns `true` only when `mode & 0o777 === 0o600` and the file is not a symlink. Reuse it for both the cache-hit path and the existing cache-miss path.
- [x] 3.2 At the top of `getOAuthToken()`, before the TTL cache check, call `tokenFilePermissionsAreSecure`. If it returns `false` (including when the file does not exist), clear `_cachedOAuthToken`, reset `_tokenLoadedAt` to `0`, and return `null`. Log at `error` level using the same message format as the existing permission-reject path.
- [x] 3.3 Remove the duplicated permission check from the cache-miss path (it is now handled by the upfront check).
- [x] 3.4 In `src/main/__tests__/env-utils.test.ts`, add a test: "invalidates cache immediately when file permissions drift to 0o644 mid-TTL" — prime the cache with a valid token (mock `lstatSync` → mode `0o100600`), then change the mock to return mode `0o100644`, call `getOAuthToken()` again without invalidating, and assert the result is `null`.

## 4. T-36 — Remove cleartext fallback from `encryptWebhookSecret`

- [x] 4.1 In `src/main/data/webhook-queries.ts`, define and export `class EncryptionUnavailableError extends Error` at the top of the file with a descriptive default message.
- [x] 4.2 Rewrite `encryptWebhookSecret()`: remove both cleartext fallback branches. When `isEncryptionAvailable()` is false, throw `new EncryptionUnavailableError(...)`. When `encryptSetting()` throws, rethrow the error directly (do not catch and return plaintext).
- [x] 4.3 In `src/main/data/__tests__/webhook-queries.test.ts`, add a test: "createWebhook throws EncryptionUnavailableError when safeStorage is unavailable" — mock `isEncryptionAvailable` to return `false`, call `createWebhook({ url: 'https://example.com', events: [] })`, assert the thrown error is an instance of `EncryptionUnavailableError`.
- [x] 4.4 Add a test: "updateWebhook throws EncryptionUnavailableError when secret is updated and safeStorage is unavailable" — mock `isEncryptionAvailable` to return `false`, call `updateWebhook({ id: 'x', secret: 'new-secret' })`, assert `EncryptionUnavailableError` is thrown.

## 5. T-35 — Harden SSRF validation in `validateWebhookUrl`

- [x] 5.1 In `src/main/handlers/webhook-handlers.ts`, add `import { isIPv4, isIPv6 } from 'node:net'` at the top.
- [x] 5.2 Replace the manual IPv4 regex block with a guard: `if (isIPv4(hostname)) { /* octet-range checks */ }`. Split the hostname on `.` and parse each octet with `parseInt(..., 10)` (base 10 only — no implicit octal) for the range checks. Keep the same ranges (127.x, 10.x, 172.16-31.x, 192.168.x, 169.254.x).
- [x] 5.3 Add an IPv6 guard: `if (isIPv6(hostname) || hostname.startsWith('['))`. Strip surrounding brackets if present. Reject: `::1`, `0:0:0:0:0:0:0:1`, addresses with `::ffff:` prefix (IPv4-mapped), addresses starting with `fc` or `fd` (ULA, RFC 4193), addresses starting with `fe80` (link-local, RFC 4291).
- [x] 5.4 Keep the existing explicit string checks for `'localhost'`, `'0.0.0.0'` (already present) since those are not IP addresses per `isIPv4()`/`isIPv6()`.
- [x] 5.5 In `src/main/handlers/__tests__/webhook-handlers.test.ts`, add rejection tests for: `http://127.0.0.1/hook`, `http://0177.0.0.1/hook`, `http://2130706433/hook`, `http://[::1]/hook`, `http://::ffff:127.0.0.1/hook`, `http://[fc00::1]/hook`, `http://[fe80::1]/hook`.
- [x] 5.6 Add acceptance test for a valid public IP: `http://93.184.216.34/hook` — assert no error thrown.

## 6. T-30 — Handle EEXIST race safely in `token-store.ts`

- [x] 6.1 In `src/main/mcp-server/token-store.ts`, after `writeExclusive` returns `false` (EEXIST), attempt `fs.readFile(filePath, 'utf8')` and validate with `isWellFormedToken(trimmed content)`. If valid, return the existing token (do not overwrite). If the read fails or the content is invalid, fall through to `overwriteWithMode`.
- [x] 6.2 Refactor `generateAndWrite` to return `{ token: string; created: boolean }` so the caller can distinguish "used existing" from "generated new". Update `readOrCreateToken` and `regenerateToken` to propagate the `created` flag correctly.
- [x] 6.3 In `src/main/mcp-server/token-store.test.ts`, add a test: "returns existing valid token when EEXIST race occurs during generation" — write a valid 64-hex token to the file, mock `writeExclusive` to return `false` (simulating EEXIST), and assert `readOrCreateToken` returns the pre-existing token with `created: false`.
- [x] 6.4 Add a test: "overwrites when EEXIST occurs but existing content is corrupt" — write `'bad-token'` to the file, mock `writeExclusive` to return `false`, and assert `readOrCreateToken` returns a new valid hex token.

## 7. T-31 — Add IPv6 loopback to MCP transport allowed hosts and origins

- [x] 7.1 In `src/main/mcp-server/transport.ts`, in `buildRequestScope()`, extend `allowedHosts` to include `'[::1]'` and `` `[::1]:${port}` ``.
- [x] 7.2 In `allowedOriginsFor()`, add `` `http://[::1]:${port}` `` to the returned array.
- [x] 7.3 Add a test (in `src/main/mcp-server/index.test.ts` or a new `transport.test.ts`) that calls `allowedOriginsFor(18792)` and asserts the result includes all three loopback origins: `http://127.0.0.1:18792`, `http://localhost:18792`, `http://[::1]:18792`.

## 8. T-28 — Add whitespace-trim contract tests for `parseBearerToken`

- [x] 8.1 In `src/main/mcp-server/auth.test.ts`, under the existing `describe('parseBearerToken')` block, add a test: `parseBearerToken('Bearer token123 ')` returns `'token123'` — documents that trailing space after the token is trimmed.
- [x] 8.2 Add a test: `parseBearerToken('Bearer ')` returns `null` — documents that a scheme-only header with no token (or only whitespace) returns null.
