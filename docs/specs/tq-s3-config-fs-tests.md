# TQ-S3: Unit Tests for config.ts + fs.ts

**Epic:** Testing & QA
**Priority:** P0
**Estimate:** Medium
**Type:** Unit Test

---

## Problem

### config.ts (90 LOC) — Auth & Configuration

`src/main/config.ts` reads gateway credentials, GitHub tokens, and Supabase config from `~/.openclaw/openclaw.json`. Bugs here cause:

- **App crash on startup** if config file missing/corrupt (calls `app.quit()`)
- **Silent auth failures** if token fields are renamed or missing
- **Credential leakage** if environment variable fallbacks behave unexpectedly

Currently untested error paths:

- Missing config file (`ENOENT`)
- Corrupt JSON (parse error)
- Missing required fields (gatewayToken absent)
- Environment variable fallback chain

### fs.ts (73 LOC) — Memory File Operations

`src/main/fs.ts` provides IPC handlers for reading/writing agent memory files. The `normalizePath()` function is the sole defense against path traversal attacks.

**Current implementation (`fs.ts:60-65`):**

```ts
function normalizePath(relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, '/').replace(/\.\./g, '')
  if (normalized.startsWith('/')) return normalized.slice(1)
  return normalized
}
```

**Known weaknesses:**

- Regex `replace(/\.\./g, '')` strips `..` but allows `....` → `..` after one pass (double-dot reconstruction)
- No symlink resolution — a symlink in memory root could point anywhere
- No canonicalization — `./foo/../../../etc/passwd` after one strip becomes `./foo/etc/passwd` (safe by accident, but fragile)

---

## Test Plan

### config.test.ts

**File to create:** `src/main/__tests__/config.test.ts`

#### Mocking Strategy

```ts
vi.mock('fs', () => ({
  readFileSync: vi.fn(),
  writeFileSync: vi.fn()
}))
vi.mock('electron', () => ({
  dialog: { showErrorBox: vi.fn() },
  app: { quit: vi.fn() }
}))
vi.mock('os', () => ({ homedir: () => '/mock-home' }))
```

#### Test Cases — getGatewayConfig

```
✓ returns { url, token } from valid config file
✓ falls back to gateway.auth.token if gatewayToken missing
✓ constructs ws:// URL from gateway.port when gatewayUrl missing
✓ defaults to port 18789 when gateway.port missing
✓ shows error dialog and calls app.quit() when gatewayToken missing
✓ shows error dialog and calls app.quit() when config file missing (ENOENT)
✓ throws error after app.quit() (caller should not continue)
✓ re-throws non-ENOENT errors (EACCES, etc.)
```

#### Test Cases — getGitHubToken

```
✓ returns token from config file
✓ falls back to GITHUB_TOKEN env var when config missing
✓ falls back to GITHUB_TOKEN env var when config doesn't have githubToken
✓ returns null when neither config nor env var has token
```

#### Test Cases — getSupabaseConfig

```
✓ returns { url, anonKey } from config file
✓ falls back to VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY env vars
✓ returns null when url missing
✓ returns null when anonKey missing
✓ returns null when config file is corrupt JSON
```

#### Test Cases — saveGatewayConfig

```
✓ writes updated config to disk with gatewayUrl and gatewayToken
✓ preserves existing config fields when updating
✓ creates new config if file doesn't exist (starts from empty object)
✓ formats JSON with 2-space indentation
```

---

### fs.test.ts

**File to create:** `src/main/__tests__/fs.test.ts`

#### Mocking Strategy

```ts
vi.mock('fs/promises', () => ({
  readdir: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
  stat: vi.fn()
}))
vi.mock('./ipc-utils', () => ({
  safeHandle: vi.fn((channel, handler) => {
    /* store handler for direct testing */
  })
}))
vi.mock('os', () => ({ homedir: () => '/mock-home' }))
```

#### Test Cases — normalizePath (path traversal defense)

```
✓ passes through simple relative paths ("daily/2026-03-16.md")
✓ strips ".." traversal ("../../../etc/passwd" → "etc/passwd")
✓ strips leading slash ("/etc/passwd" → "etc/passwd")
✓ converts backslashes to forward slashes ("foo\\bar" → "foo/bar")
✓ handles double-dot reconstruction attack ("....//etc/passwd" → preserves safety)
✓ handles URL-encoded dots (if applicable — document whether this is checked)
✓ handles empty string input
✓ handles deeply nested traversal ("a/b/../../c/../../../etc/shadow")
```

#### Test Cases — listMemoryFiles

```
✓ returns sorted list of .md files from memory root
✓ recurses into subdirectories
✓ excludes non-.md files
✓ returns empty array when memory directory doesn't exist
✓ sorts by modifiedAt descending (newest first)
✓ includes path, name, size, modifiedAt for each file
```

#### Test Cases — readMemoryFile

```
✓ reads file content from normalized path
✓ applies path normalization before reading (traversal protection)
✓ throws when file doesn't exist
```

#### Test Cases — writeMemoryFile

```
✓ writes content to normalized path
✓ applies path normalization before writing (traversal protection)
✓ overwrites existing file content
```

---

## Files to Create

| File                                | Purpose                           | Estimated LOC |
| ----------------------------------- | --------------------------------- | ------------- |
| `src/main/__tests__/config.test.ts` | Config parsing + error path tests | ~120          |
| `src/main/__tests__/fs.test.ts`     | Filesystem + path traversal tests | ~130          |

## Files to Modify

| File             | Change                 | Reason                                               |
| ---------------- | ---------------------- | ---------------------------------------------------- |
| `src/main/fs.ts` | Export `normalizePath` | Enable direct unit testing of path traversal defense |

---

## Implementation Notes

- **config.ts mocks Electron's `dialog` and `app`** — these are Node modules in main process context. Use `vi.mock('electron', ...)`.
- **fs.ts registers handlers via `safeHandle`** — to test the handlers directly, either:
  - (a) Export the handler functions separately (cleanest)
  - (b) Mock `safeHandle` to capture the registered handlers, then call them directly
  - (c) Test `listMemoryFiles`, `readMemoryFile`, `writeMemoryFile` as standalone functions if exported
- **normalizePath must be exported** for direct testing. It's currently a private function — add `export` keyword.
- **Environment variables:** Use `vi.stubEnv()` to test env var fallbacks in config.ts.

## Acceptance Criteria

- [ ] All config error paths tested (ENOENT, corrupt JSON, missing fields)
- [ ] All env var fallback chains tested
- [ ] `normalizePath` tested against known path traversal patterns
- [ ] `dialog.showErrorBox` and `app.quit()` verified to be called on missing config
- [ ] File listing, reading, and writing tested with mocked fs
- [ ] Tests run via `npm run test:main`
