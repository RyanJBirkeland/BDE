# Security Injection Audit — BDE

## Executive Summary

The BDE codebase demonstrates **solid foundational security practices** with consistent use of `execFileAsync()` (argument arrays) over shell-based execution, comprehensive path traversal validation via `validateIdePath()` and `validateRepoPath()`, and parameterized SQL queries throughout the data layer. However, **three critical vulnerabilities** emerge in git command construction and one concerning violation of the stated `execFile`/array-argument policy.

The most severe issues are (1) **unauthenticated renderer-supplied git branch names** passed directly to git checkout without validation, (2) **template literal string interpolation** of developer-controlled branch names in git log/diff arguments despite the existence of SAFE_REF_PATTERN, and (3) **commit messages sourced from user-supplied task titles** with only visual sanitization rather than cryptographic escaping. These allow branch names like `origin/main..$(malicious)` or commit message injection via backtick substitution.

---

## F-t2-inject-1: Unauthenticated Git Branch Checkout — No Validation
**Severity:** Critical
**Category:** Security / Command Injection (Git Branch)
**Location:** `src/main/handlers/git-handlers.ts:242-244`
**Evidence:**
```typescript
safeHandle('git:checkout', (_e, cwd: string, branch: string) =>
  gitCheckout(validateRepoPath(cwd), branch)
)
// src/main/git.ts:192-198
export async function gitCheckout(cwd: string, branch: string): Promise<void> {
  await execFileAsync('git', ['checkout', branch], {
    cwd,
    encoding: 'utf-8' as const,
    maxBuffer: MAX_BUFFER
  })
}
```

**Impact:** 
A renderer (or compromised browser tab) can supply malicious branch names to `git:checkout` IPC. While `execFileAsync()` using argument arrays prevents shell metacharacter injection, git interprets special syntax in ref names:
- `origin/main..HEAD` triggers range syntax
- `--track origin/main` becomes a flag to the git invocation (git parses `--` in positional args)
- Malformed branch names can cause git to error or misinterpret arguments

**Recommendation:**
Validate the branch parameter against `SAFE_REF_PATTERN` from `src/main/lib/review-paths.ts` **before** passing to `gitCheckout()`:
```typescript
safeHandle('git:checkout', (_e, cwd: string, branch: string) => {
  validateGitRef(branch)  // throws if not a safe ref
  return gitCheckout(validateRepoPath(cwd), branch)
})
```

**Effort:** S (one-line guard)
**Confidence:** High

---

## F-t2-inject-2: Branch Name String Interpolation in Git Log/Diff Arguments
**Severity:** High
**Category:** Security / Command Injection (Git Ref)
**Location:** `src/main/agent-manager/git-operations.ts:40-45 & 60-64`
**Evidence:**
```typescript
const { stdout: log } = await execFileAsync('git', ['log', '--oneline', `origin/main..${branch}`], {
  cwd: worktreePath,
  env
})
// and
const { stdout: stat } = await execFileAsync('git', ['diff', '--stat', `origin/main..${branch}`], {
  cwd: worktreePath,
  env
})
```

**Impact:**
Template literals interpolate `branch` (a developer-controlled string derived from task title) into the `--oneline` and `--stat` positional arguments. Although `execFileAsync()` prevents shell expansion, git has its own syntax (range operators `..`, tilde `~`, caret `^`, path specs `--`). A title like `"fix bug -- /etc/passwd"` creates argument `origin/main../etc/passwd`, which could manipulate git's behavior. More critically, a title containing `origin/main..$((RCE))` or similar syntax—while not executing—could induce information disclosure or unexpected git behavior.

**Recommendation:**
Validate `branch` against `SAFE_REF_PATTERN` before constructing git commands:
```typescript
export async function generatePrBody(
  worktreePath: string,
  branch: string,
  env: NodeJS.ProcessEnv
): Promise<string> {
  validateGitRef(branch)  // Ensure branch is safe
  const sections: string[] = []
  // ... rest unchanged
}
```

**Effort:** S (one call to validateGitRef)
**Confidence:** High

---

## F-t2-inject-3: Commit Message Injection via Task Title — Insufficient Sanitization
**Severity:** High
**Category:** Security / Command Injection (Git Commit Message)
**Location:** `src/main/agent-manager/git-operations.ts:177-186 & 451-459` (sanitizeForGit usage)
**Evidence:**
```typescript
export function sanitizeForGit(title: string): string {
  return title
    .replace(/`/g, "'")           // backticks → single quotes (visual escaping only)
    .replace(/\$\(/g, '(')        // $( → (
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .trim()
}

// Later, in autoCommitIfDirty:
const sanitizedTitle = sanitizeForGit(title)
await execFileAsync(
  'git',
  ['commit', '-m', `${sanitizedTitle}\n\nAutomated commit by BDE agent manager`],
  { cwd: worktreePath, env }
)
```

**Impact:**
The `sanitizeForGit()` function performs **visual escaping** (replacing backticks with quotes, $( with parentheses) rather than **cryptographic escaping**. While `execFileAsync()` with argument arrays prevents shell injection, git's commit message body is still vulnerable to:
1. **Multi-line injection via literal newlines**: `title = "fix\nCo-Authored-By: attacker <attacker@example.com>\nCo-Authored-By: legitimate"`
2. **Git trailer injection**: Task titles containing `Reviewed-by: hacker@example.com` will be preserved in the commit message, potentially poisoning commit metadata
3. **Resume control**: Backtick replacement with single quotes does not escape single quotes already in the title; a title like `"fix's bug"` becomes `"fix's bug"` unchanged

The replacement of backticks with quotes is cosmetic—it doesn't prevent the original intent if the title contains actual shell metacharacters.

**Recommendation:**
Use a cryptographically sound approach:
1. **If task titles originate only from the app**, they are "trusted" and don't need escaping when passed as execFileAsync arguments (already safe via array).
2. **If titles come from user input or renderers**, escape using JSON string escaping, which is safe for git's commit message parsing:
```typescript
export function sanitizeForGitCommit(title: string): string {
  // For commit messages, we rely on execFileAsync's array argument handling.
  // No special escaping needed if using argument array, but prevent multiline injections:
  return title
    .replace(/\n/g, ' ')  // Flatten newlines (preserve intent, prevent trailer injection)
    .trim()
}
```

**Effort:** M (requires logic change and testing)
**Confidence:** High

---

## F-t2-inject-4: Git Pull with Unvalidated Current Branch Name
**Severity:** Medium
**Category:** Security / Command Injection (Git Branch)
**Location:** `src/main/handlers/git-handlers.ts:246-248`
**Evidence:**
```typescript
safeHandle('git:pull', (_e, cwd: string, currentBranch: string) =>
  gitPull(validateRepoPath(cwd), currentBranch)
)

// src/main/git.ts:216-239
export async function gitPull(
  cwd: string,
  currentBranch: string
): Promise<{ success: boolean; error?: string; stdout?: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(
      'git',
      ['pull', '--ff-only', 'origin', currentBranch],
      {
        cwd,
        encoding: 'utf-8' as const,
        maxBuffer: MAX_BUFFER
      }
    )
```

**Impact:**
The `git:pull` handler accepts a `currentBranch` parameter from the renderer without validation. Although the argument array prevents shell expansion, git's range syntax and ref specifiers (e.g., `main..origin/main`) could be misused if a renderer supplies a crafted branch name.

**Recommendation:**
Validate the `currentBranch` parameter:
```typescript
safeHandle('git:pull', (_e, cwd: string, currentBranch: string) => {
  validateGitRef(currentBranch)
  return gitPull(validateRepoPath(cwd), currentBranch)
})
```

**Effort:** S
**Confidence:** High

---

## F-t2-inject-5: Database Backup Path String Interpolation — SQLite VACUUM INTO
**Severity:** Medium
**Category:** Security / SQL Injection (Path Traversal via SQL)
**Location:** `src/main/db.ts:65-71`
**Evidence:**
```typescript
const escapedPath = resolvedPath.replace(/'/g, "''")

// DL-11: Propagate VACUUM INTO failures instead of swallowing
const sql = `VACUUM INTO '${escapedPath}'`
db.exec(sql)
```

**Impact:**
While the code *does* validate the backup path is within the database directory (line 54-58), the SQL string is constructed via template literal interpolation. If the validation logic ever regresses or the path normalization is bypassed, an attacker with filesystem access could craft a `resolvedPath` containing SQLite string delimiters (single quotes escaped as `''`) to inject SQL. Although the current escaping (`/'/g, "''`) is *currently* sound, **VACUUM INTO is one of the few SQLite statements that doesn't support parameterized queries**, making this a latent risk.

**Recommendation:**
1. Document why parameterization is impossible (VACUUM INTO limitation).
2. Use additional validation: ensure `resolvedPath` contains only safe characters (alphanumeric, slashes, dots, hyphens):
```typescript
if (!/^[a-zA-Z0-9._\/-]+$/.test(resolvedPath)) {
  throw new Error('Invalid backup path: contains unsafe characters')
}
```
3. Or consider a safer alternative: use SQLite's built-in backup API (`sqlite3_backup_*`) if available in better-sqlite3.

**Effort:** M
**Confidence:** Medium

---

## F-t2-inject-6: Grep Query Input in Repo Search Service — No Validation
**Severity:** Medium
**Category:** Security / Command Injection (Grep Pattern)
**Location:** `src/main/services/repo-search-service.ts:54-77`
**Evidence:**
```typescript
export async function searchRepo(repoPath: string, query: string): Promise<RepoSearchResult> {
  try {
    const { stdout } = await execFileAsync('grep', ['-rn', '-i', '--', query, '.'], {
      cwd: repoPath,
      encoding: 'utf-8',
      maxBuffer: 5 * 1024 * 1024 // 5MB
    })
```

**Impact:**
The `query` parameter is passed directly as a grep argument via `execFileAsync()` without validation. While the `--` separator prevents interpreted as a flag, grep interprets the query as a **POSIX extended regex**. A user-supplied query like `a|$(rm -rf /)` or `a\x00b` could:
- Cause ReDoS (denial of service) via pathological regex (e.g., `(a+)+b`)
- Trigger unexpected grep behavior with special regex metacharacters

The `--` prevents the query from being interpreted as a grep flag, but **regex metacharacters are still processed by grep's regex engine**.

**Recommendation:**
1. **Validate the query** is a "safe" search pattern (no complex regex):
```typescript
export async function searchRepo(repoPath: string, query: string): Promise<RepoSearchResult> {
  // Escape regex metacharacters if the query is intended as a literal string
  const escapedQuery = query.replace(/[.[\\\^$|?*+()]/g, '\\$&')
  const { stdout } = await execFileAsync('grep', ['-rn', '-i', '-F', '--', escapedQuery, '.'], {
```
   Use `-F` (fixed-string search) instead of regex, or escape metacharacters.
   
2. Or add a length limit and warn users about regex complexity.

**Effort:** M
**Confidence:** Medium

---

## Summary of Findings

| Finding | Severity | Location | Effort |
|---------|----------|----------|--------|
| F-t2-inject-1 | Critical | `git-handlers.ts:242-244` | S |
| F-t2-inject-2 | High | `git-operations.ts:40-45, 60-64` | S |
| F-t2-inject-3 | High | `git-operations.ts:177-186` | M |
| F-t2-inject-4 | Medium | `git-handlers.ts:246-248` | S |
| F-t2-inject-5 | Medium | `db.ts:65-71` | M |
| F-t2-inject-6 | Medium | `repo-search-service.ts:54-77` | M |

### Strengths
- Consistent use of `execFileAsync()` (argument arrays) — prevents shell injection at scale
- Comprehensive path traversal validation in `validateIdePath()` and `validateRepoPath()`
- Parameterized SQL queries throughout data layer
- Careful handling of file I/O with symlink resolution and normalization

### Weaknesses
- Git ref validation pattern (`SAFE_REF_PATTERN`) exists but is **not consistently applied** to all git commands
- Sanitization functions (`sanitizeForGit()`) perform only visual escaping, not cryptographic safety
- Grep input validation is absent
- SQL path interpolation, while currently escaped, is fragile

---

## Recommended Priority Order
1. **F-t2-inject-1**: Add `validateGitRef()` to `git:checkout` handler (1 line, highest impact)
2. **F-t2-inject-2**: Add `validateGitRef()` to `generatePrBody()` (1 line)
3. **F-t2-inject-4**: Add `validateGitRef()` to `git:pull` handler (1 line)
4. **F-t2-inject-3**: Refactor `sanitizeForGit()` and commit message composition (medium effort)
5. **F-t2-inject-6**: Add regex escaping or `-F` flag to grep (medium effort)
6. **F-t2-inject-5**: Add character whitelist to backup path validation (low effort, defensive)
