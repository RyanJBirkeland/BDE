# WS7: Error Handling Cleanup

**Date:** 2026-03-20
**Status:** Draft
**Effort:** 0.5 day
**Dependencies:** None

## Problem

Inconsistent error handling across the main process. Four patterns coexist: silent catch with empty return, throw, return null, and fire-and-forget `.catch(() => {})`. Error messages lack context. Renderer can't distinguish "no data" from "operation failed."

### Current Violations

| File                                           | Pattern                                  | Issue                                                     |
| ---------------------------------------------- | ---------------------------------------- | --------------------------------------------------------- |
| `git.ts` — `gitStatus()`                       | `catch { return { files: [] } }`         | Silent — git failure looks like empty repo                |
| `git.ts` — `gitDiffFile()`                     | `catch { return '' }`                    | Silent — diff failure looks like no changes               |
| `git.ts` — `fetchPrStatusRest()`               | Per-PR catch returns error-shaped result | Individual PR failures silently degrade                   |
| `local-agents.ts` — `consumeEvents()`          | `.catch(() => {})` at call site          | Fire-and-forget — event consumption errors vanish         |
| `local-agents.ts` — `extractAgentCost()`       | `catch { return null }`                  | Cost parsing failure indistinguishable from "no cost yet" |
| `sprint-local.ts` — `markTaskDoneByPrNumber()` | `.catch()` + console.warn                | Partial — logged but returns void, caller can't react     |
| `git-handlers.ts`                              | `'GitHub token not configured'`          | No guidance on how to fix                                 |

Note: `gitPush()` does NOT have a try/catch — it throws on failure (correct behavior). `pollPrStatuses()` delegates to `fetchPrStatusRest()` which handles errors per-PR — no top-level catch to fix.

## Solution

Establish a lightweight result convention for expected failures. Use it consistently in `git.ts` and agent operations.

### Convention

```typescript
// src/shared/types.ts — add Result type

type Result<T> = { ok: true; data: T } | { ok: false; error: string }
```

**When to use:**

- **Result type:** For operations where failure is expected and the caller should handle it (git commands on invalid repos, network calls, file I/O)
- **Throw:** For programming errors and invariant violations (missing required args, impossible states)
- **Return null:** For lookups where absence is a valid outcome (getTask with unknown ID)

**Never:** Empty catch blocks. Never `.catch(() => {})` without logging.

## Changes

### 1. Add `Result<T>` to shared types

```typescript
// src/shared/types.ts
export type Result<T> = { ok: true; data: T } | { ok: false; error: string }
```

### 2. Refactor `git.ts` — 4 functions

#### `gitStatus()`

Before:

```typescript
export async function gitStatus(cwd: string): Promise<{ files: GitFileStatus[] }> {
  try {
    const { stdout } = await execFileAsync('git', ['status', '--porcelain=v1'], { cwd })
    return { files: parseStatusLines(stdout) }
  } catch {
    return { files: [] }
  }
}
```

After:

```typescript
export async function gitStatus(cwd: string): Promise<Result<{ files: GitFileStatus[] }>> {
  try {
    const { stdout } = await execFileAsync('git', ['status', '--porcelain=v1'], { cwd })
    return { ok: true, data: { files: parseStatusLines(stdout) } }
  } catch (err) {
    return {
      ok: false,
      error: `git status failed in ${cwd}: ${err instanceof Error ? err.message : String(err)}`
    }
  }
}
```

#### `gitDiffFile()`

Before: `catch { return '' }`

After: `catch (err) { return { ok: false, error: \`git diff failed: ${err.message}\` } }`

Note: `gitPush()` already throws on failure (no try/catch) — no change needed. `pollPrStatuses()` delegates to per-PR error handling in `fetchPrStatusRest()` — the per-PR error result pattern is acceptable, but add context to the error message in `fetchPrStatusRest()`.

### 3. Update `git-handlers.ts` callers

IPC handlers unwrap Result before returning to renderer:

```typescript
safeHandle('git:status', async (_e, cwd) => {
  const result = await gitStatus(cwd)
  if (!result.ok) {
    console.warn('[git:status]', result.error)
    return { files: [] } // Degrade gracefully for renderer
  }
  return result.data
})
```

This preserves the existing IPC contract — renderer doesn't need to change. The improvement is that errors are now logged with context instead of silently swallowed.

### 4. Fix `local-agents.ts` fire-and-forget

Before:

```typescript
consumeEvents(id, handle, meta.logPath).catch(() => {})
```

After:

```typescript
consumeEvents(id, handle, meta.logPath).catch((err) => {
  console.error(`[agents] Event consumption failed for ${id}:`, err)
})
```

### 5. Fix `extractAgentCost()` ambiguity

Before: `catch { return null }` — indistinguishable from "no cost data yet"

After:

```typescript
// Note: extractAgentCost is async (reads file) — keep it async
export async function extractAgentCost(logPath: string): Promise<Result<AgentCost | null>> {
  try {
    // ... parsing logic
    return { ok: true, data: costData ?? null } // null = no cost yet (valid)
  } catch (err) {
    return { ok: false, error: `Cost extraction failed for ${logPath}: ${err.message}` }
  }
}
```

Caller can now distinguish:

- `{ ok: true, data: null }` → no cost data yet (normal)
- `{ ok: true, data: { ... } }` → cost data found
- `{ ok: false, error: '...' }` → parsing broke

### 6. Add context to error messages

| Current                         | Improved                                                           |
| ------------------------------- | ------------------------------------------------------------------ |
| `'GitHub token not configured'` | `'GitHub token not configured. Set it in Settings → Connections.'` |
| `'Failed to stop agent'`        | `'Failed to stop agent ${agentId} (PID ${pid}): ${err.message}'`   |
| `'Spec generation failed'`      | `'Spec generation failed for task "${title}": ${err.message}'`     |

### 7. Fix `sprint-local.ts` partial error handling

`markTaskDoneByPrNumber()` — currently returns `void` and catches errors internally with `console.warn`. Change to return Result so callers (e.g., `sprint-pr-poller.ts`) can react:

```typescript
export function markTaskDoneByPrNumber(db: Database, prNumber: number): Result<SprintTask> {
  const task = db
    .prepare('SELECT * FROM sprint_tasks WHERE pr_number = ?')
    .get(prNumber) as SprintTask | null
  if (!task) return { ok: false, error: `No task found for PR #${prNumber}` }
  // ... update logic
  return { ok: true, data: updatedTask }
}
```

Update callers (`sprint-pr-poller.ts`) to handle the Result:

```typescript
const result = markTaskDoneByPrNumber(db, prNumber)
if (!result.ok) console.warn('[pr-poller]', result.error)
```

## Files Changed

| File                                  | Change Type                                               |
| ------------------------------------- | --------------------------------------------------------- |
| `src/shared/types.ts`                 | Add `Result<T>` type                                      |
| `src/main/git.ts`                     | Refactor `gitStatus`, `gitDiffFile` to return `Result<T>` |
| `src/main/handlers/git-handlers.ts`   | Unwrap Results, log errors                                |
| `src/main/local-agents.ts`            | Fix fire-and-forget, refactor extractAgentCost            |
| `src/main/handlers/sprint-local.ts`   | Improve error messages, Result for markTaskDone/Cancelled |
| `src/main/sprint-pr-poller.ts`        | Update callers of markTaskDone/Cancelled to handle Result |
| `src/main/handlers/agent-handlers.ts` | Improve error messages                                    |

## Verification

- `npm run typecheck` passes
- `npm test` passes
- `grep -rn "catch {" src/main/` returns zero empty catches (all have error logging)
- `grep -rn "\.catch(() => {})" src/main/` returns zero fire-and-forget patterns
- Existing renderer behavior unchanged (handlers degrade gracefully)

## Risk

Low. Error handling changes are additive — they add logging and context where none existed. IPC contracts unchanged. The only caller-facing change is `extractAgentCost` return type (callers must handle Result).
