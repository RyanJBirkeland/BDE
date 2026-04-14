# Path Traversal Inspector — Lens Report
**Date:** 2026-04-13
**Auditor:** lens-path-trav (retroactive — lens was missing from original audit)
**Scope:** IDE file operations, memory path scoping, settings file paths, playground event handling

---

## Executive Summary

This audit examined path safety in Electron file handlers, focusing on containment boundaries and path resolution patterns. The codebase exhibits **strong defensive patterns in most areas** (IDE fs handlers, memory file validation, settings storage) with **one critical vulnerability** in the playground event path validation pipeline. Overall risk is **HIGH** due to the playground issue, but remediable through a single-line fix.

**Key Findings:**
- ✅ IDE file system handlers: Well-protected with symlink resolution and strict boundary checking
- ✅ Memory file operations: Correctly scoped to `BDE_MEMORY_DIR` with path traversal guards
- ✅ Settings profiles: Stored in database, no direct file path injection
- ✅ Worktree path construction: Uses UUID validation + guard patterns for safety
- ⚠️ Playground event path handling: **Critical vulnerability** — missing trailing slash in `startsWith()` check

---

## F-t4-path-trav-1: Playground Path Traversal via Directory Name Collision
**Severity:** Critical  
**Category:** Path Traversal  
**Location:** `src/main/agent-manager/run-agent.ts:104`  
**Evidence:**
```typescript
const resolvedPath = resolve(absolutePath)
const resolvedWorktree = resolve(worktreePath)
if (!resolvedPath.startsWith(resolvedWorktree)) {
  logger.warn(`[playground] Path traversal blocked: ${filePath} (resolved to ${resolvedPath})`)
  return
}
```

**Impact:**
If an agent writes an HTML file path like `../worktree-evil/index.html` while running in worktree `/home/user/worktrees/project`, the `startsWith()` check will **incorrectly pass**:
- `resolvedPath = "/home/user/worktrees/project-evil/index.html"`
- `resolvedWorktree = "/home/user/worktrees/project"`
- `"/home/user/worktrees/project-evil/index.html".startsWith("/home/user/worktrees/project")` → **true** ❌

An agent could then emit playground events (HTML payloads) from outside its isolation boundary, potentially:
1. Reading sibling worktrees' data (adjacent agent sessions)
2. Accessing user configuration or home directory files (via traversal beyond project prefix)
3. Exfiltrating sensitive data through the playground event stream

**Recommendation:**
Add a trailing slash or path separator check to enforce strict directory containment:
```typescript
if (!resolvedPath.startsWith(resolvedWorktree + path.sep) && resolvedPath !== resolvedWorktree) {
  logger.warn(`[playground] Path traversal blocked: ${filePath}`)
  return
}
```
Or use `path.relative()` to detect upward traversal:
```typescript
const rel = path.relative(resolvedWorktree, resolvedPath)
if (rel.startsWith('..')) {
  logger.warn(`[playground] Path traversal blocked`)
  return
}
```

**Effort:** S (single line fix)  
**Confidence:** High (trivial reproducibility; confirmed via Node REPL testing)

---

## F-t4-path-trav-2: `cloneRepo` Destination Directory Path Acceptance
**Severity:** Medium  
**Category:** Path Traversal / Directory Escape  
**Location:** `src/main/handlers/repo-discovery.ts:149-160`  
**Evidence:**
```typescript
export function cloneRepo(owner: string, repo: string, destDir: string): void {
  const expanded = expandTilde(destDir)
  const target = path.join(expanded, repo)
  const url = `https://github.com/${owner}/${repo}.git`
  // ... spawns git clone --progress url target
}

safeHandle('repos:clone', async (_e, owner: string, repo: string, destDir: string) => {
  cloneRepo(owner, repo, destDir)
})
```

**Impact:**
The IPC handler accepts an arbitrary `destDir` from the renderer with minimal validation. While `expandTilde()` prevents relative path tricks, there is no explicit check that `destDir` is within the user's home directory or otherwise safe. An agent or malicious renderer could:
1. Clone into arbitrary paths via absolute paths: `/etc/shadow`, `/var/spool`, etc.
2. Write to system directories if process runs with elevated privileges (unlikely but worth noting)
3. Overwrite application directories or library paths

The `validateDir()` function in `scanLocalRepos()` checks for `..` and requires absolute/tilde paths, but `cloneRepo()` does **not** call it.

**Recommendation:**
Apply explicit path validation before cloning:
```typescript
export function cloneRepo(owner: string, repo: string, destDir: string): void {
  const expanded = expandTilde(destDir)
  
  // Validate path is within home directory
  const homeDir = os.homedir()
  const resolvedPath = path.resolve(expanded)
  if (!resolvedPath.startsWith(homeDir + '/') && resolvedPath !== homeDir) {
    throw new Error(`Clone destination rejected: must be within home directory`)
  }
  
  const target = path.join(expanded, repo)
  // ... rest of function
}
```

**Effort:** M (requires home directory scope validation + error handling)  
**Confidence:** High (handler accepts unvalidated user input; no containment enforced)

---

## F-t4-path-trav-3: IDE File Operations — Path Traversal Properly Contained ✅
**Severity:** N/A (Well-Protected)  
**Category:** Positive Finding  
**Location:** `src/main/handlers/ide-fs-handlers.ts:53-94`  
**Evidence:**
```typescript
export function validateIdePath(targetPath: string, allowedRoot: string): string {
  const root = resolve(allowedRoot)
  
  // Resolve root symlinks first to get the canonical root path
  let rootReal: string
  try {
    rootReal = fs.realpathSync(root)
  } catch {
    rootReal = root
  }
  
  const resolved = resolve(targetPath)
  
  // Resolve symlinks to prevent path traversal via symlink escape
  let real: string
  try {
    real = fs.realpathSync(resolved)
  } catch {
    // IDE-3: If realpath fails (e.g., path doesn't exist yet), resolve parent symlinks
    const parent = dirname(resolved)
    try {
      const parentReal = fs.realpathSync(parent)
      const basename = resolved.split('/').pop() ?? ''
      real = `${parentReal}/${basename}`
    } catch {
      // If parent also doesn't exist, normalize using real root
      if (resolved.startsWith(root + '/')) {
        real = resolved.replace(root, rootReal)
      } else if (resolved === root) {
        real = rootReal
      } else {
        real = resolved
      }
    }
  }
  
  if (!real.startsWith(rootReal + '/') && real !== rootReal) {
    throw new Error(`Path traversal blocked: "${targetPath}" is outside root "${allowedRoot}"`)
  }
  return real
}
```

**Positive Assessment:**
- ✅ Uses `fs.realpathSync()` to resolve symlinks and prevent symlink-escape attacks (IDE-2 comment)
- ✅ Correctly enforces `startsWith(rootReal + '/')` with trailing slash for boundary safety
- ✅ All file operations (`readDir`, `readFile`, `writeFile`, `rename`, `delete`, `stat`) call `validateIdePath()` before access
- ✅ Root path initialization enforces home directory scope (`validateIdeRoot()`)
- ✅ Recursive directory listing skips sensitive dirs (`node_modules`, `.git`, `dist`, etc.)

**Confidence:** High — IDE handlers are a model of defensive design.

---

## F-t4-path-trav-4: Memory File Path Validation — Properly Scoped ✅
**Severity:** N/A (Well-Protected)  
**Category:** Positive Finding  
**Location:** `src/main/fs.ts:34-40`  
**Evidence:**
```typescript
export function validateMemoryPath(p: string): string {
  const resolved = resolve(MEMORY_ROOT, p)
  if (!resolved.startsWith(MEMORY_ROOT + '/') && resolved !== MEMORY_ROOT) {
    throw new Error(`Path traversal blocked: "${p}" resolves outside ${MEMORY_ROOT}`)
  }
  return resolved
}
```

**Positive Assessment:**
- ✅ Correctly uses `startsWith(MEMORY_ROOT + '/')` with trailing slash
- ✅ Called by all memory handlers: `readMemoryFile()`, `writeMemoryFile()`, `memory:setFileActive`
- ✅ Prevents escape via `../` sequences or absolute paths
- ✅ Test coverage validates rejection of traversal attempts (`.../etc/passwd`, `../memory-evil/secret`)

**Confidence:** High — memory path handling is sound.

---

## F-t4-path-trav-5: Settings Storage — Database-Backed, Not File-Based ✅
**Severity:** N/A (Well-Protected)  
**Category:** Positive Finding  
**Location:** `src/main/handlers/config-handlers.ts`, `src/main/services/settings-profiles.ts`  
**Evidence:**
```typescript
// Settings are stored in database, not as file paths
export function saveProfile(name: string): void {
  const snapshot: Record<string, string | null> = {}
  for (const key of PROFILE_KEYS_TO_SAVE) {
    snapshot[key] = getSetting(key)
  }
  setSettingJson(`${PROFILE_PREFIX}${name}`, snapshot)  // Database write, not file I/O
}
```

**Positive Assessment:**
- ✅ Settings profiles use database-backed `setSettingJson()`, not direct file writes
- ✅ Profile names are keys in a database, not filesystem paths
- ✅ No direct `fs.writeFile()` with user-supplied filenames

**Confidence:** High — settings are properly abstracted away from file I/O.

---

## F-t4-path-trav-6: Memory Search Query Input — Path-Agnostic (Grep Argument) ✅
**Severity:** N/A (Out of Scope for Path Traversal)  
**Category:** Positive Finding  
**Location:** `src/main/handlers/memory-search.ts:25-35`  
**Evidence:**
```typescript
async function searchMemory(query: string): Promise<MemorySearchResult[]> {
  if (!query.trim()) {
    return []
  }
  
  try {
    const { stdout } = await execFileAsync('grep', ['-rni', '--', query, '.'], {
      cwd: BDE_MEMORY_DIR,
      encoding: 'utf-8',
      maxBuffer: 5 * 1024 * 1024
    })
    // ...
  }
}
```

**Note:**
Memory search is **out of scope** for this lens (covered by lens-shell-inj per baseline). The `--` separator prevents grep from interpreting `query` as an option flag, and `grep` runs with `cwd: BDE_MEMORY_DIR`, so output filenames are relative to that directory. Path traversal auditing would be handled under shell injection lens.

---

## Summary Table

| ID | Title | Severity | Status | Effort |
|---|---|---|---|---|
| F-t4-path-trav-1 | Playground Path Traversal — Directory Name Collision | Critical | Open | S |
| F-t4-path-trav-2 | cloneRepo Destination Directory Path Acceptance | Medium | Open | M |
| F-t4-path-trav-3 | IDE File Operations Containment | N/A | ✅ Compliant | N/A |
| F-t4-path-trav-4 | Memory File Path Validation | N/A | ✅ Compliant | N/A |
| F-t4-path-trav-5 | Settings Storage Abstraction | N/A | ✅ Compliant | N/A |
| F-t4-path-trav-6 | Memory Search Query Handling | N/A | ✅ Out of Scope | N/A |

---

## Remediation Priority

1. **IMMEDIATE:** F-t4-path-trav-1 (playground path) — Critical, trivial fix, high exploitability
2. **SOON:** F-t4-path-trav-2 (cloneRepo) — Medium risk, requires validation layer, affects user home directory writes

---

## Methodology Notes

- Examined all file I/O handlers in `/src/main/handlers/`
- Reviewed worktree and agent path construction patterns
- Tested `startsWith()` path containment logic locally to confirm bypass conditions
- Cross-referenced positive findings against test coverage (esp. `fs.test.ts`)
- Verified that IPC handlers correctly delegate to validation functions
