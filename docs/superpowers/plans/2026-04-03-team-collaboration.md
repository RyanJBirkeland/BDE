# Team & Collaboration — Implementation Plan

**Date:** 2026-04-03
**Spec:** `docs/superpowers/specs/2026-04-03-developer-persona-audit.md` (items 27, 28, 23, 22)
**Branch:** `feat/team-collaboration`

---

## Overview

Four features that lay groundwork for team use while remaining useful for solo developers:

1. **Reviewer Assignment** — `assigned_reviewer` field + "My Reviews" filter
2. **Sprint Planning Module** — Sprint entity with date range, task grouping, burn-down
3. **Webhook/Event Push** — POST to configured URLs on task/agent events
4. **Plugin System Foundation** — Lifecycle hooks + command registration

All features are additive (no breaking changes). Each has its own migration, IPC channels, and test suite.

---

## Feature 1: Reviewer Assignment

### 1.1 Database Migration (v24)

**File:** `src/main/db.ts`

Add migration v24 after the existing v23 entry:

```ts
{
  version: 24,
  description: 'Add assigned_reviewer column to sprint_tasks',
  up: (db) => {
    const cols = (db.pragma('table_info(sprint_tasks)') as { name: string }[]).map((c) => c.name)
    if (!cols.includes('assigned_reviewer')) {
      db.exec('ALTER TABLE sprint_tasks ADD COLUMN assigned_reviewer TEXT')
    }
  }
}
```

**Tests first** (`src/main/__tests__/integration/db-migrations.test.ts`):

```ts
it('migration v24 adds assigned_reviewer column', () => {
  // Create DB at v23, run migrations, verify column exists
  const db = createTestDb(23)
  runMigrations(db)
  const cols = db.pragma('table_info(sprint_tasks)').map(c => c.name)
  expect(cols).toContain('assigned_reviewer')
})

it('migration v24 is idempotent', () => {
  const db = createTestDb(23)
  runMigrations(db)
  // Running again should not throw
  expect(() => runMigrations(db)).not.toThrow()
})
```

### 1.2 Type Updates

**File:** `src/shared/types.ts`

Add to `SprintTask` interface after `session_id`:

```ts
assigned_reviewer?: string | null
```

Add `'assigned_reviewer'` to `GENERAL_PATCH_FIELDS` Set (same file, near line 416).

### 1.3 Query Layer Updates

**File:** `src/main/data/sprint-queries.ts`

Add `'assigned_reviewer'` to `UPDATE_ALLOWLIST` Set (line ~73).

No new query functions needed — existing `updateTask()` handles arbitrary allowlisted fields. The reviewer field uses the same pattern as `claimed_by`.

**Tests** (`src/main/__tests__/sprint-queries.test.ts`):

```ts
it('updateTask accepts assigned_reviewer field', () => {
  const task = createTask({ title: 'Test', repo: 'bde' })
  const updated = updateTask(task.id, { assigned_reviewer: 'ryan' })
  expect(updated?.assigned_reviewer).toBe('ryan')
})

it('updateTask clears assigned_reviewer with null', () => {
  const task = createTask({ title: 'Test', repo: 'bde' })
  updateTask(task.id, { assigned_reviewer: 'ryan' })
  const updated = updateTask(task.id, { assigned_reviewer: null })
  expect(updated?.assigned_reviewer).toBeNull()
})
```

### 1.4 IPC — No New Channels Needed

Reviewer assignment goes through the existing `sprint:update` IPC channel. The field is in `UPDATE_ALLOWLIST` and `GENERAL_PATCH_FIELDS`, so both IPC handlers and Queue API accept it automatically.

### 1.5 Renderer — ReviewQueue Filter

**File:** `src/renderer/src/components/code-review/ReviewQueue.tsx`

Add a filter toggle (My Reviews / All Reviews) above the task list. "My Reviews" filters by `assigned_reviewer` matching a local identity string (stored in settings as `reviewer.name`, defaulting to `'me'`).

```tsx
// New state
const [filter, setFilter] = useState<'all' | 'mine'>('all')
const reviewerName = useSettingsStore((s) => s.reviewerName) ?? 'me'

// Filter logic (after existing .filter)
const filtered = filter === 'mine'
  ? reviewTasks.filter(t => t.assigned_reviewer === reviewerName)
  : reviewTasks
```

Add two tab buttons at the top:

```tsx
<div className="cr-queue__filter">
  <button
    className={`cr-queue__filter-btn${filter === 'all' ? ' cr-queue__filter-btn--active' : ''}`}
    onClick={() => setFilter('all')}
  >
    All ({reviewTasks.length})
  </button>
  <button
    className={`cr-queue__filter-btn${filter === 'mine' ? ' cr-queue__filter-btn--active' : ''}`}
    onClick={() => setFilter('mine')}
  >
    Mine ({reviewTasks.filter(t => t.assigned_reviewer === reviewerName).length})
  </button>
</div>
```

**Tests** (`src/renderer/src/components/code-review/__tests__/ReviewQueue.test.tsx`):

```ts
it('shows all review tasks by default', () => { /* ... */ })
it('filters to "mine" when My Reviews clicked', () => { /* ... */ })
it('shows correct counts in filter tabs', () => { /* ... */ })
```

### 1.6 Renderer — TaskDetailDrawer Reviewer Dropdown

**File:** `src/renderer/src/components/sprint/TaskDetailDrawer.tsx`

Add a reviewer assignment dropdown in the drawer body, after the Priority field:

```tsx
<div className="task-drawer__field">
  <span className="task-drawer__label">Reviewer</span>
  <select
    className="task-drawer__select"
    value={task.assigned_reviewer ?? ''}
    onChange={(e) => updateTask(task.id, {
      assigned_reviewer: e.target.value || null
    })}
  >
    <option value="">Unassigned</option>
    <option value="me">Assign to me</option>
  </select>
</div>
```

For solo devs, "Assign to me" is the primary action. The dropdown can be extended with team member names later (from a future `team.members` setting).

### 1.7 Renderer — "Claim for Review" Button

**File:** `src/renderer/src/components/code-review/ReviewActions.tsx`

Add a "Claim for Review" button that appears when `assigned_reviewer` is null and sets it to the local reviewer name:

```tsx
{!task.assigned_reviewer && (
  <button
    className="cr-actions__btn cr-actions__btn--ghost"
    onClick={async () => {
      await window.api.sprint.update(task.id, { assigned_reviewer: reviewerName })
      loadData()
    }}
  >
    <UserCheck size={14} /> Claim for Review
  </button>
)}
```

### 1.8 WorkbenchForm Reviewer Field

**File:** `src/renderer/src/components/task-workbench/WorkbenchForm.tsx`

Add reviewer dropdown inside the `advancedOpen` section, after the playground checkbox:

```tsx
<div className="wb-form__field wb-form__field--flex">
  <label htmlFor="wb-form-reviewer" className="wb-form__label">Reviewer</label>
  <select
    id="wb-form-reviewer"
    value={assignedReviewer ?? ''}
    onChange={(e) => setField('assignedReviewer', e.target.value || null)}
    className="wb-form__select"
  >
    <option value="">None</option>
    <option value="me">Me</option>
  </select>
</div>
```

Wire `assignedReviewer` through `taskWorkbench` store and into `createOrUpdateTask()`.

**Effort:** ~1 day

---

## Feature 2: Sprint Planning Module

### 2.1 Database Migration (v25)

**File:** `src/main/db.ts`

```ts
{
  version: 25,
  description: 'Create sprints table and add sprint_id to sprint_tasks',
  up: (db) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS sprints (
        id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        name        TEXT NOT NULL,
        goal        TEXT,
        start_date  TEXT NOT NULL,
        end_date    TEXT NOT NULL,
        status      TEXT NOT NULL DEFAULT 'planning'
                      CHECK(status IN ('planning', 'active', 'completed', 'cancelled')),
        created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );

      CREATE TRIGGER IF NOT EXISTS sprints_updated_at
        AFTER UPDATE ON sprints
        BEGIN
          UPDATE sprints SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
          WHERE id = NEW.id;
        END;
    `)

    // Add sprint_id to sprint_tasks
    const cols = (db.pragma('table_info(sprint_tasks)') as { name: string }[]).map((c) => c.name)
    if (!cols.includes('sprint_id')) {
      db.exec(`
        ALTER TABLE sprint_tasks ADD COLUMN sprint_id TEXT;
        CREATE INDEX IF NOT EXISTS idx_sprint_tasks_sprint_id ON sprint_tasks(sprint_id);
      `)
    }
  }
}
```

**Tests** (`src/main/__tests__/integration/db-migrations.test.ts`):

```ts
it('migration v25 creates sprints table', () => {
  const db = createTestDb(24)
  runMigrations(db)
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()
  expect(tables.map(t => t.name)).toContain('sprints')
})

it('migration v25 adds sprint_id to sprint_tasks', () => {
  const db = createTestDb(24)
  runMigrations(db)
  const cols = db.pragma('table_info(sprint_tasks)').map(c => c.name)
  expect(cols).toContain('sprint_id')
})
```

### 2.2 Types

**File:** `src/shared/types.ts`

```ts
export interface Sprint {
  id: string
  name: string
  goal: string | null
  start_date: string
  end_date: string
  status: 'planning' | 'active' | 'completed' | 'cancelled'
  created_at: string
  updated_at: string
}
```

Add to `SprintTask`:

```ts
sprint_id?: string | null
```

Add `'sprint_id'` to `GENERAL_PATCH_FIELDS`.

### 2.3 Sprint Queries

**New file:** `src/main/data/sprint-plan-queries.ts`

```ts
import type { Sprint } from '../../shared/types'
import { getDb } from '../db'

export interface CreateSprintInput {
  name: string
  goal?: string
  start_date: string
  end_date: string
}

export function createSprint(input: CreateSprintInput): Sprint | null {
  const db = getDb()
  return db.prepare(
    `INSERT INTO sprints (name, goal, start_date, end_date)
     VALUES (?, ?, ?, ?) RETURNING *`
  ).get(input.name, input.goal ?? null, input.start_date, input.end_date) as Sprint | null
}

export function listSprints(): Sprint[] {
  return getDb().prepare('SELECT * FROM sprints ORDER BY start_date DESC').all() as Sprint[]
}

export function getSprint(id: string): Sprint | null {
  return getDb().prepare('SELECT * FROM sprints WHERE id = ?').get(id) as Sprint | null
}

export function updateSprint(id: string, patch: Partial<Sprint>): Sprint | null {
  const allowed = ['name', 'goal', 'start_date', 'end_date', 'status']
  const entries = Object.entries(patch).filter(([k]) => allowed.includes(k))
  if (entries.length === 0) return null

  // Validate column names (defense-in-depth)
  for (const [k] of entries) {
    if (!/^[a-z_]+$/.test(k)) throw new Error(`Invalid column name: ${k}`)
  }

  const setClauses = entries.map(([k]) => `${k} = ?`).join(', ')
  const values = [...entries.map(([, v]) => v), id]

  return getDb().prepare(
    `UPDATE sprints SET ${setClauses} WHERE id = ? RETURNING *`
  ).get(...values) as Sprint | null
}

export function deleteSprint(id: string): void {
  const db = getDb()
  db.transaction(() => {
    // Unlink tasks from this sprint
    db.prepare('UPDATE sprint_tasks SET sprint_id = NULL WHERE sprint_id = ?').run(id)
    db.prepare('DELETE FROM sprints WHERE id = ?').run(id)
  })()
}

export function getSprintBurndown(
  sprintId: string
): Array<{ date: string; remaining: number; completed: number }> {
  const db = getDb()
  const sprint = getSprint(sprintId)
  if (!sprint) return []

  // Get all tasks in this sprint
  const tasks = db.prepare(
    'SELECT status, completed_at, created_at FROM sprint_tasks WHERE sprint_id = ?'
  ).all(sprintId) as Array<{ status: string; completed_at: string | null; created_at: string }>

  // Build daily burn-down from start_date to end_date (or today, whichever is earlier)
  const start = new Date(sprint.start_date)
  const end = new Date(Math.min(new Date(sprint.end_date).getTime(), Date.now()))
  const points: Array<{ date: string; remaining: number; completed: number }> = []

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dateStr = d.toISOString().slice(0, 10)
    const completedByDate = tasks.filter(
      t => t.completed_at && t.completed_at.slice(0, 10) <= dateStr && t.status === 'done'
    ).length
    const totalByDate = tasks.filter(t => t.created_at.slice(0, 10) <= dateStr).length
    points.push({
      date: dateStr,
      remaining: totalByDate - completedByDate,
      completed: completedByDate
    })
  }

  return points
}
```

**Tests** (`src/main/__tests__/sprint-plan-queries.test.ts`):

```ts
describe('sprint-plan-queries', () => {
  it('createSprint returns sprint with id', () => { /* ... */ })
  it('listSprints returns sorted by start_date desc', () => { /* ... */ })
  it('updateSprint changes name', () => { /* ... */ })
  it('deleteSprint unlinks tasks', () => { /* ... */ })
  it('getSprintBurndown returns daily points', () => { /* ... */ })
})
```

### 2.4 Sprint IPC Handlers

**New file:** `src/main/handlers/sprint-plan-handlers.ts`

```ts
import { safeHandle } from '../ipc-utils'
import {
  createSprint, listSprints, getSprint, updateSprint, deleteSprint, getSprintBurndown
} from '../data/sprint-plan-queries'

export function registerSprintPlanHandlers(): void {
  safeHandle('sprint-plan:list', () => listSprints())
  safeHandle('sprint-plan:get', (_e, id: string) => getSprint(id))
  safeHandle('sprint-plan:create', (_e, input) => {
    const sprint = createSprint(input)
    if (!sprint) throw new Error('Failed to create sprint')
    return sprint
  })
  safeHandle('sprint-plan:update', (_e, id: string, patch) => {
    const sprint = updateSprint(id, patch)
    if (!sprint) throw new Error('Sprint not found')
    return sprint
  })
  safeHandle('sprint-plan:delete', (_e, id: string) => {
    deleteSprint(id)
    return { ok: true }
  })
  safeHandle('sprint-plan:burndown', (_e, sprintId: string) => {
    return getSprintBurndown(sprintId)
  })
}
```

**File:** `src/main/index.ts` — Register `registerSprintPlanHandlers()`.

**File:** `src/shared/ipc-channels.ts` — Add 6 new channels.

**File:** `src/preload/index.ts` and `src/preload/index.d.ts` — Add `sprintPlan` namespace with typed methods.

### 2.5 Sprint Task Assignment

Add `'sprint_id'` to `UPDATE_ALLOWLIST` in `src/main/data/sprint-queries.ts`. Tasks are assigned to sprints via the standard `sprint:update` IPC with `{ sprint_id: '<sprint-id>' }`.

### 2.6 Renderer — Sprint Selector in PipelineHeader

**File:** `src/renderer/src/components/sprint/PipelineHeader.tsx`

Add a sprint selector dropdown to the header bar:

```tsx
// New props
interface PipelineHeaderProps {
  // ...existing...
  sprints: Sprint[]
  activeSprintId: string | null
  onSprintChange: (sprintId: string | null) => void
}

// In JSX, before stats:
<select
  className="sprint-pipeline__sprint-selector"
  value={activeSprintId ?? ''}
  onChange={(e) => onSprintChange(e.target.value || null)}
>
  <option value="">All Tasks</option>
  {sprints.map(s => (
    <option key={s.id} value={s.id}>{s.name}</option>
  ))}
</select>
```

The parent (`SprintPipeline.tsx`) filters tasks by `sprint_id` when a sprint is selected.

### 2.7 Renderer — Sprint Store

**New file:** `src/renderer/src/stores/sprintPlan.ts`

```ts
import { create } from 'zustand'
import type { Sprint } from '../../../shared/types'

interface SprintPlanState {
  sprints: Sprint[]
  activeSprintId: string | null
  loading: boolean
  loadSprints: () => Promise<void>
  setActiveSprintId: (id: string | null) => void
  createSprint: (input: {
    name: string; goal?: string; start_date: string; end_date: string
  }) => Promise<void>
}

export const useSprintPlan = create<SprintPlanState>((set) => ({
  sprints: [],
  activeSprintId: null,
  loading: false,

  loadSprints: async () => {
    set({ loading: true })
    try {
      const sprints = await window.api.sprintPlan.list()
      set({ sprints })
    } finally {
      set({ loading: false })
    }
  },

  setActiveSprintId: (id) => set({ activeSprintId: id }),

  createSprint: async (input) => {
    await window.api.sprintPlan.create(input)
    const sprints = await window.api.sprintPlan.list()
    set({ sprints })
  }
}))
```

### 2.8 Renderer — Burn-down Chart in Dashboard

**File:** `src/renderer/src/views/DashboardView.tsx`

Add a burn-down card when an active sprint exists. Uses existing `MiniChart` component with sprint data from `getSprintBurndown()`.

```tsx
// In ActivitySection or CenterColumn:
{activeSprintId && (
  <NeonCard accent="cyan" title={`Sprint: ${activeSprint?.name}`}>
    <MiniChart data={burndownData} />
    <div className="dashboard-sprint__dates">
      {activeSprint?.start_date} — {activeSprint?.end_date}
    </div>
  </NeonCard>
)}
```

**Effort:** ~2-3 days

---

## Feature 3: Webhook/Event Push

### 3.1 Database Migration (v26)

**File:** `src/main/db.ts`

```ts
{
  version: 26,
  description: 'Create webhooks table',
  up: (db) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS webhooks (
        id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        url         TEXT NOT NULL,
        events      TEXT NOT NULL DEFAULT '["task:statusChanged"]',
        enabled     INTEGER NOT NULL DEFAULT 1,
        secret      TEXT,
        created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );

      CREATE TRIGGER IF NOT EXISTS webhooks_updated_at
        AFTER UPDATE ON webhooks
        BEGIN
          UPDATE webhooks SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
          WHERE id = NEW.id;
        END;
    `)
  }
}
```

### 3.2 Types

**File:** `src/shared/types.ts`

```ts
export type WebhookEventType =
  | 'task:statusChanged'
  | 'task:created'
  | 'task:deleted'
  | 'agent:completed'
  | 'agent:failed'
  | 'review:merged'
  | 'review:discarded'

export interface Webhook {
  id: string
  url: string
  events: WebhookEventType[]
  enabled: boolean
  secret: string | null
  created_at: string
  updated_at: string
}
```

### 3.3 Webhook Service

**New file:** `src/main/services/webhook-service.ts`

```ts
import { createHmac } from 'crypto'
import { getDb } from '../db'
import { createLogger } from '../logger'
import type { WebhookEventType, Webhook } from '../../shared/types'

const logger = createLogger('webhooks')

interface WebhookPayload {
  event: WebhookEventType
  timestamp: string
  data: Record<string, unknown>
}

function getEnabledWebhooks(): Webhook[] {
  const rows = getDb()
    .prepare('SELECT * FROM webhooks WHERE enabled = 1')
    .all() as Array<Record<string, unknown>>
  return rows.map(r => ({
    ...r,
    events: JSON.parse(r.events as string) as WebhookEventType[],
    enabled: !!r.enabled
  })) as Webhook[]
}

function signPayload(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex')
}

export async function fireWebhook(
  event: WebhookEventType,
  data: Record<string, unknown>
): Promise<void> {
  const webhooks = getEnabledWebhooks()
  const matching = webhooks.filter(w => w.events.includes(event))
  if (matching.length === 0) return

  const payload: WebhookPayload = {
    event,
    timestamp: new Date().toISOString(),
    data
  }
  const body = JSON.stringify(payload)

  for (const webhook of matching) {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-BDE-Event': event
    }
    if (webhook.secret) {
      headers['X-BDE-Signature'] = signPayload(body, webhook.secret)
    }

    // Fire-and-forget with 10s timeout
    fetch(webhook.url, {
      method: 'POST',
      headers,
      body,
      signal: AbortSignal.timeout(10_000)
    })
      .then(res => {
        if (!res.ok) logger.warn(`[webhook] ${webhook.url} returned ${res.status}`)
      })
      .catch(err => {
        logger.warn(`[webhook] Failed to deliver to ${webhook.url}: ${err}`)
      })
  }
}

// CRUD for webhook configuration
export function listWebhooks(): Webhook[] {
  const rows = getDb()
    .prepare('SELECT * FROM webhooks ORDER BY created_at DESC')
    .all() as Array<Record<string, unknown>>
  return rows.map(r => ({
    ...r,
    events: JSON.parse(r.events as string),
    enabled: !!r.enabled
  })) as Webhook[]
}

export function createWebhook(input: {
  url: string
  events: WebhookEventType[]
  secret?: string
}): Webhook {
  const row = getDb().prepare(
    'INSERT INTO webhooks (url, events, secret) VALUES (?, ?, ?) RETURNING *'
  ).get(
    input.url, JSON.stringify(input.events), input.secret ?? null
  ) as Record<string, unknown>
  return { ...row, events: input.events, enabled: true } as Webhook
}

export function updateWebhook(id: string, patch: Partial<Webhook>): Webhook | null {
  const allowed = ['url', 'events', 'enabled', 'secret']
  const entries = Object.entries(patch).filter(([k]) => allowed.includes(k))
  if (entries.length === 0) return null

  const setClauses = entries.map(([k]) => `${k} = ?`).join(', ')
  const values = entries.map(([k, v]) => {
    if (k === 'events') return JSON.stringify(v)
    if (k === 'enabled') return v ? 1 : 0
    return v
  })
  values.push(id)

  const row = getDb().prepare(
    `UPDATE webhooks SET ${setClauses} WHERE id = ? RETURNING *`
  ).get(...values) as Record<string, unknown> | undefined
  if (!row) return null
  return {
    ...row,
    events: JSON.parse(row.events as string),
    enabled: !!row.enabled
  } as Webhook
}

export function deleteWebhook(id: string): void {
  getDb().prepare('DELETE FROM webhooks WHERE id = ?').run(id)
}
```

**Tests** (`src/main/__tests__/webhook-service.test.ts`):

```ts
describe('webhook-service', () => {
  it('fireWebhook sends POST to matching webhooks', async () => { /* mock fetch */ })
  it('fireWebhook skips non-matching event types', async () => { /* ... */ })
  it('fireWebhook includes HMAC signature when secret set', async () => { /* ... */ })
  it('fireWebhook does not throw on network error', async () => { /* ... */ })
  it('CRUD: create, list, update, delete webhooks', () => { /* ... */ })
})
```

### 3.4 Wire into notifySprintMutation

**File:** `src/main/handlers/sprint-listeners.ts`

Import and call `fireWebhook` inside `notifySprintMutation()`:

```ts
import { fireWebhook } from '../services/webhook-service'

export function notifySprintMutation(
  type: SprintMutationEvent['type'],
  task: SprintTask
): void {
  // ...existing listener + BrowserWindow code...

  // Fire webhooks (async, non-blocking)
  const eventMap: Record<string, WebhookEventType> = {
    created: 'task:created',
    deleted: 'task:deleted',
    updated: 'task:statusChanged'
  }
  const webhookEvent = eventMap[type]
  if (webhookEvent) {
    fireWebhook(webhookEvent, {
      taskId: task.id,
      title: task.title,
      status: task.status,
      repo: task.repo
    }).catch(() => { /* already logged inside fireWebhook */ })
  }
}
```

Also wire `fireWebhook('agent:completed', ...)` and `fireWebhook('agent:failed', ...)` into `completion.ts` at the `resolveSuccess` and `resolveFailure` call sites.

Wire `fireWebhook('review:merged', ...)` and `fireWebhook('review:discarded', ...)` into the review action handlers.

### 3.5 Webhook IPC Handlers

**New file:** `src/main/handlers/webhook-handlers.ts`

```ts
import { safeHandle } from '../ipc-utils'
import {
  listWebhooks, createWebhook, updateWebhook, deleteWebhook, fireWebhook
} from '../services/webhook-service'

export function registerWebhookHandlers(): void {
  safeHandle('webhook:list', () => listWebhooks())
  safeHandle('webhook:create', (_e, input) => createWebhook(input))
  safeHandle('webhook:update', (_e, id: string, patch) => updateWebhook(id, patch))
  safeHandle('webhook:delete', (_e, id: string) => {
    deleteWebhook(id)
    return { ok: true }
  })
  safeHandle('webhook:test', async (_e, id: string) => {
    await fireWebhook('task:statusChanged', {
      test: true,
      webhookId: id,
      timestamp: new Date().toISOString()
    })
    return { ok: true }
  })
}
```

Register in `src/main/index.ts`. Add 5 channels to `src/shared/ipc-channels.ts`. Add preload bridge methods.

### 3.6 Renderer — Webhook Settings Tab

Add a "Webhooks" tab (10th tab) in Settings view:

**New file:** `src/renderer/src/components/settings/WebhookSettings.tsx`

Simple CRUD list: URL input, event type checkboxes, enable/disable toggle, "Test" button, delete button. Standard BDE settings pattern (fetch on mount, optimistic updates).

**Effort:** ~2 days

---

## Feature 4: Plugin System Foundation

### 4.1 Plugin Types

**New file:** `src/shared/plugin-types.ts`

```ts
import type { SprintTask } from './types'

export interface BDEPluginContext {
  /** Read a task by ID */
  getTask(id: string): SprintTask | null
  /** Update task fields */
  updateTask(id: string, patch: Record<string, unknown>): SprintTask | null
  /** Log a message to the BDE log */
  log(message: string): void
  /** Register a command for the command palette */
  registerCommand(command: PluginCommand): void
}

export interface PluginCommand {
  id: string
  label: string
  description?: string
  execute: () => void | Promise<void>
}

export interface BDEPlugin {
  /** Unique plugin name */
  name: string
  /** Plugin version (semver) */
  version: string

  /** Called when plugin is loaded. Receive context for hooks/commands. */
  activate?(ctx: BDEPluginContext): void | Promise<void>
  /** Called when plugin is unloaded. */
  deactivate?(): void | Promise<void>

  // --- Lifecycle Hooks ---
  /** Before task creation. Return false to prevent. */
  onBeforeTaskCreate?(task: Partial<SprintTask>): boolean | Promise<boolean>
  /** After agent completes (before review transition). */
  onAgentComplete?(
    taskId: string,
    summary: { exitCode: number; costUsd: number }
  ): void | Promise<void>
  /** Before merge in Code Review. Return false to prevent. */
  onBeforeMerge?(taskId: string, strategy: string): boolean | Promise<boolean>
}
```

### 4.2 Plugin Loader

**New file:** `src/main/plugin-loader.ts`

```ts
import { existsSync, readdirSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { createLogger } from './logger'
import type { BDEPlugin, BDEPluginContext, PluginCommand } from '../shared/plugin-types'
import type { ISprintTaskRepository } from './data/sprint-task-repository'

const logger = createLogger('plugins')
const PLUGIN_DIR = join(homedir(), '.bde', 'plugins')

interface LoadedPlugin {
  plugin: BDEPlugin
  commands: PluginCommand[]
}

const loadedPlugins: Map<string, LoadedPlugin> = new Map()

function createContext(repo: ISprintTaskRepository): BDEPluginContext {
  const commands: PluginCommand[] = []
  return {
    getTask: (id) => repo.getTask(id),
    updateTask: (id, patch) => repo.updateTask(id, patch),
    log: (message) => logger.info(`[plugin] ${message}`),
    registerCommand: (cmd) => commands.push(cmd)
  }
}

export async function loadPlugins(repo: ISprintTaskRepository): Promise<void> {
  if (!existsSync(PLUGIN_DIR)) return

  const entries = readdirSync(PLUGIN_DIR, { withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const pluginPath = join(PLUGIN_DIR, entry.name, 'index.js')
    if (!existsSync(pluginPath)) continue

    try {
      // Dynamic require for CJS plugins
      const mod = require(pluginPath) as { default?: BDEPlugin } | BDEPlugin
      const plugin: BDEPlugin =
        'default' in mod && mod.default ? mod.default : (mod as BDEPlugin)

      if (!plugin.name || !plugin.version) {
        logger.warn(`[plugins] Skipping ${entry.name}: missing name or version`)
        continue
      }

      const ctx = createContext(repo)
      const ctxCommands = (ctx as unknown as { commands: PluginCommand[] }).commands
      await plugin.activate?.(ctx)

      loadedPlugins.set(plugin.name, { plugin, commands: ctxCommands ?? [] })
      logger.info(`[plugins] Loaded: ${plugin.name}@${plugin.version}`)
    } catch (err) {
      logger.error(`[plugins] Failed to load ${entry.name}: ${err}`)
    }
  }
}

export async function unloadPlugins(): Promise<void> {
  for (const [name, { plugin }] of loadedPlugins) {
    try {
      await plugin.deactivate?.()
    } catch (err) {
      logger.error(`[plugins] Failed to deactivate ${name}: ${err}`)
    }
  }
  loadedPlugins.clear()
}

/** Run onBeforeTaskCreate hooks. Returns false if any plugin blocks creation. */
export async function runBeforeTaskCreate(
  task: Partial<unknown>
): Promise<boolean> {
  for (const [, { plugin }] of loadedPlugins) {
    if (plugin.onBeforeTaskCreate) {
      const result = await plugin.onBeforeTaskCreate(task as never)
      if (result === false) return false
    }
  }
  return true
}

/** Run onAgentComplete hooks (fire-and-forget). */
export async function runAgentComplete(
  taskId: string,
  summary: { exitCode: number; costUsd: number }
): Promise<void> {
  for (const [name, { plugin }] of loadedPlugins) {
    try {
      await plugin.onAgentComplete?.(taskId, summary)
    } catch (err) {
      logger.warn(`[plugins] ${name}.onAgentComplete failed: ${err}`)
    }
  }
}

/** Run onBeforeMerge hooks. Returns false if any plugin blocks. */
export async function runBeforeMerge(
  taskId: string,
  strategy: string
): Promise<boolean> {
  for (const [, { plugin }] of loadedPlugins) {
    if (plugin.onBeforeMerge) {
      const result = await plugin.onBeforeMerge(taskId, strategy)
      if (result === false) return false
    }
  }
  return true
}

/** Get all registered plugin commands (for command palette). */
export function getPluginCommands(): PluginCommand[] {
  const commands: PluginCommand[] = []
  for (const [, loaded] of loadedPlugins) {
    commands.push(...loaded.commands)
  }
  return commands
}

/** Get list of loaded plugins for settings UI. */
export function getLoadedPluginInfo(): Array<{ name: string; version: string }> {
  return Array.from(loadedPlugins.values()).map(({ plugin }) => ({
    name: plugin.name,
    version: plugin.version
  }))
}
```

### 4.3 Plugin IPC Handlers

**New file:** `src/main/handlers/plugin-handlers.ts`

```ts
import { safeHandle } from '../ipc-utils'
import { getLoadedPluginInfo, getPluginCommands } from '../plugin-loader'

export function registerPluginHandlers(): void {
  safeHandle('plugin:list', () => getLoadedPluginInfo())
  safeHandle('plugin:commands', () =>
    getPluginCommands().map(c => ({
      id: c.id,
      label: c.label,
      description: c.description
    }))
  )
  safeHandle('plugin:executeCommand', async (_e, commandId: string) => {
    const commands = getPluginCommands()
    const cmd = commands.find(c => c.id === commandId)
    if (!cmd) throw new Error(`Plugin command not found: ${commandId}`)
    await cmd.execute()
    return { ok: true }
  })
}
```

Register in `src/main/index.ts`. Add 3 channels to `src/shared/ipc-channels.ts`. Add preload bridge.

### 4.4 Wire Lifecycle Hooks

**File:** `src/main/handlers/sprint-local.ts` — In `sprint:create` handler, before `createTask()`:

```ts
const { runBeforeTaskCreate } = await import('../plugin-loader')
const allowed = await runBeforeTaskCreate(task)
if (!allowed) throw new Error('Task creation blocked by plugin')
```

**File:** `src/main/agent-manager/completion.ts` — In `resolveSuccess()`, after updating to review:

```ts
import { runAgentComplete } from '../plugin-loader'
// After status update to review:
runAgentComplete(taskId, { exitCode: 0, costUsd: 0 }).catch(() => {})
```

**File:** Review merge handler — Before merge execution:

```ts
const { runBeforeMerge } = await import('../plugin-loader')
const allowed = await runBeforeMerge(taskId, strategy)
if (!allowed) throw new Error('Merge blocked by plugin')
```

### 4.5 Plugin Initialization

**File:** `src/main/index.ts`

During app startup, after DB init and repository creation:

```ts
import { loadPlugins, unloadPlugins } from './plugin-loader'

// After createSprintTaskRepository():
await loadPlugins(repo)

// On app quit:
app.on('will-quit', async () => {
  await unloadPlugins()
})
```

### 4.6 Command Palette Integration

**File:** `src/renderer/src/components/CommandPalette.tsx`

Add a section for plugin commands, fetched via `plugin:commands` IPC on palette open:

```ts
// On open, fetch plugin commands:
const pluginCommands = await window.api.plugin.commands()

// Render them in a "Plugins" group at the bottom of the command list
```

### 4.7 Tests

**File:** `src/main/__tests__/plugin-loader.test.ts`

```ts
describe('plugin-loader', () => {
  it('loadPlugins loads valid plugin from directory', async () => { /* ... */ })
  it('loadPlugins skips directory without index.js', async () => { /* ... */ })
  it('loadPlugins skips plugin without name/version', async () => { /* ... */ })
  it('runBeforeTaskCreate returns true when no plugins loaded', async () => { /* ... */ })
  it('runBeforeTaskCreate returns false when plugin blocks', async () => { /* ... */ })
  it('runAgentComplete calls all plugins without throwing', async () => { /* ... */ })
  it('runBeforeMerge returns false when plugin blocks', async () => { /* ... */ })
  it('getPluginCommands aggregates from all plugins', () => { /* ... */ })
  it('unloadPlugins calls deactivate on all', async () => { /* ... */ })
})
```

**Effort:** ~2-3 days

---

## Implementation Order

| Phase | Feature | Days | Deps |
|-------|---------|------|------|
| 1 | Reviewer Assignment | 1 | None |
| 2 | Webhook/Event Push | 2 | None (but benefits from reviewer) |
| 3 | Sprint Planning Module | 2-3 | None |
| 4 | Plugin System Foundation | 2-3 | Completion handler knowledge |

Phases 1 and 2 can run in parallel. Phase 3 and 4 can run in parallel.

**Total estimate:** 7-9 days

## Pre-Commit Checklist

Every commit must pass:

```bash
npm run typecheck   # Zero errors
npm test            # All tests pass
npm run lint        # Zero errors
```

## Files Modified (Summary)

| File | Change |
|------|--------|
| `src/main/db.ts` | Migrations v24, v25, v26 |
| `src/shared/types.ts` | `Sprint`, `Webhook`, `WebhookEventType`, fields on `SprintTask` |
| `src/shared/ipc-channels.ts` | ~14 new channels |
| `src/main/data/sprint-queries.ts` | `assigned_reviewer`, `sprint_id` in allowlist |
| `src/main/handlers/sprint-listeners.ts` | Wire webhook firing |
| `src/main/index.ts` | Register 3 new handler modules, plugin init |
| `src/preload/index.ts` + `.d.ts` | New preload bridge namespaces |
| `src/renderer/src/components/code-review/ReviewQueue.tsx` | Filter tabs |
| `src/renderer/src/components/code-review/ReviewActions.tsx` | Claim button |
| `src/renderer/src/components/sprint/TaskDetailDrawer.tsx` | Reviewer dropdown |
| `src/renderer/src/components/sprint/PipelineHeader.tsx` | Sprint selector |
| `src/renderer/src/components/task-workbench/WorkbenchForm.tsx` | Reviewer field |
| `src/renderer/src/views/DashboardView.tsx` | Burn-down card |
| **New files** | |
| `src/main/data/sprint-plan-queries.ts` | Sprint CRUD + burndown |
| `src/main/handlers/sprint-plan-handlers.ts` | Sprint IPC |
| `src/main/handlers/webhook-handlers.ts` | Webhook IPC |
| `src/main/services/webhook-service.ts` | Webhook delivery + CRUD |
| `src/main/plugin-loader.ts` | Plugin lifecycle |
| `src/main/handlers/plugin-handlers.ts` | Plugin IPC |
| `src/shared/plugin-types.ts` | Plugin interface |
| `src/renderer/src/stores/sprintPlan.ts` | Sprint Zustand store |
| `src/renderer/src/components/settings/WebhookSettings.tsx` | Webhook config UI |
