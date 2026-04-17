# Credential Portability Audit: Fresh Machine Startup

**Audit Date:** 2026-04-16  
**Scope:** Cold-start behavior on fresh Mac without prior BDE, gh auth, or claude login  
**Status:** Multiple critical and high-severity issues identified

---

## Execution Trace: Fresh Machine, First Launch

1. **App starts** → `src/main/index.ts` at line 35: `ensureExtraPathsOnProcessEnv()` prepends homebrew/npm paths to `process.env.PATH`
2. **DB init** → `src/main/index.ts` line 185: `initializeDatabase()` creates `~/.bde/` directory with `0o700` permissions (lines 12-22 in db.ts)
3. **Agent manager configured** → `src/main/index.ts` line 236: `getSettingJson('agentManager.autoStart')` defaults to `true`
4. **Agent manager starts immediately** → `src/main/index.ts` line 240-254: Creates AgentManager, calls `am.start()`
5. **Drain loop enters precondition checks** → `src/main/agent-manager/drain-loop.ts` line 67-93: `validateDrainPreconditions()`
6. **OAuth token check fails silently** → `src/main/agent-manager/oauth-checker.ts` line 45-109: `checkOAuthToken()` catches exception, logs warning, returns `false`
7. **Drain tick skipped** → `src/main/agent-manager/drain-loop.ts` line 87-90: Token check fails → logger.warn → function returns false
8. **Window ready** → `src/main/index.ts` line 131-134: `mainWindow.on('ready-to-show')` fires, calls `emitStartupWarnings()`
9. **Onboarding runs** → Renderer detects token missing, shows AuthStep UI with "run `claude login`" message
10. **User clicks "Next" disabled** → Button is disabled until all three checks pass (CLI found, token exists, token valid)

**Key behavior:** Token read does NOT crash the app. Drain loop gracefully skips. Onboarding blocks continuation. Status is **recoverable**.

---

## Findings

### F-t3-credentials-1: OAuth Token File Missing on Fresh Machine — Graceful Degradation
**Severity:** Medium  
**Category:** token-missing  
**Location:** `src/main/agent-manager/oauth-checker.ts:45-109`  
**Evidence:**
```typescript
export async function checkOAuthToken(logger: Logger): Promise<boolean> {
  try {
    const tokenPath = joinPath(home(), '.bde', 'oauth-token')
    const tokenStats = await stat(tokenPath).catch(() => null)
    if (tokenStats && tokenStats.size > MAX_TOKEN_FILE_BYTES) { ... }
    const token = (await readFile(tokenPath, 'utf-8')).trim()
    if (!token || token.length < 20) {
      const refreshed = await refreshOAuthTokenFromKeychain()
      if (refreshed) {
        logger.info('[oauth-checker] OAuth token auto-refreshed from Keychain')
        _oauthCheckResult = true
        ...
        return true
      } else {
        logger.warn('[oauth-checker] OAuth token expired or missing — skipping drain. Run: claude login')
        _oauthCheckResult = false
        ...
        return false
      }
    }
    ...
    return true
  } catch {
    logger.warn('[oauth-checker] OAuth token expired or missing — skipping drain. Run: claude login')
    _oauthCheckResult = false
    ...
    return false
  }
}
```

**Impact:** Fresh machine user sees empty task queue. Agent manager drain loop is paused at boot. User must explicitly run `claude login` in terminal. The command is mentioned in log but not in app UI until onboarding loads. No direct app-level error—silent fallback.

**Recommendation:** 
- Token-missing should trigger a more prominent in-app notification before onboarding (e.g., toast or modal)
- Add "Open Terminal" button in AuthStep that opens a terminal and displays the command (macOS: `open -a Terminal; echo 'claude login'`)
- Consider storing the first-launch state so we can prioritize the Auth step in onboarding
- Emit a `manager:critical` event (higher priority than `manager:warning`) on bootstrap if token is missing and autoStart is true

**Effort:** M  
**Confidence:** High

---

### F-t3-credentials-2: OAuth Token Refresh from Keychain Before File Exists — Undetected Failure
**Severity:** High  
**Category:** token-refresh  
**Location:** `src/main/agent-manager/oauth-checker.ts:66-80`  
**Evidence:**
```typescript
const token = (await readFile(tokenPath, 'utf-8')).trim()
if (!token || token.length < 20) {
  const refreshed = await refreshOAuthTokenFromKeychain()
  if (refreshed) {
    logger.info('[oauth-checker] OAuth token auto-refreshed from Keychain')
    _oauthCheckResult = true
    _oauthCheckExpiry = Date.now() + OAUTH_CHECK_CACHE_TTL_MS
    return true
  } else {
    logger.warn('[oauth-checker] OAuth token expired or missing — skipping drain. Run: claude login')
    _oauthCheckResult = false
    _oauthCheckExpiry = Date.now() + OAUTH_CHECK_FAIL_CACHE_TTL_MS
    return false
  }
}
```

**Impact:** On a fresh machine:
1. `~/.bde/oauth-token` does NOT exist (or is empty from old install)
2. `readFile()` throws → caught in outer catch, returns false immediately
3. `refreshOAuthTokenFromKeychain()` is NEVER called on the fast path
4. If keychain HAS credentials (e.g., from web login), the fallback is never triggered
5. User must manually run `claude login` even though credentials exist in Keychain

The comment at line 51 says "Read with a size guard" but the actual read `readFile(tokenPath, 'utf-8')` will throw ENOENT on missing file, bypassing the proactive refresh logic.

**Recommendation:**
- Check for ENOENT explicitly before throwing: use `.catch((err) => err.code === 'ENOENT' ? '' : throw err)`
- Or wrap the entire `readFile()` in a try-catch that specifically handles ENOENT as "file missing, try keychain"
- Add a test case: "checkOAuthToken with missing oauth-token file attempts keychain refresh"

**Effort:** S  
**Confidence:** High

---

### F-t3-credentials-3: `getOAuthToken()` Returns Null When Token File Missing — Silent Spawn Failure
**Severity:** Critical  
**Category:** token-missing  
**Location:** `src/main/env-utils.ts:125-165`  
**Evidence:**
```typescript
export function getOAuthToken(): string | null {
  const now = Date.now()
  if (_tokenLoadedAt > 0 && now - _tokenLoadedAt < TOKEN_TTL_MS) return _cachedOAuthToken
  _tokenLoadedAt = now
  const tokenPath = join(homedir(), '.bde', 'oauth-token')
  try {
    if (existsSync(tokenPath)) {
      const lstats = lstatSync(tokenPath)
      if (lstats.isSymbolicLink()) {
        console.warn('[env-utils] OAuth token file is a symlink — rejecting for security')
        _cachedOAuthToken = null
        return _cachedOAuthToken
      }
      if (lstats.size > MAX_TOKEN_BYTES) {
        console.warn('[env-utils] OAuth token file exceeds maximum size — rejecting')
        _cachedOAuthToken = null
        return _cachedOAuthToken
      }
      const mode = lstats.mode & 0o777
      if (mode !== 0o600) {
        logger.error(
          `[env-utils] OAuth token rejected: insecure permissions ${mode.toString(8)}. ` +
            `Run: chmod 600 ${tokenPath}`
        )
        return null
      }
      _cachedOAuthToken = readFileSync(tokenPath, 'utf8').trim()
      if (!_cachedOAuthToken || _cachedOAuthToken.length < 20) {
        logger.warn('[env-utils] OAuth token is too short or empty — ignoring')
        _cachedOAuthToken = null
      }
    } else {
      _cachedOAuthToken = null
    }
  } catch {
    _cachedOAuthToken = null
  }
  return _cachedOAuthToken
}
```

**Impact:** 
- When `~/.bde/oauth-token` is missing, this returns `null`
- Callers in `src/main/agent-manager/spawn-sdk.ts` line 35-36 and `spawn-cli.ts` line 38-44 pass `token: null | ''` to the SDK/CLI
- SDK receives `apiKey: undefined` (line 35: `...(token ? { apiKey: token } : {})`) → SDK uses default credential chain
- CLI receives `ANTHROPIC_API_KEY=` (undefined env var, line 43: `env = { ...env, ANTHROPIC_API_KEY: token }`) → CLI fails with "No API key"
- **Agent spawn does NOT fail loudly**. The spawn call itself succeeds; the CLI process exits with code 1 silently reading stdin waiting for input
- Error is buried in stderr, not surfaced to user until task moves to error state

**Recommendation:**
- In `spawnAgent()`, check token upfront: `if (!token) throw new Error('OAuth token required — run: claude login')`
- OR: ensure `checkOAuthToken()` is called BEFORE any spawn attempt (currently only in precondition, not enforced at spawn time)
- Add explicit error in spawn-cli.ts: "if (!token) throw new Error('ANTHROPIC_API_KEY required')"

**Effort:** M  
**Confidence:** High

---

### F-t3-credentials-4: Agent Spawn Failure with Missing Token — Task Silently Errors
**Severity:** High  
**Category:** error-surface  
**Location:** `src/main/agent-manager/spawn-and-wire.ts:39-86`  
**Evidence:**
```typescript
export async function handleSpawnFailure(
  err: unknown,
  task: AgentRunClaim,
  worktree: { worktreePath: string; branch: string },
  repoPath: string,
  deps: RunAgentDeps
): Promise<never> {
  const { logger, repo, onTaskTerminal, onSpawnFailure } = deps
  ...
  const errMsg = err instanceof Error ? err.message : String(err)
  emitAgentEvent(task.id, {
    type: 'agent:error',
    message: `Spawn failed: ${errMsg}`,
    timestamp: Date.now()
  })
  flushAgentEventBatcher()
  try {
    repo.updateTask(task.id, {
      status: 'error',
      completed_at: nowIso(),
      notes: `Spawn failed: ${errMsg}`,
      claimed_by: null
    })
  } catch (updateErr) { ... }
  await onTaskTerminal(task.id, 'error')
  ...
  throw err
}
```

**Impact:** When spawn fails due to missing token:
1. Task status changes to `error` with notes: `"Spawn failed: <message from claude CLI>"`
2. User sees task in error state in UI, but the error message is opaque (e.g., "Spawn failed: ENOENT: no such file or directory")
3. User must check `~/.bde/agent-manager.log` to understand the real issue
4. No guidance to run `claude login` is attached to the task or displayed in-app

**Recommendation:**
- Catch spawn errors and inspect stderr for "authentication" / "API key" patterns
- If detected, append to notes: "Run `claude login` in your terminal and retry this task"
- Emit a `manager:warning` with actionable text when spawn fails due to auth

**Effort:** M  
**Confidence:** High

---

### F-t3-credentials-5: Missing .bde/oauth-token Directory Not Created by App
**Severity:** Low  
**Category:** token-missing  
**Location:** `src/main/env-utils.ts:129` (read-only), `src/main/db.ts:12` (write-only)  
**Evidence:**
```typescript
// env-utils.ts — reads token only if file exists
if (existsSync(tokenPath)) {
  // read...
} else {
  _cachedOAuthToken = null
}

// db.ts — creates ~/.bde on startup if missing
mkdirSync(DB_DIR, { recursive: true, mode: 0o700 })
```

**Impact:**
- `~/.bde/` directory IS created by `getDb()` at startup (db.ts:12)
- `~/.bde/oauth-token` is NOT pre-created by the app; it must exist from `claude login`
- If user never runs `claude login`, the file is missing → token reads return null
- This is correct behavior, but could be documented more clearly in error messages

**Recommendation:**
- No fix needed—the current design (lazy creation on `claude login`) is sound
- Just ensure error messages say "run: claude login" consistently (already done in most places)

**Effort:** S  
**Confidence:** High

---

### F-t3-credentials-6: CLI Detection via `which` — No Error Message if Claude Not Found
**Severity:** Medium  
**Category:** cli-detection  
**Location:** `src/main/auth-guard.ts:71-78`  
**Evidence:**
```typescript
detectCli(): boolean {
  // Try `which claude` first — handles nvm, npm-global, mise, asdf, and any other install location.
  // Using /usr/bin/which directly to avoid PATH shadowing and because this runs synchronously.
  const result = spawnSync('/usr/bin/which', ['claude'], { encoding: 'utf8' })
  if (result.status === 0 && result.stdout.trim()) return true
  // Fallback: check common paths directly in case `which` itself is unavailable
  return CLI_FALLBACK_PATHS.some((dir) => existsSync(join(dir, 'claude')))
}
```

**Impact:**
- Returns boolean only—no error context if CLI not found
- In onboarding (AuthStep.tsx:19-115), a failed CLI check shows: "Claude Code CLI installed ✗"
- No guidance on how to install Claude Code CLI (npm install, brew, etc.)
- User must infer to "Google how to install claude" rather than seeing "npm install -g @anthropic-ai/claude"

**Recommendation:**
- Add `detectCliWithMessage()` that returns `{ found: boolean; message?: string; installCommand?: string }`
- Populate `installCommand` based on detected package manager (check for npm, brew, mise in PATH)
- Display install command in onboarding UI or in a linked help modal

**Effort:** M  
**Confidence:** Medium

---

### F-t3-credentials-7: GitHub Token Missing on Fresh Machine — No Fallback to `gh auth`
**Severity:** Medium  
**Category:** token-missing  
**Location:** `src/main/handlers/auth-handlers.ts:17-33`  
**Evidence:**
```typescript
export function registerOnboardingHandlers(): void {
  safeHandle('onboarding:checkGhCli', async () => {
    try {
      const { stdout } = await execFileAsync('gh', ['--version'])
      const version = stdout.trim().split('\n')[0] ?? undefined
      try {
        await execFileAsync('gh', ['auth', 'status'])
        return { available: true, authenticated: true, version }
      } catch {
        return { available: true, authenticated: false, version }
      }
    } catch {
      return { available: false, authenticated: false }
    }
  })
}
```

**Impact:**
- Onboarding checks `gh auth status` ✓ (lines 24: already runs)
- BUT: no message or link to "run: gh auth login" is shown if auth fails
- User must infer from a check mark turning red

**Recommendation:**
- In onboarding, if `gh auth status` fails, show: "Run: `gh auth login` in your terminal"
- Link to GitHub docs or show the command in a copyable code block
- Consider auto-opening terminal with pre-populated command (macOS: `open -a Terminal "gh auth login"`)

**Effort:** M  
**Confidence:** Medium

---

### F-t3-credentials-8: `safeStorage.isEncryptionAvailable()` False Before Keychain Unlock — Clear Feedback
**Severity:** Medium  
**Category:** safestorage  
**Location:** `src/main/handlers/config-handlers.ts:76-82`  
**Evidence:**
```typescript
safeHandle('settings:getEncryptionStatus', () => {
  const available = safeStorage.isEncryptionAvailable()
  return {
    available,
    reason: available ? undefined : 'System keychain unavailable'
  }
})
```

**Displayed in UI** (`src/renderer/src/components/settings/ConnectionsSection.tsx:165-180`):
```typescript
{encryptionStatus !== null && (
  <div className={`encryption-status-banner encryption-status-banner--${encryptionStatus.available ? 'active' : 'unavailable'}`}>
    {encryptionStatus.available ? (
      <ShieldCheck size={14} aria-hidden="true" />
    ) : (
      <ShieldAlert size={14} aria-hidden="true" />
    )}
    {encryptionStatus.available
      ? 'Credential encryption: Active'
      : `Credential encryption: UNAVAILABLE — ${encryptionStatus.reason ?? 'Credentials may be stored in plaintext'}`}
  </div>
)}
```

**Impact:**
- On first login, if Keychain is locked, `safeStorage.isEncryptionAvailable()` returns false
- User sees banner: "Credential encryption: UNAVAILABLE — System keychain unavailable"
- App does NOT crash—GitHub token can still be stored in plaintext in SQLite
- User may think they're compromised, but this is expected on first boot before Keychain unlock

**Recommendation:**
- Change reason text to: "System keychain locked. Unlock it (macOS: biometric or password) and restart BDE to enable credential encryption"
- Add a "Retry" button in the banner that re-checks encryption status without restart
- Document this in onboarding or in a "What is encryption?" help modal

**Effort:** M  
**Confidence:** High

---

### F-t3-credentials-9: No Explicit Token Validation Before Agent Spawn — Spawn Attempt Can Fail
**Severity:** High  
**Category:** token-missing  
**Location:** `src/main/agent-manager/run-agent.ts`, `src/main/agent-manager/spawn-and-wire.ts`  
**Evidence:**

The drain loop preconditions call `checkOAuthToken()` (drain-loop.ts:87), but this is a gating check. Once a task is claimed and `runAgent()` begins, there's no re-check before `spawnAndWireAgent()` (run-agent.ts:205+). A token could expire between the precondition check and the actual spawn.

```typescript
// drain-loop.ts (line 87)
const tokenOk = await checkOAuthToken(deps.logger)
if (!tokenOk) {
  deps.logger.warn('[drain] OAuth token invalid — skipping drain tick')
  return false
}
// ... time passes, token expires ...
// Then processQueuedTask → runAgent → spawnAndWireAgent spawns with stale/expired token
```

**Impact:**
- Token could expire between precondition check and spawn (unlikely in 30s, but possible over 5+ minute spans)
- Spawn fails with cryptic error
- Task moves to error state instead of being re-queued
- User must manually reset task to queued and restart

**Recommendation:**
- Add a second token check immediately before `spawnWithTimeout()` in spawn-and-wire.ts
- If token has expired, reject the spawn with "Token expired during queue wait — please run `claude login` and retry"
- Or: refresh token opportunistically before spawn if it's near expiry (within 5min buffer already implemented in oauth-checker.ts:88-94)

**Effort:** M  
**Confidence:** Medium

---

### F-t3-credentials-10: Settings → Connections Tab — Limited Auth Status Display
**Severity:** Low  
**Category:** settings-ux  
**Location:** `src/renderer/src/components/settings/ConnectionsSection.tsx:182-214`  
**Evidence:**
```typescript
<SettingsCard
  icon={<div className="stg-card__icon stg-card__icon--purple">C</div>}
  title="Claude CLI Auth"
  subtitle="OAuth token for agent spawning"
  status={authCardStatus}
>
  <div className="settings-field__row">
    <div className="settings-field__status">
      <Badge variant={authBadgeVariant} size="sm">
        {authBadgeLabel}
      </Badge>
      {authStatus?.expiresAt && (
        <span className="settings-field__expiry">
          Expires: {formatExpiry(authStatus.expiresAt)}
        </span>
      )}
    </div>
    <div className="settings-field__actions">
      <Button
        variant="ghost"
        size="sm"
        onClick={refreshAuth}
        disabled={authLoading}
        loading={authLoading}
        type="button"
      >
        <RefreshCw size={12} className="settings-field__refresh-icon" />
        Refresh
      </Button>
    </div>
  </div>
</SettingsCard>
```

**Impact:**
- Status shows: "Disconnected" (red) if token missing
- No action button to "Login" or "Run claude login"
- User must navigate away from Settings, open terminal, run command manually
- Upon return, status is still "Disconnected" until they click "Refresh"

**Recommendation:**
- Add "Login" button next to "Refresh" when status is "Disconnected"
- Clicking "Login" opens terminal with `claude login` pre-populated (or copy-to-clipboard)
- Show expiry time more prominently (highlight if < 1 hour remaining)
- Add a "Copy command" button in addition to "Open Terminal"

**Effort:** M  
**Confidence:** Medium

---

### F-t3-credentials-11: Fresh Machine with No gh Auth — GitHub Operations Will Fail Silently in Background
**Severity:** High  
**Category:** token-missing  
**Location:** `src/main/services/operational-checks-service.ts:26-44`, onboarding (not enforced at spawn)  
**Evidence:**

Onboarding checks `gh auth status` (auth-handlers.ts:18-33), but does NOT block continuation if GitHub is unauthenticated. The check is advisory only.

```typescript
// onboarding checks it, but doesn't prevent "Next"
const handleGhChange = useCallback((_key: string, value: string) => {
  setGhToken(value)
  ...
}, [ghDirty])
```

**Impact:**
- User completes onboarding without GitHub auth
- Agent tasks that create/merge PRs will fail silently
- Error appears in task notes as: "Pull request creation failed" with no context
- User must manually authenticate with `gh auth login` and retry

**Recommendation:**
- Make GitHub auth a required step in onboarding (add checkmark that blocks "Next" button)
- OR: Show a prominent warning in onboarding if `gh` is available but not authenticated
- Add a helper link: "How to authenticate with GitHub" → open browser to `https://github.com/login`
- In operational-checks, if gh is missing or unauthenticated, surface this as a warning BEFORE spawning (currently checked only in preconditions, not enforced)

**Effort:** M  
**Confidence:** High

---

### F-t3-credentials-12: Keychain Access Hangs in Main Process — Rate Limiting Sufficient
**Severity:** Low  
**Category:** safestorage  
**Location:** `src/main/auth-guard.ts:41-69` (rate limit works)  
**Evidence:**
```typescript
const KEYCHAIN_RATE_LIMIT_MS = 1000 // 1 second between reads
let lastKeychainRead = 0
let cachedKeychainResult: KeychainPayload | null = null

export class MacOSCredentialStore implements CredentialStore {
  async readToken(): Promise<KeychainPayload | null> {
    const now = Date.now()
    const timeSinceLastRead = now - lastKeychainRead
    if (timeSinceLastRead < KEYCHAIN_RATE_LIMIT_MS) {
      return cachedKeychainResult
    }
    lastKeychainRead = now
    try {
      const { stdout } = await execFileAsync('/usr/bin/security', [
        'find-generic-password',
        '-s',
        'Claude Code-credentials',
        '-w'
      ])
      ...
    } catch {
      cachedKeychainResult = null
      return null
    }
  }
}
```

**Impact:**
- Keychain access is async (execFileAsync), not blocking main thread ✓
- Rate limiting prevents hammering Keychain ✓
- Currently only called in `checkAuthStatus()` at startup, not in hot loops ✓
- **No hang risk identified**

**Recommendation:**
- Document the 1s rate limit in a comment (already clear from code)
- Ensure `readToken()` is never called in a hot loop (inspect callsites)
- Test with Keychain unlocking delay (simulate locked keychain) to confirm timeout behavior

**Effort:** S  
**Confidence:** High

---

### F-t3-credentials-13: Agent Pipeline Spawn Without Token — Fails Loudly (Good)
**Severity:** Low  
**Category:** error-surface  
**Location:** `src/main/agent-manager/spawn-and-wire.ts:103-119` (spawn call is reached regardless of token)  
**Evidence:**

The spawn attempt is not explicitly guarded by token presence—it relies on the drain-loop precondition `checkOAuthToken()` to prevent reaching this code. However, once in `spawnAndWireAgent()`, there's no second check.

```typescript
let handle: AgentHandle
try {
  handle = await spawnWithTimeout(
    prompt,
    worktree.worktreePath,
    effectiveModel,
    logger,
    task.max_cost_usd ?? undefined
  )
  ...
} catch (err) {
  await handleSpawnFailure(err, task, worktree, repoPath, deps)
  throw err
}
```

**Impact:**
- If drain precondition somehow passes but token is invalid, spawn attempt is made
- SDK or CLI exits with "No API key" error
- Error is caught and surfaced to task notes ✓
- Fail-fast re-queues task after 3 attempts within 30s ✓
- **Behavior is acceptable, but could be more explicit**

**Recommendation:**
- Add pre-spawn token validation: `if (!token) throw new Error('OAuth token required — run: claude login')`
- Ensures error message is consistent and user-actionable

**Effort:** S  
**Confidence:** High

---

## Summary Table

| Finding | Severity | Category | Issue | Recommendation | Effort |
|---------|----------|----------|-------|-----------------|--------|
| F-t3-credentials-1 | Medium | token-missing | Silent drain skip, no app-level feedback | Add toast/modal on bootstrap if token missing | M |
| F-t3-credentials-2 | High | token-refresh | OAuth file missing bypasses keychain refresh | Explicitly catch ENOENT and attempt refresh | S |
| F-t3-credentials-3 | Critical | token-missing | Token null at spawn → silent CLI failure | Check token upfront, throw with clear error | M |
| F-t3-credentials-4 | High | error-surface | Spawn failure omits "run: claude login" guidance | Catch auth errors, append guidance to notes | M |
| F-t3-credentials-5 | Low | token-missing | .bde/oauth-token not pre-created (correct design) | No fix; document in error messages | S |
| F-t3-credentials-6 | Medium | cli-detection | No install guidance if Claude CLI not found | Add install command based on package manager | M |
| F-t3-credentials-7 | Medium | token-missing | GitHub auth check doesn't show login command | Add "gh auth login" hint in onboarding | M |
| F-t3-credentials-8 | Medium | safestorage | Keychain unavailable message unclear | Clarify "unlock keychain and restart" | M |
| F-t3-credentials-9 | High | token-missing | No re-check before spawn, token could expire | Add pre-spawn validation or proactive refresh | M |
| F-t3-credentials-10 | Low | settings-ux | Auth status card lacks login action | Add "Login" button, terminal helper | M |
| F-t3-credentials-11 | High | token-missing | GitHub auth not enforced in onboarding | Make gh auth required or block with warning | M |
| F-t3-credentials-12 | Low | safestorage | Keychain hang risk | No hang observed; rate limiting sufficient | S |
| F-t3-credentials-13 | Low | error-surface | Spawn not explicitly guarded by token | Add upfront token check for clarity | S |

---

## Critical Path to Fix (Priority Order)

1. **F-t3-credentials-3 (Critical):** Add token check before spawn to prevent silent CLI failures
2. **F-t3-credentials-2 (High):** Fix oauth-checker to attempt keychain refresh on missing file
3. **F-t3-credentials-4 (High):** Surface "run: claude login" guidance in task error notes
4. **F-t3-credentials-9 (High):** Add re-check before spawn for stale token edge case
5. **F-t3-credentials-11 (High):** Enforce GitHub auth in onboarding or show clear warning
6. **F-t3-credentials-1 (Medium):** Add app-level toast/modal on bootstrap if token missing

---

## Testing Checklist

- [ ] Fresh install: verify `~/.bde/oauth-token` missing → onboarding blocks at Auth step
- [ ] Fresh install: run `claude login` → token file created → onboarding unblocks
- [ ] Fresh install: verify `gh auth status` check shown in onboarding
- [ ] Token expired: verify proactive refresh from keychain works (mocked in tests)
- [ ] Keychain locked: verify `safeStorage.isEncryptionAvailable()` returns false with clear reason
- [ ] Missing Claude CLI: verify error message suggests install command
- [ ] Spawn with no token: verify error message is "OAuth token required — run: claude login" (not SDK/CLI errors)
- [ ] Task failure due to token: verify notes include actionable guidance

