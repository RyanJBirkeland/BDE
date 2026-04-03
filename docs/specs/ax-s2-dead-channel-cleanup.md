# AX-S2: Dead Channel & Dead Code Cleanup

**Epic:** Architecture & DX
**Priority:** P1
**Size:** S (Small)
**Depends on:** None

---

## Problem

After the dead code purge in PR #81 (~1,450 lines removed), the audit found 8 dead IPC channels and 3 dead renderer exports that remain. These add maintenance burden and confusion — particularly `sessions:getHistory` which is a stub that suggests incomplete functionality.

## Inventory

### Dead IPC Handlers (registered in main, never invoked from renderer)

| Channel               | File                | Line  | Reason Dead                                                |
| --------------------- | ------------------- | ----- | ---------------------------------------------------------- |
| `sessions:getHistory` | `agent-handlers.ts` | 61-63 | Stub — always returns `[]`. No preload method calls it.    |
| `get-diff`            | `git-handlers.ts`   | 23    | Legacy — replaced by `git:diff` in the git client refactor |
| `get-branch`          | `git-handlers.ts`   | 24    | Legacy — replaced by `git:branches`                        |
| `get-log`             | `git-handlers.ts`   | 25    | Legacy — replaced by git client; never called from preload |
| `read-sprint-md`      | `git-handlers.ts`   | 20    | Legacy — no preload bridge entry, no renderer calls        |

### Dead Preload Methods (exposed in preload, never called from renderer)

| Method                  | Preload Line     | Reason Dead                                                                         |
| ----------------------- | ---------------- | ----------------------------------------------------------------------------------- |
| `agents.getMeta(args)`  | `index.ts:77-78` | Handler exists and works, but no renderer file calls `window.api.agents.getMeta()`  |
| `agents.markDone(args)` | `index.ts:83-84` | Handler exists and works, but no renderer file calls `window.api.agents.markDone()` |
| `sprint.delete(id)`     | `index.ts:101`   | Handler exists and works, but no renderer file calls `window.api.sprint.delete()`   |

### Dead Renderer Exports

| Export                | File                                         | Reason Dead                                                  |
| --------------------- | -------------------------------------------- | ------------------------------------------------------------ |
| `getSupabaseConfig()` | `src/renderer/src/lib/supabase.ts`           | Renderer uses `window.api.getSupabaseConfig()` (IPC) instead |
| `clearConfigCache()`  | `src/renderer/src/lib/rpc.ts`                | Marked `@deprecated`, is a no-op                             |
| `AgentSource` type    | `src/renderer/src/hooks/useUnifiedAgents.ts` | Exported but never imported; inline union used instead       |

## Implementation

### Step 1: Remove dead IPC handlers

**`src/main/handlers/agent-handlers.ts`** — Remove lines 60-63:

```diff
-  // --- Session history (agent output tabs) ---
-  safeHandle('sessions:getHistory', async (_event, _sessionKey: string) => {
-    return []
-  })
```

**`src/main/handlers/git-handlers.ts`** — Remove lines 20-25:

```diff
-  safeHandle('read-sprint-md', (_e, repoPath: string) => readSprintMd(repoPath))
-
-  // --- Git read-only IPC ---
-  safeHandle('get-diff', (_e, repoPath: string, base?: string) => getDiff(repoPath, base))
-  safeHandle('get-branch', (_e, repoPath: string) => getBranch(repoPath))
-  safeHandle('get-log', (_e, repoPath: string, n?: number) => getLog(repoPath, n))
```

Remove unused imports: `readSprintMd`, `getDiff`, `getBranch`, `getLog` from `'../git'`.

**`src/main/git.ts`** — If `readSprintMd`, `getDiff`, `getBranch`, `getLog` are only called by the dead handlers, remove the functions entirely. Verify each has no other callers.

### Step 2: Remove dead preload methods

**`src/preload/index.ts`** — Remove:

- `agents.getMeta` (line 77-78)
- `agents.markDone` (line 83-84)
- `sprint.delete` (line 101)

**`src/preload/index.d.ts`** — Remove corresponding type declarations.

### Step 3: Remove dead renderer exports

- `src/renderer/src/lib/supabase.ts` — Remove `getSupabaseConfig()` export. If the file becomes empty, delete it.
- `src/renderer/src/lib/rpc.ts` — Remove `clearConfigCache()` function.
- `src/renderer/src/hooks/useUnifiedAgents.ts` — Remove `AgentSource` type export.

### Step 4: Verify

```bash
npm run build   # No compile errors
npm test        # No broken tests
```

Grep for any remaining references to removed channels/exports.

## Acceptance Criteria

- [ ] `sessions:getHistory`, `get-diff`, `get-branch`, `get-log`, `read-sprint-md` handlers removed
- [ ] `agents.getMeta`, `agents.markDone`, `sprint.delete` removed from preload
- [ ] Dead renderer exports removed
- [ ] `npm run build` passes
- [ ] `npm test` passes
- [ ] No grep hits for removed channel names in `src/`

## Notes

- `agents.getMeta` and `agents.markDone` may be needed in future features. If so, re-add them when the feature ships — dead code is worse than missing code.
- `sprint.delete` likely was used during development but the delete button was removed from the UI. If sprint task deletion is re-added later, the handler is trivial to restore.
- The 4 legacy git handlers (`get-diff`, `get-branch`, `get-log`, `read-sprint-md`) predate the `git:*` namespaced client added later. The `git:*` versions are the canonical API.
