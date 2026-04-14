# Path Traversal Security Audit - BDE Main Process

## Summary

This audit examined path validation and traversal prevention across the Electron main process, focusing on file system operations, IPC handlers, and worktree management. The codebase demonstrates strong defensive practices in most areas—IDE file operations validate paths against a root directory, playground HTML detection includes proper symlink resolution, and worktree construction uses sanitized task IDs. However, several review-related IPC handlers lack validation of paths received from the renderer, creating a gap where database-sourced paths are used directly in git operations without verification. The playground path validation includes a correct trailing-slash check that prevents sibling directory bypass (as documented in a recent fix), but review operations do not enforce similar boundary checks.

## Findings

### F-t2-pathval-1: Unvalidated worktreePath in review:getDiff and review:getCommits Handlers
**Severity:** High
**Category:** Path Traversal
**Location:** `src/main/handlers/review.ts:48-55, 82-89`
**Evidence:** 
```typescript
// review:getDiff handler - line 48-55
safeHandle('review:getDiff', async (_e, payload) => {
  const { worktreePath, base } = payload
  // ISSUE: worktreePath is passed directly from IPC without validation
  const { stdout: numstatOut } = await execFileAsync(
    'git',
    ['diff', '--numstat', `${base}...HEAD`],
    { cwd: worktreePath, env }  // Used as cwd without validation
  )
})

// Identical issue in review:getCommits - line 82-89
safeHandle('review:getCommits', async (_e, payload) => {
  const { worktreePath, base } = payload
  const { stdout } = await execFileAsync(
    'git',
    ['log', `${base}..HEAD`, '--format=%H%x00%s%x00%an%x00%aI', '--reverse'],
    { cwd: worktreePath, env }  // Unvalidated cwd parameter
  )
})
```
**Impact:** An attacker who can manipulate the sprint_tasks table (e.g., via SQL injection, compromised database, or insider threat) could set a malicious worktree_path pointing to any directory. When a reviewer loads the code review page, git commands would execute in that arbitrary directory, potentially allowing information disclosure (reading .git history) or repo state manipulation. The execFile is safe from shell injection due to argument array format, but the working directory itself is a valid attack surface.
**Recommendation:** Validate worktreePath against a whitelist of known valid worktree directories (stored in memory by AgentManager or retrieved from git worktree list). Alternatively, require worktree_path to exist and contain a .git entry before using it.
**Effort:** M (requires adding a validation function and calling it in both handlers)
**Confidence:** High

### F-t2-pathval-2: Unvalidated filePath in review:getFileDiff Handler
**Severity:** High
**Category:** Path Traversal
**Location:** `src/main/handlers/review.ts:104-114`
**Evidence:**
```typescript
safeHandle('review:getFileDiff', async (_e, payload) => {
  const { worktreePath, filePath, base } = payload
  // ISSUE: filePath passed directly to git without validation
  const { stdout } = await execFileAsync('git', ['diff', `${base}...HEAD`, '--', filePath], {
    cwd: worktreePath,
    env,
    maxBuffer: 10 * 1024 * 1024
  })
  return { diff: stdout }
})
```
**Impact:** The filePath parameter is user-controlled via IPC (from the renderer). While git's `--` separator prevents interpretation of filePath as a flag, an attacker could pass `../../.git/config` or similar traversal paths. Git would then diff that file against the base, potentially leaking configuration secrets or internal git metadata. The danger is amplified if combined with a manipulated worktreePath pointing to a sensitive repository.
**Recommendation:** Validate that filePath does not contain `..` segments and is relative (not starting with `/`). Use path.resolve() to canonicalize the path and confirm it stays within the worktree boundary, similar to the playground path validation in run-agent.ts.
**Effort:** M
**Confidence:** High

### F-t2-pathval-3: Unvalidated base Reference in review:getDiff and review:getCommits Handlers
**Severity:** Medium
**Category:** Path Traversal / Git Argument Injection
**Location:** `src/main/handlers/review.ts:48-55, 82-89, 104-114`
**Evidence:**
```typescript
// Used in git diff command - line 54
['diff', '--numstat', `${base}...HEAD`]  // base is unsanitized

// Used in git log command - line 87
['log', `${base}..HEAD`, '--format=%H%x00%s%x00%an%x00%aI', '--reverse']

// Used in git diff command - line 107
['diff', `${base}...HEAD`, '--', filePath]
```
**Impact:** The `base` parameter (user-controlled via IPC) is interpolated directly into git ref specifications. While execFile's argument array format prevents shell injection, an attacker could pass values like `$(malicious)` or `<(command)` to git. Modern git versions should reject these safely, but the handler should validate that base is a valid git ref format (e.g., matches `^[a-zA-Z0-9/_.-]+$`). The default hardcoded value of `origin/main` suggests base is meant to be a ref name.
**Recommendation:** Validate base against a regex pattern for valid git ref names. Whitelist known values or enforce strict validation (alphanumerics, forward slashes, dots, hyphens only).
**Effort:** S
**Confidence:** Medium

### F-t2-pathval-4: Playground Path Validation Missing Validation Before join()
**Severity:** Low
**Category:** Path Traversal
**Location:** `src/main/agent-manager/run-agent.ts:97-98`
**Evidence:**
```typescript
export async function tryEmitPlaygroundEvent(
  taskId: string,
  filePath: string,
  worktreePath: string,
  logger: Logger
): Promise<void> {
  try {
    // Line 97-98: join() before validation
    const absolutePath = filePath.startsWith('/') ? filePath : join(worktreePath, filePath)
    
    // Validation happens AFTER join
    const { resolve } = await import('node:path')
    const resolvedPath = resolve(absolutePath)
    const resolvedWorktree = resolve(worktreePath)
    if (!resolvedPath.startsWith(resolvedWorktree + '/') && resolvedPath !== resolvedWorktree) {
      logger.warn(`[playground] Path traversal blocked: ${filePath}...`)
      return
    }
```
**Impact:** While the subsequent validation (with trailing slash fix) correctly blocks traversal, the logic accepts absolute paths starting with `/` without restriction (line 98). If filePath is an absolute path outside the worktree (e.g., `/etc/passwd`), it bypasses the join and goes directly to validation. The validation then correctly blocks it, so this is low-risk, but the design is slightly fragile.
**Recommendation:** Explicitly reject absolute paths at the entry point rather than accepting them and validating later. Add: `if (filePath.startsWith('/')) { logger.warn(...); return; }` before the join.
**Effort:** S
**Confidence:** Low

## Security Posture

**Strengths:**
- IDE file operations (fs: handlers) properly validate all paths against ideRootPath with symlink resolution
- Playground path validation correctly implements trailing-slash check to prevent sibling directory traversal (F-t1-sre-{n})
- Task IDs are generated as random hex blobs (not UUIDs with traversal-friendly characters), making worktree path construction safe
- Worktree base validation enforces home directory containment
- Spec file path validation prevents traversal

**Gaps:**
- Review operations trust paths from database without runtime validation
- No whitelist or existence check for worktree directories in review handlers
- File diff handler allows user-controlled filePath to flow directly into git commands

**Recommendations (Priority Order):**
1. Validate worktreePath in review handlers against a whitelist or existence check
2. Sanitize filePath in review:getFileDiff to block traversal segments
3. Validate base git ref parameter to match expected format
4. Reject absolute paths in playground event handler at entry point
5. Consider centralizing path validation logic into reusable utilities to reduce duplication

