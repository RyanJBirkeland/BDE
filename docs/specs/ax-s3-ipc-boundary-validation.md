# AX-S3: IPC Boundary Validation & Path Safety

**Epic:** Architecture & DX
**Priority:** P0 (Security)
**Size:** M (Medium)
**Depends on:** None

---

## Problem

IPC is a trust boundary — the renderer process should be treated as potentially compromised. Currently, most handlers pass user-supplied strings directly to filesystem and shell operations without validation:

### 1. Path Traversal in `tailAgentLog` (High)

**File:** `src/main/local-agents.ts:280-289`

```typescript
export async function tailAgentLog(args: TailLogArgs): Promise<TailLogResult> {
  const fromByte = args.fromByte ?? 0
  const buf = await readFile(args.logPath)  // <-- arbitrary path from renderer
  // ...
}
```

The `logPath` parameter comes directly from the renderer via `local:tailAgentLog` IPC. A compromised renderer could read any file on disk (e.g., `~/.ssh/id_rsa`, `/etc/shadow`).

### 2. Git CWD Not Validated (Medium)

**File:** `src/main/handlers/git-handlers.ts:28-35`

All `git:*` handlers accept a `cwd: string` parameter that is passed directly to `execFileSync(..., { cwd })`. A compromised renderer could execute git commands in any directory. The `getRepoPaths()` function returns a whitelist of valid repos — but handlers don't check against it.

### 3. Weak `normalizePath` in fs.ts (Medium)

**File:** `src/main/fs.ts:60-65`

```typescript
function normalizePath(relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, '/').replace(/\.\./g, '')
  if (normalized.startsWith('/')) return normalized.slice(1)
  return normalized
}
```

This regex-based approach has edge cases:
- Doesn't use `path.resolve()` + prefix check (the robust standard)
- Doesn't handle URL-encoded sequences
- A path like `foo/....//bar` after replace becomes `foo///bar` → safe, but fragile

### 4. Terminal Shell Path Not Validated (Low)

**File:** `src/main/handlers/terminal-handlers.ts` — `terminal:create`

The `shell` parameter is passed to `node-pty` and could be any executable path. Low risk since the renderer controls which shell to spawn, but worth validating.

## Design

### Principle: Validate at the boundary, trust internally

Add validation functions in a new `src/main/validation.ts` module. Call them at the top of each handler — before any filesystem or shell operation.

### 1. Path Containment Validator

```typescript
// src/main/validation.ts
import { resolve, normalize } from 'path'

export function assertPathWithin(untrusted: string, allowedRoot: string): string {
  const resolved = resolve(allowedRoot, normalize(untrusted))
  if (!resolved.startsWith(allowedRoot + '/') && resolved !== allowedRoot) {
    throw new Error(`Path traversal blocked: ${untrusted}`)
  }
  return resolved
}
```

### 2. Apply to `tailAgentLog`

**File:** `src/main/local-agents.ts`

```typescript
import { assertPathWithin } from './validation'

const LOGS_DIR = join(homedir(), '.bde', 'agent-logs')

export async function tailAgentLog(args: TailLogArgs): Promise<TailLogResult> {
  const safePath = assertPathWithin(args.logPath, LOGS_DIR)
  const buf = await readFile(safePath)
  // ...
}
```

### 3. Apply to git handlers

**File:** `src/main/handlers/git-handlers.ts`

```typescript
import { getRepoPaths } from '../git'

function assertValidCwd(cwd: string): void {
  const allowed = Object.values(getRepoPaths())
  if (!allowed.some(root => cwd === root || cwd.startsWith(root + '/'))) {
    throw new Error(`Git CWD not in allowed repos: ${cwd}`)
  }
}

// Apply at the top of each git:* handler:
safeHandle('git:status', (_e, cwd: string) => {
  assertValidCwd(cwd)
  return gitStatus(cwd)
})
```

### 4. Strengthen `normalizePath` in fs.ts

Replace regex-based normalization with `assertPathWithin`:

```typescript
// src/main/fs.ts
import { assertPathWithin } from './validation'

async function readMemoryFile(relativePath: string): Promise<string> {
  const safePath = assertPathWithin(relativePath, MEMORY_ROOT)
  return readFile(safePath, 'utf-8')
}
```

### 5. Validate terminal shell path

```typescript
const ALLOWED_SHELLS = ['/bin/bash', '/bin/zsh', '/bin/sh', '/usr/bin/fish', '/opt/homebrew/bin/fish']

function assertValidShell(shell?: string): void {
  if (shell && !ALLOWED_SHELLS.includes(shell)) {
    throw new Error(`Shell not allowed: ${shell}`)
  }
}
```

## Files to Change

| File | Change |
|------|--------|
| `src/main/validation.ts` | **New** — `assertPathWithin()`, `assertValidCwd()`, `assertValidShell()` |
| `src/main/local-agents.ts` | Validate `logPath` in `tailAgentLog()` |
| `src/main/handlers/git-handlers.ts` | Validate `cwd` in all `git:*` handlers |
| `src/main/fs.ts` | Replace `normalizePath()` with `assertPathWithin()` |
| `src/main/handlers/terminal-handlers.ts` | Validate `shell` in `terminal:create` |

## Acceptance Criteria

- [ ] `tailAgentLog` rejects paths outside `~/.bde/agent-logs/`
- [ ] All `git:*` handlers reject CWDs outside known repo paths
- [ ] `readMemoryFile` / `writeMemoryFile` reject paths outside `~/.openclaw/workspace/memory/`
- [ ] `terminal:create` rejects non-whitelisted shell paths
- [ ] Each validation throws an error that `safeHandle()` logs and propagates
- [ ] `npm run build` passes
- [ ] Unit tests added for `assertPathWithin()` edge cases (`.`, `..`, `../../../etc/passwd`, absolute paths, symlink-like patterns)

## Risks

- **False positives:** A valid log path that doesn't start with the expected prefix (e.g., agent spawned before migration) would be rejected. Mitigate: log the rejection clearly so it's diagnosable.
- **Repo whitelist:** If a user adds a new repo to `REPO_PATHS` in git.ts, the validator picks it up automatically since it reads from `getRepoPaths()`.
