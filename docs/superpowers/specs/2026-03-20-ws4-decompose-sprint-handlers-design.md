# WS4: Decompose Sprint Handlers

**Date:** 2026-03-20
**Status:** Draft
**Effort:** 0.5-1 day
**Dependencies:** WS2 (Extract Data Layer)

## Problem

`src/main/handlers/sprint-local.ts` is 469 LOC mixing 5 concerns: task CRUD, mutation broadcasting, spec file I/O, gateway RPC for spec generation, and queue statistics. Both IPC handlers and the queue-api router import from this file.

## Solution

Split into 3 focused modules + a thin handler registration file. After WS2, the CRUD queries live in `src/main/data/sprint-queries.ts`, so the handler layer becomes thinner.

## Architecture

```
src/main/handlers/
  sprint-handlers.ts        — Thin IPC handler registration (dispatcher)
  sprint-spec.ts            — Spec file I/O + gateway generation
  sprint-listeners.ts       — Mutation observer pattern
```

Combined with WS2:
```
src/main/data/
  sprint-queries.ts         — CRUD queries (from WS2)
```

### Module Responsibilities

#### `sprint-handlers.ts` (~80 LOC)

Thin dispatcher. Registers IPC handlers, delegates to query functions and spec module:

```typescript
import { getTask, listTasks, createTask, updateTask, deleteTask, claimTask, releaseTask } from '../data/sprint-queries'
import { readSpecFile, generatePrompt } from './sprint-spec'
import { notifySprintMutation } from './sprint-listeners'

export function registerSprintHandlers(): void {
  const db = getDb()

  safeHandle('sprint:list', (_e, status?) => listTasks(db, status))
  safeHandle('sprint:get', (_e, id) => getTask(db, id))
  safeHandle('sprint:create', async (_e, input) => {
    const task = createTask(db, input)
    notifySprintMutation('created', task)  // uses structured event signature
    return task
  })
  safeHandle('sprint:update', async (_e, id, patch) => {
    const task = updateTask(db, id, patch)
    if (task) notifySprintMutation('updated', task)
    return task
  })
  safeHandle('sprint:delete', (_e, id) => {
    const result = deleteTask(db, id)
    if (result) notifySprintMutation('deleted', { id })
    return result
  })
  safeHandle('sprint:readSpecFile', (_e, taskId) => readSpecFile(taskId))
  safeHandle('sprint:generatePrompt', (_e, req) => generatePrompt(req))
  // ... claim, release, health check
}
```

#### `sprint-spec.ts` (~120 LOC)

Owns spec file I/O and gateway-based spec generation:

```typescript
export function readSpecFile(taskId: string): string | null {
  // Read spec from filesystem
}

export function buildQuickSpecPrompt(title: string, repo: string, templateHint?: string): string {
  // Construct prompt for gateway
}

export function getTemplateScaffold(templateName: string): string {
  // Return scaffold string for template
}

export async function generatePrompt(req: GeneratePromptRequest): Promise<GeneratePromptResponse> {
  // Gateway RPC call with AbortController
  // Returns { spec, prompt }
}
```

#### `sprint-listeners.ts` (~40 LOC)

Mutation observer for queue-api SSE and other subscribers:

```typescript
// Preserve existing single-object event signature from sprint-local.ts
type SprintMutationEvent = {
  type: 'created' | 'updated' | 'deleted'
  task: SprintTask
}
type SprintMutationListener = (event: SprintMutationEvent) => void
const listeners = new Set<SprintMutationListener>()

export function onSprintMutation(cb: SprintMutationListener): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

export function notifySprintMutation(type: SprintMutationEvent['type'], task: SprintTask): void {
  const event = { type, task }
  for (const cb of listeners) {
    try { cb(event) } catch { /* log */ }
  }
}
```

## Changes

### 1. Create `src/main/handlers/sprint-spec.ts`

Extract from sprint-local.ts:
- `readSpecFile()`
- `buildQuickSpecPrompt()`
- `getTemplateScaffold()`
- `generatePrompt()` (the async gateway RPC handler)

### 2. Create `src/main/handlers/sprint-listeners.ts`

Extract from sprint-local.ts:
- `onSprintMutation()` function
- `notifySprintMutation()` (rename from internal `notifyMutation()`)
- The `listeners` Set

### 3. Rewrite `sprint-local.ts` → `sprint-handlers.ts`

Rename file. Keep only `registerSprintHandlers()` function. Import queries from `../data/sprint-queries`, spec functions from `./sprint-spec`, listeners from `./sprint-listeners`.

### 4. Update queue-api/router.ts imports

Currently imports 6 functions from `../handlers/sprint-local`. After refactor:

```typescript
import { getTask, listTasks, claimTask, updateTask, releaseTask, getQueueStats } from '../data/sprint-queries'
import { onSprintMutation } from '../handlers/sprint-listeners'
```

### 5. Update other importers

Check all files importing from `sprint-local`:
- `src/main/sprint-pr-poller.ts` — uses `markTaskDoneByPrNumber`, `markTaskCancelledByPrNumber`, `listTasksWithOpenPrs`, `updateTaskMergeableState` → import from `../data/sprint-queries`
- `src/main/handlers/git-handlers.ts` — uses `markTaskDoneByPrNumber`, `markTaskCancelledByPrNumber`, `updateTaskMergeableState` → import from `../data/sprint-queries`
- `src/main/agent-history.ts` — uses `clearSprintTaskFk` → import from `../data/sprint-queries`

All of these functions (`listTasksWithOpenPrs`, `updateTaskMergeableState`, `clearSprintTaskFk`) are query operations and should move to `data/sprint-queries.ts` as part of WS2.

### 6. Update `src/main/index.ts`

Change handler registration call:
```typescript
// Before
import { registerSprintLocalHandlers } from './handlers/sprint-local'
// After
import { registerSprintHandlers } from './handlers/sprint-handlers'
```

## File Size Targets

| File | Target LOC |
|------|-----------|
| `sprint-handlers.ts` | ~80 |
| `sprint-spec.ts` | ~120 |
| `sprint-listeners.ts` | ~40 |
| `data/sprint-queries.ts` (from WS2) | ~150 |

Total: ~390 (down from 469 in one file, but with better separation)

## Verification

- `npm run typecheck` passes
- `npm test` passes
- `grep -r "sprint-local" src/` returns zero results (old file fully removed)
- Each new file has a single clear responsibility

## Risk

Low. Pure extraction. The only coordination point is ensuring `notifySprintMutation` is called after mutations in the handler — same pattern as today, just across module boundaries.
