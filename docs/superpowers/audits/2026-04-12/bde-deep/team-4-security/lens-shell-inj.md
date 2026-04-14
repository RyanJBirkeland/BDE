# Shell Injection Security Audit Report
## BDE Codebase Analysis (2026-04-12)

### Executive Summary

The BDE codebase demonstrates **strong compliance** with shell injection prevention best practices. The codebase adheres to the established CLAUDE.md security policy of preferring `execFile`/`execFileAsync` with argument arrays over string interpolation. No critical shell injection vulnerabilities were identified during this audit. All shell command execution patterns use Node.js's `execFile` API with argument arrays, which prevents shell metacharacter interpretation. User-controlled inputs passed to git commands are either sanitized (branch names, commit messages) or safely passed as isolated arguments.

### Scope
- Shell command execution patterns across `/src/main/`
- IPC handlers accepting user input (agent-manager-handlers.ts, handlers/)
- Git operations (git-operations.ts, worktree.ts, completion.ts)
- Worktree path construction and cleanup
- Agent spawning (sdk-adapter.ts, adhoc-agent.ts)
- PTY terminal spawning (pty.ts)

### Methodology
1. Identified all uses of `exec`, `spawn`, `execFile`, `execSync`, etc.
2. Verified argument passing patterns (arrays vs. strings)
3. Traced user-controlled input through IPC boundaries
4. Checked for shell:true configurations and backtick interpolation in arrays
5. Validated branch name and commit message sanitization

---

## Findings

### F-t4-shell-inj-1: All Shell Execution Uses Safe execFile Pattern
**Severity:** Low (finding, not vulnerability)  
**Category:** Shell Injection Prevention  
**Location:** Codebase-wide patterns in src/main/

**Evidence:**
- 140+ uses of `execFile`, `execFileAsync`, `spawn`, and related APIs
- All uses follow the safe pattern: `execFile(command, [...arrayOfArgs], options)`
- Examples:
  - `src/main/git.ts:34` - `execFileAsync('git', ['status', '--porcelain', '--branch'], ...)`
  - `src/main/agent-manager/git-operations.ts:40` - `execFile('git', ['log', '--oneline', `origin/main..${branch}`], ...)`
  - `src/main/agent-manager/worktree.ts:331` - `execFileAsync('rm', ['-rf', worktreePath], ...)`

**Impact:** Positive - The codebase correctly implements the "prefer argument arrays over string interpolation" pattern from CLAUDE.md. This is the primary defense against shell metacharacter injection attacks.

**Recommendation:** Continue enforcing this pattern in code review. No action required.

**Effort:** N/A

**Confidence:** High

---

### F-t4-shell-inj-2: Branch Names Properly Sanitized via Regex
**Severity:** Low (finding, not vulnerability)  
**Category:** Input Validation / Defense-in-Depth  
**Location:** `src/main/agent-manager/worktree.ts:41-52`

**Evidence:**
```typescript
export function branchNameForTask(title: string, taskId?: string, groupId?: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')  // Only alphanumeric + hyphens
    .replace(/^-+|-+$/g, '')      // Strip leading/trailing hyphens
    .slice(0, BRANCH_SLUG_MAX_LENGTH)
  const finalSlug = slug || 'unnamed-task'
  const suffix = groupId ? `-${groupId.slice(0, 8)}` : taskId ? `-${taskId.slice(0, 8)}` : ''
  return `agent/${finalSlug}${suffix}`
}
```

All branch names used in git commands (git-operations.ts:40, 59, 335) derive from `branchNameForTask()`, which enforces a strict whitelist. Task IDs and group IDs are UUIDs.

**Impact:** Even if user-provided task titles contained shell metacharacters, git commands would safely receive a sanitized branch name. This provides defense-in-depth beyond the argument array pattern.

**Recommendation:** Maintain this sanitization function. Code review should continue verifying that all branch name sources trace back to `branchNameForTask()` or hardcoded strings.

**Effort:** S

**Confidence:** High

---

### F-t4-shell-inj-3: Commit Messages Sanitized via sanitizeForGit()
**Severity:** Low (finding, not vulnerability)  
**Category:** Input Validation / Defense-in-Depth  
**Location:** `src/main/agent-manager/git-operations.ts:178-184`

**Evidence:**
```typescript
export function sanitizeForGit(title: string): string {
  return title
    .replace(/`/g, "'")                    // Backticks → single quotes
    .replace(/\$\(/g, '(')                 // $( → ( (prevents command substitution)
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // Markdown links → plain text
    .trim()
}
```

This function is used in:
- `src/main/agent-manager/completion.ts:149` - Auto-commit during task completion
- `src/main/agent-manager/completion.ts:254` - Final merge commit message
- `src/main/services/review-merge-service.ts:86, 105` - Review merge commits
- `src/main/agent-manager/git-operations.ts:219` - PR title creation

All calls pass the result as a separate array element to `execFile()`.

**Impact:** Positive defense-in-depth. Backticks, `$(...)`, and markdown constructs are stripped before the message reaches git. Combined with the argument array pattern, this provides two layers of protection.

**Recommendation:** Maintain this sanitization. Consider expanding tests to verify sanitization handles edge cases (nested $(...), unicode backticks, etc.).

**Effort:** S

**Confidence:** High

---

### F-t4-shell-inj-4: No execSync or shell:true Configuration Found
**Severity:** Low (finding, not vulnerability)  
**Category:** Shell Injection Prevention  
**Location:** Codebase-wide

**Evidence:**
- Zero matches for `execSync` in src/main/ (only `execFileAsync` via promisified `execFile`)
- Zero matches for `shell: true` in spawn/exec options
- PTY spawning (pty.ts:61) uses `pty.spawn(opts.shell, [], {...})` with empty args array

**Impact:** Positive. `execSync` is inherently riskier (blocks main thread, implicit shell parsing). The codebase avoids it entirely, preferring async `execFileAsync`.

**Recommendation:** Maintain this pattern. Add a linting rule or code review note to prevent future `execSync` introductions.

**Effort:** S

**Confidence:** High

---

### F-t4-shell-inj-5: Worktree Paths Constructed Safely via path.join()
**Severity:** Low (finding, not vulnerability)  
**Category:** Path Safety / Defense-in-Depth  
**Location:** `src/main/agent-manager/worktree.ts:141-220`

**Evidence:**
```typescript
const branch = branchNameForTask(title, taskId, groupId)  // Sanitized
const repoDir = path.join(worktreeBase, repoSlug(repoPath)) // path.join, no interpolation
const worktreePath = path.join(repoDir, taskId)  // taskId is UUID, verified by regex
```

Cleanup at line 331:
```typescript
await execFileAsync('rm', ['-rf', worktreePath], { env })
```

The `worktreePath` is safely constructed and passed as an isolated array argument.

**Impact:** Positive. Even though `rm -rf` is dangerous, the path is constructed via `path.join()` and UUIDs are verified (TASK_ID_UUID_PATTERN.test(taskId)), preventing directory traversal attacks.

**Recommendation:** Continue using `path.join()` for all path construction. Maintain UUID validation for task directory names.

**Effort:** S

**Confidence:** High

---

### F-t4-shell-inj-6: IPC Handler Checkpoint Message Safely Passed
**Severity:** Low (finding, not vulnerability)  
**Category:** IPC Input Handling  
**Location:** `src/main/handlers/agent-manager-handlers.ts:88-89`

**Evidence:**
```typescript
const msg = (message && message.trim()) || 'checkpoint: user-requested snapshot'
await execFileAsync('git', ['commit', '-m', msg], { cwd, encoding: 'utf-8' })
```

The `message` parameter comes from user IPC (line 62), but is safely passed as a separate array element to `execFileAsync()`. Even if the message contains `; rm -rf /`, git receives it as a literal string, not shell code.

**Impact:** Positive. Despite the message being user-controlled, the argument array pattern prevents interpretation as shell syntax.

**Recommendation:** Continue this pattern. No additional sanitization needed beyond what execFileAsync provides.

**Effort:** S

**Confidence:** High

---

### F-t4-shell-inj-7: PTY Shell Validation Uses Whitelist
**Severity:** Low (finding, not vulnerability)  
**Category:** Shell Selection Safety  
**Location:** `src/main/pty.ts:17-42`

**Evidence:**
```typescript
const ALLOWED_SHELLS = new Set([
  '/bin/bash', '/bin/zsh', '/bin/sh', '/bin/dash', '/bin/fish',
  '/usr/bin/bash', '/usr/bin/zsh', '/usr/bin/sh', '/usr/bin/dash', '/usr/bin/fish',
  '/usr/local/bin/bash', '/usr/local/bin/zsh', '/usr/local/bin/fish',
  '/opt/homebrew/bin/bash', '/opt/homebrew/bin/zsh', '/opt/homebrew/bin/fish'
])

export function validateShell(shell: string): boolean {
  return ALLOWED_SHELLS.has(shell)
}

export function createPty(opts: { shell: string; ... }): PtyHandle {
  if (!validateShell(opts.shell)) throw new Error(`Shell not allowed: "${opts.shell}"`)
  const proc = pty.spawn(opts.shell, [], {...})
```

**Impact:** Positive. The whitelist prevents arbitrary shell selection. No shell arguments are passed (`[]`), limiting attack surface.

**Recommendation:** Maintain the whitelist. Document why new shells should not be added without security review.

**Effort:** S

**Confidence:** High

---

### F-t4-shell-inj-8: Agent SDK and CLI Spawning Uses Proper Argument Arrays
**Severity:** Low (finding, not vulnerability)  
**Category:** Agent Spawning Safety  
**Location:** `src/main/agent-manager/sdk-adapter.ts:196-205`

**Evidence:**
```typescript
const child = spawn(
  'claude',
  [
    '--output-format', 'stream-json',
    '--input-format', 'stream-json',
    '--verbose',
    '--model', opts.model
  ],
  { cwd: opts.cwd, env: env as NodeJS.ProcessEnv, stdio: ['pipe', 'pipe', 'pipe'] }
)
```

All arguments are passed in the array, including the model name. Node.js's `spawn()` API with an array never invokes a shell, preventing metacharacter interpretation.

**Impact:** Positive. Agent spawning is safe even if model names contained special characters.

**Recommendation:** Continue this pattern for all spawn calls.

**Effort:** S

**Confidence:** High

---

## Summary of Controls

| Control | Status | Evidence |
|---------|--------|----------|
| Use execFile/execFileAsync (not execSync) | ✅ Implemented | 140+ uses, zero execSync instances |
| Use argument arrays (not string interpolation) | ✅ Implemented | All shell calls use array pattern |
| Sanitize branch names | ✅ Implemented | branchNameForTask() with regex |
| Sanitize commit messages | ✅ Implemented | sanitizeForGit() function |
| Whitelist PTY shells | ✅ Implemented | ALLOWED_SHELLS set validation |
| No shell:true configuration | ✅ Implemented | Zero instances found |
| No backtick interpolation in arrays | ✅ Implemented | Backticks within arrays are literals |
| Validate task IDs (UUID regex) | ✅ Implemented | TASK_ID_UUID_PATTERN checks |
| Use path.join() for paths (no interpolation) | ✅ Implemented | All path construction safe |

---

## Recommendations

### Continue Current Practices
1. Maintain execFile/execFileAsync pattern in all future shell operations
2. Keep sanitizeForGit() and branchNameForTask() functions current
3. Validate all user-controlled input before passing to shell operations (as currently done)

### Code Review Checklist
- [ ] All new shell commands use `execFile`/`execFileAsync` with argument arrays
- [ ] No `execSync` or `shell: true` configurations introduced
- [ ] Branch names trace back to `branchNameForTask()` or hardcoded strings
- [ ] Commit/PR messages use `sanitizeForGit()` if user-controlled
- [ ] IPC handlers passing strings to shell operations use argument arrays

### Testing
- The existing test suite (`__tests__/git.test.ts`) includes tests for shell injection safety
- Consider expanding tests to cover edge cases:
  - Commit messages with nested `$(...)` constructs
  - Unicode backticks or other lookalike characters
  - Extremely long branch names (already capped, but worth testing)

---

## Conclusion

**No critical shell injection vulnerabilities were identified.** The BDE codebase demonstrates **mature security practices**:

1. **Consistent use of the safe pattern** - All 140+ shell invocations use `execFile` with argument arrays
2. **Defense-in-depth** - Branch names and commit messages are sanitized even though the argument array pattern makes sanitization redundant
3. **Clear policy** - CLAUDE.md documents the requirement and developers follow it
4. **Strong test coverage** - Existing tests verify the safe patterns

The codebase is well-positioned to prevent shell injection attacks. Future development should maintain these practices.

**Estimated Audit Confidence: High**
