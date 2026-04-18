# BDE MCP Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose BDE's task and epic CRUD to local MCP-speaking agents (Claude Code, Cursor, etc.) as a Streamable-HTTP MCP server running inside the Electron main process, opt-in via a Settings toggle.

**Architecture:** New `src/main/mcp-server/` module. Transport: `@modelcontextprotocol/sdk`'s Streamable HTTP, bound to `127.0.0.1:<port>`. Auth: bearer token stored in `~/.bde/mcp-token` mode 0600. All mutations routed through existing services (`sprint-service`, new `EpicGroupService`) so validation, status-transition checks, audit trail in `task_changes`, and renderer broadcast via `notifySprintMutation` are preserved. Two in-scope refactors (extract `createTaskWithValidation` into `sprint-service`; extract `EpicGroupService` from `group-handlers.ts`) ensure IPC and MCP paths are bit-for-bit identical.

**Tech Stack:** TypeScript, Electron 39 main process, Node `http`, `@modelcontextprotocol/sdk`, `zod` (already a dep), vitest, better-sqlite3 (already a dep), React + TypeScript for Settings UI.

**Spec:** `docs/superpowers/specs/2026-04-17-bde-mcp-server-design.md`

---

## File Structure

**New files (main process) — 12:**
- `src/main/services/epic-group-service.ts` — service wrapping `task-group-queries` + epic dependency index; refactor per spec §7.1.
- `src/main/mcp-server/index.ts` — `createMcpServer(deps, config)` factory.
- `src/main/mcp-server/transport.ts` — HTTP request handler wiring the MCP SDK's Streamable HTTP transport.
- `src/main/mcp-server/auth.ts` — bearer-token middleware with `timingSafeEqual`.
- `src/main/mcp-server/token-store.ts` — read/generate `~/.bde/mcp-token`.
- `src/main/mcp-server/schemas.ts` — shared zod schemas for tool inputs.
- `src/main/mcp-server/errors.ts` — map service errors to MCP JSON-RPC errors.
- `src/main/mcp-server/tools/meta.ts` — `meta.repos`, `meta.taskStatuses`, `meta.dependencyConditions`.
- `src/main/mcp-server/tools/tasks.ts` — six task tools.
- `src/main/mcp-server/tools/epics.ts` — eight epic tools.
- `src/main/mcp-server/settings-events.ts` — local EventEmitter so `config:set` can signal hot-toggle.

**New files (tests) — 7:**
- `src/main/services/epic-group-service.test.ts`
- `src/main/mcp-server/token-store.test.ts`
- `src/main/mcp-server/auth.test.ts`
- `src/main/mcp-server/errors.test.ts`
- `src/main/mcp-server/tools/tasks.test.ts`
- `src/main/mcp-server/tools/epics.test.ts`
- `src/main/mcp-server/mcp-server.integration.test.ts`

**New files (renderer) — 2:**
- `src/renderer/src/components/settings/LocalMcpServerSection.tsx`
- `src/renderer/src/components/settings/LocalMcpServerSection.css`

**Modified files — 9:**
- `src/main/services/sprint-service.ts` — add `createTaskWithValidation(input, deps)`.
- `src/main/handlers/sprint-local.ts` — `sprint:create` handler delegates to `createTaskWithValidation`.
- `src/main/handlers/group-handlers.ts` — delegate all mutations to `EpicGroupService`.
- `src/main/handlers/config-handlers.ts` — emit on `settings-events` after `config:set`.
- `src/main/index.ts` — start/stop MCP server in whenReady; subscribe to settings events for hot-toggle.
- `src/renderer/src/components/settings/ConnectionsSection.tsx` — render the new `LocalMcpServerSection`.
- `package.json` — add `@modelcontextprotocol/sdk` dependency.
- `docs/BDE_FEATURES.md` — new "Local MCP Server" section.
- `CLAUDE.md` — one-line pointer under "Key File Locations".

**Module docs — 5:**
- `docs/modules/services/index.md` — row for `epic-group-service`; update `sprint-service` row.
- `docs/modules/services/epic-group-service.md` — new detail file.
- `docs/modules/handlers/index.md` — note that `group-handlers` now delegates.
- `docs/modules/components/index.md` — row for `LocalMcpServerSection`.
- `docs/modules/index.md` (or nearest main-process module index) — add `mcp-server/` directory overview.

---

## Phase 1 — Enabling refactors

### Task 1: Extract `createTaskWithValidation` into `sprint-service`

**Why:** Today `sprint-local.ts` contains all the validation-before-create logic. MCP must use the same path, so move it into `sprint-service` behind a single entry point. Handler becomes a thin wrapper.

**Files:**
- Modify: `src/main/services/sprint-service.ts`
- Modify: `src/main/handlers/sprint-local.ts`
- Create: `src/main/services/sprint-service.create.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/main/services/sprint-service.create.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createTaskWithValidation } from './sprint-service'
import type { CreateTaskInput } from './sprint-service'
import type { SprintTask, TaskGroup } from '../../shared/types'

// sprint-service pulls getDb() indirectly via sprint-mutations. Mock the
// mutation layer so no real DB is required.
vi.mock('./sprint-mutations', () => ({
  createTask: vi.fn(),
  listTasks: vi.fn(() => [] as SprintTask[])
}))
vi.mock('./sprint-mutation-broadcaster', () => ({
  notifySprintMutation: vi.fn()
}))
vi.mock('../data/task-group-queries', () => ({
  listGroups: vi.fn(() => [] as TaskGroup[])
}))
vi.mock('../git', () => ({
  getRepoPaths: vi.fn(() => ({ bde: '/fake/path' }))
}))

import * as mutations from './sprint-mutations'

describe('createTaskWithValidation', () => {
  const logger = { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects when repo is not configured', () => {
    const input: CreateTaskInput = { title: 't', repo: 'unknown', status: 'backlog' }
    expect(() => createTaskWithValidation(input, { logger })).toThrow(/not configured/)
    expect(mutations.createTask).not.toHaveBeenCalled()
  })

  it('rejects a queued task whose spec is missing required sections', () => {
    const input: CreateTaskInput = {
      title: 't',
      repo: 'bde',
      status: 'queued',
      spec: 'plain text with no headings'
    }
    expect(() => createTaskWithValidation(input, { logger })).toThrow(/Spec quality/)
    expect(mutations.createTask).not.toHaveBeenCalled()
  })

  it('delegates to sprint-mutations.createTask on valid input and returns the row', () => {
    const fakeRow = { id: 'abc', title: 't', repo: 'bde', status: 'backlog' } as SprintTask
    ;(mutations.createTask as ReturnType<typeof vi.fn>).mockReturnValue(fakeRow)

    const input: CreateTaskInput = { title: 't', repo: 'bde', status: 'backlog' }
    const result = createTaskWithValidation(input, { logger })

    expect(result).toBe(fakeRow)
    expect(mutations.createTask).toHaveBeenCalledWith(
      expect.objectContaining({ title: 't', repo: 'bde' })
    )
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/services/sprint-service.create.test.ts`
Expected: FAIL — `createTaskWithValidation is not a function` (or `is not exported`).

- [ ] **Step 3: Add `createTaskWithValidation` to `sprint-service.ts`**

Append at the bottom of `src/main/services/sprint-service.ts` (before the final `export` block if any):

```typescript
import { validateTaskCreation } from './task-validation'
import { SpecParser } from './spec-quality/spec-parser'
import { RequiredSectionsValidator } from './spec-quality/validators/sync-validators'
import { getRepoPaths } from '../git'
import { listGroups } from '../data/task-group-queries'

export interface CreateTaskWithValidationDeps {
  logger: { warn: (...args: unknown[]) => void; info: (...args: unknown[]) => void; error: (...args: unknown[]) => void; debug: (...args: unknown[]) => void }
}

/**
 * Single entry point for task creation used by both the IPC handler and the
 * MCP server. Runs spec-quality validation, checks repo configuration, then
 * delegates to createTask (which notifies sprint-mutation-broadcaster).
 */
export function createTaskWithValidation(
  input: mutations.CreateTaskInput,
  deps: CreateTaskWithValidationDeps
): SprintTask {
  const validation = validateTaskCreation(input, {
    logger: { warn: (...args: unknown[]) => deps.logger.warn(String(args[0])) },
    listTasks: mutations.listTasks,
    listGroups
  })
  if (!validation.valid) {
    throw new Error(`Spec quality checks failed: ${validation.errors.join('; ')}`)
  }

  if (validation.task.status === 'queued' && validation.task.spec) {
    const parsed = new SpecParser().parse(validation.task.spec)
    const sectionErrors = new RequiredSectionsValidator()
      .validate(parsed)
      .filter((issue) => issue.severity === 'error')
    if (sectionErrors.length > 0) {
      throw new Error(`Spec quality checks failed: ${sectionErrors[0].message}`)
    }
  }

  const repoPaths = getRepoPaths()
  if (!repoPaths[validation.task.repo]) {
    throw new Error(
      `Repo "${validation.task.repo}" is not configured. Add it in Settings > Repositories, then try again.`
    )
  }

  const row = createTask(validation.task)
  if (!row) throw new Error('Failed to create task')
  return row
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/services/sprint-service.create.test.ts`
Expected: PASS — 3 tests pass.

- [ ] **Step 5: Replace handler body in `sprint-local.ts` `sprint:create`**

In `src/main/handlers/sprint-local.ts`, replace the body of the `sprint:create` `safeHandle` registration (lines 62–94) with:

```typescript
  safeHandle('sprint:create', async (_e, task: CreateTaskInput) => {
    return createTaskWithValidation(task, { logger })
  })
```

Also add the import near the top:

```typescript
import {
  // ...existing imports...
  createTaskWithValidation
} from '../services/sprint-service'
```

Remove now-dead imports from `sprint-local.ts` if they are no longer referenced anywhere else in the file: `validateTaskCreation`, `SpecParser`, `RequiredSectionsValidator`, `getRepoPaths`, `listGroups`. Use your editor's "find references" to verify each one is unused before deleting.

- [ ] **Step 6: Run full test suite**

Run: `npm test`
Expected: all tests pass, including any existing `sprint-local` tests that exercised `sprint:create`.

- [ ] **Step 7: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: zero errors.

- [ ] **Step 8: Commit**

```bash
git add src/main/services/sprint-service.ts \
  src/main/services/sprint-service.create.test.ts \
  src/main/handlers/sprint-local.ts
git commit -m "refactor(sprint-service): extract createTaskWithValidation shared by IPC and MCP"
```

---

### Task 2: Extract `EpicGroupService` from `group-handlers`

**Why:** The in-memory epic dependency index currently lives inside the handler file, which means any non-IPC caller (MCP) cannot rebuild it. Pull it into a service.

**Files:**
- Create: `src/main/services/epic-group-service.ts`
- Create: `src/main/services/epic-group-service.test.ts`
- Modify: `src/main/handlers/group-handlers.ts`

- [ ] **Step 1: Write the failing test**

Create `src/main/services/epic-group-service.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createEpicGroupService } from './epic-group-service'
import type { TaskGroup, EpicDependency } from '../../shared/types'

const fakeGroup = (overrides: Partial<TaskGroup> = {}): TaskGroup => ({
  id: 'g1',
  name: 'Epic 1',
  icon: 'G',
  accent_color: '#0ff',
  goal: null,
  status: 'draft',
  created_at: '2026-04-17T00:00:00.000Z',
  updated_at: '2026-04-17T00:00:00.000Z',
  depends_on: null,
  ...overrides
})

describe('createEpicGroupService', () => {
  let queries: {
    createGroup: ReturnType<typeof vi.fn>
    listGroups: ReturnType<typeof vi.fn>
    getGroup: ReturnType<typeof vi.fn>
    updateGroup: ReturnType<typeof vi.fn>
    deleteGroup: ReturnType<typeof vi.fn>
    addTaskToGroup: ReturnType<typeof vi.fn>
    removeTaskFromGroup: ReturnType<typeof vi.fn>
    getGroupTasks: ReturnType<typeof vi.fn>
    reorderGroupTasks: ReturnType<typeof vi.fn>
    queueAllGroupTasks: ReturnType<typeof vi.fn>
    addGroupDependency: ReturnType<typeof vi.fn>
    removeGroupDependency: ReturnType<typeof vi.fn>
    updateGroupDependencyCondition: ReturnType<typeof vi.fn>
  }

  beforeEach(() => {
    queries = {
      createGroup: vi.fn((input) => fakeGroup({ id: 'new', ...input })),
      listGroups: vi.fn(() => [fakeGroup()]),
      getGroup: vi.fn((id: string) => fakeGroup({ id })),
      updateGroup: vi.fn((id: string, patch) => fakeGroup({ id, ...patch })),
      deleteGroup: vi.fn(),
      addTaskToGroup: vi.fn(() => true),
      removeTaskFromGroup: vi.fn(() => true),
      getGroupTasks: vi.fn(() => []),
      reorderGroupTasks: vi.fn(() => true),
      queueAllGroupTasks: vi.fn(() => 0),
      addGroupDependency: vi.fn((id, dep) =>
        fakeGroup({ id, depends_on: [dep] as EpicDependency[] })
      ),
      removeGroupDependency: vi.fn((id) => fakeGroup({ id })),
      updateGroupDependencyCondition: vi.fn((id) => fakeGroup({ id }))
    }
  })

  it('rebuilds the dependency index on every mutation', () => {
    const svc = createEpicGroupService(queries)
    expect(queries.listGroups).toHaveBeenCalledTimes(1) // initial rebuild
    svc.createEpic({ name: 'x' })
    svc.updateEpic('g1', { name: 'y' })
    svc.deleteEpic('g1')
    // 1 init + 3 mutations = 4
    expect(queries.listGroups).toHaveBeenCalledTimes(4)
  })

  it('rejects a dependency that would introduce a cycle', () => {
    // g1 already depends on g2 (configured through queries mocks below).
    queries.listGroups.mockReturnValue([
      fakeGroup({ id: 'g1', depends_on: [{ id: 'g2', condition: 'on_success' }] }),
      fakeGroup({ id: 'g2', depends_on: null })
    ])
    queries.getGroup.mockImplementation((id: string) => {
      if (id === 'g2') return fakeGroup({ id: 'g2', depends_on: null })
      return fakeGroup({ id: 'g1', depends_on: [{ id: 'g2', condition: 'on_success' }] })
    })

    const svc = createEpicGroupService(queries)
    // Attempting g2 → g1 closes the cycle.
    expect(() => svc.addDependency('g2', { id: 'g1', condition: 'on_success' })).toThrow(/cycle/i)
    expect(queries.addGroupDependency).not.toHaveBeenCalled()
  })

  it('throws on update when group does not exist', () => {
    queries.updateGroup.mockReturnValue(null)
    const svc = createEpicGroupService(queries)
    expect(() => svc.updateEpic('missing', { name: 'y' })).toThrow(/not found/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/services/epic-group-service.test.ts`
Expected: FAIL — `Cannot find module './epic-group-service'`.

- [ ] **Step 3: Create the service**

Create `src/main/services/epic-group-service.ts`:

```typescript
/**
 * EpicGroupService — mutation-side facade over task-group-queries plus the
 * in-memory epic dependency index. Owns index-rebuild so every caller (IPC,
 * MCP) sees identical behavior.
 */
import type { TaskGroup, EpicDependency, SprintTask } from '../../shared/types'
import type {
  CreateGroupInput,
  UpdateGroupInput
} from '../data/task-group-queries'
import {
  createGroup as defaultCreateGroup,
  listGroups as defaultListGroups,
  getGroup as defaultGetGroup,
  updateGroup as defaultUpdateGroup,
  deleteGroup as defaultDeleteGroup,
  addTaskToGroup as defaultAddTaskToGroup,
  removeTaskFromGroup as defaultRemoveTaskFromGroup,
  getGroupTasks as defaultGetGroupTasks,
  reorderGroupTasks as defaultReorderGroupTasks,
  queueAllGroupTasks as defaultQueueAllGroupTasks,
  addGroupDependency as defaultAddGroupDependency,
  removeGroupDependency as defaultRemoveGroupDependency,
  updateGroupDependencyCondition as defaultUpdateGroupDependencyCondition
} from '../data/task-group-queries'
import { createEpicDependencyIndex, detectEpicCycle } from './epic-dependency-service'

export interface EpicGroupQueries {
  createGroup: (input: CreateGroupInput) => TaskGroup | null
  listGroups: () => TaskGroup[]
  getGroup: (id: string) => TaskGroup | null
  updateGroup: (id: string, patch: UpdateGroupInput) => TaskGroup | null
  deleteGroup: (id: string) => void
  addTaskToGroup: (taskId: string, groupId: string) => boolean
  removeTaskFromGroup: (taskId: string) => boolean
  getGroupTasks: (groupId: string) => SprintTask[]
  reorderGroupTasks: (groupId: string, orderedTaskIds: string[]) => boolean
  queueAllGroupTasks: (groupId: string) => number
  addGroupDependency: (groupId: string, dep: EpicDependency) => TaskGroup | null
  removeGroupDependency: (groupId: string, upstreamId: string) => TaskGroup | null
  updateGroupDependencyCondition: (
    groupId: string,
    upstreamId: string,
    condition: EpicDependency['condition']
  ) => TaskGroup | null
}

export interface EpicGroupService {
  listEpics: () => TaskGroup[]
  getEpic: (id: string) => TaskGroup | null
  getEpicTasks: (id: string) => SprintTask[]
  createEpic: (input: CreateGroupInput) => TaskGroup
  updateEpic: (id: string, patch: UpdateGroupInput) => TaskGroup
  deleteEpic: (id: string) => void
  addTask: (epicId: string, taskId: string) => void
  removeTask: (taskId: string) => void
  reorderTasks: (epicId: string, orderedTaskIds: string[]) => void
  queueAllTasks: (epicId: string) => number
  addDependency: (epicId: string, dep: EpicDependency) => TaskGroup
  removeDependency: (epicId: string, upstreamId: string) => TaskGroup
  updateDependencyCondition: (
    epicId: string,
    upstreamId: string,
    condition: EpicDependency['condition']
  ) => TaskGroup
}

const defaultQueries: EpicGroupQueries = {
  createGroup: defaultCreateGroup,
  listGroups: defaultListGroups,
  getGroup: defaultGetGroup,
  updateGroup: defaultUpdateGroup,
  deleteGroup: defaultDeleteGroup,
  addTaskToGroup: defaultAddTaskToGroup,
  removeTaskFromGroup: defaultRemoveTaskFromGroup,
  getGroupTasks: defaultGetGroupTasks,
  reorderGroupTasks: defaultReorderGroupTasks,
  queueAllGroupTasks: defaultQueueAllGroupTasks,
  addGroupDependency: defaultAddGroupDependency,
  removeGroupDependency: defaultRemoveGroupDependency,
  updateGroupDependencyCondition: defaultUpdateGroupDependencyCondition
}

export function createEpicGroupService(
  queries: EpicGroupQueries = defaultQueries
): EpicGroupService {
  const index = createEpicDependencyIndex()

  function rebuildIndex(): void {
    index.rebuild(queries.listGroups())
  }

  rebuildIndex()

  function assertNoCycle(epicId: string, proposedDeps: EpicDependency[]): void {
    const cycle = detectEpicCycle(epicId, proposedDeps, (id) => {
      const g = queries.getGroup(id)
      return g?.depends_on ?? null
    })
    if (cycle) throw new Error(`Epic cycle detected: ${cycle.join(' -> ')}`)
  }

  return {
    listEpics: () => queries.listGroups(),
    getEpic: (id) => queries.getGroup(id),
    getEpicTasks: (id) => queries.getGroupTasks(id),

    createEpic(input) {
      const created = queries.createGroup(input)
      if (!created) throw new Error('Failed to create task group')
      rebuildIndex()
      return created
    },

    updateEpic(id, patch) {
      const updated = queries.updateGroup(id, patch)
      if (!updated) throw new Error(`Task group not found: ${id}`)
      rebuildIndex()
      return updated
    },

    deleteEpic(id) {
      queries.deleteGroup(id)
      rebuildIndex()
    },

    addTask(epicId, taskId) {
      const ok = queries.addTaskToGroup(taskId, epicId)
      if (!ok) throw new Error(`Failed to add task ${taskId} to group ${epicId}`)
    },

    removeTask(taskId) {
      const ok = queries.removeTaskFromGroup(taskId)
      if (!ok) throw new Error(`Failed to remove task ${taskId} from group`)
    },

    reorderTasks(epicId, orderedTaskIds) {
      const ok = queries.reorderGroupTasks(epicId, orderedTaskIds)
      if (!ok) throw new Error(`Failed to reorder tasks in group ${epicId}`)
    },

    queueAllTasks: (epicId) => queries.queueAllGroupTasks(epicId),

    addDependency(epicId, dep) {
      const group = queries.getGroup(epicId)
      if (!group) throw new Error(`Task group not found: ${epicId}`)
      const currentDeps = group.depends_on ?? []
      const proposedDeps = [...currentDeps, dep]
      assertNoCycle(epicId, proposedDeps)
      const updated = queries.addGroupDependency(epicId, dep)
      if (!updated) throw new Error(`Failed to add dependency to group ${epicId}`)
      rebuildIndex()
      return updated
    },

    removeDependency(epicId, upstreamId) {
      const updated = queries.removeGroupDependency(epicId, upstreamId)
      if (!updated) throw new Error(`Failed to remove dependency from group ${epicId}`)
      rebuildIndex()
      return updated
    },

    updateDependencyCondition(epicId, upstreamId, condition) {
      const updated = queries.updateGroupDependencyCondition(epicId, upstreamId, condition)
      if (!updated) throw new Error(`Failed to update dependency condition in group ${epicId}`)
      rebuildIndex()
      return updated
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/services/epic-group-service.test.ts`
Expected: PASS — 3 tests pass.

- [ ] **Step 5: Delegate `group-handlers.ts` to the service**

Replace the entire contents of `src/main/handlers/group-handlers.ts` with:

```typescript
import { safeHandle } from '../ipc-utils'
import { createEpicGroupService, type EpicGroupService } from '../services/epic-group-service'
import type {
  CreateGroupInput,
  UpdateGroupInput
} from '../data/task-group-queries'
import type { EpicDependency } from '../../shared/types'

// Module-level singleton — mirrors prior handler-file behavior. All callers
// share the same dependency index.
let service: EpicGroupService | null = null
function svc(): EpicGroupService {
  if (!service) service = createEpicGroupService()
  return service
}

export function getEpicGroupService(): EpicGroupService {
  return svc()
}

export function registerGroupHandlers(): void {
  svc() // force construction + initial index build

  safeHandle('groups:create', (_e, input: CreateGroupInput) => svc().createEpic(input))
  safeHandle('groups:list', () => svc().listEpics())
  safeHandle('groups:get', (_e, id: string) => svc().getEpic(id))
  safeHandle('groups:update', (_e, id: string, patch: UpdateGroupInput) => svc().updateEpic(id, patch))
  safeHandle('groups:delete', (_e, id: string) => svc().deleteEpic(id))

  safeHandle('groups:addTask', (_e, taskId: string, groupId: string) => {
    svc().addTask(groupId, taskId)
    return true
  })
  safeHandle('groups:removeTask', (_e, taskId: string) => {
    svc().removeTask(taskId)
    return true
  })
  safeHandle('groups:getGroupTasks', (_e, groupId: string) => svc().getEpicTasks(groupId))
  safeHandle('groups:queueAll', (_e, groupId: string) => svc().queueAllTasks(groupId))
  safeHandle('groups:reorderTasks', (_e, groupId: string, orderedTaskIds: string[]) => {
    svc().reorderTasks(groupId, orderedTaskIds)
    return true
  })
  safeHandle('groups:addDependency', (_e, groupId: string, dep: EpicDependency) =>
    svc().addDependency(groupId, dep)
  )
  safeHandle('groups:removeDependency', (_e, groupId: string, upstreamId: string) =>
    svc().removeDependency(groupId, upstreamId)
  )
  safeHandle('groups:updateDependencyCondition', (_e, groupId: string, upstreamId: string, condition: EpicDependency['condition']) =>
    svc().updateDependencyCondition(groupId, upstreamId, condition)
  )
}
```

- [ ] **Step 6: Run full test suite**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 7: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: zero errors.

- [ ] **Step 8: Commit**

```bash
git add src/main/services/epic-group-service.ts \
  src/main/services/epic-group-service.test.ts \
  src/main/handlers/group-handlers.ts
git commit -m "refactor(group-handlers): extract EpicGroupService for IPC + MCP reuse"
```

---

## Phase 2 — MCP infrastructure

### Task 3: Add `@modelcontextprotocol/sdk` dependency

**Files:**
- Modify: `package.json`, `package-lock.json`

- [ ] **Step 1: Install the dependency**

Run: `npm install @modelcontextprotocol/sdk@^1.0.0`
Expected: new entry in `package.json` dependencies, `package-lock.json` updated.

- [ ] **Step 2: Verify the install**

Run: `node -e "require('@modelcontextprotocol/sdk/server/index.js')"`
Expected: no output (import succeeds).

- [ ] **Step 3: Verify no native-module rebuild needed**

Run: `npm run typecheck`
Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(deps): add @modelcontextprotocol/sdk for MCP server"
```

---

### Task 4: Settings keys and defaults

**Files:**
- Modify: `src/main/settings.ts` — add two well-known keys.

- [ ] **Step 1: Add the settings keys**

At the bottom of `src/main/settings.ts` (near the other `SETTING_*` exports around line 52), add:

```typescript
// MCP server settings — read at startup and on settings-updated events
export const SETTING_MCP_ENABLED = 'mcp.enabled'
export const SETTING_MCP_PORT = 'mcp.port'
export const MCP_DEFAULT_PORT = 18792

/**
 * Read the MCP enabled flag. Stored as 'true' | 'false' in the settings table.
 * Defaults to false (opt-in).
 */
export function getMcpEnabled(): boolean {
  return getSetting(SETTING_MCP_ENABLED) === 'true'
}

/**
 * Read the MCP port. Falls back to MCP_DEFAULT_PORT when unset or malformed.
 */
export function getMcpPort(): number {
  const raw = getSetting(SETTING_MCP_PORT)
  if (!raw) return MCP_DEFAULT_PORT
  const n = Number(raw)
  return Number.isInteger(n) && n > 0 && n < 65536 ? n : MCP_DEFAULT_PORT
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add src/main/settings.ts
git commit -m "feat(settings): add mcp.enabled and mcp.port well-known keys"
```

---

### Task 5: Token store (`token-store.ts`)

**Files:**
- Create: `src/main/mcp-server/token-store.ts`
- Create: `src/main/mcp-server/token-store.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/main/mcp-server/token-store.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { readOrCreateToken, regenerateToken, tokenFilePath } from './token-store'

describe('token-store', () => {
  let dir: string
  let filePath: string

  beforeEach(async () => {
    dir = await fs.mkdtemp(join(tmpdir(), 'bde-mcp-token-'))
    filePath = join(dir, 'mcp-token')
  })

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true })
  })

  it('generates a 64-hex-char token when file is absent', async () => {
    const token = await readOrCreateToken(filePath)
    expect(token).toMatch(/^[0-9a-f]{64}$/)
    const stat = await fs.stat(filePath)
    // mode 0600 on the lower 9 bits
    expect(stat.mode & 0o777).toBe(0o600)
  })

  it('returns existing token on second call', async () => {
    const first = await readOrCreateToken(filePath)
    const second = await readOrCreateToken(filePath)
    expect(second).toBe(first)
  })

  it('regenerateToken overwrites the file with a new value', async () => {
    const first = await readOrCreateToken(filePath)
    const second = await regenerateToken(filePath)
    expect(second).not.toBe(first)
    expect(second).toMatch(/^[0-9a-f]{64}$/)
    const onDisk = (await fs.readFile(filePath, 'utf8')).trim()
    expect(onDisk).toBe(second)
  })

  it('tokenFilePath returns ~/.bde/mcp-token', () => {
    const p = tokenFilePath()
    expect(p.endsWith('/.bde/mcp-token')).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/mcp-server/token-store.test.ts`
Expected: FAIL — `Cannot find module './token-store'`.

- [ ] **Step 3: Create the token store**

Create `src/main/mcp-server/token-store.ts`:

```typescript
import { promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'

const TOKEN_BYTES = 32
const FILE_MODE = 0o600

export function tokenFilePath(): string {
  return join(homedir(), '.bde', 'mcp-token')
}

async function generateAndWrite(filePath: string): Promise<string> {
  const token = randomBytes(TOKEN_BYTES).toString('hex')
  await fs.mkdir(join(filePath, '..'), { recursive: true })
  await fs.writeFile(filePath, token + '\n', { mode: FILE_MODE, flag: 'w' })
  // Some platforms ignore the mode flag on open; enforce explicitly.
  await fs.chmod(filePath, FILE_MODE)
  return token
}

export async function readOrCreateToken(
  filePath: string = tokenFilePath()
): Promise<string> {
  try {
    const contents = await fs.readFile(filePath, 'utf8')
    const token = contents.trim()
    if (/^[0-9a-f]{64}$/.test(token)) return token
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code !== 'ENOENT') throw err
  }
  return generateAndWrite(filePath)
}

export async function regenerateToken(
  filePath: string = tokenFilePath()
): Promise<string> {
  return generateAndWrite(filePath)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/mcp-server/token-store.test.ts`
Expected: PASS — 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/main/mcp-server/token-store.ts src/main/mcp-server/token-store.test.ts
git commit -m "feat(mcp): add token store for bearer-token auth"
```

---

### Task 6: Auth middleware

**Files:**
- Create: `src/main/mcp-server/auth.ts`
- Create: `src/main/mcp-server/auth.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/main/mcp-server/auth.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { checkBearerAuth } from './auth'
import type { IncomingMessage } from 'node:http'

function fakeReq(headers: Record<string, string>): IncomingMessage {
  return { headers } as unknown as IncomingMessage
}

describe('checkBearerAuth', () => {
  const token = 'a'.repeat(64)

  it('returns ok when Authorization matches', () => {
    const result = checkBearerAuth(fakeReq({ authorization: `Bearer ${token}` }), token)
    expect(result.ok).toBe(true)
  })

  it('returns 401 when header is missing', () => {
    const result = checkBearerAuth(fakeReq({}), token)
    expect(result.ok).toBe(false)
    expect(result.status).toBe(401)
  })

  it('returns 401 when scheme is not Bearer', () => {
    const result = checkBearerAuth(fakeReq({ authorization: `Basic ${token}` }), token)
    expect(result.ok).toBe(false)
    expect(result.status).toBe(401)
  })

  it('returns 401 when token differs', () => {
    const other = 'b'.repeat(64)
    const result = checkBearerAuth(fakeReq({ authorization: `Bearer ${other}` }), token)
    expect(result.ok).toBe(false)
    expect(result.status).toBe(401)
  })

  it('returns 401 when token length differs (avoids timingSafeEqual throw)', () => {
    const result = checkBearerAuth(fakeReq({ authorization: `Bearer short` }), token)
    expect(result.ok).toBe(false)
    expect(result.status).toBe(401)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/mcp-server/auth.test.ts`
Expected: FAIL — `Cannot find module './auth'`.

- [ ] **Step 3: Create the middleware**

Create `src/main/mcp-server/auth.ts`:

```typescript
import type { IncomingMessage } from 'node:http'
import { timingSafeEqual } from 'node:crypto'

export type AuthResult =
  | { ok: true }
  | { ok: false; status: 401; message: string }

const DENY = (message: string): AuthResult => ({ ok: false, status: 401, message })

/**
 * Validate an inbound HTTP request carries `Authorization: Bearer <expected>`.
 * Uses timingSafeEqual to avoid leaking the expected token via string compare.
 */
export function checkBearerAuth(req: IncomingMessage, expected: string): AuthResult {
  const header = req.headers.authorization
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) {
    return DENY('missing bearer token')
  }
  const presented = header.slice('Bearer '.length).trim()
  if (presented.length !== expected.length) {
    return DENY('invalid bearer token')
  }
  const a = Buffer.from(presented, 'utf8')
  const b = Buffer.from(expected, 'utf8')
  if (!timingSafeEqual(a, b)) {
    return DENY('invalid bearer token')
  }
  return { ok: true }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/mcp-server/auth.test.ts`
Expected: PASS — 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/main/mcp-server/auth.ts src/main/mcp-server/auth.test.ts
git commit -m "feat(mcp): add bearer-token auth middleware"
```

---

### Task 7: Errors module

**Files:**
- Create: `src/main/mcp-server/errors.ts`
- Create: `src/main/mcp-server/errors.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/main/mcp-server/errors.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { toJsonRpcError, McpDomainError, McpErrorCode } from './errors'

describe('toJsonRpcError', () => {
  it('maps zod ZodError to -32602 Invalid params', () => {
    const schema = z.object({ id: z.string() })
    let caught: unknown
    try { schema.parse({}) } catch (err) { caught = err }
    const mapped = toJsonRpcError(caught)
    expect(mapped.code).toBe(-32602)
    expect(mapped.message).toMatch(/invalid/i)
    expect(mapped.data).toBeDefined()
  })

  it('maps McpDomainError with code NOT_FOUND to -32001', () => {
    const err = new McpDomainError('Task xyz not found', McpErrorCode.NotFound, { id: 'xyz' })
    const mapped = toJsonRpcError(err)
    expect(mapped.code).toBe(-32001)
    expect(mapped.data).toEqual({ id: 'xyz' })
  })

  it('maps McpDomainError with code INVALID_TRANSITION to -32002', () => {
    const err = new McpDomainError('bad transition', McpErrorCode.InvalidTransition)
    expect(toJsonRpcError(err).code).toBe(-32002)
  })

  it('maps McpDomainError with code CYCLE to -32003', () => {
    const err = new McpDomainError('cycle', McpErrorCode.Cycle)
    expect(toJsonRpcError(err).code).toBe(-32003)
  })

  it('maps McpDomainError with code FORBIDDEN_FIELD to -32004', () => {
    const err = new McpDomainError('nope', McpErrorCode.ForbiddenField)
    expect(toJsonRpcError(err).code).toBe(-32004)
  })

  it('maps any other thrown value to -32603 Internal error without leaking stack', () => {
    const mapped = toJsonRpcError(new Error('oops stack trace details'))
    expect(mapped.code).toBe(-32603)
    expect(mapped.message).toBe('Internal error')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/mcp-server/errors.test.ts`
Expected: FAIL — `Cannot find module './errors'`.

- [ ] **Step 3: Create the errors module**

Create `src/main/mcp-server/errors.ts`:

```typescript
import { ZodError } from 'zod'

export enum McpErrorCode {
  NotFound = 'NOT_FOUND',
  InvalidTransition = 'INVALID_TRANSITION',
  Cycle = 'CYCLE',
  ForbiddenField = 'FORBIDDEN_FIELD'
}

export class McpDomainError extends Error {
  constructor(
    message: string,
    public readonly kind: McpErrorCode,
    public readonly data?: Record<string, unknown>
  ) {
    super(message)
    this.name = 'McpDomainError'
  }
}

export interface JsonRpcErrorBody {
  code: number
  message: string
  data?: unknown
}

const CODE_MAP: Record<McpErrorCode, number> = {
  [McpErrorCode.NotFound]: -32001,
  [McpErrorCode.InvalidTransition]: -32002,
  [McpErrorCode.Cycle]: -32003,
  [McpErrorCode.ForbiddenField]: -32004
}

export function toJsonRpcError(err: unknown): JsonRpcErrorBody {
  if (err instanceof ZodError) {
    return {
      code: -32602,
      message: `Invalid params: ${err.issues.map((i) => i.message).join('; ')}`,
      data: { issues: err.issues }
    }
  }
  if (err instanceof McpDomainError) {
    return { code: CODE_MAP[err.kind], message: err.message, data: err.data }
  }
  // Unknown error — never leak internals.
  return { code: -32603, message: 'Internal error' }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/mcp-server/errors.test.ts`
Expected: PASS — 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/main/mcp-server/errors.ts src/main/mcp-server/errors.test.ts
git commit -m "feat(mcp): add JSON-RPC error mapping"
```

---

### Task 8: Shared zod schemas

**Files:**
- Create: `src/main/mcp-server/schemas.ts`

- [ ] **Step 1: Create the schema module**

Create `src/main/mcp-server/schemas.ts`:

```typescript
import { z } from 'zod'
import { TASK_STATUSES } from '../../shared/task-state-machine'

// --- Task schemas -----------------------------------------------------------

export const TaskStatusSchema = z.enum([...TASK_STATUSES] as [string, ...string[]])

export const TaskDependencySchema = z.object({
  id: z.string().min(1),
  type: z.enum(['hard', 'soft'])
})

/**
 * Write allow-list — fields an external agent may set on create/update.
 * System-managed fields (claimed_by, pr_*, completed_at, agent_run_id,
 * failure_reason, etc.) are intentionally absent.
 */
export const TaskWriteFieldsSchema = z.object({
  title: z.string().min(1).max(500),
  repo: z.string().min(1).max(200),
  status: TaskStatusSchema.optional(),
  spec: z.string().max(200_000).optional(),
  spec_type: z.enum(['feature', 'bug-fix', 'refactor', 'test-coverage', 'freeform', 'prompt']).optional(),
  priority: z.number().int().min(0).max(10).optional(),
  tags: z.array(z.string().min(1).max(64)).max(32).optional(),
  depends_on: z.array(TaskDependencySchema).max(32).optional(),
  playground_enabled: z.boolean().optional(),
  max_runtime_ms: z.number().int().min(60_000).max(86_400_000).optional(),
  group_id: z.string().min(1).nullable().optional()
})

export const TaskCreateSchema = TaskWriteFieldsSchema
export const TaskUpdateSchema = z.object({
  id: z.string().min(1),
  patch: TaskWriteFieldsSchema.partial()
})

export const TaskListSchema = z.object({
  status: TaskStatusSchema.optional(),
  repo: z.string().min(1).optional(),
  epicId: z.string().min(1).optional(),
  tag: z.string().min(1).optional(),
  search: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(500).optional(),
  offset: z.number().int().min(0).optional()
})

export const TaskIdSchema = z.object({ id: z.string().min(1) })

export const TaskCancelSchema = z.object({
  id: z.string().min(1),
  reason: z.string().max(500).optional()
})

export const TaskHistorySchema = z.object({
  id: z.string().min(1),
  limit: z.number().int().min(1).max(500).optional(),
  offset: z.number().int().min(0).optional()
})

// --- Epic schemas -----------------------------------------------------------

export const EpicDependencySchema = z.object({
  id: z.string().min(1),
  condition: z.enum(['on_success', 'always', 'manual'])
})

export const EpicWriteFieldsSchema = z.object({
  name: z.string().min(1).max(200),
  icon: z.string().max(4).optional(),
  accent_color: z.string().regex(/^#[0-9a-f]{6}$/i).optional(),
  goal: z.string().max(2000).nullable().optional()
})

export const EpicListSchema = z.object({
  status: z.enum(['draft', 'ready', 'in-pipeline', 'completed']).optional(),
  search: z.string().min(1).optional()
})

export const EpicIdSchema = z.object({
  id: z.string().min(1),
  includeTasks: z.boolean().optional()
})

export const EpicUpdateSchema = z.object({
  id: z.string().min(1),
  patch: EpicWriteFieldsSchema.partial().extend({
    status: z.enum(['draft', 'ready', 'in-pipeline', 'completed']).optional()
  })
})

export const EpicAddTaskSchema = z.object({
  epicId: z.string().min(1),
  taskId: z.string().min(1)
})

export const EpicRemoveTaskSchema = z.object({
  taskId: z.string().min(1)
})

export const EpicSetDependenciesSchema = z.object({
  id: z.string().min(1),
  dependencies: z.array(EpicDependencySchema).max(32)
})
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add src/main/mcp-server/schemas.ts
git commit -m "feat(mcp): add shared zod schemas for tool inputs"
```

---

## Phase 3 — Tools

### Task 9: Meta tools (`meta.*`)

**Files:**
- Create: `src/main/mcp-server/tools/meta.ts`

- [ ] **Step 1: Create the meta tools**

Create `src/main/mcp-server/tools/meta.ts`:

```typescript
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import {
  TASK_STATUSES,
  VALID_TRANSITIONS
} from '../../../shared/task-state-machine'
import { getSettingJson } from '../../settings'
import type { RepoConfig } from '../../paths'

export interface MetaToolsDeps {
  getRepos: () => RepoConfig[]
}

export function registerMetaTools(server: McpServer, deps: MetaToolsDeps): void {
  server.tool(
    'meta.repos',
    'List repositories configured in BDE Settings.',
    {},
    async () => ({
      content: [
        { type: 'text', text: JSON.stringify(deps.getRepos()) }
      ]
    })
  )

  server.tool(
    'meta.taskStatuses',
    'List valid task statuses and allowed transitions.',
    {},
    async () => {
      // VALID_TRANSITIONS is Record<string, Set<string>>; convert Sets → Arrays
      // for JSON serialization.
      const transitions: Record<string, string[]> = {}
      for (const [from, targets] of Object.entries(VALID_TRANSITIONS)) {
        transitions[from] = [...targets]
      }
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ statuses: TASK_STATUSES, transitions })
          }
        ]
      }
    }
  )

  server.tool(
    'meta.dependencyConditions',
    'List valid dependency condition values for tasks and epics.',
    {},
    async () => ({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            task: ['hard', 'soft'],
            epic: ['on_success', 'always', 'manual']
          })
        }
      ]
    })
  )
}

export function defaultGetRepos(): RepoConfig[] {
  return getSettingJson<RepoConfig[]>('repos') ?? []
}
```

`VALID_TRANSITIONS` is already exported from `src/shared/task-state-machine.ts:71` as `Record<string, Set<string>>` — the `Set` → `Array` conversion above is necessary for JSON serialization.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add src/main/mcp-server/tools/meta.ts
# Also stage task-state-machine.ts if you touched it.
git commit -m "feat(mcp): add meta.* tools (repos, taskStatuses, dependencyConditions)"
```

---

### Task 10: Task tools — read (`tasks.list`, `tasks.get`, `tasks.history`)

**Files:**
- Create: `src/main/mcp-server/tools/tasks.ts` (first half — read tools)
- Create: `src/main/mcp-server/tools/tasks.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/main/mcp-server/tools/tasks.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { registerTaskTools, type TaskToolsDeps } from './tasks'
import type { SprintTask } from '../../../shared/types'

type ToolHandler = (args: unknown) => Promise<{ content: Array<{ type: 'text'; text: string }> }>

function mockServer() {
  const handlers = new Map<string, ToolHandler>()
  return {
    server: {
      tool: (
        name: string,
        _desc: string,
        _schema: unknown,
        handler: ToolHandler
      ) => {
        handlers.set(name, handler)
      }
    } as any,
    call: (name: string, args: unknown) => {
      const h = handlers.get(name)
      if (!h) throw new Error(`no handler for ${name}`)
      return h(args)
    }
  }
}

const fakeTask = (overrides: Partial<SprintTask> = {}): SprintTask => ({
  id: 't1',
  title: 'demo',
  repo: 'bde',
  status: 'backlog',
  priority: 0,
  created_at: '2026-04-17T00:00:00.000Z',
  updated_at: '2026-04-17T00:00:00.000Z',
  claimed_by: null,
  tags: null,
  depends_on: null,
  group_id: null,
  spec: null,
  spec_type: null,
  notes: null,
  worktree_path: null,
  branch: null,
  pr_url: null,
  pr_number: null,
  pr_status: null,
  started_at: null,
  completed_at: null,
  agent_run_id: null,
  failure_reason: null,
  retry_count: 0,
  max_retries: 3,
  playground_enabled: 0,
  max_runtime_ms: null,
  template_name: null,
  ...(overrides as SprintTask)
}) as SprintTask

function fakeDeps(overrides: Partial<TaskToolsDeps> = {}): TaskToolsDeps {
  return {
    listTasks: vi.fn(() => [fakeTask()]),
    getTask: vi.fn(() => fakeTask()),
    createTaskWithValidation: vi.fn(() => fakeTask()),
    updateTask: vi.fn(() => fakeTask()),
    cancelTask: vi.fn(() => fakeTask({ status: 'cancelled' })),
    getTaskChanges: vi.fn(() => []),
    logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
    ...overrides
  }
}

describe('tasks.* read tools', () => {
  it('tasks.list filters by status and returns JSON text', async () => {
    const deps = fakeDeps()
    const { server, call } = mockServer()
    registerTaskTools(server, deps)
    const res = await call('tasks.list', { status: 'queued' })
    const parsed = JSON.parse(res.content[0].text)
    expect(Array.isArray(parsed)).toBe(true)
    expect(deps.listTasks).toHaveBeenCalled()
  })

  it('tasks.get returns -32001 when task missing', async () => {
    const deps = fakeDeps({ getTask: vi.fn(() => null) })
    const { server, call } = mockServer()
    registerTaskTools(server, deps)
    await expect(call('tasks.get', { id: 'missing' })).rejects.toThrow(/not found/)
  })

  it('tasks.history returns the change rows as JSON', async () => {
    const rows = [{ id: 'c1', task_id: 't1', field: 'status', old: 'queued', new: 'active' }]
    const deps = fakeDeps({ getTaskChanges: vi.fn(() => rows as any) })
    const { server, call } = mockServer()
    registerTaskTools(server, deps)
    const res = await call('tasks.history', { id: 't1' })
    expect(JSON.parse(res.content[0].text)).toEqual(rows)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/mcp-server/tools/tasks.test.ts`
Expected: FAIL — `Cannot find module './tasks'`.

- [ ] **Step 3: Create the tasks tools file with read tools**

Create `src/main/mcp-server/tools/tasks.ts`:

```typescript
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { SprintTask } from '../../../shared/types'
import type { TaskChange } from '../../data/task-changes'
import type { CreateTaskWithValidationDeps } from '../../services/sprint-service'
import type { CreateTaskInput } from '../../data/sprint-task-repository'
import { McpDomainError, McpErrorCode } from '../errors'
import {
  TaskCancelSchema,
  TaskCreateSchema,
  TaskHistorySchema,
  TaskIdSchema,
  TaskListSchema,
  TaskUpdateSchema
} from '../schemas'

export interface TaskToolsDeps {
  listTasks: (status?: string) => SprintTask[]
  getTask: (id: string) => SprintTask | null
  createTaskWithValidation: (input: CreateTaskInput, deps: CreateTaskWithValidationDeps) => SprintTask
  updateTask: (id: string, patch: Record<string, unknown>) => SprintTask | null
  cancelTask: (id: string, reason?: string) => SprintTask | null
  /** Mirrors the data-layer signature: (taskId, limit?). Offset is applied in the tool handler via slice. */
  getTaskChanges: (id: string, limit?: number) => TaskChange[]
  logger: CreateTaskWithValidationDeps['logger']
}

function json(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value) }] }
}

function filterInMemory(tasks: SprintTask[], args: ReturnType<typeof TaskListSchema.parse>): SprintTask[] {
  let out = tasks
  if (args.repo) out = out.filter((t) => t.repo === args.repo)
  if (args.epicId) out = out.filter((t) => t.group_id === args.epicId)
  if (args.tag) out = out.filter((t) => Array.isArray(t.tags) && t.tags.includes(args.tag!))
  if (args.search) {
    const q = args.search.toLowerCase()
    out = out.filter((t) =>
      t.title.toLowerCase().includes(q) ||
      (t.spec ? t.spec.toLowerCase().includes(q) : false)
    )
  }
  const offset = args.offset ?? 0
  const limit = args.limit ?? 100
  return out.slice(offset, offset + limit)
}

export function registerTaskTools(server: McpServer, deps: TaskToolsDeps): void {
  server.tool(
    'tasks.list',
    'List sprint tasks with optional filters (status, repo, epicId, tag, search).',
    TaskListSchema.shape,
    async (rawArgs) => {
      const args = TaskListSchema.parse(rawArgs)
      const rows = deps.listTasks(args.status)
      return json(filterInMemory(rows, args))
    }
  )

  server.tool(
    'tasks.get',
    'Fetch one task by id.',
    TaskIdSchema.shape,
    async (rawArgs) => {
      const { id } = TaskIdSchema.parse(rawArgs)
      const row = deps.getTask(id)
      if (!row) throw new McpDomainError(`Task ${id} not found`, McpErrorCode.NotFound, { id })
      return json(row)
    }
  )

  server.tool(
    'tasks.history',
    'Fetch the audit trail (field-level change log) for a task.',
    TaskHistorySchema.shape,
    async (rawArgs) => {
      const { id, limit, offset } = TaskHistorySchema.parse(rawArgs)
      const task = deps.getTask(id)
      if (!task) throw new McpDomainError(`Task ${id} not found`, McpErrorCode.NotFound, { id })
      // Fetch limit + offset rows, then slice; keeps the data-layer API unchanged.
      const effectiveLimit = (limit ?? 100) + (offset ?? 0)
      const rows = deps.getTaskChanges(id, effectiveLimit)
      return json(rows.slice(offset ?? 0))
    }
  )

  // tasks.create, tasks.update, tasks.cancel registered in Task 11.
  registerTaskWriteTools(server, deps)
}

// Placeholder so the file typechecks between task 10 and task 11.
function registerTaskWriteTools(_server: McpServer, _deps: TaskToolsDeps): void {
  // Implemented in Task 11.
}
```

- [ ] **Step 4: Run tests to verify the three passing**

Run: `npx vitest run src/main/mcp-server/tools/tasks.test.ts`
Expected: PASS — the three tests in the `read tools` describe pass. Other tests (write) will be added in Task 11.

- [ ] **Step 5: Commit**

```bash
git add src/main/mcp-server/tools/tasks.ts src/main/mcp-server/tools/tasks.test.ts
git commit -m "feat(mcp): add tasks.list / tasks.get / tasks.history tools"
```

---

### Task 11: Task tools — write (`tasks.create`, `tasks.update`, `tasks.cancel`)

**Files:**
- Modify: `src/main/mcp-server/tools/tasks.ts`
- Modify: `src/main/mcp-server/tools/tasks.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `src/main/mcp-server/tools/tasks.test.ts` (inside the same top-level `describe` or a sibling):

```typescript
describe('tasks.* write tools', () => {
  it('tasks.create delegates to createTaskWithValidation', async () => {
    const deps = fakeDeps()
    const { server, call } = mockServer()
    registerTaskTools(server, deps)
    const res = await call('tasks.create', { title: 't', repo: 'bde' })
    expect(deps.createTaskWithValidation).toHaveBeenCalledWith(
      expect.objectContaining({ title: 't', repo: 'bde' }),
      expect.any(Object)
    )
    expect(JSON.parse(res.content[0].text).id).toBe('t1')
  })

  it('tasks.create rejects forbidden fields', async () => {
    const deps = fakeDeps()
    const { server, call } = mockServer()
    registerTaskTools(server, deps)
    // claimed_by is system-managed; zod strips unknown keys on .parse, so
    // a forbidden field that survives is a schema bug. Assert the schema
    // strips it by ensuring the delegate was not asked to set it.
    await call('tasks.create', { title: 't', repo: 'bde', claimed_by: 'x' } as any)
    const call0 = (deps.createTaskWithValidation as any).mock.calls[0][0]
    expect(call0.claimed_by).toBeUndefined()
  })

  it('tasks.update rejects invalid transitions via McpDomainError', async () => {
    const deps = fakeDeps({
      updateTask: vi.fn(() => {
        throw new Error('Invalid status transition: done → queued for task t1')
      })
    })
    const { server, call } = mockServer()
    registerTaskTools(server, deps)
    await expect(
      call('tasks.update', { id: 't1', patch: { status: 'queued' } })
    ).rejects.toThrow()
  })

  it('tasks.cancel routes through cancelTask (which triggers onStatusTerminal)', async () => {
    const deps = fakeDeps()
    const { server, call } = mockServer()
    registerTaskTools(server, deps)
    const res = await call('tasks.cancel', { id: 't1', reason: 'no longer needed' })
    expect(deps.cancelTask).toHaveBeenCalledWith('t1', 'no longer needed')
    expect(JSON.parse(res.content[0].text).status).toBe('cancelled')
  })
})
```

- [ ] **Step 2: Run tests to verify the four failing**

Run: `npx vitest run src/main/mcp-server/tools/tasks.test.ts`
Expected: FAIL — four new tests fail because `registerTaskWriteTools` is a no-op.

- [ ] **Step 3: Replace the `registerTaskWriteTools` stub**

In `src/main/mcp-server/tools/tasks.ts`, replace the stub body with:

```typescript
function registerTaskWriteTools(server: McpServer, deps: TaskToolsDeps): void {
  server.tool(
    'tasks.create',
    'Create a new sprint task. Runs the same validation as the in-app Task Workbench.',
    TaskCreateSchema.shape,
    async (rawArgs) => {
      const input = TaskCreateSchema.parse(rawArgs) as CreateTaskInput
      const row = deps.createTaskWithValidation(input, { logger: deps.logger })
      return json(row)
    }
  )

  server.tool(
    'tasks.update',
    'Update an existing task. Status transitions are validated; forbidden fields are stripped.',
    TaskUpdateSchema.shape,
    async (rawArgs) => {
      const { id, patch } = TaskUpdateSchema.parse(rawArgs)
      const row = deps.updateTask(id, patch)
      if (!row) throw new McpDomainError(`Task ${id} not found`, McpErrorCode.NotFound, { id })
      return json(row)
    }
  )

  server.tool(
    'tasks.cancel',
    'Cancel a task. Runs through the terminal-status path so dependents are re-evaluated.',
    TaskCancelSchema.shape,
    async (rawArgs) => {
      const { id, reason } = TaskCancelSchema.parse(rawArgs)
      const row = deps.cancelTask(id, reason)
      if (!row) throw new McpDomainError(`Task ${id} not found`, McpErrorCode.NotFound, { id })
      return json(row)
    }
  )
}
```

- [ ] **Step 4: Run tests to verify all passing**

Run: `npx vitest run src/main/mcp-server/tools/tasks.test.ts`
Expected: PASS — 7 tests total.

- [ ] **Step 5: Commit**

```bash
git add src/main/mcp-server/tools/tasks.ts src/main/mcp-server/tools/tasks.test.ts
git commit -m "feat(mcp): add tasks.create / tasks.update / tasks.cancel tools"
```

---

### Task 12: Epic tools (`epics.*`)

**Files:**
- Create: `src/main/mcp-server/tools/epics.ts`
- Create: `src/main/mcp-server/tools/epics.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/main/mcp-server/tools/epics.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { registerEpicTools, type EpicToolsDeps } from './epics'
import type { TaskGroup } from '../../../shared/types'

type ToolHandler = (args: unknown) => Promise<{ content: Array<{ type: 'text'; text: string }> }>

function mockServer() {
  const handlers = new Map<string, ToolHandler>()
  return {
    server: {
      tool: (name: string, _d: string, _s: unknown, h: ToolHandler) => {
        handlers.set(name, h)
      }
    } as any,
    call: (name: string, args: unknown) => handlers.get(name)!(args)
  }
}

const fakeGroup = (overrides: Partial<TaskGroup> = {}): TaskGroup => ({
  id: 'g1',
  name: 'E1',
  icon: 'G',
  accent_color: '#0ff',
  goal: null,
  status: 'draft',
  created_at: '2026-04-17T00:00:00.000Z',
  updated_at: '2026-04-17T00:00:00.000Z',
  depends_on: null,
  ...overrides
})

function fakeDeps(over: Partial<EpicToolsDeps> = {}): EpicToolsDeps {
  const svc = {
    listEpics: vi.fn(() => [fakeGroup()]),
    getEpic: vi.fn(() => fakeGroup()),
    getEpicTasks: vi.fn(() => []),
    createEpic: vi.fn((i) => fakeGroup({ id: 'new', ...i })),
    updateEpic: vi.fn((id, patch) => fakeGroup({ id, ...patch })),
    deleteEpic: vi.fn(),
    addTask: vi.fn(),
    removeTask: vi.fn(),
    reorderTasks: vi.fn(),
    queueAllTasks: vi.fn(() => 0),
    addDependency: vi.fn((id, dep) => fakeGroup({ id, depends_on: [dep] })),
    removeDependency: vi.fn((id) => fakeGroup({ id })),
    updateDependencyCondition: vi.fn((id) => fakeGroup({ id }))
  }
  return { epicService: svc as any, ...over }
}

describe('epics.* tools', () => {
  it('epics.list returns JSON text', async () => {
    const { server, call } = mockServer()
    registerEpicTools(server, fakeDeps())
    const res = await call('epics.list', {})
    expect(Array.isArray(JSON.parse(res.content[0].text))).toBe(true)
  })

  it('epics.get returns -32001 when missing', async () => {
    const deps = fakeDeps()
    ;(deps.epicService.getEpic as any).mockReturnValue(null)
    const { server, call } = mockServer()
    registerEpicTools(server, deps)
    await expect(call('epics.get', { id: 'missing' })).rejects.toThrow(/not found/)
  })

  it('epics.get includes tasks when includeTasks is true', async () => {
    const deps = fakeDeps()
    const { server, call } = mockServer()
    registerEpicTools(server, deps)
    const res = await call('epics.get', { id: 'g1', includeTasks: true })
    const body = JSON.parse(res.content[0].text)
    expect(body).toHaveProperty('tasks')
    expect(deps.epicService.getEpicTasks).toHaveBeenCalledWith('g1')
  })

  it('epics.create delegates to service', async () => {
    const deps = fakeDeps()
    const { server, call } = mockServer()
    registerEpicTools(server, deps)
    const res = await call('epics.create', { name: 'new' })
    expect(deps.epicService.createEpic).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'new' })
    )
    expect(JSON.parse(res.content[0].text).id).toBe('new')
  })

  it('epics.setDependencies replaces the deps by computing diff', async () => {
    const deps = fakeDeps()
    ;(deps.epicService.getEpic as any).mockReturnValue(
      fakeGroup({ depends_on: [{ id: 'old', condition: 'on_success' }] })
    )
    const { server, call } = mockServer()
    registerEpicTools(server, deps)
    await call('epics.setDependencies', {
      id: 'g1',
      dependencies: [{ id: 'new', condition: 'always' }]
    })
    expect(deps.epicService.removeDependency).toHaveBeenCalledWith('g1', 'old')
    expect(deps.epicService.addDependency).toHaveBeenCalledWith('g1', {
      id: 'new',
      condition: 'always'
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/mcp-server/tools/epics.test.ts`
Expected: FAIL — `Cannot find module './epics'`.

- [ ] **Step 3: Create the epics tool file**

Create `src/main/mcp-server/tools/epics.ts`:

```typescript
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { EpicGroupService } from '../../services/epic-group-service'
import type { EpicDependency } from '../../../shared/types'
import { McpDomainError, McpErrorCode } from '../errors'
import {
  EpicAddTaskSchema,
  EpicIdSchema,
  EpicListSchema,
  EpicRemoveTaskSchema,
  EpicSetDependenciesSchema,
  EpicUpdateSchema,
  EpicWriteFieldsSchema
} from '../schemas'

export interface EpicToolsDeps {
  epicService: EpicGroupService
}

function json(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value) }] }
}

export function registerEpicTools(server: McpServer, deps: EpicToolsDeps): void {
  const svc = deps.epicService

  server.tool(
    'epics.list',
    'List epics (task groups). Optionally filter by status or search string on name.',
    EpicListSchema.shape,
    async (rawArgs) => {
      const args = EpicListSchema.parse(rawArgs)
      let rows = svc.listEpics()
      if (args.status) rows = rows.filter((e) => e.status === args.status)
      if (args.search) {
        const q = args.search.toLowerCase()
        rows = rows.filter((e) => e.name.toLowerCase().includes(q))
      }
      return json(rows)
    }
  )

  server.tool(
    'epics.get',
    'Fetch one epic by id. Pass includeTasks=true to also return the epic\'s task list.',
    EpicIdSchema.shape,
    async (rawArgs) => {
      const { id, includeTasks } = EpicIdSchema.parse(rawArgs)
      const epic = svc.getEpic(id)
      if (!epic) throw new McpDomainError(`Epic ${id} not found`, McpErrorCode.NotFound, { id })
      if (includeTasks) {
        return json({ ...epic, tasks: svc.getEpicTasks(id) })
      }
      return json(epic)
    }
  )

  server.tool(
    'epics.create',
    'Create a new epic (task group).',
    EpicWriteFieldsSchema.shape,
    async (rawArgs) => {
      const input = EpicWriteFieldsSchema.parse(rawArgs)
      return json(svc.createEpic(input))
    }
  )

  server.tool(
    'epics.update',
    'Update an epic\'s fields (name, icon, accent_color, goal, status).',
    EpicUpdateSchema.shape,
    async (rawArgs) => {
      const { id, patch } = EpicUpdateSchema.parse(rawArgs)
      return json(svc.updateEpic(id, patch))
    }
  )

  server.tool(
    'epics.delete',
    'Delete an epic. Its tasks remain but are detached.',
    EpicIdSchema.shape.id ? { id: EpicIdSchema.shape.id } : EpicIdSchema.shape,
    async (rawArgs) => {
      const { id } = EpicIdSchema.parse(rawArgs)
      svc.deleteEpic(id)
      return json({ deleted: true, id })
    }
  )

  server.tool(
    'epics.addTask',
    'Attach an existing task to an epic.',
    EpicAddTaskSchema.shape,
    async (rawArgs) => {
      const { epicId, taskId } = EpicAddTaskSchema.parse(rawArgs)
      svc.addTask(epicId, taskId)
      return json({ ok: true, epicId, taskId })
    }
  )

  server.tool(
    'epics.removeTask',
    'Detach a task from its epic.',
    EpicRemoveTaskSchema.shape,
    async (rawArgs) => {
      const { taskId } = EpicRemoveTaskSchema.parse(rawArgs)
      svc.removeTask(taskId)
      return json({ ok: true, taskId })
    }
  )

  server.tool(
    'epics.setDependencies',
    'Replace an epic\'s upstream dependencies. Rejects cycles atomically.',
    EpicSetDependenciesSchema.shape,
    async (rawArgs) => {
      const { id, dependencies } = EpicSetDependenciesSchema.parse(rawArgs)
      const epic = svc.getEpic(id)
      if (!epic) throw new McpDomainError(`Epic ${id} not found`, McpErrorCode.NotFound, { id })

      const current: EpicDependency[] = epic.depends_on ?? []
      const currentIds = new Set(current.map((d) => d.id))
      const nextIds = new Set(dependencies.map((d) => d.id))

      // Remove deps no longer present.
      for (const dep of current) {
        if (!nextIds.has(dep.id)) svc.removeDependency(id, dep.id)
      }
      // Add / update remaining.
      for (const dep of dependencies) {
        if (!currentIds.has(dep.id)) {
          svc.addDependency(id, dep)
        } else {
          svc.updateDependencyCondition(id, dep.id, dep.condition)
        }
      }

      const updated = svc.getEpic(id)
      return json(updated)
    }
  )
}
```

- [ ] **Step 4: Run tests to verify passing**

Run: `npx vitest run src/main/mcp-server/tools/epics.test.ts`
Expected: PASS — 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/main/mcp-server/tools/epics.ts src/main/mcp-server/tools/epics.test.ts
git commit -m "feat(mcp): add epics.* tools"
```

---

## Phase 4 — Server assembly and lifecycle

### Task 13: Settings events (local EventEmitter)

**Files:**
- Create: `src/main/mcp-server/settings-events.ts`
- Modify: `src/main/handlers/config-handlers.ts`

- [ ] **Step 1: Create the event emitter module**

Create `src/main/mcp-server/settings-events.ts`:

```typescript
/**
 * Local, in-process event bus for settings-change notifications. The `config:set`
 * IPC handler emits here so main-process modules (e.g., the MCP server) can hot-
 * toggle in response without requiring a renderer broadcast round-trip.
 */
import { EventEmitter } from 'node:events'

export interface SettingChangedEvent {
  key: string
  value: string | null
}

const emitter = new EventEmitter()
// Avoid Node's default 10-listener warning; small number of subscribers but
// we may add more over time (status-server, future auto-start toggle, etc.)
emitter.setMaxListeners(32)

export function emitSettingChanged(event: SettingChangedEvent): void {
  emitter.emit('setting-changed', event)
}

export function onSettingChanged(listener: (event: SettingChangedEvent) => void): () => void {
  emitter.on('setting-changed', listener)
  return () => emitter.off('setting-changed', listener)
}
```

- [ ] **Step 2: Emit from `config:set`**

Open `src/main/handlers/config-handlers.ts`, find the `config:set` `safeHandle(...)` registration, and inside the handler body — right after the write to the settings table succeeds — add a call to `emitSettingChanged`. Example edit at the end of the existing handler body (where it currently returns):

```typescript
// existing: setSetting(key, value)  or  setSettingJson(key, value)
// add this:
emitSettingChanged({ key, value: typeof value === 'string' ? value : JSON.stringify(value) })
```

Add the import at the top:

```typescript
import { emitSettingChanged } from '../mcp-server/settings-events'
```

If `config:set` handles both `string` and `JSON` values in separate branches, emit from both.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add src/main/mcp-server/settings-events.ts src/main/handlers/config-handlers.ts
git commit -m "feat(mcp): add settings-events bus for hot-toggle"
```

---

### Task 14: Transport + server factory (`createMcpServer`)

**Files:**
- Create: `src/main/mcp-server/transport.ts`
- Create: `src/main/mcp-server/index.ts`

- [ ] **Step 1: Create the transport wrapper**

Create `src/main/mcp-server/transport.ts`:

```typescript
/**
 * Thin HTTP wrapper around the MCP SDK's Streamable HTTP transport.
 * Adds bearer-token auth and structured error logging.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { checkBearerAuth } from './auth'
import type { Logger } from '../logger'

export interface TransportHandler {
  handle: (req: IncomingMessage, res: ServerResponse) => Promise<void>
  close: () => Promise<void>
}

export function createTransportHandler(
  mcpServer: McpServer,
  token: string,
  logger: Logger
): TransportHandler {
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined // stateless — one transport serves all requests
  })
  mcpServer.connect(transport).catch((err) => logger.error(`mcp connect: ${err}`))

  return {
    async handle(req, res) {
      if (req.url !== '/mcp') {
        res.writeHead(404, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Not found' }))
        return
      }
      const auth = checkBearerAuth(req, token)
      if (!auth.ok) {
        res.writeHead(auth.status, {
          'Content-Type': 'application/json',
          'WWW-Authenticate': 'Bearer realm="bde-mcp"'
        })
        res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32001, message: auth.message } }))
        return
      }
      try {
        await transport.handleRequest(req, res)
      } catch (err) {
        logger.error(`mcp transport: ${err}`)
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Internal error' }))
        }
      }
    },
    async close() {
      await transport.close()
    }
  }
}
```

- [ ] **Step 2: Create the server factory**

Create `src/main/mcp-server/index.ts`:

```typescript
import http from 'node:http'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { broadcast } from '../broadcast'
import { createLogger } from '../logger'
import { getTask, listTasks, updateTask } from '../services/sprint-service'
import { createTaskWithValidation } from '../services/sprint-service'
import { getTaskChanges } from '../data/task-changes'
import type { EpicGroupService } from '../services/epic-group-service'
import { getSettingJson } from '../settings'
import { readOrCreateToken } from './token-store'
import { createTransportHandler } from './transport'
import { registerTaskTools } from './tools/tasks'
import { registerEpicTools } from './tools/epics'
import { registerMetaTools } from './tools/meta'
import { toJsonRpcError } from './errors'
import type { RepoConfig } from '../paths'

const logger = createLogger('mcp-server')

export interface McpServerConfig {
  port: number
}

export interface McpServerDeps {
  epicService: EpicGroupService
  onStatusTerminal: (taskId: string, status: string) => void | Promise<void>
}

export interface McpServerHandle {
  start(): Promise<number>
  stop(): Promise<void>
}

export function createMcpServer(deps: McpServerDeps, config: McpServerConfig): McpServerHandle {
  let httpServer: http.Server | null = null
  let transportHandler: Awaited<ReturnType<typeof createTransportHandler>> | null = null

  function buildMcp(token: string) {
    const mcp = new McpServer({ name: 'bde', version: '1.0.0' })

    registerMetaTools(mcp, {
      getRepos: () => getSettingJson<RepoConfig[]>('repos') ?? []
    })

    registerTaskTools(mcp, {
      listTasks,
      getTask,
      createTaskWithValidation,
      updateTask,
      cancelTask: (id, reason) => {
        const patch: Record<string, unknown> = { status: 'cancelled' }
        if (reason) patch.notes = reason
        const row = updateTask(id, patch)
        if (row) {
          // Fire-and-forget; onStatusTerminal handles its own errors.
          Promise.resolve(deps.onStatusTerminal(id, 'cancelled')).catch((err) =>
            logger.error(`onStatusTerminal after cancel ${id}: ${err}`)
          )
        }
        return row
      },
      getTaskChanges: (id, limit) => getTaskChanges(id, limit),
      logger
    })

    registerEpicTools(mcp, { epicService: deps.epicService })

    return mcp
  }

  return {
    async start(): Promise<number> {
      const token = await readOrCreateToken()
      const mcp = buildMcp(token)
      transportHandler = createTransportHandler(mcp, token, logger)

      return new Promise<number>((resolve, reject) => {
        httpServer = http.createServer((req, res) => {
          transportHandler!.handle(req, res).catch((err) => {
            const body = JSON.stringify({ jsonrpc: '2.0', error: toJsonRpcError(err) })
            if (!res.headersSent) {
              res.writeHead(500, { 'Content-Type': 'application/json' })
            }
            res.end(body)
          })
        })
        httpServer.on('error', (err) => {
          const errno = (err as NodeJS.ErrnoException).code
          const msg = errno === 'EADDRINUSE'
            ? `MCP server could not bind to port ${config.port} — already in use.`
            : `MCP server failed to start: ${err}`
          logger.error(msg)
          broadcast('manager:warning', { message: msg })
          reject(err)
        })
        httpServer.listen(config.port, '127.0.0.1', () => {
          const addr = httpServer!.address()
          const actualPort = typeof addr === 'object' && addr ? addr.port : config.port
          logger.info(`Listening on http://127.0.0.1:${actualPort}/mcp`)
          resolve(actualPort)
        })
      })
    },

    async stop(): Promise<void> {
      if (transportHandler) {
        await transportHandler.close().catch((err) => logger.warn(`transport close: ${err}`))
        transportHandler = null
      }
      if (httpServer) {
        await new Promise<void>((r) => httpServer!.close(() => r()))
        httpServer = null
        logger.info('Stopped')
      }
    }
  }
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: zero errors. If `getTaskChanges` does not accept `(id, limit, offset)`, adjust the MCP adapter to match its real signature and update `TaskToolsDeps.getTaskChanges` accordingly.

- [ ] **Step 4: Commit**

```bash
git add src/main/mcp-server/transport.ts src/main/mcp-server/index.ts
git commit -m "feat(mcp): add Streamable HTTP transport and server factory"
```

---

### Task 15: Wire into `src/main/index.ts` lifecycle

**Files:**
- Modify: `src/main/index.ts`

- [ ] **Step 1: Add MCP lifecycle in `whenReady` block**

In `src/main/index.ts`, immediately after the `createStatusServer` lines (around 325), add:

```typescript
    // Start MCP server (opt-in; controlled by mcp.enabled setting)
    let mcp: McpServerHandle | null = null

    async function startMcpServer(): Promise<void> {
      if (mcp) return
      const port = getMcpPort()
      const handle = createMcpServer(
        { epicService: getEpicGroupService(), onStatusTerminal: taskTerminal.onStatusTerminal },
        { port }
      )
      try {
        await handle.start()
        mcp = handle
      } catch (err) {
        createLogger('startup').error(`Failed to start MCP server: ${err}`)
      }
    }

    async function stopMcpServer(): Promise<void> {
      if (!mcp) return
      await mcp.stop()
      mcp = null
    }

    if (getMcpEnabled()) {
      await startMcpServer()
    }

    onSettingChanged(({ key, value }) => {
      if (key !== 'mcp.enabled') return
      if (value === 'true') {
        startMcpServer().catch(() => {})
      } else {
        stopMcpServer().catch(() => {})
      }
    })

    app.on('will-quit', () => {
      stopMcpServer().catch(() => {})
    })
```

Then add the imports at the top of the file:

```typescript
import { createMcpServer, type McpServerHandle } from './mcp-server'
import { onSettingChanged } from './mcp-server/settings-events'
import { getMcpEnabled, getMcpPort } from './settings'
import { getEpicGroupService } from './handlers/group-handlers'
```

Note: the name `taskTerminal` here refers to the existing local variable built by `createTaskTerminalService(...)` in `whenReady` — confirm the exact variable name and pass its `onStatusTerminal` method (likely already wired to `am.onStatusTerminal` or similar; follow the existing pattern used by `status-server` and the sprint handlers).

- [ ] **Step 2: Typecheck and build**

Run: `npm run typecheck && npm run build`
Expected: zero errors.

- [ ] **Step 3: Smoke test — start the app and verify the server listens**

Run: `npm run dev`
Expected: app boots normally. `mcp.enabled` is false by default, so the MCP server does not start (no "Listening on http://..." in the log). You'll verify the enabled path in Task 17.

- [ ] **Step 4: Commit**

```bash
git add src/main/index.ts
git commit -m "feat(mcp): wire MCP server into main-process lifecycle"
```

---

## Phase 5 — Settings UI

### Task 16: Settings → Connections "Local MCP Server" card

**Files:**
- Create: `src/renderer/src/components/settings/LocalMcpServerSection.tsx`
- Create: `src/renderer/src/components/settings/LocalMcpServerSection.css`
- Modify: `src/renderer/src/components/settings/ConnectionsSection.tsx`
- Modify: `src/preload/index.ts` (new IPC channels)
- Modify: `src/main/handlers/config-handlers.ts` (expose token read + regenerate)

- [ ] **Step 1: Add two IPC channels in the main process**

At the bottom of `src/main/handlers/config-handlers.ts` inside the existing `registerConfigHandlers()` body, add:

```typescript
  safeHandle('mcp:getToken', async () => {
    const { readOrCreateToken } = await import('../mcp-server/token-store')
    return readOrCreateToken()
  })

  safeHandle('mcp:regenerateToken', async () => {
    const { regenerateToken } = await import('../mcp-server/token-store')
    const token = await regenerateToken()
    // Rebind by toggling mcp.enabled off→on if currently enabled.
    const enabled = getSetting('mcp.enabled') === 'true'
    if (enabled) {
      setSetting('mcp.enabled', 'false')
      emitSettingChanged({ key: 'mcp.enabled', value: 'false' })
      setSetting('mcp.enabled', 'true')
      emitSettingChanged({ key: 'mcp.enabled', value: 'true' })
    }
    return token
  })
```

Add `import { getSetting, setSetting } from '../settings'` at the top if not already present.

- [ ] **Step 2: Expose the channels in the preload bridge**

In `src/preload/index.ts`, inside the exposed API object, add:

```typescript
  mcpGetToken: (): Promise<string> => ipcRenderer.invoke('mcp:getToken'),
  mcpRegenerateToken: (): Promise<string> => ipcRenderer.invoke('mcp:regenerateToken'),
```

Update the matching `interface Api` definition (or `src/preload/index.d.ts`) to include both.

- [ ] **Step 3: Create the Settings section component**

Create `src/renderer/src/components/settings/LocalMcpServerSection.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { SettingsCard } from './SettingsCard'
import './LocalMcpServerSection.css'

interface Props {
  enabled: boolean
  port: number
  onChangeEnabled: (next: boolean) => void
  onChangePort: (next: number) => void
}

export function LocalMcpServerSection({ enabled, port, onChangeEnabled, onChangePort }: Props): JSX.Element {
  const [token, setToken] = useState<string | null>(null)
  const [revealed, setRevealed] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    window.api.mcpGetToken().then((t) => {
      if (!cancelled) setToken(t)
    })
    return () => {
      cancelled = true
    }
  }, [])

  async function regenerate(): Promise<void> {
    if (!confirm('Regenerate the MCP token? Any agent using the old token will be rejected.')) return
    setBusy(true)
    try {
      const next = await window.api.mcpRegenerateToken()
      setToken(next)
      setRevealed(true)
    } finally {
      setBusy(false)
    }
  }

  function copyConfig(): void {
    if (!token) return
    const snippet = JSON.stringify(
      {
        mcpServers: {
          bde: {
            url: `http://127.0.0.1:${port}/mcp`,
            headers: { Authorization: `Bearer ${token}` }
          }
        }
      },
      null,
      2
    )
    navigator.clipboard.writeText(snippet)
  }

  return (
    <SettingsCard title="Local MCP Server" description="Expose BDE's tasks and epics to local MCP-speaking agents (Claude Code, Cursor) over http://127.0.0.1.">
      <label className="settings-field settings-field--inline">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => onChangeEnabled(e.target.checked)}
        />
        <span>Enable MCP server</span>
      </label>

      <label className="settings-field">
        <span>Port</span>
        <input
          type="number"
          min={1024}
          max={65535}
          value={port}
          onChange={(e) => onChangePort(Number(e.target.value))}
        />
      </label>

      <div className="settings-field">
        <span>Bearer token</span>
        <div className="mcp-token-row">
          <code className="mcp-token">
            {token ? (revealed ? token : token.replace(/./g, '•')) : 'loading…'}
          </code>
          <button type="button" onClick={() => setRevealed((r) => !r)}>
            {revealed ? 'Hide' : 'Reveal'}
          </button>
          <button
            type="button"
            onClick={() => {
              if (token) navigator.clipboard.writeText(token)
            }}
          >
            Copy token
          </button>
          <button type="button" onClick={regenerate} disabled={busy}>
            {busy ? 'Regenerating…' : 'Regenerate'}
          </button>
        </div>
      </div>

      <div className="settings-field">
        <button type="button" onClick={copyConfig} disabled={!token}>
          Copy Claude Code config
        </button>
      </div>
    </SettingsCard>
  )
}
```

- [ ] **Step 4: Create the stylesheet**

Create `src/renderer/src/components/settings/LocalMcpServerSection.css`:

```css
.mcp-token-row {
  display: flex;
  align-items: center;
  gap: var(--bde-space-2);
  flex-wrap: wrap;
}

.mcp-token {
  font-family: var(--bde-font-mono, monospace);
  font-size: 12px;
  padding: var(--bde-space-1) var(--bde-space-2);
  background: var(--bde-color-surface-muted);
  border-radius: var(--bde-radius-sm);
  overflow-wrap: anywhere;
  flex: 1 1 280px;
}
```

- [ ] **Step 5: Render the section in `ConnectionsSection.tsx`**

In `src/renderer/src/components/settings/ConnectionsSection.tsx`, add an import and render the section. Wire its props through the existing settings state (use the same hook/store pattern the other sections use — typically `useSetting('mcp.enabled', false)` or equivalent). Example placement near other localhost-server cards:

```tsx
import { LocalMcpServerSection } from './LocalMcpServerSection'
// …
<LocalMcpServerSection
  enabled={mcpEnabled}
  port={mcpPort}
  onChangeEnabled={(v) => setMcpEnabled(v)}
  onChangePort={(v) => setMcpPort(v)}
/>
```

Use the same settings hook used elsewhere in `ConnectionsSection.tsx` to read/write `mcp.enabled` (string `'true'|'false'`) and `mcp.port` (string number). If existing code uses `setSettingJson`, mirror it; if it uses `setSetting` with string values, use that.

- [ ] **Step 6: Typecheck, build, lint**

Run: `npm run typecheck && npm run lint && npm run build`
Expected: zero errors.

- [ ] **Step 7: Manual smoke test**

Run: `npm run dev`. Open Settings → Connections. Toggle "Enable MCP server", observe the log: `[mcp-server] Listening on http://127.0.0.1:18792/mcp`. Click "Copy Claude Code config"; paste into a scratch file and confirm the snippet is well-formed JSON.

Run an MCP client against it — the simplest check is `curl`:

```bash
TOKEN=$(cat ~/.bde/mcp-token)
curl -s -X POST http://127.0.0.1:18792/mcp \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

Expected: JSON body listing at least `tasks.list`, `tasks.get`, `tasks.create`, `tasks.update`, `tasks.cancel`, `tasks.history`, `epics.list`, …, `meta.repos`.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/components/settings/LocalMcpServerSection.tsx \
  src/renderer/src/components/settings/LocalMcpServerSection.css \
  src/renderer/src/components/settings/ConnectionsSection.tsx \
  src/preload/index.ts \
  src/preload/index.d.ts \
  src/main/handlers/config-handlers.ts
git commit -m "feat(settings): add Local MCP Server section to Connections"
```

---

## Phase 6 — Integration tests and docs

### Task 17: Integration test — real SDK client vs real server

**Files:**
- Create: `src/main/mcp-server/mcp-server.integration.test.ts`

- [ ] **Step 1: Create the integration test**

Create `src/main/mcp-server/mcp-server.integration.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { createMcpServer, type McpServerHandle } from './index'
import { createEpicGroupService } from '../services/epic-group-service'
import { readOrCreateToken } from './token-store'

// This test suite requires the main-process DB to be initialized. It runs
// under the `test:main` configuration.
let handle: McpServerHandle
let client: Client
let port: number
let token: string

beforeAll(async () => {
  const epicService = createEpicGroupService()
  handle = createMcpServer(
    { epicService, onStatusTerminal: () => {} },
    { port: 0 } // bind to a random free port
  )
  port = await handle.start()
  token = await readOrCreateToken()

  client = new Client({ name: 'test', version: '0.0.0' }, { capabilities: {} })
  const transport = new StreamableHTTPClientTransport(
    new URL(`http://127.0.0.1:${port}/mcp`),
    { requestInit: { headers: { Authorization: `Bearer ${token}` } } }
  )
  await client.connect(transport)
}, 30_000)

afterAll(async () => {
  await client?.close()
  await handle?.stop()
})

describe('MCP server integration', () => {
  it('lists the expected tools', async () => {
    const { tools } = await client.listTools()
    const names = tools.map((t) => t.name).sort()
    expect(names).toContain('tasks.list')
    expect(names).toContain('tasks.create')
    expect(names).toContain('tasks.update')
    expect(names).toContain('tasks.cancel')
    expect(names).toContain('tasks.history')
    expect(names).toContain('epics.list')
    expect(names).toContain('epics.create')
    expect(names).toContain('meta.taskStatuses')
  })

  it('create → list → update → history round-trip', async () => {
    // create
    const created = await client.callTool({
      name: 'tasks.create',
      arguments: { title: 'mcp integration demo', repo: 'bde', status: 'backlog' }
    })
    const createdBody = JSON.parse((created.content[0] as any).text)
    expect(createdBody.title).toBe('mcp integration demo')
    const id = createdBody.id

    // list
    const list = await client.callTool({
      name: 'tasks.list',
      arguments: { search: 'mcp integration demo' }
    })
    const listBody = JSON.parse((list.content[0] as any).text)
    expect(listBody.some((t: any) => t.id === id)).toBe(true)

    // update
    const updated = await client.callTool({
      name: 'tasks.update',
      arguments: { id, patch: { priority: 5 } }
    })
    const updatedBody = JSON.parse((updated.content[0] as any).text)
    expect(updatedBody.priority).toBe(5)

    // history must have at least one row (priority change)
    const history = await client.callTool({
      name: 'tasks.history',
      arguments: { id }
    })
    const historyBody = JSON.parse((history.content[0] as any).text)
    expect(Array.isArray(historyBody)).toBe(true)
    expect(historyBody.some((r: any) => r.field === 'priority')).toBe(true)

    // cancel cleans up
    await client.callTool({ name: 'tasks.cancel', arguments: { id } })
  })

  it('rejects requests with a wrong bearer token', async () => {
    const bad = new Client({ name: 'bad', version: '0.0.0' }, { capabilities: {} })
    const transport = new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${port}/mcp`),
      { requestInit: { headers: { Authorization: 'Bearer wrong' } } }
    )
    await expect(bad.connect(transport)).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Run under main-process config**

Run: `npm run test:main -- mcp-server.integration`
Expected: all 3 tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/main/mcp-server/mcp-server.integration.test.ts
git commit -m "test(mcp): integration test with real SDK client and server"
```

---

### Task 18: Parity test — IPC vs MCP produce identical audit trails

**Files:**
- Create: `src/main/mcp-server/parity.integration.test.ts`

- [ ] **Step 1: Write the parity test**

Create `src/main/mcp-server/parity.integration.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { createMcpServer, type McpServerHandle } from './index'
import { createEpicGroupService } from '../services/epic-group-service'
import { createTaskWithValidation } from '../services/sprint-service'
import { getTaskChanges } from '../data/task-changes'
import { readOrCreateToken } from './token-store'
import { createLogger } from '../logger'

let handle: McpServerHandle
let client: Client
let port: number

beforeAll(async () => {
  handle = createMcpServer(
    { epicService: createEpicGroupService(), onStatusTerminal: () => {} },
    { port: 0 }
  )
  port = await handle.start()
  const token = await readOrCreateToken()

  client = new Client({ name: 'parity', version: '0.0.0' }, { capabilities: {} })
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } }
    })
  )
})

afterAll(async () => {
  await client.close()
  await handle.stop()
})

function onlyFields(changes: ReturnType<typeof getTaskChanges>) {
  return changes.map((c) => ({ field: c.field, old: c.old_value, new: c.new_value }))
}

describe('IPC vs MCP parity', () => {
  it('creates identical tasks and identical audit trails', async () => {
    const logger = createLogger('parity-test')
    const input = { title: 'parity', repo: 'bde', status: 'backlog' as const, priority: 3 }

    const ipcTask = createTaskWithValidation(input, { logger })

    const mcpRes = await client.callTool({ name: 'tasks.create', arguments: input })
    const mcpTask = JSON.parse((mcpRes.content[0] as any).text)

    // Compare the row shapes (ignore id, timestamps).
    const { id: _a1, created_at: _a2, updated_at: _a3, ...ipcRest } = ipcTask as any
    const { id: _b1, created_at: _b2, updated_at: _b3, ...mcpRest } = mcpTask
    expect(mcpRest).toEqual(ipcRest)

    // Apply the same mutation to both and compare histories.
    await client.callTool({
      name: 'tasks.update',
      arguments: { id: mcpTask.id, patch: { priority: 7 } }
    })

    // Call updateTask via service (IPC path would round-trip; the service is
    // the same code the handler uses).
    const { updateTask } = await import('../services/sprint-service')
    updateTask(ipcTask.id, { priority: 7 })

    const ipcHist = onlyFields(getTaskChanges(ipcTask.id))
    const mcpHist = onlyFields(getTaskChanges(mcpTask.id))
    expect(mcpHist).toEqual(ipcHist)
  })
})
```

- [ ] **Step 2: Run the parity test**

Run: `npm run test:main -- parity.integration`
Expected: pass.

- [ ] **Step 3: Commit**

```bash
git add src/main/mcp-server/parity.integration.test.ts
git commit -m "test(mcp): parity test — IPC vs MCP produce identical rows and audit"
```

---

### Task 19: Documentation updates

**Files:**
- Modify: `docs/BDE_FEATURES.md`
- Modify: `CLAUDE.md`
- Modify / Create: `docs/modules/services/index.md`, `docs/modules/services/epic-group-service.md`, `docs/modules/components/index.md`

- [ ] **Step 1: Add the Local MCP Server section to BDE_FEATURES.md**

In `docs/BDE_FEATURES.md`, under "Development Tools" (after "Source Control"), append:

```markdown
### Local MCP Server

Opt-in HTTP server that exposes BDE's task and epic CRUD to local MCP-speaking agents (Claude Code, Claude Desktop, Cursor). Runs inside the Electron main process; all mutations go through the same services the UI uses, so validation, dependency auto-blocking, status-transition checks, audit trail, and renderer broadcast are preserved.

- **Transport**: MCP Streamable HTTP at `http://127.0.0.1:<port>/mcp`. Default port `18792`.
- **Auth**: bearer token stored in `~/.bde/mcp-token` (mode `0600`). Set `Authorization: Bearer <token>` on every request.
- **Enable**: Settings → Connections → Local MCP Server → toggle "Enable MCP server".
- **Tools**:
  - `tasks.list` / `tasks.get` / `tasks.create` / `tasks.update` / `tasks.cancel` / `tasks.history`
  - `epics.list` / `epics.get` / `epics.create` / `epics.update` / `epics.delete` / `epics.addTask` / `epics.removeTask` / `epics.setDependencies`
  - `meta.repos` / `meta.taskStatuses` / `meta.dependencyConditions`
- **Out of scope**: agent orchestration (claim/cancel/retry) and review-station actions. Local-only — binds to `127.0.0.1`.
- **Example Claude Code config**:

  ```json
  {
    "mcpServers": {
      "bde": {
        "url": "http://127.0.0.1:18792/mcp",
        "headers": { "Authorization": "Bearer <paste-from-settings>" }
      }
    }
  }
  ```

Related: Task Workbench, Sprint Pipeline, Task Dependencies.
```

- [ ] **Step 2: Update CLAUDE.md Key File Locations**

In `CLAUDE.md`, under "Key File Locations", add:

```markdown
- MCP server: `src/main/mcp-server/` — opt-in local MCP server for external agents; toggle via `mcp.enabled` setting. Token in `~/.bde/mcp-token`.
```

Also add under "Architecture Notes" a one-line item:

```markdown
- **MCP server**: `src/main/mcp-server/` — Streamable HTTP on `127.0.0.1:<port>` (default 18792). All mutations route through `sprint-service` / `EpicGroupService`.
```

- [ ] **Step 3: Update module index files**

In `docs/modules/services/index.md`, add a row:

```markdown
| epic-group-service | `src/main/services/epic-group-service.ts` | Owns the in-memory epic dependency index and the single entry point for all epic mutations. |
```

Update the `sprint-service` row description to note:

```markdown
… and exposes `createTaskWithValidation()` as the single create-with-validation entry point shared by IPC and MCP.
```

Create `docs/modules/services/epic-group-service.md`:

```markdown
# epic-group-service

**Layer:** services
**Source:** `src/main/services/epic-group-service.ts`

## Purpose
Single entry point for all epic (task group) mutations. Owns the in-memory
epic dependency index so callers don't rebuild it out of band.

## Public API
- `createEpicGroupService(queries?)` — factory returning an `EpicGroupService`
- `EpicGroupService.{listEpics,getEpic,getEpicTasks,createEpic,updateEpic,deleteEpic,addTask,removeTask,reorderTasks,queueAllTasks,addDependency,removeDependency,updateDependencyCondition}`

## Key Dependencies
- `../data/task-group-queries` — DB layer.
- `./epic-dependency-service` — in-memory cycle-detection index.
```

In `docs/modules/components/index.md`, add a row:

```markdown
| LocalMcpServerSection | settings | Settings → Connections card for the Local MCP Server (toggle, port, token, copy config). |
```

- [ ] **Step 4: Typecheck + lint + test**

Run: `npm run typecheck && npm run lint && npm test && npm run test:main`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add docs/BDE_FEATURES.md CLAUDE.md docs/modules/services/index.md docs/modules/services/epic-group-service.md docs/modules/components/index.md
git commit -m "docs(mcp): document Local MCP Server + epic-group-service"
```

---

## Final verification

- [ ] **Run every CI check locally**

```bash
npm run typecheck
npm run lint
npm run test:coverage
npm run test:main
npm run build
```

Expected: all green. Coverage thresholds respected. Build produces `out/` artifacts without warnings.

- [ ] **Manual end-to-end**

1. `npm run dev`
2. Settings → Connections → toggle "Enable MCP server".
3. Copy the Claude Code config, paste it into a Claude Code MCP config for another project.
4. From that other session ask Claude to "create a BDE task titled 'hello from outside' in repo bde". Verify the task appears in the Sprint Pipeline in real time (no reload).
5. Toggle the server off; observe the log line `[mcp-server] Stopped`. Repeat step 4 and verify the agent's request fails cleanly.

- [ ] **Update `docs/modules/` last-pass**

Skim the touched source files; if any changed exports since their detail file was written, refresh the corresponding `docs/modules/<layer>/<module>.md`. Per CLAUDE.md this is mandatory pre-commit — add any missing rows now.

---

## Self-review summary

All 19 tasks have concrete code, exact file paths, and explicit run commands. No "TBD"s, no "similar to Task N"s. Types referenced in later tasks (`EpicGroupService`, `TaskToolsDeps`, `McpServerHandle`, `createTaskWithValidation`, `SETTING_MCP_ENABLED`, etc.) are all defined in earlier tasks. Spec coverage:

| Spec section | Covered in |
|---|---|
| §1 Architecture | Tasks 3, 5–8, 14 |
| §2 Tool surface (tasks) | Tasks 10, 11 |
| §2 Tool surface (epics) | Task 12 |
| §2 Tool surface (meta) | Task 9 |
| §3 Data flow | Tasks 14, 17 |
| §4 Auth & transport | Tasks 5, 6, 14 |
| §5 Error handling | Task 7 (+ reused in 10–12) |
| §6 Settings & lifecycle | Tasks 4, 13, 15, 16 |
| §7 Refactors (Boy Scout) | Tasks 1, 2 |
| §8 Testing | Tasks 1, 2, 5, 6, 7, 10–12, 17, 18 |
| §9 Docs | Task 19 |
| §10 Dependency policy | Task 3 |
