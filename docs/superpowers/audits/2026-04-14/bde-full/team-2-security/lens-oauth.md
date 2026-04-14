# OAuth & Credential Security Audit

## Executive Summary

BDE implements a generally sound credential handling architecture with **strict controls on OAuth token lifecycle, file permissions, and environment variable isolation**. The application:

1. **Stores OAuth tokens in a file-based cache** (`~/.bde/oauth-token`) with enforced `0o600` permissions (user-only read/write)
2. **Does not leak tokens via logs or stack traces** — error handling avoids logging sensitive values
3. **Clears OAuth env vars unconditionally** — prevents process.env-based token injection attacks
4. **Uses rate-limited keychain reads** with caching to prevent filesystem exhaustion
5. **Correctly passes tokens to CLI via env** but **pre-fetches via SDK.apiKey parameter** (not env)

However, **three findings** require attention: (1) **unvalidated token length** in the oauth-checker creating a potential DoS/crash vector with crafted tokens, (2) **GitHub token stored in plaintext SQLite** without encryption, and (3) **stale token cached across 5-minute window** allowing expired tokens to briefly remain in-memory if user forces rotation.

---

## Findings

### F-t2-oauth-1: Unvalidated Token File Length in OAuth Checker Reads
**Severity:** Medium
**Category:** Security / Input Validation
**Location:** `src/main/agent-manager/oauth-checker.ts:53`
**Evidence:**
```typescript
const token = (await readFile(tokenPath, 'utf-8')).trim()
if (!token || token.length < 20) {  // Only checks minimum length — no max bound
  const refreshed = await refreshOAuthTokenFromKeychain()
  // ...
}
```

The oauth-checker reads the entire token file into memory without enforcing a maximum length. If an attacker writes a multi-gigabyte crafted file to `~/.bde/oauth-token`, the `readFile` call will allocate unbounded memory, potentially causing an out-of-memory crash or memory exhaustion attack.

**Impact:** 
- An attacker with write access to the user's home directory (compromised account, shared system, social engineering) can create a malicious token file that triggers memory exhaustion
- The drain loop runs every ~5 seconds, so the crash persists across restarts
- No defensive bounds checking before using the token

**Recommendation:**
1. Enforce a maximum token length (e.g., 1024 bytes) before using the token
2. Use `fs.createReadStream()` or read with a size limit for untrusted file input
3. Consider: `if (token.length < 20 || token.length > 512) { /* reject */ }`

**Effort:** S

**Confidence:** High

---

### F-t2-oauth-2: GitHub Token Stored in Plaintext SQLite
**Severity:** High
**Category:** Security / Credentials
**Location:** `src/main/settings.ts:32` (via `setSetting()`), stored in `settings` table
**Evidence:**
```typescript
// ConnectionsSection.tsx:85
await window.api.settings.set('github.token', ghToken)

// config.ts:4 — reads from settings table
export function getGitHubToken(): string | null {
  return getSetting('github.token') ?? process.env['GITHUB_TOKEN'] ?? null
}

// webhook-handlers.ts:148 — uses token directly in HMAC
const signature = crypto.createHmac('sha256', webhook.secret).update(body).digest('hex')
```

The GitHub token is stored in plaintext in the SQLite database (`~/.bde/bde.db`). While the database file has permissions `0o600`, any process running as the user can read the entire database and extract the token. There is no encryption-at-rest, no key derivation, and no secrets vault integration.

**Impact:**
- SQLite database dumps via debugger, file inspection, or data exfiltration leak the GitHub token
- The token is a **Personal Access Token** scoped to the user's GitHub account — compromise allows API abuse, repo access, PR tampering
- Backup/export of settings includes the token in cleartext
- If the database is shared via file-sync services (Dropbox, iCloud, etc.), token leaks across devices

**Recommendation:**
1. **Never store API tokens directly in SQLite**
2. For GitHub tokens: delegate to `gh` CLI's built-in auth storage (already available on the system)
3. If local storage is required:
   - Encrypt sensitive settings using `crypto.subtle` with a user-derived key (passphrase + salt)
   - Use a dedicated secrets column marked with a flag (e.g., `is_encrypted` boolean)
   - Rotate encryption keys on password change
   - Never log decrypted values

**Effort:** M

**Confidence:** High

---

### F-t2-oauth-3: OAuth Token Cache Not Invalidated on Manual Rotation
**Severity:** Medium
**Category:** Security / Token Lifecycle
**Location:** `src/main/env-utils.ts:89–96`
**Evidence:**
```typescript
let _cachedOAuthToken: string | null = null
let _tokenLoadedAt = 0
const TOKEN_TTL_MS = 5 * 60 * 1000 // 5 minutes

export function getOAuthToken(): string | null {
  const now = Date.now()
  if (_tokenLoadedAt > 0 && now - _tokenLoadedAt < TOKEN_TTL_MS) return _cachedOAuthToken
  // Cache hit — returns stale token for up to 5 minutes
}

// invalidateOAuthToken() must be called explicitly, but:
// - oauth-checker.ts calls it AFTER refresh succeeds
// - If refresh fails, stale token remains cached until TTL expires
```

The OAuth token is cached in-memory for 5 minutes. If the user manually rotates their token (e.g., via `claude login`), the old token remains in the BDE process's memory for up to 5 minutes even though the file on disk has been updated. During this window:

1. **Agent spawns** will use the old/revoked token
2. **API calls** (GitHub, Anthropic) will fail with 401 Unauthorized
3. **No immediate notification** to the user that the token is stale

Additionally, the `invalidateOAuthToken()` API is not exported for external callers to use (e.g., the renderer cannot invalidate the cache), so manual token updates in Settings UI cannot immediately take effect.

**Impact:**
- User rotates OAuth token but agents continue using the revoked token for up to 5 minutes
- Agents report auth failures, confusing the user ("I just logged in!")
- If the user's original token is compromised, they manually rotate but the app still uses the old one
- Multi-device usage: token rotated on one machine still cached on another

**Recommendation:**
1. **Reduce cache TTL** from 5 minutes to 30–60 seconds for faster refresh convergence
2. **Export `invalidateOAuthToken()`** as an IPC handler so the Settings UI can trigger immediate invalidation
3. **Wire `settings:set` -> check if key is `github.token`** and invalidate cache
4. **Consider file-watch** on `~/.bde/oauth-token` to detect external rotation

**Effort:** M

**Confidence:** High

---

### F-t2-oauth-4: Webhook Secrets Transmitted Over IPC Without Encryption Flag
**Severity:** Medium
**Category:** Security / Credentials
**Location:** `src/main/handlers/webhook-handlers.ts:92–114`
**Evidence:**
```typescript
safeHandle('webhook:create', async (_e, payload: { url: string; events: string[]; secret?: string }) => {
  validateWebhookUrl(payload.url)
  const webhook = createWebhook(payload)
  logger.info(`Created webhook ${webhook.id} for ${payload.url}`)
  return webhook  // ← returns full webhook object including secret
})

safeHandle('webhook:update', async (_e, payload: { ... secret?: string | null ... }) => {
  const webhook = updateWebhook(payload)
  logger.info(`Updated webhook ${payload.id}`)
  return webhook  // ← includes secret in response
})
```

Webhook secrets are transmitted over IPC from renderer to main and back again. While Electron's IPC is isolated to the same app context, if any future logging, monitoring, or debugging tools capture IPC payloads, the secret would be visible in cleartext. Additionally, the secret is stored in plaintext in SQLite (same as GitHub token issue).

**Impact:**
- Webhook secrets logged if IPC traffic is captured (DevTools, IPC spy tools, or debugging output)
- Stored in plaintext in database, subject to same risks as GitHub token
- When returning webhook objects to the renderer, the secret is exposed in the JS scope

**Recommendation:**
1. **Mark secrets in API responses** — return `{ id, url, events, enabled, hasSecret: true }` instead of the actual secret
2. **Add IPC audit logging** for channels that transmit sensitive data; mask secret values
3. **Encrypt secrets in database** (same as GitHub token recommendation)
4. **Never echo secrets back to renderer** — confirm save success without returning the secret

**Effort:** M

**Confidence:** Medium

---

### F-t2-oauth-5: No OAuth Token Expiry Enforcement Before Agent Spawn
**Severity:** Low
**Category:** Security / Token Lifecycle
**Location:** `src/main/agent-manager/index.ts:156–170`, `sdk-adapter.ts:97–118`
**Evidence:**
```typescript
// index.ts — autoStart flow
if (autoStart) {
  getOAuthToken()  // ← Just reads, doesn't validate expiry
  const am = createAgentManager(...)
  am.start()
}

// oauth-checker.ts — doesn't check timestamp-based expiry
if (!token || token.length < 20) {
  // Only checks length, not actual OAuth expiry time
}
```

The `getOAuthToken()` function reads the token and validates its **format** (minimum length 20 bytes) but does **not** validate the OAuth **expiry timestamp**. If the token file is older than 1 hour but still exists, it may be expired according to Anthropic's OAuth provider, but the app will attempt to use it until `oauth-checker.ts` proactively refreshes (which runs every 45+ minutes). This can result in:

1. Agent spawns with an expired token
2. API call fails with 401 Unauthorized
3. Retry logic kicks in, but the initial spawn cost is wasted

**Impact:**
- Wasted API calls and retry overhead for expired tokens
- Poor user experience: agents report auth failures when token is technically "present"
- Multi-span agent runs (20 turns) might consume budget on failed early turns before switching to refreshed token

**Recommendation:**
1. Parse the token file for embedded expiry metadata (if available)
2. Check keychain for `claudeAiOauth.expiresAt` **before** spawning agents
3. Proactively refresh the token file if it's >45 minutes old (already done in oauth-checker) **before** agent spawn, not after failure
4. Return expiry info in `auth:status` IPC so UI can warn user

**Effort:** M

**Confidence:** Medium

---

## Non-Findings (Secure by Design)

### ✅ OAuth Token File Permissions Enforced
- `env-utils.ts:310` writes with `mode: 0o600` (user-only read/write)
- `env-utils.ts:102–108` validates permissions and warns if they're too permissive
- Database file also enforced to `0o600` in `db.ts:19`

### ✅ Environment Variable Isolation
- `auth-guard.ts:106–108` unconditionally deletes `ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN` from process.env
- `env-utils.ts:57–87` uses strict allowlist for agent environment (no token injection via env)
- SDK auth uses `apiKey` parameter, not `ANTHROPIC_API_KEY` env var (correct design)

### ✅ Token Not Logged
- `env-utils.ts:303` logs error message but not the token itself
- `oauth-checker.ts` only logs status ("refreshed" / "failed"), not token content
- No string interpolation of token values in error messages

### ✅ IPC Type Safety
- `ipc-utils.ts` uses compile-time type checking to prevent mismatched payloads
- `safeHandle()` provides error logging without exposing payloads
- Settings channels use `[key: string, value: unknown]` without auto-serialization of sensitive types

### ✅ Error Stack Traces Don't Leak Credentials
- `logger.ts:100` truncates stack traces to top 4 frames for brevity
- `logError()` separates message-level logging from stack-level debugging
- Anthropic SDK errors are caught and re-thrown, not stringified with full context

---

## Summary Table

| Finding | Severity | Type | Effort | Fixable Now |
|---------|----------|------|--------|------------|
| F-t2-oauth-1 | Medium | Input Validation | S | ✅ Yes |
| F-t2-oauth-2 | High | Credentials Storage | M | ✅ Yes |
| F-t2-oauth-3 | Medium | Token Lifecycle | M | ✅ Yes |
| F-t2-oauth-4 | Medium | Credentials Exposure | M | ✅ Yes |
| F-t2-oauth-5 | Low | Token Expiry | M | ✅ Yes |

---

## Recommendation Priority

1. **Immediate (this sprint):**
   - **F-t2-oauth-1**: Add max-length check for token file reads (prevents memory exhaustion)
   - **F-t2-oauth-2**: Audit GitHub token usage; delegate to `gh` CLI or implement encrypted storage

2. **Short-term (next sprint):**
   - **F-t2-oauth-3**: Reduce cache TTL, export invalidation API
   - **F-t2-oauth-4**: Mask secrets in IPC responses

3. **Medium-term:**
   - **F-t2-oauth-5**: Integrate expiry checking into pre-spawn validation
   - Consider encrypted settings store for all sensitive values

---

**Audit conducted:** 2026-04-14  
**Auditor:** Credential Security Lens  
**Scope:** OAuth token handling, credential storage, IPC transmission  
**Baseline:** File-based token cache by design (acceptable); keychain access avoided in main process (correct)
