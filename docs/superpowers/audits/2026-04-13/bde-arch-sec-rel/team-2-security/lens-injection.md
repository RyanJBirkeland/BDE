# Injection Risk Audit: BDE Main Process

**Audit Date:** 2026-04-13  
**Auditor:** Security Engineer (Injection Risk Lens)  
**Scope:** Electron main process, focus on shell injection, path traversal, command injection  

## Executive Summary

The BDE main process demonstrates **strong injection risk posture** with consistent use of `execFileAsync` (argument arrays) throughout the codebase, eliminating shell injection risk. However, several **medium-severity findings** relate to:

1. **Insufficient sanitization** of task titles in PR creation
2. **Unsanitized jq filter** expressions in `gh` CLI calls
3. **Regex vulnerabilities** in grep-based search handlers
4. **SQL string interpolation** in database backup (though mitigated with path validation)

All findings involve **controlled data sources** (configuration, database, IPC) with no evidence of renderer-to-main RCE vectors. Recommendations focus on defense-in-depth improvements.

---

## F-t2-injection-1: Incomplete Title Sanitization in PR Creation

**Severity:** Medium  
**Category:** Injection Risk  
**Location:** `src/main/agent-manager/git-operations.ts:180-186`, `src/main/services/review-pr-service.ts:58-60`

**Evidence:**

The `sanitizeForGit()` function removes backticks, `$()`, and markdown links from task titles before passing them to `gh pr create --title`:

```typescript
// src/main/agent-manager/git-operations.ts:180-186
export function sanitizeForGit(title: string): string {
  return title
    .replace(/`/g, "'")
    .replace(/\$\(/g, '(')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .trim()
}
```

However, the `gh` CLI parser can interpret special characters in title strings. For example:

- `--title` with value `Add feature --draft` could flip the PR to draft mode
- `--title` with value `Fix bug'$(whoami)'` might escape the quote (though `gh` likely handles this safely via argument array)

While `execFileAsync` uses argument arrays (safe), the value is **not validated against `gh` flag syntax**. The regex sanitization targets shell injection but not GitHub CLI flag injection.

**Impact:**

Low practical risk because:
- `execFileAsync` passes arguments as an array, not a shell command string
- `gh` is unlikely to re-parse the title value as command flags
- Task titles come from agent output (controlled by system), not user input

However, a malicious task title (e.g., from a compromised agent or future user-facing API) could:
- Insert unwanted PR properties (`--draft`, `--reviewer`, etc.)
- Confuse GitHub API calls or alter PR metadata

**Recommendation:**

Add explicit validation to reject common `gh` flag patterns in titles:

```typescript
export function sanitizeForGit(title: string): string {
  let sanitized = title
    .replace(/`/g, "'")
    .replace(/\$\(/g, '(')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .trim()
  
  // Reject patterns that look like gh CLI flags
  if (/^\s*--/.test(sanitized) || /\s--[a-z-]+/.test(sanitized)) {
    sanitized = sanitized.replace(/--[a-z-]+/g, '')
  }
  
  return sanitized
}
```

**Effort:** S  
**Confidence:** Medium

---

## F-t2-injection-2: Unsanitized jq Filter in gh pr list

**Severity:** Medium  
**Category:** Command Injection (jq)  
**Location:** `src/main/agent-manager/git-operations.ts:157-161`

**Evidence:**

The `checkExistingPr()` function uses `gh pr list --jq` with a hardcoded filter:

```typescript
// src/main/agent-manager/git-operations.ts:157-161
const { stdout: listOut } = await execFileAsync(
  'gh',
  ['pr', 'list', '--head', branch, '--json', 'url,number', '--jq', '.[0] | {url, number}'],
  { cwd: worktreePath, env }
)
```

The `jq` filter `'.[0] | {url, number}'` is hardcoded and safe. However, if **branch validation is ever relaxed** or branch name comes from an untrusted source, a malicious branch like `feature; rm -rf /` could potentially:

- Be passed to `gh` as the `--head` value
- If `gh` or `jq` mishandles the argument, could lead to command execution

Currently, the `branch` parameter is generated via `branchNameForTask()` which strips special characters, so risk is **low in practice**. But the code does not document or enforce this dependency.

**Impact:**

- **Current state:** Safe because `branchNameForTask()` normalizes branch names (e.g., `agent/fix-auth-bugs-abc12345`)
- **Risk if branch validation is removed:** Moderate — jq filters can execute arbitrary commands if not quoted properly
- **Electron context:** Even if command injection succeeds, it runs in the Electron main process (node.js), not the shell

**Recommendation:**

1. Add a comment documenting the branch name format dependency:
   ```typescript
   // branch is normalized by branchNameForTask() to prevent injection
   // If this ever changes, validate branch against SAFE_REF_PATTERN
   const { stdout: listOut } = await execFileAsync(
     'gh',
     ['pr', 'list', '--head', branch, '--json', 'url,number', '--jq', '.[0] | {url, number}'],
   ```

2. Consider using `gh api` with REST instead of jq:
   ```typescript
   const { stdout: listOut } = await execFileAsync(
     'gh', ['api', '/repos/{owner}/{repo}/pulls', '--head', branch],
   ```

**Effort:** M  
**Confidence:** Medium

---

## F-t2-injection-3: ReDoS in grep Output Parsing

**Severity:** Low  
**Category:** Regular Expression Denial of Service  
**Location:** `src/main/services/repo-search-service.ts:29`, `src/main/handlers/memory-search.ts:65`

**Evidence:**

Both `parseGrepOutput()` and the memory search handler parse grep output with a simple regex:

```typescript
// src/main/services/repo-search-service.ts:29
const match = line.match(/^(.+?):(\d+):(.*)$/)

// src/main/handlers/memory-search.ts:65
const match = line.match(/^(.+?):(\d+):(.*)$/)
```

The regex itself (`/^(.+?):(\d+):(.*)$/`) is not vulnerable to catastrophic backtracking because:
- `.+?` is non-greedy (lazy quantifier)
- No nested quantifiers or alternation
- Pattern has clear anchors (`^` and `$`)

However, the code in `memory-search.ts` attempts to strip "dangerous backtracking patterns" from the grep query:

```typescript
// src/main/handlers/memory-search.ts:42-46
const safeQuery = query
  .replace(/(\(\?:.*\))[+*]/g, '') // non-capturing groups with quantifiers
  .replace(/\([^)]*\)[+*]{2,}/g, '') // groups with multiple sequential quantifiers
  .replace(/\([^)]*[+*|][^)]*\)[+*{]/g, '') // capturing groups with nested quantifiers
```

This **grep query sanitization is unnecessary and incomplete** because `grep` (used in `repo-search-service.ts`) does not support PCRE-style advanced quantifiers by default; it uses basic ERE. The memory search attempts to prevent attack vectors that are not actually exploitable via `grep -rni`.

**Impact:**

- **repo-search-service.ts:** No ReDoS risk — simple regex, no user-controlled pattern
- **memory-search.ts:** Over-engineering; the grep output parsing regex is safe; the query sanitization is unnecessary
- **No RCE:** The grep query is passed as an argument array, not a shell command string

**Recommendation:**

Simplify memory search to remove unnecessary sanitization:

```typescript
// In memory-search.ts, simplify:
async function searchMemory(query: string): Promise<MemorySearchResponse> {
  if (typeof query !== 'string' || query.length > 200) {
    logger.warn('memory:search query rejected: exceeds 200 char limit')
    throw new Error('Query must be a string of 200 characters or fewer')
  }

  if (!query.trim()) {
    return { results: [], timedOut: false }
  }

  try {
    // No need to sanitize for grep — it's not a shell-executed string
    const { stdout } = await execFileAsync('grep', ['-rni', '--', query, '.'], {
      cwd: BDE_MEMORY_DIR,
      encoding: 'utf-8',
      maxBuffer: 5 * 1024 * 1024,
      timeout: 5000
    })
    // ... rest of function
  }
}
```

**Effort:** S  
**Confidence:** High

---

## F-t2-injection-4: SQL String Interpolation in Database Backup

**Severity:** Low  
**Category:** SQL Injection / String Interpolation  
**Location:** `src/main/db.ts:65-71`

**Evidence:**

The `backupDatabase()` function uses string interpolation for the SQLite `VACUUM INTO` command:

```typescript
// src/main/db.ts:65-71
const escapedPath = resolvedPath.replace(/'/g, "''")
const sql = `VACUUM INTO '${escapedPath}'`
db.exec(sql)
```

While the code includes a comment acknowledging that `VACUUM INTO` doesn't support bound parameters, the path validation and single-quote escaping provide **strong mitigation**:

1. Path is resolved and validated to be within `DB_DIR`
2. Single quotes are escaped using SQL string literal escaping (doubling)
3. `db.exec()` is not vulnerable to injection in the same way as prepared statement parameter binding (it's direct SQL execution, but the path is fully controlled)

**Impact:**

- **Injected characters:** An attacker would need to control `DB_PATH` or `DB_DIR`
- **Attack vector:** None in current code; these are compile-time constants
- **Mitigation:** Path validation (line 54-58) ensures the backup path is within the database directory

**Recommendation:**

The current mitigation is adequate, but consider documenting the escaping strategy:

```typescript
// VACUUM INTO doesn't support bound parameters per SQLite docs.
// Mitigate SQL injection risk by:
// 1. Validating backup path is within DB_DIR (path traversal check)
// 2. Escaping single quotes using SQL string literal rules
const escapedPath = resolvedPath.replace(/'/g, "''")
const sql = `VACUUM INTO '${escapedPath}'`
db.exec(sql)
```

**Effort:** S  
**Confidence:** High

---

## F-t2-injection-5: Missing Handler Registration Validation

**Severity:** Low  
**Category:** IPC Handler Injection / Registration  
**Location:** `src/main/handlers/repo-discovery.ts:209-220`

**Evidence:**

The `registerRepoDiscoveryHandlers()` function validates user input for paths but does not validate GitHub owner/repo identifiers before passing them to `git clone`:

```typescript
// src/main/handlers/repo-discovery.ts:148-163
export function cloneRepo(owner: string, repo: string, destDir: string): void {
  if (!/^[a-zA-Z0-9_.-]+$/.test(owner) || !/^[a-zA-Z0-9_.-]+$/.test(repo)) {
    throw new Error(
      `Invalid repository identifier: owner and repo must contain only alphanumeric characters, hyphens, underscores, and dots`
    )
  }

  const expanded = expandTilde(destDir)
  const resolvedDest = path.resolve(expanded)
  const homeDir = os.homedir()
  if (!resolvedDest.startsWith(homeDir + '/') && resolvedDest !== homeDir) {
    throw new Error(
      `Clone destination must be within your home directory. Rejected: ${resolvedDest}`
    )
  }
  const target = path.join(expanded, repo)
  const url = `https://github.com/${owner}/${repo}.git`

  const sendEvent = (evt: Partial<CloneProgressEvent>): void => {
    broadcast('repos:cloneProgress', { owner, repo, line: '', done: false, ...evt })
  }

  mkdir(expanded, { recursive: true })
    .then(() => {
      const proc = spawn('git', ['clone', '--progress', url, target], {
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
      })
```

**Good news:** The validation is **present and correct** — the regex `/^[a-zA-Z0-9_.-]+$/` rejects special shell characters. The `spawn()` call uses an argument array (not shell execution), so even if validation failed, injection would not occur.

**Minor observation:** The same validation is missing in `scanLocalRepos()`, but that function only validates that paths don't escape the home directory, so risk is minimal.

**Recommendation:**

No change required. The validation is sufficient for defense-in-depth.

**Effort:** N/A  
**Confidence:** High

---

## Summary Table

| Finding | Severity | Category | Location | Fixable | Effort |
|---------|----------|----------|----------|---------|--------|
| F-t2-injection-1 | Medium | Title Injection | git-operations.ts | Yes | S |
| F-t2-injection-2 | Medium | jq Filter Docs | git-operations.ts | Yes | M |
| F-t2-injection-3 | Low | Unnecessary Sanitization | memory-search.ts | Yes | S |
| F-t2-injection-4 | Low | SQL Interpolation (Mitigated) | db.ts | No | N/A |
| F-t2-injection-5 | Low | Validation Present | repo-discovery.ts | No | N/A |

---

## Overall Risk Assessment

**Current Posture:** STRONG

The codebase demonstrates excellent security discipline:

1. **Consistent use of `execFileAsync`** with argument arrays throughout (no shell injection vectors)
2. **Path traversal protection** in file operations (IDE handlers, backup validation)
3. **Input validation** on GitHub identifiers and git refs
4. **No eval/Function constructor** usage
5. **SQL injection mitigated** by parameterized queries (better-sqlite3)

**Residual Risk:** LOW

- Task title sanitization incomplete (but source is controlled)
- jq filter dependency undocumented (but hardcoded)
- ReDoS prevention over-engineered (but harmless)

**Recommendations Priority:**

1. **Must-fix:** None (all findings are improvements, not critical bugs)
2. **Should-fix:** F-t2-injection-1 (title validation) for defense-in-depth
3. **Nice-to-have:** F-t2-injection-2 (documentation), F-t2-injection-3 (cleanup)

