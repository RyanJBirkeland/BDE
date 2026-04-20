# Re-Queue Data Hygiene — Implementation Plan (RC6)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `resetTaskForRetry(id)` service function that clears stale terminal-state fields on a task, so re-queued tasks look like freshly-queued tasks. Wire it into the existing retry handler and the MCP `tasks.update` path for terminal→queued transitions.

**Architecture:** Small service-layer function that patches a task row to clear `completed_at`, `failure_reason`, `claimed_by`, `started_at`, `retry_count`, `fast_fail_count`, and `next_eligible_at`. Called by the `sprint:retry` IPC and by the MCP `tasks.update` handler when a terminal-status task is being moved back to `queued`.

**Spec reference:** `docs/superpowers/specs/2026-04-20-pipeline-pain-points-design.md` § Root Cause 6.

---

### Task 1: Add `resetTaskForRetry` to sprint-service

**Files:**
- Modify: `src/main/services/sprint-service.ts`
- Modify: `src/main/services/__tests__/sprint-service.test.ts` (or the nearest existing test file)

- [ ] **Step 1: Write the failing test**

```typescript
describe('resetTaskForRetry', () => {
  it('clears all stale terminal-state fields', () => {
    const updateTask = vi.fn().mockReturnValue({ id: 't1', status: 'queued' })
    resetTaskForRetry('t1', { updateTask })
    expect(updateTask).toHaveBeenCalledWith('t1', {
      completed_at: null,
      failure_reason: null,
      claimed_by: null,
      started_at: null,
      retry_count: 0,
      fast_fail_count: 0,
      next_eligible_at: null
    })
  })

  it('does not set status — caller decides queued vs backlog', () => {
    const updateTask = vi.fn().mockReturnValue({ id: 't1', status: 'queued' })
    resetTaskForRetry('t1', { updateTask })
    const patch = updateTask.mock.calls[0][1]
    expect(patch).not.toHaveProperty('status')
  })

  it('returns the updated row', () => {
    const updateTask = vi.fn().mockReturnValue({ id: 't1', status: 'queued' })
    const row = resetTaskForRetry('t1', { updateTask })
    expect(row).toEqual({ id: 't1', status: 'queued' })
  })

  it('returns null if updateTask returns null', () => {
    const updateTask = vi.fn().mockReturnValue(null)
    const row = resetTaskForRetry('missing', { updateTask })
    expect(row).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test:main -- sprint-service`
Expected: FAIL — `resetTaskForRetry is not defined`.

- [ ] **Step 3: Implement**

Append to `src/main/services/sprint-service.ts`:

```typescript
export interface ResetTaskForRetryDeps {
  updateTask?: (id: string, patch: Record<string, unknown>) => SprintTask | null
}

/**
 * Clear stale terminal-state fields on a task so it looks fresh after
 * re-queueing. Does NOT set `status` — the caller owns that decision
 * (usually 'queued', sometimes 'backlog'). Fields cleared:
 * - completed_at, failure_reason, claimed_by, started_at,
 * - retry_count and fast_fail_count (reset to 0, not null),
 * - next_eligible_at.
 */
export function resetTaskForRetry(id: string, deps: ResetTaskForRetryDeps = {}): SprintTask | null {
  const doUpdate = deps.updateTask ?? updateTask
  return doUpdate(id, {
    completed_at: null,
    failure_reason: null,
    claimed_by: null,
    started_at: null,
    retry_count: 0,
    fast_fail_count: 0,
    next_eligible_at: null
  })
}
```

- [ ] **Step 4: Run tests**

Run: `npm run test:main -- sprint-service`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/services/sprint-service.ts src/main/services/__tests__/sprint-service.test.ts
git commit -m "feat(sprint-service): add resetTaskForRetry to clear stale terminal-state fields"
```

---

### Task 2: Wire `resetTaskForRetry` into `sprint:retry` handler

**Files:**
- Modify: `src/main/handlers/sprint-retry-handler.ts`
- Modify: test for that handler

- [ ] **Step 1: Read the current handler**

Run: `cat src/main/handlers/sprint-retry-handler.ts`

Identify where it updates the task's status to `'queued'`. Insert a `resetTaskForRetry(id)` call *before* the status update so the status transition starts from a clean row.

- [ ] **Step 2: Write the failing test**

In the handler's test file, add:

```typescript
it('resets terminal-state fields before queueing', async () => {
  // Use the test harness the existing tests use.
  const spy = vi.fn().mockReturnValue({ id: 't1', status: 'queued' })
  // Replace updateTask / resetTaskForRetry with spies per existing mocking style.
  // Call the retry handler.
  // Assert resetTaskForRetry was called first, then status='queued' update.
})
```

Match whatever mocking strategy the handler's existing tests use.

- [ ] **Step 3: Run tests to verify failure**

Run: `npm run test:main -- sprint-retry-handler`
Expected: FAIL.

- [ ] **Step 4: Wire it in**

Edit the handler:

```typescript
import { resetTaskForRetry, updateTask } from '../services/sprint-service'

// Inside the safeHandle('sprint:retry', ...) body:
resetTaskForRetry(id)
const result = updateTask(id, { status: 'queued' })
if (!result) throw new Error(`Task ${id} not found`)
return result
```

Order matters: reset first (so completed_at is null, etc.), then update status (which then persists the queued row with fresh fields).

- [ ] **Step 5: Run tests**

Run: `npm run test:main -- sprint-retry-handler`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/main/handlers/sprint-retry-handler.ts src/main/handlers/__tests__/sprint-retry-handler.test.ts
git commit -m "feat(sprint-retry): reset terminal-state fields before queueing"
```

---

### Task 3: Apply the same reset on MCP `tasks.update` terminal→queued transitions

**Files:**
- Modify: `src/main/mcp-server/tools/tasks.ts`
- Modify: `src/main/mcp-server/tools/tasks.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tasks.test.ts`:

```typescript
it('tasks.update with status transition from terminal back to queued resets terminal-state fields', async () => {
  const deps = fakeDeps({
    getTask: vi.fn(() => fakeTask({ id: 't1', status: 'failed' })),
    updateTask: vi.fn(() => fakeTask({ id: 't1', status: 'queued' }))
  })
  const { server, call } = mockServer()
  registerTaskTools(server, deps)
  await call('tasks.update', { id: 't1', patch: { status: 'queued' } })

  // The handler must have called resetTaskForRetry — in the mock-deps world,
  // this manifests as an extra updateTask call with the reset patch shape,
  // OR as a dedicated deps.resetTaskForRetry call. Pick whichever the impl
  // produces. A clean approach: the handler composes reset + patch into
  // ONE updateTask call that includes the reset fields + the new status.
  const calls = (deps.updateTask as any).mock.calls
  const patch = calls[0][1]
  expect(patch).toMatchObject({
    status: 'queued',
    completed_at: null,
    failure_reason: null,
    claimed_by: null,
    started_at: null,
    retry_count: 0,
    fast_fail_count: 0,
    next_eligible_at: null
  })
})

it('tasks.update for a non-terminal status change does NOT reset fields', async () => {
  const deps = fakeDeps({
    getTask: vi.fn(() => fakeTask({ id: 't1', status: 'active' })),
    updateTask: vi.fn(() => fakeTask({ id: 't1', status: 'review' }))
  })
  const { server, call } = mockServer()
  registerTaskTools(server, deps)
  await call('tasks.update', { id: 't1', patch: { status: 'review' } })
  const calls = (deps.updateTask as any).mock.calls
  const patch = calls[0][1]
  expect(patch).not.toHaveProperty('completed_at')
})
```

- [ ] **Step 2: Run to verify failure**

- [ ] **Step 3: Implement**

In `tasks.ts`, the `tasks.update` handler:

```typescript
import { TERMINAL_STATUSES } from '../../shared/task-state-machine'

// Inside the tasks.update handler:
const { id, patch } = TaskUpdateSchema.parse(rawArgs)

// If transitioning from a terminal status back to queued/backlog, fold the
// reset fields into the patch so the underlying updateTask persists it all
// in one atomic call.
if (patch.status === 'queued' || patch.status === 'backlog') {
  const current = deps.getTask(id)
  if (current && TERMINAL_STATUSES.has(current.status)) {
    Object.assign(patch, {
      completed_at: null,
      failure_reason: null,
      claimed_by: null,
      started_at: null,
      retry_count: 0,
      fast_fail_count: 0,
      next_eligible_at: null
    })
  }
}

const row = deps.updateTask(id, patch)
if (!row) throw new McpDomainError(`Task ${id} not found`, McpErrorCode.NotFound, { id })
return json(row)
```

- [ ] **Step 4: Run tests**

Run: `npm run test:main -- tools/tasks`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/mcp-server/tools/tasks.ts src/main/mcp-server/tools/tasks.test.ts
git commit -m "feat(mcp): reset terminal-state fields on tasks.update terminal→queued transitions"
```

---

### Task 4: Document in CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add a one-line under Key Conventions**

```markdown
- When re-queueing a task, call `resetTaskForRetry(id)` (or use the `sprint:retry` IPC / `tasks.update` MCP tool) instead of issuing a raw `UPDATE sprint_tasks SET status='queued'` — direct SQL leaves stale `completed_at`, `failure_reason`, `retry_count`, etc. from the prior run.
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(CLAUDE.md): document resetTaskForRetry for clean re-queue flows"
```

---

### Task 5: Regression

```bash
npm run typecheck && npm test && npm run test:main && npm run lint
```

All green.

---

## Self-Review Notes

- Spec coverage: `resetTaskForRetry` service function (Task 1); wired into the two known re-queue paths — IPC retry handler (Task 2) and MCP tasks.update terminal→queued (Task 3); documentation (Task 4).
- Placeholders: None.
- Type consistency: `ResetTaskForRetryDeps` is stable across tasks. Injection pattern matches `cancelTask` (which also accepts an optional `updateTask` dep for testability).
