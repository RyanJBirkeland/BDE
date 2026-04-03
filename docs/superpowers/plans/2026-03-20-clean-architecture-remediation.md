# Clean Architecture Remediation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all issues from the 2026-03-20 clean architecture audit — dependency violations, god modules, missing abstraction layers, error handling, and testability gaps.

**Architecture:** 8 workstreams executed in dependency order. WS1 first (unblocks all). WS2/3/5/7/8 independent (parallel). WS4 after WS2. WS6 after WS3. Lightweight functional style — functions take dependencies as parameters, no DI container.

**Tech Stack:** TypeScript, Electron, React, Zustand, better-sqlite3, Vitest

**Specs:** `docs/superpowers/specs/2026-03-20-ws{1-8}-*-design.md`

---

## Execution Order

```
WS1 (30min) ──────────────────────────────────────────────────►
WS2 (1-2d) ─────────────────► WS4 (0.5-1d) ─────────────────►
WS3 (0.5-1d) ────────────────► WS6 (0.5-1d) ────────────────►
WS5 (1-2d) ──────────────────────────────────────────────────►
WS7 (0.5d) ──────────────────────────────────────────────────►
WS8 (1d) ────────────────────────────────────────────────────►
```

---

## Task 1: Fix Dependency Direction (WS1)

**Branch:** `chore/ws1-fix-dependency-direction`

**Files:**

- Modify: `src/main/agents/types.ts` — remove AgentEvent/AgentEventType
- Modify: `src/shared/types.ts` — add AgentEvent/AgentEventType
- Modify: `src/shared/ipc-channels.ts:11` — fix import
- Modify: `src/preload/index.ts:6` — fix import
- Modify: `src/preload/index.d.ts:5` — fix import
- Modify: `src/main/queue-api/router.ts:23` — fix import
- Modify: `src/renderer/src/stores/agentEvents.ts:2` — fix import
- Modify: `src/renderer/src/components/agents/AgentDetail.tsx:7` — fix import
- Modify: `src/renderer/src/components/agents/ChatRenderer.tsx:8` — fix import
- Modify: `src/renderer/src/components/agents/__tests__/ChatRenderer.test.tsx` — fix import

- [ ] **Step 1: Create branch**

```bash
git checkout -b chore/ws1-fix-dependency-direction
```

- [ ] **Step 2: Add AgentEvent types to shared/types.ts**

Add these types to the end of `src/shared/types.ts` (before any closing statements), copied verbatim from `src/main/agents/types.ts` lines 5–26:

```typescript
// --- Agent Events (unified event stream for local + remote agents) ---

export type AgentEventType =
  | 'agent:started'
  | 'agent:text'
  | 'agent:user_message'
  | 'agent:thinking'
  | 'agent:tool_call'
  | 'agent:tool_result'
  | 'agent:rate_limited'
  | 'agent:error'
  | 'agent:completed'

export type AgentEvent =
  | { type: 'agent:started'; model: string; timestamp: number }
  | { type: 'agent:text'; text: string; timestamp: number }
  | { type: 'agent:user_message'; text: string; timestamp: number }
  | { type: 'agent:thinking'; tokenCount: number; text?: string; timestamp: number }
  | { type: 'agent:tool_call'; tool: string; summary: string; input?: unknown; timestamp: number }
  | {
      type: 'agent:tool_result'
      tool: string
      success: boolean
      summary: string
      output?: unknown
      timestamp: number
    }
  | { type: 'agent:rate_limited'; retryDelayMs: number; attempt: number; timestamp: number }
  | { type: 'agent:error'; message: string; timestamp: number }
  | {
      type: 'agent:completed'
      exitCode: number
      costUsd: number
      tokensIn: number
      tokensOut: number
      durationMs: number
      timestamp: number
    }
```

- [ ] **Step 3: Remove AgentEvent types from main/agents/types.ts**

Delete lines 3–26 (the `AgentEventType` and `AgentEvent` type definitions). Keep the `AgentSpawnOptions`, `AgentHandle`, and `AgentProvider` interfaces. Add an import for `AgentEvent` from shared so the `AgentHandle.events` field still works:

```typescript
import type { AgentEvent } from '../../shared/types'
```

- [ ] **Step 4: Update 8 import paths**

Each file needs its import changed:

| File                                                    | Old                                                               | New                                                             |
| ------------------------------------------------------- | ----------------------------------------------------------------- | --------------------------------------------------------------- |
| `src/shared/ipc-channels.ts:11`                         | `import type { AgentEvent } from '../main/agents/types'`          | `import type { AgentEvent } from './types'`                     |
| `src/preload/index.ts:6`                                | `import type { AgentEvent } from '../main/agents/types'`          | `import type { AgentEvent } from '../shared/types'`             |
| `src/preload/index.d.ts:5`                              | `import type { AgentEvent } from '../main/agents/types'`          | `import type { AgentEvent } from '../shared/types'`             |
| `src/main/queue-api/router.ts:23`                       | `import type { AgentEvent } from '../agents/types'`               | `import type { AgentEvent } from '../../shared/types'`          |
| `src/renderer/src/stores/agentEvents.ts:2`              | `import type { AgentEvent } from '../../../main/agents/types'`    | `import type { AgentEvent } from '../../../../shared/types'`    |
| `src/renderer/src/components/agents/AgentDetail.tsx:7`  | `import type { AgentEvent } from '../../../../main/agents/types'` | `import type { AgentEvent } from '../../../../../shared/types'` |
| `src/renderer/src/components/agents/ChatRenderer.tsx:8` | `import type { AgentEvent } from '../../../../main/agents/types'` | `import type { AgentEvent } from '../../../../../shared/types'` |
| ChatRenderer.test.tsx                                   | same pattern                                                      | same fix                                                        |

- [ ] **Step 5: Run typecheck and tests**

```bash
npm run typecheck && npm test
```

Expected: All pass. If any import paths are wrong, fix them.

- [ ] **Step 6: Verify no remaining violations**

```bash
grep -r "from.*main/agents/types" src/shared src/preload src/renderer
```

Expected: Zero results.

- [ ] **Step 7: Commit**

```bash
git add src/shared/types.ts src/main/agents/types.ts src/shared/ipc-channels.ts src/preload/index.ts src/preload/index.d.ts src/main/queue-api/router.ts src/renderer/src/stores/agentEvents.ts src/renderer/src/components/agents/AgentDetail.tsx src/renderer/src/components/agents/ChatRenderer.tsx src/renderer/src/components/agents/__tests__/ChatRenderer.test.tsx
git commit -m "chore: move AgentEvent types to shared layer

Fixes dependency direction violation where shared/preload/renderer
imported from main/agents/types. All cross-boundary types now live
in src/shared/types.ts."
```

---

## Task 2: Extract Data Layer (WS2)

**Branch:** `chore/ws2-extract-data-layer`

**Files:**

- Create: `src/main/data/sprint-queries.ts`
- Create: `src/main/data/agent-queries.ts`
- Create: `src/main/data/cost-queries.ts` (move from `src/main/cost-queries.ts`)
- Create: `src/main/data/settings-queries.ts`
- Create: `src/main/data/__tests__/sprint-queries.test.ts`
- Create: `src/main/data/__tests__/settings-queries.test.ts`
- Modify: `src/main/handlers/sprint-local.ts` — remove query functions, import from data layer
- Modify: `src/main/queue-api/router.ts` — update imports
- Modify: `src/main/sprint-pr-poller.ts` — update imports
- Modify: `src/main/agent-history.ts` — update imports
- Modify: `src/main/handlers/cost-handlers.ts` — update imports

- [ ] **Step 1: Create branch**

```bash
git checkout main && git checkout -b chore/ws2-extract-data-layer
```

- [ ] **Step 2: Write sprint-queries test**

Create `src/main/data/__tests__/sprint-queries.test.ts`:

```typescript
import Database from 'better-sqlite3'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { runMigrations } from '../../db'

let db: Database.Database

beforeEach(() => {
  db = new Database(':memory:')
  runMigrations(db)
})

afterEach(() => {
  db.close()
})

// Import will fail until we create the module
// import { getTask, listTasks, createTask, updateTask, deleteTask } from '../sprint-queries'

describe('sprint-queries', () => {
  it.todo('getTask returns task by id')
  it.todo('getTask returns null for missing id')
  it.todo('listTasks returns all tasks ordered by priority')
  it.todo('listTasks filters by status')
  it.todo('createTask inserts and returns task')
  it.todo('updateTask updates allowed fields')
  it.todo('updateTask rejects disallowed fields')
  it.todo('deleteTask removes task')
})
```

- [ ] **Step 3: Run test to verify it loads (todos skip)**

```bash
npx vitest run src/main/data/__tests__/sprint-queries.test.ts
```

Expected: All tests show as TODO/skipped.

- [ ] **Step 4: Create sprint-queries.ts**

Create `src/main/data/sprint-queries.ts`. Extract all query functions from `src/main/handlers/sprint-local.ts`. Each function takes `db: Database.Database` as first parameter. Read `sprint-local.ts` carefully and copy the exact SQL and logic for: `getTask`, `listTasks`, `createTask`, `updateTask`, `deleteTask`, `claimTask`, `releaseTask`, `getQueueStats`, `getDoneTodayCount`, `markTaskDoneByPrNumber`, `markTaskCancelledByPrNumber`, `listTasksWithOpenPrs`, `updateTaskMergeableState`, `clearSprintTaskFk`, and the `UPDATE_ALLOWLIST` constant.

- [ ] **Step 5: Implement sprint-queries tests**

Replace the `.todo` tests with real tests that insert data and verify queries:

```typescript
import { getTask, listTasks, createTask, updateTask, deleteTask } from '../sprint-queries'

describe('getTask', () => {
  it('returns task by id', () => {
    db.prepare(
      "INSERT INTO sprint_tasks (id, title, status, priority, created_at, updated_at) VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))"
    ).run('t1', 'Test Task', 'backlog', 10)
    const task = getTask(db, 't1')
    expect(task).not.toBeNull()
    expect(task!.id).toBe('t1')
    expect(task!.title).toBe('Test Task')
  })

  it('returns null for missing id', () => {
    expect(getTask(db, 'nonexistent')).toBeNull()
  })
})

describe('listTasks', () => {
  it('returns tasks ordered by priority', () => {
    db.prepare(
      "INSERT INTO sprint_tasks (id, title, status, priority, created_at, updated_at) VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))"
    ).run('a', 'Low', 'backlog', 99)
    db.prepare(
      "INSERT INTO sprint_tasks (id, title, status, priority, created_at, updated_at) VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))"
    ).run('b', 'High', 'backlog', 1)
    const tasks = listTasks(db)
    expect(tasks[0].id).toBe('b')
    expect(tasks[1].id).toBe('a')
  })

  it('filters by status', () => {
    db.prepare(
      "INSERT INTO sprint_tasks (id, title, status, priority, created_at, updated_at) VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))"
    ).run('a', 'Backlog', 'backlog', 1)
    db.prepare(
      "INSERT INTO sprint_tasks (id, title, status, priority, created_at, updated_at) VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))"
    ).run('b', 'Queued', 'queued', 1)
    const tasks = listTasks(db, 'queued')
    expect(tasks).toHaveLength(1)
    expect(tasks[0].id).toBe('b')
  })
})
```

- [ ] **Step 6: Run tests**

```bash
npx vitest run src/main/data/__tests__/sprint-queries.test.ts
```

Expected: All PASS.

- [ ] **Step 7: Create settings-queries.ts**

Create `src/main/data/settings-queries.ts`. Extract from `src/main/settings.ts`: `getSetting`, `setSetting`, `deleteSetting`, `getSettingJson`, `setSettingJson`. All take `db: Database.Database` as first param.

- [ ] **Step 8: Write and run settings-queries tests**

Create `src/main/data/__tests__/settings-queries.test.ts` with tests for get/set/delete/JSON operations against in-memory DB.

- [ ] **Step 9: Move cost-queries.ts to data layer**

Move `src/main/cost-queries.ts` to `src/main/data/cost-queries.ts`. Add `db` parameter to all functions. Remove internal `getDb()` calls.

- [ ] **Step 10: Create agent-queries.ts**

Create `src/main/data/agent-queries.ts`. Extract from `src/main/agent-history.ts`: `listAgents`, `getAgentMeta`, `createAgentRecord`, `updateAgentMeta`, `findAgentByPid`, `pruneOldAgents`. All take `db` as first param.

- [ ] **Step 11: Update all callers**

Update these files to import from `src/main/data/` instead of the original locations:

- `src/main/handlers/sprint-local.ts` — import query functions from `../data/sprint-queries`, call with `getDb()`
- `src/main/queue-api/router.ts` — import from `../data/sprint-queries`
- `src/main/sprint-pr-poller.ts` — import from `./data/sprint-queries`
- `src/main/agent-history.ts` — thin wrapper that calls `./data/agent-queries` with `getDb()`
- `src/main/settings.ts` — thin wrapper that calls `./data/settings-queries` with `getDb()`
- `src/main/handlers/cost-handlers.ts` — import from `../data/cost-queries`

- [ ] **Step 12: Run full test suite**

```bash
npm run typecheck && npm test
```

Expected: All pass.

- [ ] **Step 13: Commit**

```bash
git add src/main/data/ src/main/handlers/sprint-local.ts src/main/queue-api/router.ts src/main/sprint-pr-poller.ts src/main/agent-history.ts src/main/settings.ts src/main/handlers/cost-handlers.ts
git commit -m "chore: extract data layer with parameterized query functions

Creates src/main/data/ with sprint-queries, agent-queries, cost-queries,
and settings-queries. All functions take db as first parameter for
testability. Includes in-memory SQLite tests."
```

Delete the original `src/main/cost-queries.ts` if fully migrated:

```bash
git rm src/main/cost-queries.ts
git commit -m "chore: remove old cost-queries.ts (moved to data layer)"
```

---

## Task 3: Split Sprint Store (WS3)

**Branch:** `chore/ws3-split-sprint-store`

**Files:**

- Create: `src/renderer/src/stores/sprintTasks.ts`
- Create: `src/renderer/src/stores/sprintUI.ts`
- Create: `src/renderer/src/stores/sprintEvents.ts`
- Delete: `src/renderer/src/stores/sprint.ts` (after migration)
- Modify: ~12 consumer files (SprintCenter, TaskCard, TicketEditor, LogDrawer, hooks, etc.)
- Modify: Test files

- [ ] **Step 1: Create branch**

```bash
git checkout main && git checkout -b chore/ws3-split-sprint-store
```

- [ ] **Step 2: Read current sprint.ts thoroughly**

Read `src/renderer/src/stores/sprint.ts` in full. Note every property, action, and their exact types. The store has ~19 properties and uses `TaskOutputEvent` from `queue-api-contract` (not `AgentEvent`).

- [ ] **Step 3: Create sprintTasks.ts**

Create `src/renderer/src/stores/sprintTasks.ts` with task data + CRUD actions. Copy the relevant state and actions from `sprint.ts`: `tasks`, `loading`, `loadError`, `prMergedMap`, `loadData`, `createTask`, `updateTask`, `deleteTask`, `launchTask`, `setTasks`, `mergeSseUpdate`, `setPrMergedMap`.

- [ ] **Step 4: Create sprintUI.ts**

Create `src/renderer/src/stores/sprintUI.ts` with UI selection state: `selectedTaskId`, `logDrawerTaskId`, `repoFilter`, `generatingIds`, `setSelectedTaskId`, `setLogDrawerTaskId`, `setRepoFilter`, `setGeneratingIds`.

- [ ] **Step 5: Create sprintEvents.ts**

Create `src/renderer/src/stores/sprintEvents.ts` with event stream state: `taskEvents`, `latestEvents`, `queueHealth`, `initTaskOutputListener`, `fetchQueueHealth`, `clearTaskEvents`.

- [ ] **Step 6: Update all consumers**

Use grep to find every `useSprintStore` import and update to the appropriate new store(s):

```bash
grep -rn "useSprintStore" src/renderer/src/
```

Key files to update:

- `SprintCenter.tsx` — uses all 3 stores
- `TaskCard.tsx` — `sprintEvents` (latestEvents)
- `TicketEditor.tsx` — `sprintTasks` (createTask, updateTask)
- `LogDrawer.tsx` — `sprintEvents` (taskEvents)
- `hooks/useSprintPolling.ts` — `sprintTasks` (tasks, loadData, mergeSseUpdate) + `sprintEvents` (fetchQueueHealth)
- `hooks/usePrStatusPolling.ts` — `sprintTasks` (tasks, prMergedMap)
- `hooks/useSprintKeyboardShortcuts.ts` — `sprintUI` (selectedTaskId, setLogDrawerTaskId)

- [ ] **Step 7: Delete sprint.ts**

```bash
git rm src/renderer/src/stores/sprint.ts
```

- [ ] **Step 8: Update tests**

Split `src/renderer/src/stores/__tests__/sprint.test.ts` into three test files matching the new stores. Update mock patterns.

- [ ] **Step 9: Run full test suite**

```bash
npm run typecheck && npm test
```

- [ ] **Step 10: Verify no remaining references**

```bash
grep -rn "useSprintStore" src/renderer/
```

Expected: Zero results.

- [ ] **Step 11: Commit**

```bash
git add -A src/renderer/src/stores/ src/renderer/src/components/ src/renderer/src/hooks/ src/renderer/src/views/
git commit -m "chore: split sprint store into tasks, UI, and events stores

Breaks monolithic useSprintStore (19 properties, 5 concerns) into:
- useSprintTasks: task CRUD and data
- useSprintUI: selection, drawers, filters
- useSprintEvents: SSE events and queue health"
```

---

## Task 4: Decompose Sprint Handlers (WS4)

**Branch:** `chore/ws4-decompose-sprint-handlers`
**Depends on:** WS2 merged

**Files:**

- Create: `src/main/handlers/sprint-spec.ts`
- Create: `src/main/handlers/sprint-listeners.ts`
- Rename: `src/main/handlers/sprint-local.ts` → `src/main/handlers/sprint-handlers.ts`
- Modify: `src/main/index.ts` — update registration import
- Modify: `src/main/queue-api/router.ts` — update imports
- Modify: `src/main/queue-api/sse.ts` — update imports

- [ ] **Step 1: Create branch from main (after WS2 merge)**

```bash
git checkout main && git pull && git checkout -b chore/ws4-decompose-sprint-handlers
```

- [ ] **Step 2: Create sprint-listeners.ts**

Create `src/main/handlers/sprint-listeners.ts`. Extract the mutation observer pattern from `sprint-local.ts`. Use the existing single-object event signature:

```typescript
import type { SprintTask } from '../../shared/types'

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
    try {
      cb(event)
    } catch (err) {
      console.error('[sprint-listeners]', err)
    }
  }
}
```

- [ ] **Step 3: Create sprint-spec.ts**

Create `src/main/handlers/sprint-spec.ts`. Extract from `sprint-local.ts`: `readSpecFile`, `buildQuickSpecPrompt`, `getTemplateScaffold`, `generatePrompt`.

- [ ] **Step 4: Rewrite sprint-local.ts → sprint-handlers.ts**

Rename the file and reduce to a thin dispatcher that imports queries from `../data/sprint-queries`, spec functions from `./sprint-spec`, and listeners from `./sprint-listeners`. The handler registration should be ~80 LOC.

- [ ] **Step 5: Update all importers**

- `src/main/index.ts` — change `registerSprintLocalHandlers` to `registerSprintHandlers`
- `src/main/queue-api/router.ts` — import queries from `../data/sprint-queries`, listeners from `../handlers/sprint-listeners`
- `src/main/queue-api/sse.ts` — import `onSprintMutation` from `../handlers/sprint-listeners`
- `src/main/sprint-pr-poller.ts` — import queries from `./data/sprint-queries`
- `src/main/agent-history.ts` — import `clearSprintTaskFk` from `./data/sprint-queries`

- [ ] **Step 6: Run full test suite**

```bash
npm run typecheck && npm test
```

- [ ] **Step 7: Verify old file is gone**

```bash
grep -rn "sprint-local" src/
```

Expected: Zero results (only in test file names is acceptable).

- [ ] **Step 8: Commit**

```bash
git add -A src/main/
git commit -m "chore: decompose sprint handlers into spec, listeners, and thin dispatcher

Splits 469-LOC sprint-local.ts into:
- sprint-handlers.ts (~80 LOC): thin IPC dispatcher
- sprint-spec.ts (~120 LOC): spec I/O and gateway generation
- sprint-listeners.ts (~40 LOC): mutation observer pattern"
```

---

## Task 5: Decompose SettingsView (WS5)

**Branch:** `chore/ws5-decompose-settings-view`

**Files:**

- Create: `src/renderer/src/components/settings/AppearanceSection.tsx`
- Create: `src/renderer/src/components/settings/ConnectionsSection.tsx`
- Create: `src/renderer/src/components/settings/CredentialForm.tsx`
- Create: `src/renderer/src/components/settings/RepositoriesSection.tsx`
- Create: `src/renderer/src/components/settings/TaskTemplatesSection.tsx`
- Create: `src/renderer/src/components/settings/AgentRuntimeSection.tsx`
- Create: `src/renderer/src/components/settings/AboutSection.tsx`
- Modify: `src/renderer/src/views/SettingsView.tsx` — reduce to tab container

- [ ] **Step 1: Create branch**

```bash
git checkout main && git checkout -b chore/ws5-decompose-settings-view
```

- [ ] **Step 2: Read SettingsView.tsx in full**

Read all 841 lines. Map section boundaries. Note state variables, hooks, and imports used by each section.

- [ ] **Step 3: Create CredentialForm.tsx**

Create `src/renderer/src/components/settings/CredentialForm.tsx` with the multi-field credential form component. Supports 1 or 2 fields (for Gateway URL+token vs single token). Include show/hide toggle, test button, save button.

- [ ] **Step 4: Extract AppearanceSection**

Move theme toggle, accent color picker, and `useAccentColor` hook into `AppearanceSection.tsx`.

- [ ] **Step 5: Extract ConnectionsSection**

Rewrite using `CredentialForm` instances. Gateway gets 2 fields (URL + token), GitHub and TaskRunner get 1 field each. Use actual IPC methods: `window.api.testGatewayConnection(url, token)`, `window.api.github.fetch('/user')`, `window.api.sprint.healthCheck()`.

- [ ] **Step 6: Extract RepositoriesSection**

Move the existing `RepositoriesSection` function (lines 71-236) to its own file. Clean up imports.

- [ ] **Step 7: Extract TaskTemplatesSection**

Move the existing `TaskTemplatesSection` function (lines 240-348) to its own file.

- [ ] **Step 8: Extract AgentRuntimeSection**

Move agent binary path, permission mode, and related settings.

- [ ] **Step 9: Extract AboutSection**

Move about info (lines 816-838) to its own small component.

- [ ] **Step 10: Rewrite SettingsView.tsx as tab container**

Replace 841 LOC with ~60 LOC tab container that imports and renders sections.

- [ ] **Step 11: Run full test suite**

```bash
npm run typecheck && npm test
```

- [ ] **Step 12: Verify SettingsView is under 100 LOC**

```bash
wc -l src/renderer/src/views/SettingsView.tsx
```

Expected: Under 100 lines.

- [ ] **Step 13: Commit**

```bash
git add src/renderer/src/components/settings/ src/renderer/src/views/SettingsView.tsx
git commit -m "chore: decompose SettingsView into section components

Splits 841-LOC monolith into tab container + 7 section components.
Introduces CredentialForm to eliminate 3x copy-pasted credential logic."
```

---

## Task 6: Decompose SprintCenter (WS6)

**Branch:** `chore/ws6-decompose-sprint-center`
**Depends on:** WS3 merged

**Files:**

- Create: `src/renderer/src/components/sprint/SprintToolbar.tsx`
- Create: `src/renderer/src/hooks/useSprintTaskActions.ts`
- Modify: `src/renderer/src/components/sprint/SprintCenter.tsx` — reduce to layout shell
- Modify: `src/renderer/src/hooks/useSprintPolling.ts` — update to split stores
- Modify: `src/renderer/src/hooks/useSprintKeyboardShortcuts.ts` — update to split stores

- [ ] **Step 1: Create branch (after WS3 merge)**

```bash
git checkout main && git pull && git checkout -b chore/ws6-decompose-sprint-center
```

- [ ] **Step 2: Create useSprintTaskActions hook**

Create `src/renderer/src/hooks/useSprintTaskActions.ts` with task lifecycle callbacks extracted from SprintCenter. Key behaviors to preserve:

- `handleStop` uses `TASK_STATUS.CANCELLED` (not 'failed'), checks `task.agent_run_id` is not null
- `handleRerun` creates a NEW task via `createTask()`, does NOT mutate the existing task

```typescript
import { useCallback } from 'react'
import { useSprintTasks } from '../stores/sprintTasks'
import { TASK_STATUS } from '../../../shared/constants'
import type { SprintTask } from '../../../shared/types'

export function useSprintTaskActions() {
  const updateTask = useSprintTasks((s) => s.updateTask)
  const deleteTask = useSprintTasks((s) => s.deleteTask)
  const launchTask = useSprintTasks((s) => s.launchTask)
  const createTask = useSprintTasks((s) => s.createTask)

  const handleMarkDone = useCallback(
    (task: SprintTask) => {
      updateTask(task.id, { status: TASK_STATUS.DONE })
    },
    [updateTask]
  )

  const handleStop = useCallback(
    async (task: SprintTask) => {
      if (!task.agent_run_id) return
      // Use existing confirm pattern from SprintCenter
      await window.api.killAgent(task.agent_run_id)
      await updateTask(task.id, { status: TASK_STATUS.CANCELLED })
    },
    [updateTask]
  )

  const handleRerun = useCallback(
    async (task: SprintTask) => {
      await createTask({
        title: task.title,
        prompt: task.prompt ?? '',
        repo: task.repo,
        priority: task.priority,
        template_name: task.template_name
      })
    },
    [createTask]
  )

  const handleDelete = useCallback(
    async (task: SprintTask) => {
      await deleteTask(task.id)
    },
    [deleteTask]
  )

  return { handleMarkDone, handleStop, handleRerun, handleDelete, handleLaunch: launchTask }
}
```

- [ ] **Step 3: Create SprintToolbar.tsx**

Extract toolbar UI (repo filter, create button, view toggle) from SprintCenter into `src/renderer/src/components/sprint/SprintToolbar.tsx`.

- [ ] **Step 4: Update existing hooks for split stores**

Update `useSprintPolling.ts` and `useSprintKeyboardShortcuts.ts` to import from `sprintTasks`, `sprintUI`, `sprintEvents` instead of `sprint`. Preserve existing function signatures (e.g., `useSprintKeyboardShortcuts` still takes `{ setModalOpen, setConflictDrawerOpen }`).

- [ ] **Step 5: Rewrite SprintCenter.tsx**

Reduce to ~150 LOC layout shell. Import and use `useSprintTaskActions()`, `SprintToolbar`, and the updated hooks.

- [ ] **Step 6: Run full test suite**

```bash
npm run typecheck && npm test
```

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/components/sprint/ src/renderer/src/hooks/
git commit -m "chore: decompose SprintCenter into layout shell, toolbar, and hooks

Extracts SprintToolbar and useSprintTaskActions from 456-LOC SprintCenter.
Updates existing hooks to use split stores from WS3."
```

---

## Task 7: Error Handling Cleanup (WS7)

**Branch:** `chore/ws7-error-handling-cleanup`

**Files:**

- Modify: `src/shared/types.ts` — add `Result<T>` type
- Modify: `src/main/git.ts` — refactor gitStatus, gitDiffFile to return Result
- Modify: `src/main/handlers/git-handlers.ts` — unwrap Results, log errors
- Modify: `src/main/local-agents.ts` — fix fire-and-forget, refactor extractAgentCost
- Modify: `src/main/handlers/sprint-local.ts` — improve error messages

- [ ] **Step 1: Create branch**

```bash
git checkout main && git checkout -b chore/ws7-error-handling-cleanup
```

- [ ] **Step 2: Add Result type to shared/types.ts**

```typescript
/** Lightweight result type for expected failures. */
export type Result<T> = { ok: true; data: T } | { ok: false; error: string }
```

- [ ] **Step 3: Refactor gitStatus to return Result**

In `src/main/git.ts`, change `gitStatus` from:

```typescript
} catch {
  return { files: [] }
}
```

To:

```typescript
} catch (err) {
  return { ok: false, error: `git status failed in ${cwd}: ${err instanceof Error ? err.message : String(err)}` }
}
```

And wrap the success path in `{ ok: true, data: ... }`.

- [ ] **Step 4: Refactor gitDiffFile to return Result**

Same pattern — return `Result<string>` instead of empty string on error.

- [ ] **Step 5: Update git-handlers.ts to unwrap Results**

IPC handlers unwrap Result and log errors while preserving the existing IPC contract:

```typescript
safeHandle('git:status', async (_e, cwd) => {
  const result = await gitStatus(cwd)
  if (!result.ok) {
    console.warn('[git:status]', result.error)
    return { files: [] }
  }
  return result.data
})
```

- [ ] **Step 6: Fix consumeEvents fire-and-forget**

In `src/main/local-agents.ts` line 183, change:

```typescript
consumeEvents(id, handle, meta.logPath).catch(() => {})
```

To:

```typescript
consumeEvents(id, handle, meta.logPath).catch((err) => {
  console.error(`[agents] Event consumption failed for ${id}:`, err)
})
```

- [ ] **Step 7: Refactor extractAgentCost to return Result**

Change return type to `Promise<Result<AgentCost | null>>`. Callers can distinguish parsing failure from "no cost yet".

- [ ] **Step 8: Improve error messages**

Add context to: `'GitHub token not configured'` → `'GitHub token not configured. Set it in Settings → Connections.'`

- [ ] **Step 9: Run full test suite**

```bash
npm run typecheck && npm test
```

- [ ] **Step 10: Verify no silent catches remain**

```bash
grep -n "catch {" src/main/git.ts src/main/local-agents.ts
grep -n "\.catch(() => {})" src/main/local-agents.ts
```

Expected: Zero results for truly silent catches.

- [ ] **Step 11: Commit**

```bash
git add src/shared/types.ts src/main/git.ts src/main/handlers/git-handlers.ts src/main/local-agents.ts src/main/handlers/sprint-local.ts src/main/handlers/agent-handlers.ts
git commit -m "chore: add Result type and fix silent error handling

Introduces Result<T> for expected failures. Refactors git.ts to return
Results with context. Fixes fire-and-forget in consumeEvents. Adds
context to error messages."
```

---

## Task 8: Terminal Decoupling (WS8)

**Branch:** `chore/ws8-terminal-decoupling`

**Files:**

- Create: `src/main/pty.ts`
- Create: `src/main/__tests__/pty.test.ts`
- Modify: `src/main/handlers/terminal-handlers.ts` — thin Electron wiring

- [ ] **Step 1: Create branch**

```bash
git checkout main && git checkout -b chore/ws8-terminal-decoupling
```

- [ ] **Step 2: Write pty.test.ts**

Create `src/main/__tests__/pty.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { isPtyAvailable, validateShell } from '../pty'

describe('pty', () => {
  it('reports availability', () => {
    expect(typeof isPtyAvailable()).toBe('boolean')
  })

  it('validates allowed shells', () => {
    expect(validateShell('/bin/zsh')).toBe(true)
    expect(validateShell('/bin/bash')).toBe(true)
    expect(validateShell('/bin/sh')).toBe(true)
    expect(validateShell('/usr/bin/evil')).toBe(false)
    expect(validateShell('')).toBe(false)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

```bash
npx vitest run src/main/__tests__/pty.test.ts
```

Expected: FAIL (module not found).

- [ ] **Step 4: Create pty.ts**

Create `src/main/pty.ts` with pure PTY management. Copy the `ALLOWED_SHELLS` set exactly from `terminal-handlers.ts`. Use the same `pty.spawn` options. Do NOT import Electron. Use integer-agnostic `PtyHandle` (no ID — IDs managed by handler):

```typescript
import type { IPty } from 'node-pty'

let pty: typeof import('node-pty') | null = null
try {
  pty = require('node-pty')
} catch {
  /* terminal unavailable */
}

export function _setPty(mock: typeof import('node-pty') | null): void {
  pty = mock
}

const ALLOWED_SHELLS = new Set([
  '/bin/bash',
  '/bin/zsh',
  '/bin/sh',
  '/bin/dash',
  '/bin/fish',
  '/usr/bin/bash',
  '/usr/bin/zsh',
  '/usr/bin/sh',
  '/usr/bin/dash',
  '/usr/bin/fish',
  '/usr/local/bin/bash',
  '/usr/local/bin/zsh',
  '/usr/local/bin/fish',
  '/opt/homebrew/bin/bash',
  '/opt/homebrew/bin/zsh',
  '/opt/homebrew/bin/fish'
])

export function isPtyAvailable(): boolean {
  return pty !== null
}
export function validateShell(shell: string): boolean {
  return ALLOWED_SHELLS.has(shell)
}

export interface PtyHandle {
  process: IPty
  onData: (cb: (data: string) => void) => void
  onExit: (cb: () => void) => void
  write: (data: string) => void
  resize: (cols: number, rows: number) => void
  kill: () => void
}

export function createPty(opts: {
  shell: string
  cols: number
  rows: number
  cwd?: string
}): PtyHandle {
  if (!pty) throw new Error('Terminal unavailable: node-pty failed to load')
  if (!validateShell(opts.shell)) throw new Error(`Shell not allowed: "${opts.shell}"`)
  const proc = pty.spawn(opts.shell, [], {
    name: 'xterm-256color',
    cols: opts.cols,
    rows: opts.rows,
    cwd: opts.cwd ?? process.env.HOME ?? '/',
    env: { ...process.env, TERM: 'xterm-256color' } as Record<string, string>
  })
  return {
    process: proc,
    onData: (cb) => {
      proc.onData(cb)
    },
    onExit: (cb) => {
      proc.onExit(() => cb())
    },
    write: (data) => {
      proc.write(data)
    },
    resize: (cols, rows) => {
      proc.resize(cols, rows)
    },
    kill: () => {
      proc.kill()
    }
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
npx vitest run src/main/__tests__/pty.test.ts
```

Expected: PASS.

- [ ] **Step 6: Rewrite terminal-handlers.ts**

Rewrite `src/main/handlers/terminal-handlers.ts` to import from `../pty`. Preserve exact IPC contract:

- Integer IDs (`let termId = 0; const id = ++termId`)
- `ipcMain.on` for `terminal:write` with `{ id, data }` payload
- `terminal:exit:${id}` sends no payload
- `terminal:data:${id}` data forwarding via BrowserWindow
- `terminalWindows` map for window tracking
- Data length guard (`data.length > 65_536`)

- [ ] **Step 7: Run full test suite**

```bash
npm run typecheck && npm test
```

- [ ] **Step 8: Verify no BrowserWindow in pty.ts**

```bash
grep -n "BrowserWindow" src/main/pty.ts
```

Expected: Zero results.

- [ ] **Step 9: Commit**

```bash
git add src/main/pty.ts src/main/__tests__/pty.test.ts src/main/handlers/terminal-handlers.ts
git commit -m "chore: decouple PTY management from Electron

Extracts pure pty.ts with createPty, validateShell, isPtyAvailable.
Terminal handlers become thin Electron wiring. PTY logic now testable
without mocking Electron. Preserves integer ID IPC contract."
```

---

## Final Integration

After all 8 workstreams are merged:

- [ ] **Run full check**

```bash
npm run typecheck && npm test && npm run lint
```

- [ ] **Verify audit improvements**

```bash
# No dependency direction violations
grep -r "from.*main/agents/types" src/shared src/preload src/renderer

# No monolithic sprint store
grep -rn "useSprintStore" src/renderer/

# No old sprint-local
grep -rn "sprint-local" src/main/

# SettingsView under 100 LOC
wc -l src/renderer/src/views/SettingsView.tsx

# No silent catches in git.ts
grep -n "catch {" src/main/git.ts

# No BrowserWindow in pty.ts
grep -n "BrowserWindow" src/main/pty.ts
```
