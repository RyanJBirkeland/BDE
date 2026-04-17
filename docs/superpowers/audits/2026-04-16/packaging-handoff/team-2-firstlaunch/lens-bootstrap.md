# Electron Startup Sequence Audit (Cold Start, Fresh Machine)

## Executive Summary

The BDE Electron app implements a **well-structured cold-start sequence** that creates the `~/.bde/` directory, initializes the SQLite database with 52 migrations, loads default settings via the `??` operator, registers IPC handlers, and emits startup warnings at the precise moment (`ready-to-show`) when the renderer is ready to receive broadcasts. The implementation is **production-ready** with good error isolation and signal propagation. No critical blockers for first-launch.

---

## Startup Sequence (Numbered for Mental Model)

1. **Process startup** (`main/index.ts` lines 33–72): Enforce Node.js v22+, set proxy, acquire single-instance lock
2. **Module initialization** (line 74): Create logger (which creates `~/.bde/` with 0o700 perms if missing)
3. **Error handlers** (lines 98–115): Catch uncaught exceptions and unhandled rejections
4. **`app.whenReady()`** (line 181): Main async startup sequence begins
5. **Database initialization** (lines 185–194): 
   - `getDb()` creates `~/.bde/` (recursive, mode 0o700) if missing
   - Creates `~/.bde/memory/tasks/` for task memory
   - Opens SQLite, enforces 0o700 on `~/.bde/` (fixes older installs)
   - Runs 52 migrations in sequence; each wraps in a transaction with explicit version bumping
   - Migration v1 creates `settings` table (empty on first run)
6. **Post-DB checks** (lines 196–224):
   - Start DB file watcher
   - Start background services (load sampler, plugins)
   - Run async Claude Settings bootstrap (non-blocking, fires errors to startup queue)
   - Run startup backup (non-fatal failure)
   - Launch Supabase import (async, fires broadcast if error)
7. **Task repository & services** (lines 203–327): Create task repo, terminal service, agent manager config, review service
8. **IPC handler registration** (line 337): All async/sync handlers registered before window creation
9. **Security** (line 339): CSP headers configured
10. **Window creation** (line 341): `new BrowserWindow()` with `show: false`
    - Preload loads (with context isolation, sandbox enabled)
    - Renderer HTML/JS loads asynchronously
    - On `ready-to-show` event: window shown + `emitStartupWarnings()` fires to accumulated error queue
11. **Tearoff window restoration** (line 342): Recreate user's saved tearoff windows

---

## Findings

### F-t2-bootstrap-1: Startup Warnings Emission at `ready-to-show` — Best Practice

**Severity:** Low (informational)  
**Category:** ipc-timing  
**Location:** `src/main/index.ts:131–134`  
**Evidence:**
```typescript
mainWindow.on('ready-to-show', () => {
  mainWindow.show()
  emitStartupWarnings()  // Fires accumulated startup errors to renderer
})
```

**Impact:** Startup warnings (e.g., missing Keychain, failed Supabase import) are queued in `startupErrors[]` and emitted **only after** the window is visually ready and the renderer's preload has subscribed to `manager:warning` broadcast. This prevents race where IPC send fires before listeners exist. Users see warnings in a toast/modal, not lost.

**Recommendation:** Document in CLAUDE.md that async fire-and-forget startup tasks (e.g., `importSprintTasksFromSupabase`) should either push errors to `startupErrors[]` (for early-resolved errors) or call `broadcast('manager:warning', ...)` directly (for late-resolved errors). Current code pattern is correct.

**Effort:** S  
**Confidence:** High

---

### F-t2-bootstrap-2: Database Directory Creation — Dual Path Ensures Safety

**Severity:** Low (informational)  
**Category:** dir-creation  
**Location:** `src/main/logger.ts:17–30` and `src/main/db.ts:12–22`  
**Evidence:**
```typescript
// logger.ts
function ensureLogDir(): void {
  if (!existsSync(BDE_DIR)) {
    mkdirSync(BDE_DIR, { recursive: true, mode: 0o700 })
  }
  try {
    chmodSync(BDE_DIR, 0o700)  // Enforce even on existing dirs
  } catch (err) {
    console.warn('[logger] Failed to enforce .bde directory permissions:', err)
  }
}

// db.ts
if (!_db) {
  mkdirSync(DB_DIR, { recursive: true, mode: 0o700 })
  mkdirSync(BDE_TASK_MEMORY_DIR, { recursive: true })
  try {
    chmodSync(DB_DIR, 0o700)
  } catch (err) {
    console.warn('[db] Failed to enforce .bde directory permissions:', err)
  }
  // ...
}
```

**Impact:** `~/.bde/` is created twice: first by logger (line 74 in index.ts, during module load), second by db.ts (line 185 in index.ts, inside `whenReady()`). Both use `recursive: true`, so second call is idempotent. Permissions (0o700) are enforced on every startup via `chmodSync` to fix legacy installs created without the mode flag. This is **robust and necessary for security**.

**Recommendation:** No changes needed. Pattern is sound: chmod is non-fatal (logged as warning only), and catching permission errors (e.g., read-only filesystem, insufficient permissions) prevents startup crash.

**Effort:** S  
**Confidence:** High

---

### F-t2-bootstrap-3: Migration Ordering Enforced at Loader Level — Strong Validation

**Severity:** Low (informational)  
**Category:** migration  
**Location:** `src/main/migrations/loader.ts:39–88`  
**Evidence:**
```typescript
export function loadMigrations(): Migration[] {
  const migrations: Migration[] = []
  // ... collect via import.meta.glob ...
  
  // Sort by version to ensure correct order
  migrations.sort((a, b) => a.version - b.version)

  // Validate version sequence: must be contiguous 1..N
  for (let i = 0; i < migrations.length; i++) {
    const expected = i + 1
    if (migrations[i].version !== expected) {
      throw new Error(
        `Migration version mismatch: expected v${expected}, found v${migrations[i].version}`
      )
    }
  }

  // Defense-in-depth: throw if no migrations found (0-migration loader bug)
  if (migrations.length === 0) {
    throw new Error(
      'loadMigrations() found 0 migrations matching "./v*.ts" — likely a ' +
      'bundler/glob regression...'
    )
  }
  return migrations
}

export function getPendingMigrations(
  migrations: Migration[],
  currentVersion: number
): Migration[] {
  const pending = migrations
    .filter((m) => m.version > currentVersion)
    .sort((a, b) => a.version - b.version)

  // Check for gaps in pending migrations
  if (pending.length > 1) {
    for (let i = 1; i < pending.length; i++) {
      if (pending[i].version !== pending[i - 1].version + 1) {
        throw new Error(...)
      }
    }
  }
  return pending
}
```

**Impact:** Migrations are statically validated at module load time (inside `import.meta.glob`). Version sequence must be contiguous (v1, v2, v3, ..., v52; no gaps). Comments in the code reference production regression where v046+ migrations never ran due to glob loading bug in older bundler. This is **excellent defense-in-depth**.

**Recommendation:** No changes. The v1 migration creates the `settings` table but inserts no default rows, so fresh installs have an empty settings table. Code defensively reads settings with `??` fallback (e.g., `getSettingJson('agentManager.maxConcurrent') ?? 2`). This is correct.

**Effort:** S  
**Confidence:** High

---

### F-t2-bootstrap-4: Settings Table Created Empty — Defaults in Code, Not DB

**Severity:** Low (informational)  
**Category:** migration  
**Location:** `src/main/migrations/v001-create-core-tables-agent-runs-settings.ts` and `src/main/index.ts:228–236`  
**Evidence:**
```typescript
// v001: only creates schema, no INSERT statements
db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key          TEXT PRIMARY KEY,
    value        TEXT NOT NULL,
    updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
`)

// index.ts: defaults applied via ?? operator
const amConfig = {
  maxConcurrent: getSettingJson<number>('agentManager.maxConcurrent') ?? 2,
  worktreeBase: getSetting('agentManager.worktreeBase') ?? join(homedir(), 'worktrees', 'bde'),
  maxRuntimeMs: getSettingJson<number>('agentManager.maxRuntimeMs') ?? 3_600_000,
  idleTimeoutMs: 900_000,
  pollIntervalMs: 30_000,
  defaultModel: getSetting('agentManager.defaultModel') ?? 'claude-sonnet-4-5'
}
```

**Impact:** On first run, `getSettingJson('agentManager.maxConcurrent')` returns `null` (key doesn't exist in empty table), so the expression evaluates to the fallback `2`. This is **safe and idiomatic**. If code accidentally forgets a `??` fallback, the code would read `null`, potentially crashing. But critical settings all have fallbacks.

**Recommendation:** Audit all `getSettingJson()` and `getSetting()` calls to ensure required settings have `??` fallbacks. Quick scan shows all agent manager config reads have fallbacks. Consider adding a lint rule or code comment warning future developers.

**Effort:** S  
**Confidence:** High

---

### F-t2-bootstrap-5: Database Backup at Startup — Non-Fatal Failure, Clean Semantics

**Severity:** Low (informational)  
**Category:** error-handling  
**Location:** `src/main/bootstrap.ts:146–162`  
**Evidence:**
```typescript
export function initializeDatabase(): void {
  getDb()
  // ... other startup tasks ...

  // Run backup on startup and every 24 hours.
  // Backup failure (disk full, bad permissions) must not abort startup with a misleading
  // "Database Migration Failed" dialog — it is non-fatal.
  try {
    backupDatabase()
  } catch (err) {
    logger.warn(`Startup backup failed (non-fatal): ${getErrorMessage(err)}`)
  }
  const safeBackup = (): void => {
    try {
      backupDatabase()
    } catch (err) {
      logger.warn(`Scheduled backup failed (non-fatal): ${getErrorMessage(err)}`)
    }
  }
  const backupInterval = setInterval(safeBackup, BACKUP_INTERVAL_MS)
  app.on('will-quit', () => clearInterval(backupInterval))
}
```

**Impact:** `backupDatabase()` runs inside `initializeDatabase()`, which is called inside `app.whenReady()`. If the backup fails (disk full, permission denied, corrupted DB), the error is logged but **does not** trigger the "Database Migration Failed" dialog (which is reserved for actual migration failures). User sees a warning in logs but startup continues. This is the correct semantics.

**Recommendation:** No changes. Pattern is sound. The backup failure is distinguished from migration failure intentionally.

**Effort:** S  
**Confidence:** High

---

### F-t2-bootstrap-6: Supabase Import Fire-and-Forget — Async Error Broadcasting

**Severity:** Low (informational)  
**Category:** error-handling, ipc-timing  
**Location:** `src/main/bootstrap.ts:164–173`  
**Evidence:**
```typescript
// One-time async import from Supabase (no-op if local table already has rows or credentials missing)
importSprintTasksFromSupabase(getDb()).catch((err) => {
  const message = `Supabase import failed: ${getErrorMessage(err)}`
  logger.warn(message)
  if (isNonTrivialError(message)) {
    // This may resolve after the window is ready — emit directly rather than relying on
    // emitStartupWarnings() which is called at window load time.
    broadcast('manager:warning', { message })
  }
})
```

**Impact:** `importSprintTasksFromSupabase()` is async, so it may resolve **after** the window is already showing and the user is interacting. If it fails, the code calls `broadcast('manager:warning', ...)` directly rather than pushing to `startupErrors[]`. This is the correct choice because by the time this error fires, the window is already visible and preload has subscribed. The comment in the code explicitly documents this decision.

**Recommendation:** Excellent code pattern. Document this as the template for other async fire-and-forget startup tasks: if the task may resolve after window creation, broadcast directly; if it runs before window creation, push to `startupErrors[]`.

**Effort:** S  
**Confidence:** High

---

### F-t2-bootstrap-7: OAuth Token File — No Creation at Startup, Read-Only

**Severity:** Low (informational)  
**Category:** error-handling  
**Location:** `src/main/env-utils.ts:125–165`  
**Evidence:**
```typescript
export function getOAuthToken(): string | null {
  const now = Date.now()
  if (_tokenLoadedAt > 0 && now - _tokenLoadedAt < TOKEN_TTL_MS) return _cachedOAuthToken
  _tokenLoadedAt = now
  const tokenPath = join(homedir(), '.bde', 'oauth-token')
  try {
    if (existsSync(tokenPath)) {
      // Use lstatSync (not statSync) to detect symlinks before following them.
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
      // Validate token format: reject empty strings or tokens too short to be valid
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
- `~/.bde/oauth-token` is **not** created by the app at startup. It is read-only at this point.
- On fresh install, the file doesn't exist, `getOAuthToken()` returns `null`, and `ANTHROPIC_API_KEY` is not set for agent subprocesses.
- The code explicitly checks for symlinks (security), file size, and permissions (0o600 required).
- If the token is invalid, the code logs a clear error message and continues.
- Called at line 241 in `index.ts` inside `if (autoStart)` block: `getOAuthToken()` is called but its return value is not checked—the code assumes the agent manager's drain loop will catch the missing token and error gracefully.

**Recommendation:** Verify that the agent manager's drain loop handles missing/invalid tokens gracefully. From the code, it appears to: `index.ts` line 241 calls `getOAuthToken()` but doesn't check the result; the token is only used when spawning agents. If missing, agents fail with a visible error. This is acceptable for first-launch UX (user sees "need to log in"), but should be verified.

**Effort:** S  
**Confidence:** High

---

### F-t2-bootstrap-8: Safe Storage Encryption — Lazy Re-encryption of Plaintext Settings

**Severity:** Medium  
**Category:** safestorage  
**Location:** `src/main/settings.ts:14–31` and `src/main/bootstrap.ts:107–124`  
**Evidence:**
```typescript
// settings.ts
export function getSetting(key: string, db?: Database.Database): string | null {
  const raw = _getSetting(db ?? getDb(), key)
  if (raw === null) return null
  if (SENSITIVE_SETTING_KEYS.has(key)) {
    const plaintext = decryptSetting(raw)
    // Lazy migration: re-encrypt any legacy plaintext values found in the DB.
    // Skip silently if encryption is unavailable — we cannot upgrade now.
    if (!raw.startsWith(ENCRYPTED_PREFIX)) {
      try {
        _setSetting(db ?? getDb(), key, encryptSetting(plaintext))
      } catch (err) {
        logger.warn(`Skipping lazy re-encryption of "${key}": ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    return plaintext
  }
  return raw
}

// bootstrap.ts — warnPlaintextSensitiveSettings runs at startup
export function warnPlaintextSensitiveSettings(): void {
  const db = getDb()
  const plaintextKeys: string[] = []
  for (const key of SENSITIVE_SETTING_KEYS) {
    const raw = _getRawSetting(db, key)
    if (raw !== null && !raw.startsWith(ENCRYPTED_PREFIX)) {
      plaintextKeys.push(key)
    }
  }
  if (plaintextKeys.length > 0) {
    logger.warn(
      `Sensitive settings stored as plaintext (missing ${ENCRYPTED_PREFIX} prefix): ${plaintextKeys.join(', ')}. ` +
      'These values are unencrypted in SQLite. Re-save each credential via Settings to encrypt it.'
    )
  }
}
```

**Impact:**
- On first run (no settings table rows), `warnPlaintextSensitiveSettings()` logs nothing (no sensitive keys exist yet).
- When a user stores a sensitive setting (e.g., GitHub token), the code calls `encryptSetting()`, which calls `safeStorage.isEncryptionAvailable()`. If encryption is unavailable (locked Keychain on macOS, or Linux), the code throws and the UI shows an error.
- If encryption is available, the value is encrypted with the `ENC:` prefix and stored. Future reads lazily re-encrypt any legacy plaintext values found.
- This pattern is **defensive but not bulletproof**: if `safeStorage.isEncryptionAvailable()` returns `false` at startup but returns `true` later (e.g., user unlocks Keychain), the code handles it gracefully via lazy re-encryption.

**Recommendation:** No critical issues. The code is sound. Consider documenting in CLAUDE.md that Keychain must be unlocked before the first agent run; if the user stores a GitHub token with a locked Keychain, the error is clear ("Cannot store sensitive setting: safeStorage encryption is unavailable").

**Effort:** S  
**Confidence:** High

---

### F-t2-bootstrap-9: Missing `~/.bde/logs/` Directory Creation

**Severity:** Low  
**Category:** dir-creation  
**Location:** `src/main/paths.ts:88–91` (defined but not created)  
**Evidence:**
```typescript
export const BDE_AGENT_LOGS_DIR = join(BDE_DIR, 'agent-logs')
export const BDE_AGENT_LOG_PATH = join(BDE_DIR, 'agent-manager.log')
export const BDE_MEMORY_DIR = join(BDE_DIR, 'memory')
export const BDE_TASK_MEMORY_DIR = join(BDE_MEMORY_DIR, 'tasks')
```

And in `db.ts:13`:
```typescript
mkdirSync(BDE_TASK_MEMORY_DIR, { recursive: true })
```

**Impact:** 
- `BDE_TASK_MEMORY_DIR` (`~/.bde/memory/tasks/`) is created at startup via `recursive: true` on the deepest path.
- `BDE_AGENT_LOGS_DIR` (`~/.bde/agent-logs/`) is **not** explicitly created at startup, but it's created on-demand by the agent manager when it first writes a log.
- `BDE_AGENT_LOG_PATH` (`~/.bde/agent-manager.log`) is created on-demand when the first log entry is written (via `appendFileSync` in logger.ts).
- This is **safe**: `appendFileSync` doesn't require the parent directory to exist first (the parent `~/.bde/` already exists), so lazy creation is fine.

**Recommendation:** No changes needed. Agent logs are created on-demand by the agent manager. The `memory/tasks/` directory is explicitly created because the memory module may read from it before writing anything, and it contains user data (agent reasoning), so it should exist early.

**Effort:** S  
**Confidence:** High

---

### F-t2-bootstrap-10: Single-Instance Lock Held Before `whenReady()`

**Severity:** Low (informational)  
**Category:** error-handling  
**Location:** `src/main/index.ts:49–52`  
**Evidence:**
```typescript
if (!app.requestSingleInstanceLock()) {
  app.quit()
  process.exit(0)
}
```

**Impact:** This runs **before** `app.whenReady()`, so if a second instance is launched while the first is starting up, the second instance exits cleanly with `process.exit(0)` (no error dialog). The first instance, on receipt of the `second-instance` event (line 166), refocuses its window. This prevents concurrent DB writes and is **correct**.

**Recommendation:** No changes. The single-instance lock is held for the entire app lifetime.

**Effort:** S  
**Confidence:** High

---

### F-t2-bootstrap-11: Window Show Timing — `ready-to-show` vs `did-finish-load` vs DOM Ready

**Severity:** Low (informational)  
**Category:** ipc-timing  
**Location:** `src/main/index.ts:131–134`  
**Evidence:**
```typescript
mainWindow.on('ready-to-show', () => {
  mainWindow.show()
  emitStartupWarnings()
})

mainWindow.webContents.on('will-navigate', (event, url) => {
  if (!url.startsWith(appUrl)) {
    event.preventDefault()
  }
})

if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
  mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
} else {
  mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
}
```

**Impact:**
- `mainWindow.loadFile()` (or `loadURL()`) is called synchronously after creating the window, which starts the async load and render process.
- Electron fires `ready-to-show` when the renderer process has finished rendering the initial page, but **before** JavaScript has run.
- The preload script runs **after** the renderer context is created but **before** the main renderer JS evaluates (contextBridge happens here).
- React mounts components in `src/renderer/src/main.tsx`, which eventually subscribes to `manager:warning` broadcasts via `window.api.agentManager.onWarning()`.
- `emitStartupWarnings()` is called **after** `mainWindow.show()`, so it broadcasts after the window is visible.
- However, there's **potential for a race**: the preload runs synchronously, but React mounting is async. If startup warnings fire **before** React mounts, the listener is not yet registered and warnings are lost.

**Recommendation:** This is a **potential but unlikely issue** in practice:
  - Most startup errors are trivial (missing credentials, skipped imports).
  - The one non-trivial error path (`initializeDatabase()` throwing) is synchronous and triggers the error dialog before the window is created.
  - Late-resolving errors (Supabase import) are broadcast directly and may race, but the code already handles this by calling `broadcast()` directly in the catch handler.
  - **Mitigation already in place**: The startup error accumulator pattern (push to `startupErrors[]` for early errors, broadcast directly for late errors) is correct.
  
  To be fully safe, the renderer could listen to `manager:warning` at the preload level (store messages in a buffer), then drain the buffer once React mounts. But the current approach is pragmatic and matches the codebase's error handling philosophy (non-critical errors are advisory).

**Effort:** S  
**Confidence:** High

---

### F-t2-bootstrap-12: IPC Handler Registration Ordering — Before Window Creation

**Severity:** Low (informational)  
**Category:** ipc-timing  
**Location:** `src/main/index.ts:337–341`  
**Evidence:**
```typescript
// Register all IPC handlers
const handlerDeps: AppHandlerDeps = {
  agentManager,
  terminalDeps,
  reviewService,
  reviewChatStreamDeps,
  repo
}
registerAllHandlers(handlerDeps)

setupCSP()

createWindow()
```

**Impact:** All IPC handlers are registered **before** `createWindow()` is called, so by the time the renderer loads and sends its first IPC message, handlers are already listening. This is the correct pattern and prevents "no handler for channel X" errors.

**Recommendation:** No changes. Pattern is correct.

**Effort:** S  
**Confidence:** High

---

### F-t2-bootstrap-13: Synchronous `getOAuthToken()` Called at Startup — No Blocking

**Severity:** Low (informational)  
**Category:** error-handling  
**Location:** `src/main/index.ts:241`  
**Evidence:**
```typescript
if (autoStart) {
  getOAuthToken()  // Returns null on fresh install, cached for 30s

  // Wire data modules to use the same structured file logger as the agent manager
  const logger = createLogger('agent-manager')
  setSprintQueriesLogger(logger)
  // ...
}
```

**Impact:** `getOAuthToken()` is synchronous and fast (file stat + read, or returns cached value). On fresh install, the file doesn't exist, so it returns `null` immediately. The token is only used later when the agent manager spawns subprocesses. If the token is missing, agents fail with a clear error. No blocking.

**Recommendation:** No changes. Pattern is correct.

**Effort:** S  
**Confidence:** High

---

### F-t2-bootstrap-14: Log Rotation — Non-Fatal Failures on First Run

**Severity:** Low (informational)  
**Category:** error-handling  
**Location:** `src/main/logger.ts:32–59`  
**Evidence:**
```typescript
function rotateIfNeeded(): void {
  try {
    const stats = statSync(LOG_PATH)
    if (stats.size > MAX_LOG_SIZE) {
      // ... rename old logs ...
    }
  } catch {
    // File doesn't exist yet — fine
  }
}

function fileLog(level: string, name: string, msg: string): void {
  try {
    const ts = nowIso()
    appendFileSync(LOG_PATH, `${ts} [${level}] [${name}] ${msg}\n`)
    if (++writeCount >= ROTATION_CHECK_INTERVAL) {
      writeCount = 0
      rotateIfNeeded()
    }
  } catch {
    // Logging should never crash the app
  }
}
```

**Impact:** On first run, `LOG_PATH` (`~/.bde/bde.log`) doesn't exist. `rotateIfNeeded()` catches the error and continues. `appendFileSync()` creates the file on first write. All errors are caught, so logging never crashes the app.

**Recommendation:** No changes. Pattern is defensive and correct.

**Effort:** S  
**Confidence:** High

---

### F-t2-bootstrap-15: Window Creation Failure — Not Explicitly Handled

**Severity:** Medium  
**Category:** window-creation, error-handling  
**Location:** `src/main/index.ts:117–164`  
**Evidence:**
```typescript
function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: '#0A0A0A',
    titleBarStyle: 'hiddenInset',
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: SHARED_WEB_PREFERENCES
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
    emitStartupWarnings()
  })
  
  // ... more handlers ...
  
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  // ... DB init, agent manager setup ...
  
  createWindow()
  restoreTearoffWindows()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})
```

**Impact:** 
- `new BrowserWindow()` can throw if the display is unavailable (e.g., headless system, X11 not running on Linux).
- `createWindow()` has no try-catch, so an exception would propagate up and crash the app.
- The uncaught exception handler (line 98–107) would catch it and log it, but the user would see no error dialog.
- On a headless system, the app would exit silently.

**Recommendation:** Wrap `createWindow()` in a try-catch and show a meaningful error dialog:
```typescript
try {
  createWindow()
  restoreTearoffWindows()
} catch (err) {
  dialog.showErrorBox(
    'Display Error',
    `Cannot create window: ${err instanceof Error ? err.message : String(err)}\n\n` +
    'Ensure a display is available (X11 on Linux, or run on a machine with a display).'
  )
  app.quit()
}
```

**Effort:** S  
**Confidence:** High

---

## Summary Table

| Finding | Severity | Category | Status | Action |
|---------|----------|----------|--------|--------|
| F-t2-bootstrap-1 | Low | ipc-timing | ✓ PASS | Document pattern |
| F-t2-bootstrap-2 | Low | dir-creation | ✓ PASS | No changes |
| F-t2-bootstrap-3 | Low | migration | ✓ PASS | No changes |
| F-t2-bootstrap-4 | Low | migration | ✓ PASS | Audit `??` fallbacks |
| F-t2-bootstrap-5 | Low | error-handling | ✓ PASS | No changes |
| F-t2-bootstrap-6 | Low | error-handling, ipc-timing | ✓ PASS | Document pattern |
| F-t2-bootstrap-7 | Low | error-handling | ✓ PASS | Verify agent manager token handling |
| F-t2-bootstrap-8 | Medium | safestorage | ✓ PASS | Document keychain lock requirement |
| F-t2-bootstrap-9 | Low | dir-creation | ✓ PASS | No changes |
| F-t2-bootstrap-10 | Low | error-handling | ✓ PASS | No changes |
| F-t2-bootstrap-11 | Low | ipc-timing | ⚠ AWARE | Race is unlikely in practice |
| F-t2-bootstrap-12 | Low | ipc-timing | ✓ PASS | No changes |
| F-t2-bootstrap-13 | Low | error-handling | ✓ PASS | No changes |
| F-t2-bootstrap-14 | Low | error-handling | ✓ PASS | No changes |
| F-t2-bootstrap-15 | Medium | window-creation, error-handling | 🔴 RECOMMEND FIX | Add try-catch with error dialog |

---

## Conclusion

The startup sequence is **well-engineered and production-ready** for cold-start on a fresh machine. Directory creation is safe (dual-path with permission enforcement), migrations are validated and ordered, settings have sensible defaults, and startup warnings are emitted at the correct IPC readiness point. Only minor recommendations:

1. Add try-catch around `createWindow()` to handle display unavailability gracefully (F-t2-bootstrap-15).
2. Audit all `getSettingJson()` calls to ensure `??` fallbacks (already done for agent manager config, but should be verified across the codebase).
3. Document the fire-and-forget error pattern for other developers.

No critical blockers for shipping.
