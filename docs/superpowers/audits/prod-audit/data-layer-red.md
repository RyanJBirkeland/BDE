# Data Layer -- Red Team Audit

**Date:** 2026-03-29
**Scope:** 19 files in Data Layer (10 source, 9 test)
**Persona:** Red Team (Security Auditor)

---

## Cross-Reference: SEC-6 Status

The March 28 synthesis report flagged **SEC-6: SQL string interpolation in `backupDatabase()`** at `src/main/db.ts:31`.

**Status: Partially mitigated.** A regex validation was added at line 32:

```ts
if (!/^[\w\-.\/]+$/.test(backupPath)) {
  throw new Error('Invalid backup path')
}
```

However, the `backupPath` is still interpolated into SQL via template literal at line 37:

```ts
db.exec(`VACUUM INTO '${backupPath}'`)
```

The regex is defense-in-depth but the path comes from `DB_PATH + '.backup'` where `DB_PATH` is derived from `homedir()`. On a system where the home directory contains a single quote (e.g., macOS user "O'Brien"), the regex would reject it (no `'` in `[\w\-.\/]+`), so it is safe. The fix is adequate for the current threat model. See DL-RED-1 for a remaining concern about the regex itself.

---

## Findings

### Critical

None found.

### High

**DL-RED-1: `updateTask` builds SQL SET clause from dynamic column names without compile-time assertion**

- **File:** `src/main/data/sprint-queries.ts:200`
- **Code:**
  ```ts
  setClauses.push(`${key} = ?`)
  ```
- **Risk:** The column name `key` is only validated against `UPDATE_ALLOWLIST`, a runtime `Set`. If an attacker can add an entry to `UPDATE_ALLOWLIST` (e.g., via prototype pollution on `Set`), or if a future developer adds a column name containing SQL metacharacters to the allowlist, the `key` is interpolated directly into the SQL string. While the current allowlist entries are safe, there is no compile-time or runtime assertion that allowlist entries are valid SQL identifiers.
- **Severity:** High (defense-in-depth gap -- single point of failure in allowlist correctness)
- **Fix:** Add a regex assertion when building the SET clause:
  ```ts
  if (!/^[a-z_]+$/.test(key)) throw new Error(`Invalid column name: ${key}`)
  ```
  This was also flagged by main-process-sd S7 in the March 28 audit and remains unfixed.

**DL-RED-2: `updateAgentMeta` builds SQL SET clause from `AGENT_COLUMN_MAP` values without validation**

- **File:** `src/main/data/agent-queries.ts:131`
- **Code:**
  ```ts
  setClauses.push(`${col} = ?`)
  ```
- **Risk:** The `col` value comes from `AGENT_COLUMN_MAP`, a `Record<string, string>` constant. Same class of vulnerability as DL-RED-1: the column name is interpolated into SQL. If `AGENT_COLUMN_MAP` were modified at runtime (prototype pollution, or a future developer adding a bad entry), this becomes SQL injection.
- **Severity:** High (defense-in-depth gap)
- **Fix:** Same regex assertion: `if (!/^[a-z_]+$/.test(col)) throw new Error(...)`.

**DL-RED-3: `backupDatabase` regex allows path traversal sequences**

- **File:** `src/main/db.ts:32`
- **Code:**
  ```ts
  if (!/^[\w\-.\/]+$/.test(backupPath)) {
    throw new Error('Invalid backup path')
  }
  ```
- **Risk:** The regex `[\w\-.\/]+` permits `../` sequences. While `backupPath` is currently `DB_PATH + '.backup'` (not user-controlled), if this function is ever refactored to accept user input, the regex would allow writing the backup to any writable location (e.g., `../../../../tmp/evil.db`). The `VACUUM INTO` command creates a file at the specified path.
- **Severity:** High (latent -- not currently exploitable, but the validation is insufficient for its stated purpose)
- **Fix:** Either (a) remove the validation comment claiming "defense in depth" and hardcode the path without interpolation, or (b) use `path.resolve()` and verify it starts with the expected directory:
  ```ts
  const resolved = path.resolve(backupPath)
  if (!resolved.startsWith(DB_DIR)) throw new Error('Backup path outside data dir')
  ```

### Medium

**DL-RED-4: Supabase credentials stored in plaintext in SQLite settings table**

- **File:** `src/main/data/supabase-import.ts:64-65`, `src/main/settings.ts:31-32`
- **Code:**
  ```ts
  const supabaseUrl = getSetting(db, SETTING_SUPABASE_URL)
  const supabaseKey = getSetting(db, SETTING_SUPABASE_KEY)
  ```
- **Risk:** The Supabase `serviceKey` (which is a service-role key with full database access) is stored as plaintext in the SQLite `settings` table. The database file at `~/.bde/bde.db` is readable by the user. Any process running as the same user can read the service key. The service key grants unrestricted access to the Supabase project (bypass RLS, read/write all tables).
- **Severity:** Medium (local privilege boundary -- any process as the same user can read the DB; mitigated by the fact that this is optional/legacy and only used during one-time import)
- **Fix:** After the one-time import completes successfully, delete the credentials from the settings table:
  ```ts
  deleteSetting(db, SETTING_SUPABASE_URL)
  deleteSetting(db, SETTING_SUPABASE_KEY)
  ```

**DL-RED-5: OAuth token file has no permission enforcement**

- **File:** `src/main/env-utils.ts:36-38`
- **Code:**
  ```ts
  const tokenPath = join(homedir(), '.bde', 'oauth-token')
  if (existsSync(tokenPath)) {
    _cachedOAuthToken = readFileSync(tokenPath, 'utf8').trim()
  }
  ```
- **Risk:** The `~/.bde/oauth-token` file contains the Claude OAuth access token in plaintext. The code never checks or sets file permissions. If the file was created with default permissions (e.g., `0644`), other users on a shared system can read it. On a multi-user macOS system, this token grants access to the user's Claude subscription.
- **Severity:** Medium (local-only, single-user typical deployment)
- **Fix:** When reading the token, verify permissions: `fs.statSync(tokenPath).mode & 0o077 === 0`. When writing the token (if BDE ever does), use `fs.writeFileSync(path, data, { mode: 0o600 })`.

**DL-RED-6: `ensureSubscriptionAuth` deletes env vars as sole security measure**

- **File:** `src/main/auth-guard.ts:101-102`
- **Code:**
  ```ts
  delete process.env['ANTHROPIC_API_KEY']
  delete process.env['ANTHROPIC_AUTH_TOKEN']
  ```
- **Risk:** The `ensureSubscriptionAuth` function deletes `ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN` from `process.env` to force subscription-only auth. However, any code that runs before this function (or concurrently) can read those env vars. Additionally, `buildAgentEnvWithAuth()` in `env-utils.ts` sets `ANTHROPIC_API_KEY` from the OAuth token file, potentially re-introducing the env var that was just deleted. The auth guard's env cleanup is not effective as a security boundary.
- **Severity:** Medium (defense-in-depth gap -- the intent is to prevent non-subscription usage, but the mechanism is bypassable)
- **Fix:** Document this as a subscription enforcement mechanism, not a security boundary. Or, move the env cleanup to `buildAgentEnv()` so it's always applied.

**DL-RED-7: Migrations run in a single transaction with no individual error isolation**

- **File:** `src/main/db.ts:440-446`
- **Code:**
  ```ts
  const runAll = db.transaction(() => {
    for (const migration of pending) {
      migration.up(db)
      db.pragma(`user_version = ${migration.version}`)
    }
  })
  runAll()
  ```
- **Risk:** If any migration fails, the entire transaction rolls back, including successful earlier migrations. The `user_version` pragma is set inside the transaction, so on rollback it reverts. This means a bad migration N+2 will also roll back the successful migration N+1. On next startup, all pending migrations run again from the last committed version. Migration v9 and v10 use `DROP TABLE` + `ALTER TABLE ... RENAME` -- if these are re-run against an already-migrated schema, the `CREATE TABLE` will silently succeed (via `IF NOT EXISTS`) but `INSERT INTO ... SELECT * FROM sprint_tasks` will copy rows from the already-migrated table, potentially duplicating data.
- **Severity:** Medium (data corruption risk on partial migration failure; mitigated by the fact that all current migrations are tested and stable)
- **Fix:** Wrap each migration in its own transaction, or at minimum, add idempotency guards to destructive migrations (v9, v10) that check the current schema before acting.

**DL-RED-8: `getSettingJson` uses unconstrained generic type deserialization**

- **File:** `src/main/data/settings-queries.ts:26-34`
- **Code:**
  ```ts
  export function getSettingJson<T>(db: Database.Database, key: string): T | null {
    const raw = getSetting(db, key)
    if (!raw) return null
    try {
      return JSON.parse(raw) as T
    } catch {
      return null
    }
  }
  ```
- **Risk:** The `as T` cast is a lie -- `JSON.parse` returns `any`, and the function trusts that the stored JSON matches type `T`. If a malicious or corrupted value is stored in the settings table (e.g., via direct SQLite access or a compromised Queue API), the deserialized object is trusted by all callers. For example, `getSettingJson<RepoConfig[]>('repos')` in `paths.ts:26` feeds directly into `localPath` values used in `path.resolve()` calls and git operations. A crafted `repos` setting with `localPath: "/etc"` could cause agents to operate on arbitrary directories.
- **Severity:** Medium (requires local SQLite write access, but the blast radius is significant -- arbitrary directory traversal in agent operations)
- **Fix:** Add schema validation (e.g., Zod) for security-sensitive settings like `repos`. At minimum, validate that `localPath` is an absolute path within known safe directories.

**DL-RED-9: Queue API token in query string is logged in server access logs**

- **File:** `src/main/queue-api/helpers.ts:30-35`
- **Code:**
  ```ts
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
  const queryToken = url.searchParams.get('token')
  if (queryToken) {
    token = queryToken
  }
  ```
- **Risk:** The SSE endpoint accepts the API key as a `?token=` query parameter. Query strings are logged by web servers, proxies, and browser history. While this is a localhost API, if BDE ever adds request logging (or a user runs it behind a reverse proxy for remote access), the API key will appear in logs.
- **Severity:** Medium (accepted risk per main-process-sd C4 in March 28 audit, but still worth documenting)
- **Fix:** Document as accepted risk, or switch SSE auth to a cookie-based mechanism.

### Low

**DL-RED-10: `migration.version` interpolated into pragma without parameterization**

- **File:** `src/main/db.ts:443`
- **Code:**
  ```ts
  db.pragma(`user_version = ${migration.version}`)
  ```
- **Risk:** `migration.version` is a number from the `migrations` array defined in the same file. It is not user-controlled. However, `db.pragma()` does not support parameterized values, so this is string interpolation into a SQL pragma. If the `Migration` interface were ever extended to accept external version numbers, this could become an injection vector.
- **Severity:** Low (not exploitable with current code)
- **Fix:** Add `if (!Number.isInteger(migration.version)) throw new Error(...)` as a defensive guard.

**DL-RED-11: `sanitizeDependsOn` recursive call has no depth limit**

- **File:** `src/shared/sanitize-depends-on.ts:16`
- **Code:**
  ```ts
  const parsed = JSON.parse(value)
  return sanitizeDependsOn(parsed) // Recursive call
  ```
- **Risk:** If `JSON.parse` returns a string (e.g., double-encoded JSON), the function will recurse. Each level of double-encoding adds one recursion level. Deeply nested encoding (unlikely in practice) could cause a stack overflow.
- **Severity:** Low (requires deliberately crafted input; `JSON.parse` of a normal double-encoded string only recurses once)
- **Fix:** Add a depth parameter: `function sanitizeDependsOn(value: unknown, depth = 0): ... { if (depth > 2) return null; ... sanitizeDependsOn(parsed, depth + 1) }`.

**DL-RED-12: Supabase import does not validate `status` field from remote data**

- **File:** `src/main/data/supabase-import.ts:127`
- **Code:**
  ```ts
  status: row.status ?? 'backlog',
  ```
- **Risk:** The status value from Supabase is inserted directly. While SQLite has a CHECK constraint that rejects invalid statuses, a Supabase row with an unexpected status (e.g., one that existed in an older schema version) will cause the entire import transaction to fail. The error is caught at line 164, but the user gets zero tasks imported with only a log message.
- **Severity:** Low (data availability issue, not confidentiality/integrity)
- **Fix:** Validate and normalize the status before insertion:
  ```ts
  const VALID_STATUSES = new Set(['backlog','queued','blocked','active','done','cancelled','failed','error'])
  status: VALID_STATUSES.has(row.status) ? row.status : 'backlog',
  ```

**DL-RED-13: `AuthGuard` Keychain read is not rate-limited**

- **File:** `src/main/auth-guard.ts:43-48`
- **Code:**
  ```ts
  const { stdout } = await execFileAsync('security', [
    'find-generic-password',
    '-s',
    'Claude Code-credentials',
    '-w'
  ])
  ```
- **Risk:** Each call to `checkAuthStatus()` spawns a child process to read from the macOS Keychain. There is no caching or rate-limiting. If the renderer calls `auth:status` in a tight loop (e.g., via polling), it could spawn many `security` processes. The CLAUDE.md notes this hangs in Electron's main process, which is why the auth guard is NOT called in the drain loop -- but it is still callable via IPC.
- **Severity:** Low (DoS against the local system; mitigated by it being localhost-only)
- **Fix:** Add caching with a TTL (similar to `getOAuthToken()` in env-utils.ts).

**DL-RED-14: Database file permissions not explicitly set**

- **File:** `src/main/db.ts:9-10`
- **Code:**
  ```ts
  mkdirSync(DB_DIR, { recursive: true })
  _db = new Database(DB_PATH)
  ```
- **Risk:** The `~/.bde/` directory and `bde.db` file are created with default umask permissions. On macOS, this is typically `0755` for directories and `0644` for files, meaning other users can read the database. The database contains API keys (`taskRunner.apiKey`), Supabase service keys, sprint task data, and agent run logs.
- **Severity:** Low (single-user typical deployment; macOS home directories are generally not world-readable in practice due to SIP)
- **Fix:** Set explicit permissions: `mkdirSync(DB_DIR, { recursive: true, mode: 0o700 })` and after creating the DB, `fs.chmodSync(DB_PATH, 0o600)`.

**DL-RED-15: `VACUUM INTO` backup has no integrity verification**

- **File:** `src/main/db.ts:37`
- **Code:**
  ```ts
  db.exec(`VACUUM INTO '${backupPath}'`)
  ```
- **Risk:** The backup is created but never verified. A partial write (disk full, crash during VACUUM) could produce a corrupt backup file that overwrites the previous good backup. There is only one backup generation (`.backup`), so a corrupt backup means no valid backup exists.
- **Severity:** Low (data availability; the primary DB is still intact)
- **Fix:** Write to a temp file first, verify with `PRAGMA integrity_check`, then rename to the final backup path.

---

## Summary Table

| ID        | Severity | Category                        | File                      | Status        |
| --------- | -------- | ------------------------------- | ------------------------- | ------------- |
| DL-RED-1  | High     | SQL injection (dynamic columns) | sprint-queries.ts:200     | Open          |
| DL-RED-2  | High     | SQL injection (dynamic columns) | agent-queries.ts:131      | Open          |
| DL-RED-3  | High     | Path traversal (latent)         | db.ts:32                  | Open          |
| DL-RED-4  | Medium   | Credential storage              | supabase-import.ts:64     | Open          |
| DL-RED-5  | Medium   | File permissions                | env-utils.ts:36           | Open          |
| DL-RED-6  | Medium   | Auth bypass                     | auth-guard.ts:101         | Open          |
| DL-RED-7  | Medium   | Migration safety                | db.ts:440                 | Open          |
| DL-RED-8  | Medium   | Unsafe deserialization          | settings-queries.ts:26    | Open          |
| DL-RED-9  | Medium   | Token in query string           | helpers.ts:30             | Accepted risk |
| DL-RED-10 | Low      | SQL pragma interpolation        | db.ts:443                 | Open          |
| DL-RED-11 | Low      | Unbounded recursion             | sanitize-depends-on.ts:16 | Open          |
| DL-RED-12 | Low      | Input validation                | supabase-import.ts:127    | Open          |
| DL-RED-13 | Low      | DoS (process spawn)             | auth-guard.ts:43          | Open          |
| DL-RED-14 | Low      | File permissions                | db.ts:9                   | Open          |
| DL-RED-15 | Low      | Backup integrity                | db.ts:37                  | Open          |

---

## Cross-Reference with March 28 Audit

| March 28 ID                                         | This Audit         | Status                                                   |
| --------------------------------------------------- | ------------------ | -------------------------------------------------------- |
| SEC-6 (SQL string interpolation in backupDatabase)  | DL-RED-3           | Partially mitigated -- regex added but allows traversal  |
| main-process-sd S7 (SQL column allowlist assertion) | DL-RED-1, DL-RED-2 | Still open -- no regex assertion on column names         |
| main-process-sd C4 (SSE token query-string)         | DL-RED-9           | Acknowledged as accepted risk                            |
| SEC-5 (CORS wildcard)                               | N/A                | Fixed -- `CORS_HEADERS = {}` (empty object, no wildcard) |

---

## Positive Findings

The data layer demonstrates several strong security practices:

1. **Parameterized queries throughout.** All user-supplied values (task IDs, status strings, claimed_by, etc.) flow through `?` placeholders. No direct string interpolation of user data into SQL.
2. **Field allowlist on updates.** `UPDATE_ALLOWLIST` prevents updating `id`, `created_at`, `updated_at`. Protected fields cannot be overwritten via the update API.
3. **Atomic WIP enforcement.** `claimTask` uses a SQLite transaction for the count-then-claim operation, preventing TOCTOU races.
4. **CHECK constraints on status.** Invalid status values are rejected at the database level, not just application level.
5. **Body size limit on Queue API.** `MAX_BODY_SIZE = 5MB` prevents memory exhaustion from oversized requests.
6. **CORS wildcard removed.** The March 28 SEC-5 finding has been fixed -- `CORS_HEADERS` is now an empty object.
7. **Fail-closed on error.** `getActiveTaskCount()` returns `Infinity` on DB error, preventing new task claims when the database is broken.
