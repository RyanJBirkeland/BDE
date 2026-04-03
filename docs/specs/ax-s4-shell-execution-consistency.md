# AX-S4: Shell Execution Consistency in local-agents.ts

**Epic:** Architecture & DX
**Priority:** P0 (Security)
**Size:** S (Small)
**Depends on:** None

---

## Problem

PR #105 fixed all `execSync` string interpolation in `src/main/git.ts` by replacing them with `execFileSync` array patterns. However, `src/main/local-agents.ts` still uses `execAsync` (promisified `exec`) with template literal interpolation:

**Line 53:**

```typescript
const { stdout } = await execAsync(`lsof -p ${pid} -a -d cwd -F n`)
```

While `pid` is typed as `number` and comes from `parseInt()` of `ps` output (making injection unlikely in practice), this pattern is inconsistent with the security standard established in PR #105 and violates defense-in-depth.

**Line 99:**

```typescript
const { stdout } = await execAsync('ps -eo pid,%cpu,rss,etime,args')
```

This one is safe (no interpolation, static command) but still uses `exec` which invokes a shell. `execFile` is preferred when no shell features are needed.

## Design

### Replace `exec` with `execFile` throughout

```typescript
import { execFile, spawn } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)
```

### Fix 1: `getProcessCwd` (line 53)

Before:

```typescript
const { stdout } = await execAsync(`lsof -p ${pid} -a -d cwd -F n`)
```

After:

```typescript
const { stdout } = await execFileAsync('lsof', ['-p', String(pid), '-a', '-d', 'cwd', '-F', 'n'])
```

### Fix 2: `getAgentProcesses` (line 99)

Before:

```typescript
const { stdout } = await execAsync('ps -eo pid,%cpu,rss,etime,args')
```

After:

```typescript
const { stdout } = await execFileAsync('ps', ['-eo', 'pid,%cpu,rss,etime,args'])
```

### Cleanup: Remove unused `exec` import

After both changes, `exec` is no longer needed. Update the import:

```diff
-import { exec, spawn } from 'child_process'
+import { execFile, spawn } from 'child_process'
```

```diff
-const execAsync = promisify(exec)
+const execFileAsync = promisify(execFile)
```

## Files to Change

| File                       | Line | Change                                             |
| -------------------------- | ---- | -------------------------------------------------- |
| `src/main/local-agents.ts` | 6    | Replace `exec` import with `execFile`              |
| `src/main/local-agents.ts` | 18   | `const execFileAsync = promisify(execFile)`        |
| `src/main/local-agents.ts` | 53   | Use `execFileAsync('lsof', [...])` with array args |
| `src/main/local-agents.ts` | 99   | Use `execFileAsync('ps', [...])` with array args   |

## Acceptance Criteria

- [ ] Zero `exec()` or `execAsync()` calls remain in `local-agents.ts`
- [ ] All shell commands use `execFile` / `execFileAsync` with argument arrays
- [ ] Grep `src/main/` for `execAsync\(` and `execSync\(` with template literals returns zero hits
- [ ] `getAgentProcesses()` still returns correct process list (manual verification)
- [ ] `getProcessCwd()` still resolves CWDs correctly via `lsof`
- [ ] `npm run build` passes

## Verification

After implementation, run a project-wide audit:

```bash
# Should return zero results
grep -rn 'execSync\s*(' src/main/ | grep -v 'execFileSync'
grep -rn 'execAsync\s*(' src/main/
grep -rn 'exec(' src/main/ | grep -v 'execFile' | grep -v 'db.exec'
```

## Notes

- This is a 4-line change with high security value. Should be a standalone PR for easy review.
- The `ps` command on macOS/Linux does not need a shell — `execFile` works directly.
- The `lsof` command similarly needs no shell features (no pipes, redirects, or glob expansion).
