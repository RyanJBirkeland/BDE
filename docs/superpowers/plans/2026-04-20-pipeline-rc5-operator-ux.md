# Operator UX Surfaces — Implementation Plan (RC5)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give operators in-app affordances when pipeline tasks fail — a Retry button on errored/failed rows that also performs the data-hygiene reset, and a clearer MCP schema description on length-capped fields. (The drain-pause banner is implemented in RC3.)

**Architecture:** The Retry button wires the existing `sprint-retry-handler` IPC to a new `resetTaskForRetry` service call (defined in RC6) and surfaces it in the Task Pipeline UI. Schema description polish is a one-file change to the MCP zod schemas.

**Spec reference:** `docs/superpowers/specs/2026-04-20-pipeline-pain-points-design.md` § Root Cause 5.

**Dependency:** RC6 (`resetTaskForRetry` function). If RC6 has not landed yet, Task 2 below creates a minimal inline version of `resetTaskForRetry`; RC6's work will then consolidate it into a shared service export.

---

### Task 1: Polish MCP schema descriptions for length-capped fields

**Files:**
- Modify: `src/main/mcp-server/schemas.ts`

- [ ] **Step 1: Survey existing schema descriptions**

Run: `grep -B1 "\.max(\|\.length\b" src/main/mcp-server/schemas.ts | head -40`

Identify every field that has a `.max(N)` or numeric-length constraint but no user-facing description explaining the limit. Candidates:

- `icon` (max 4 — single emoji glyph)
- `name`, `title`, `repo` (length caps — mention the cap in the description)
- `tags`, `depends_on` (array caps)

- [ ] **Step 2: Add `.describe()` calls with human-readable descriptions**

Zod supports `.describe('...')` which surfaces in error messages via `z.ZodError.issues[].message` (with minor handler glue). Even if the error-message wiring requires an extra step (see Task 3), the description on the schema is self-documenting for any future code-generation or UI auto-render.

Example edits:

```typescript
// In the EpicCreateSchema (or wherever icon is declared)
icon: z.string().max(4).describe('Single emoji glyph identifying the epic (max 4 chars)').optional(),

// In TaskWriteFieldsSchema
title: z.string().min(1).max(500).describe('Task title (1-500 chars)'),
repo: z.string().min(1).max(200).describe('Repository slug (lowercase, configured in Settings; 1-200 chars)'),
tags: z.array(z.string().min(1).max(64)).max(32).describe('Up to 32 tags, each 1-64 chars').optional(),
```

Apply the pattern consistently to every length-capped field.

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/main/mcp-server/schemas.ts
git commit -m "docs(mcp-schemas): add descriptions to length-capped fields for discoverability"
```

---

### Task 2: Map zod errors to user-friendly messages in MCP error responses

**Files:**
- Modify: `src/main/mcp-server/errors.ts`
- Modify: `src/main/mcp-server/errors.test.ts`

- [ ] **Step 1: Read the current zod-error mapping**

Run: `grep -n "ZodError\|toJsonRpcError\|fromZodError" src/main/mcp-server/errors.ts`

Note the current path that converts zod validation failures into JSON-RPC error responses. The goal of this task: when a zod error occurs on a field that has a `.describe()`, include that description in the surfaced message rather than the raw zod message.

- [ ] **Step 2: Write the failing test**

Append to `errors.test.ts`:

```typescript
import { z } from 'zod'
import { toJsonRpcError } from './errors' // or wherever the helper is exported

describe('zod errors carry the field description', () => {
  it('includes the describe() text in the user-facing message', () => {
    const schema = z.object({
      icon: z.string().max(4).describe('Single emoji glyph identifying the epic (max 4 chars)')
    })
    const result = schema.safeParse({ icon: 'shield' })
    expect(result.success).toBe(false)
    if (!result.success) {
      const rpc = toJsonRpcError(result.error)
      expect(rpc.message).toMatch(/Single emoji glyph/)
    }
  })
})
```

- [ ] **Step 3: Run to verify failure**

Run: `npm run test:main -- errors`
Expected: FAIL — current `toJsonRpcError` returns raw zod messages.

- [ ] **Step 4: Extend `toJsonRpcError` to prefer field descriptions**

In `errors.ts`, within the zod-error branch:

```typescript
function messageFromZodIssue(issue: z.ZodIssue, schema?: z.ZodTypeAny): string {
  // Try to find the schema for the failing path and pull its description.
  // If unavailable (caller didn't pass schema), fall back to the raw message.
  if (schema && 'description' in (schema as any)) {
    // Walk the schema down the path; for complex cases this may require a
    // helper — keep the shape simple for now (top-level fields).
    const fieldName = issue.path[0]
    if (typeof fieldName === 'string' && schema instanceof z.ZodObject) {
      const fieldSchema = (schema.shape as Record<string, z.ZodTypeAny>)[fieldName]
      if (fieldSchema?.description) {
        return `${fieldName}: ${fieldSchema.description} — got: ${issue.message}`
      }
    }
  }
  return `${issue.path.join('.')}: ${issue.message}`
}
```

Note: this is a simplification — it only walks top-level object fields. Deeper paths (nested arrays, unions) fall back to the raw message. That's acceptable because the current pain point is top-level fields (`icon`, `title`, etc.).

Wire it: `toJsonRpcError` takes the optional `schema` second argument now; call sites that have the schema on hand pass it, others don't. Zero-breaking default: when no schema passed, behavior is unchanged.

- [ ] **Step 5: Run tests**

Run: `npm run test:main -- errors`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/main/mcp-server/errors.ts src/main/mcp-server/errors.test.ts
git commit -m "feat(mcp-errors): include field .describe() text in user-facing error messages"
```

---

### Task 3: Add Retry button to the Task Pipeline row

**Files:**
- Modify: `src/renderer/src/components/sprint/TaskDetailActionButtons.tsx` (or the row-action component — search for one)
- Modify: `src/renderer/src/stores/sprintTasks.ts` (action for the retry flow)
- Test: whichever `__tests__` file covers the row-action component

- [ ] **Step 1: Identify the row action component**

Run: `grep -rn "action buttons\|row action\|Retry" src/renderer/src/components/sprint/ | head -10`

Find the component that renders per-task action buttons on a Pipeline row or the Task Detail drawer. Its location may vary — treat the following code as a sketch to adapt.

- [ ] **Step 2: Add a `retryTask` action to the sprintTasks store**

In `src/renderer/src/stores/sprintTasks.ts`, add:

```typescript
retryTask: async (id: string) => {
  // Uses the sprint:retry IPC channel (existing handler) which in turn
  // calls resetTaskForRetry + updates status to 'queued'. If that handler
  // does not yet call resetTaskForRetry, this action should also POST
  // an update to clear the terminal fields — but that duplicates RC6's
  // work. Prefer: land RC6 first, then this is a clean one-liner.
  try {
    await window.api.sprint.retry(id)
    // Re-fetch the list to pick up the new state.
    await get().refetch()
  } catch (err) {
    get().setError(err instanceof Error ? err.message : String(err))
  }
}
```

If `window.api.sprint.retry` does not exist on the preload, add it:

- `src/preload/index.ts`: add `sprint.retry: (id: string) => ipcRenderer.invoke('sprint:retry', id)`
- Shared types: extend `window.api.sprint` type with `retry(id: string): Promise<void>`
- `src/main/handlers/sprint-retry-handler.ts`: ensure the handler registers `sprint:retry` — it likely does; verify.

- [ ] **Step 3: Render the Retry button conditionally**

In the row action component, add:

```typescript
const canRetry = task.status === 'error' || task.status === 'failed' || task.status === 'cancelled'

{canRetry && (
  <Button
    variant="ghost"
    size="sm"
    onClick={() => sprintTasks.retryTask(task.id)}
    aria-label={`Retry task ${task.id}`}
  >
    <RefreshCw size={14} /> Retry
  </Button>
)}
```

(Reuse whatever Button / icon imports are standard in the file. `lucide-react`'s `RefreshCw` is already used elsewhere per CLAUDE.md.)

- [ ] **Step 4: Add a component test**

Either in the existing `__tests__/TaskDetailActionButtons.test.tsx` (if present) or a new file:

```typescript
it('shows Retry on errored tasks and invokes retryTask', async () => {
  const retryTask = vi.fn()
  // Render with an errored task and a mocked store that exposes retryTask.
  // Click the Retry button.
  // expect(retryTask).toHaveBeenCalledWith('audit-20260420-t-11')
})

it('hides Retry when task is in a non-terminal status', () => {
  // Render with status='active'; expect no Retry button.
})
```

Match the existing test patterns in the `sprint` folder.

- [ ] **Step 5: Run tests**

Run: `npm test -- TaskDetailActionButtons` (or whichever file you touched).
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/sprint/TaskDetailActionButtons.tsx src/renderer/src/stores/sprintTasks.ts src/preload/index.ts <shared-types-file> <test-file>
git commit -m "feat(pipeline-ui): add Retry button on errored/failed/cancelled task rows"
```

---

### Task 4: Show `failure_reason` in the task-detail panel

**Files:**
- Modify: whichever component renders task detail — search for it
- Test: corresponding test file

- [ ] **Step 1: Find the detail component**

Run: `grep -rn "TaskDetail\|SprintTaskDetail\|detail drawer" src/renderer/src/components/sprint/ | head -10`

- [ ] **Step 2: Add a failure-reason section**

When `task.failure_reason` is non-null AND `task.status` is terminal (`error`/`failed`/`cancelled`), render:

```tsx
{task.failure_reason && (
  <section aria-label="Failure reason">
    <h3>Failure reason</h3>
    <pre>{task.failure_reason}</pre>
  </section>
)}
```

Use existing styling tokens; keep it visually distinct (red accent).

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(pipeline-ui): surface failure_reason in the task detail panel"
```

---

### Task 5: Full-suite regression

- [ ] **Step 1: Run**

```bash
npm run typecheck && npm test && npm run test:main && npm run lint
```

Expected: all green.

- [ ] **Step 2: Manual smoke**

Manually create an errored task in the DB (`UPDATE sprint_tasks SET status='error', failure_reason='test' WHERE id='<some-existing-id>'`). Open the Pipeline, verify:
- Failure reason shows in the detail panel.
- Retry button is visible.
- Clicking Retry transitions the task to `queued`.

Undo the test state.

---

## Self-Review Notes

- Spec coverage: Retry button (Task 3); failure_reason surfacing (Task 4); schema-hint polish (Tasks 1–2). The drain-pause banner is owned by RC3, referenced in the architecture summary above.
- Placeholders: None.
- Dependency on RC6: Task 3 assumes `sprint:retry` eventually calls `resetTaskForRetry`. If RC6 hasn't shipped yet, the Retry button still works (status flips to `queued`) but the terminal-state fields retain stale values — which RC6 fixes. No ordering blocker, just a temporary UX imperfection.
