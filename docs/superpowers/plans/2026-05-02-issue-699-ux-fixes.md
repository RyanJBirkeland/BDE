# Issue #699 UX Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix four UX issues from the #699 dogfooding report: structured verification failure notes in the task drawer, blocked task hover tooltip, spec editor hint text, and clearer dependency cascade semantics.

**Architecture:** All changes are renderer-only except Task 1 (moving `parseRevisionFeedback` to shared so the renderer can use it). Tasks 3–5 are fully independent pure UI changes. Task 2 depends on Task 1.

**Tech Stack:** React, TypeScript, Vitest, @testing-library/react, existing Zustand stores (`useSprintTasks`), existing CSS token vars.

---

## File Map

| File | Change |
|---|---|
| `src/shared/types/revision.ts` | Add `isRevisionFeedback()` + `parseRevisionFeedback()` |
| `src/main/agent-manager/revision-feedback-builder.ts` | Import from shared instead of re-defining |
| `src/renderer/src/components/sprint/TaskDetailDrawer.tsx` | Add `VerificationDiagnostics` component; call `parseRevisionFeedback` on notes |
| `src/renderer/src/components/sprint/TaskPill.tsx` | Add `useSprintTasks` selector for blocking task titles; set `title` on outer div |
| `src/renderer/src/components/task-workbench/SpecEditor.tsx` | Add hint `<p>` below toolbar |
| `src/renderer/src/components/task-workbench/SpecEditor.css` | Add `.wb-spec__hint` style |
| `src/renderer/src/components/task-workbench/DependencyPicker.tsx` | Add `<label>` + change placeholder text |
| `src/renderer/src/components/task-workbench/DependencyPicker.css` | Add `.wb-deps__condition-label` style |

---

### Task 1: Move `parseRevisionFeedback` to shared

**Files:**
- Modify: `src/shared/types/revision.ts`
- Modify: `src/main/agent-manager/revision-feedback-builder.ts`

**Background:** `parseRevisionFeedback` and its helper `isRevisionFeedback` currently live in the main-process-only `revision-feedback-builder.ts`. The renderer needs them (Task 2). Moving them to `src/shared/types/revision.ts` (where `RevisionFeedback` and `RevisionDiagnostic` already live) makes them available everywhere without duplicating logic. `revision-feedback-builder.ts` re-exports them so existing main-process imports keep working.

- [ ] **Step 1: Add `isRevisionFeedback` and `parseRevisionFeedback` to `src/shared/types/revision.ts`**

Append to the bottom of `src/shared/types/revision.ts`:

```typescript
function isRevisionFeedback(value: unknown): value is RevisionFeedback {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.summary === 'string' &&
    Array.isArray(candidate.diagnostics)
  )
}

/**
 * Attempts to parse a task's notes field as RevisionFeedback.
 * Returns the parsed object on success, or null if the notes are not valid
 * RevisionFeedback JSON (e.g. legacy freeform strings).
 */
export function parseRevisionFeedback(notes: string | null | undefined): RevisionFeedback | null {
  if (!notes) return null
  try {
    const parsed: unknown = JSON.parse(notes)
    if (isRevisionFeedback(parsed)) return parsed
    return null
  } catch {
    return null
  }
}
```

- [ ] **Step 2: Update `revision-feedback-builder.ts` to import from shared**

In `src/main/agent-manager/revision-feedback-builder.ts`, find the existing definitions of `parseRevisionFeedback` and `isRevisionFeedback` (around lines 175–195) and replace them with a re-export:

```typescript
export { parseRevisionFeedback } from '../../shared/types/revision'
```

Delete the `parseRevisionFeedback` function body and the `isRevisionFeedback` function body entirely — the shared module now owns them.

- [ ] **Step 3: Run tests to confirm nothing broke**

```bash
npm test -- --run src/main/agent-manager/__tests__/revision-feedback-builder.test.ts
```

Expected: all existing tests pass (they import from `revision-feedback-builder.ts` which re-exports from shared).

- [ ] **Step 4: Commit**

```bash
git add src/shared/types/revision.ts src/main/agent-manager/revision-feedback-builder.ts
git commit -m "refactor(shared): move parseRevisionFeedback to shared/types/revision"
```

---

### Task 2: Structured verification diagnostics in TaskDetailDrawer

**Files:**
- Modify: `src/renderer/src/components/sprint/TaskDetailDrawer.tsx`
- Modify: `src/renderer/src/components/sprint/__tests__/TaskDetailDrawer.test.tsx`

**Background:** When the pre-review verification gate fails, `task.notes` contains a JSON-stringified `RevisionFeedback` object with `summary` and `diagnostics[]` (file, line, kind, message, suggestedFix). The drawer currently renders `task.notes` as a raw `<pre>` — users see JSON instead of formatted diagnostics. This task adds a structured renderer that falls back to the existing `<pre>` for legacy freeform notes.

- [ ] **Step 1: Write the failing tests**

In `src/renderer/src/components/sprint/__tests__/TaskDetailDrawer.test.tsx`, add these tests inside the existing `describe('failure details', ...)` block:

```typescript
    it('renders structured diagnostics when notes is a RevisionFeedback JSON', () => {
      const feedback = {
        summary: 'TypeScript compilation failed',
        diagnostics: [
          { file: 'src/foo.ts', line: 42, kind: 'typecheck', message: "Property 'bar' does not exist" }
        ]
      }
      render(
        <TaskDetailDrawer
          task={{ ...baseTask, status: 'failed', notes: JSON.stringify(feedback) }}
          onClose={vi.fn()}
          onEdit={vi.fn()}
        />
      )
      expect(screen.getByTestId('task-drawer-verification-diagnostics')).toBeInTheDocument()
      expect(screen.getByText('TypeScript compilation failed')).toBeInTheDocument()
      expect(screen.getByText(/src\/foo\.ts:42/)).toBeInTheDocument()
      expect(screen.getByText(/Property 'bar' does not exist/)).toBeInTheDocument()
    })

    it('falls back to pre block when notes is a freeform string', () => {
      render(
        <TaskDetailDrawer
          task={{ ...baseTask, status: 'failed', notes: 'npm test exited with code 1' }}
          onClose={vi.fn()}
          onEdit={vi.fn()}
        />
      )
      expect(screen.queryByTestId('task-drawer-verification-diagnostics')).not.toBeInTheDocument()
      expect(screen.getByTestId('task-drawer-failure-notes')).toBeInTheDocument()
      expect(screen.getByTestId('task-drawer-failure-notes').textContent).toContain('npm test exited with code 1')
    })
```

- [ ] **Step 2: Run to confirm the tests fail**

```bash
npm test -- --run src/renderer/src/components/sprint/__tests__/TaskDetailDrawer.test.tsx
```

Expected: the two new tests fail with "Unable to find an element by: [data-testid="task-drawer-verification-diagnostics"]".

- [ ] **Step 3: Add import and `VerificationDiagnostics` component to `TaskDetailDrawer.tsx`**

Add to the imports at the top of `src/renderer/src/components/sprint/TaskDetailDrawer.tsx`:

```typescript
import { parseRevisionFeedback } from '../../../../shared/types/revision'
import type { RevisionFeedback } from '../../../../shared/types/revision'
```

Add this component function before the main `TaskDetailDrawer` export (anywhere in the file outside the component):

```typescript
function VerificationDiagnostics({ feedback }: { feedback: RevisionFeedback }): React.JSX.Element {
  return (
    <div
      className="task-drawer__verification-diagnostics"
      data-testid="task-drawer-verification-diagnostics"
    >
      <p className="task-drawer__diag-summary">{feedback.summary}</p>
      {feedback.diagnostics.length > 0 && (
        <ul className="task-drawer__diag-list">
          {feedback.diagnostics.map((d, i) => (
            <li key={i} className="task-drawer__diag-item">
              <span className="task-drawer__diag-location">
                {d.file}
                {d.line !== undefined ? `:${d.line}` : ''} [{d.kind}]
              </span>
              <span className="task-drawer__diag-message">{d.message}</span>
              {d.suggestedFix && (
                <span className="task-drawer__diag-fix">Fix: {d.suggestedFix}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Replace the bare notes `<pre>` with a conditional render**

Find the notes rendering section in `TaskDetailDrawer.tsx`. It currently looks like:

```typescript
            {task.notes ? (
              <pre
                className="task-drawer__failure-notes"
                data-testid="task-drawer-failure-notes"
                style={{
                  color: 'var(--fleet-text, rgba(255,255,255,0.85))'
                }}
              >
                {task.notes}
              </pre>
            ) : (
              <div className="task-drawer__status-text">
                No diagnostic notes captured. Check the Agents view for details.
              </div>
            )}
```

Replace with:

```typescript
            {task.notes ? (
              (() => {
                const feedback = parseRevisionFeedback(task.notes)
                return feedback ? (
                  <VerificationDiagnostics feedback={feedback} />
                ) : (
                  <pre
                    className="task-drawer__failure-notes"
                    data-testid="task-drawer-failure-notes"
                    style={{
                      color: 'var(--fleet-text, rgba(255,255,255,0.85))'
                    }}
                  >
                    {task.notes}
                  </pre>
                )
              })()
            ) : (
              <div className="task-drawer__status-text">
                No diagnostic notes captured. Check the Agents view for details.
              </div>
            )}
```

- [ ] **Step 5: Run tests to confirm they pass**

```bash
npm test -- --run src/renderer/src/components/sprint/__tests__/TaskDetailDrawer.test.tsx
```

Expected: all tests pass including the two new ones.

- [ ] **Step 6: Run typecheck**

```bash
npm run typecheck
```

Expected: zero errors.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/components/sprint/TaskDetailDrawer.tsx \
        src/renderer/src/components/sprint/__tests__/TaskDetailDrawer.test.tsx
git commit -m "feat(sprint): render verification failure notes as structured diagnostics"
```

---

### Task 3: Blocked task hover tooltip

**Files:**
- Modify: `src/renderer/src/components/sprint/TaskPill.tsx`
- Modify: `src/renderer/src/components/sprint/__tests__/TaskPill.test.tsx` (or create if absent — check first)

**Background:** When a task is `blocked`, `task.depends_on` contains the ids of the tasks blocking it. `TaskPill` renders blocked tasks but gives no tooltip indicating why. Adding a `title` attribute with the blocking task names fixes this with zero layout change.

- [ ] **Step 1: Check for TaskPill tests**

```bash
ls src/renderer/src/components/sprint/__tests__/ | grep -i pill
```

Note the test file name for use in Step 2.

- [ ] **Step 2: Write the failing test**

Open the TaskPill test file (e.g. `TaskPill.test.tsx`). Add a new test. First check how the file mocks stores — look for `vi.mock` calls at the top. Then add:

```typescript
  it('shows blocked-by tooltip on the pill when task is blocked with depends_on', () => {
    // Set up store so the blocking task title can be resolved
    useSprintTasks.setState({
      tasks: [
        { ...basePillTask, id: 'blocker-1', title: 'Build Auth Service', status: 'active' }
      ]
    })
    const blockedTask = {
      ...basePillTask,
      status: 'blocked',
      depends_on: [{ id: 'blocker-1', type: 'hard' as const }]
    }
    render(<TaskPill task={blockedTask} selected={false} onClick={vi.fn()} />)
    const pill = screen.getByRole('button')
    expect(pill.getAttribute('title')).toContain('Blocked by:')
    expect(pill.getAttribute('title')).toContain('Build Auth Service')
  })
```

If the test file doesn't already import `useSprintTasks`, add:

```typescript
import { useSprintTasks } from '../../../stores/sprintTasks'
```

And add a `beforeEach` reset:

```typescript
  beforeEach(() => {
    useSprintTasks.setState({ tasks: [] })
  })
```

- [ ] **Step 3: Run to confirm the test fails**

```bash
npm test -- --run src/renderer/src/components/sprint/__tests__/TaskPill.test.tsx
```

Expected: new test fails — pill has no `title` attribute.

- [ ] **Step 4: Update `TaskPill.tsx` to add the blocked tooltip**

Add to the imports at the top of `src/renderer/src/components/sprint/TaskPill.tsx`:

```typescript
import { useCallback } from 'react'
import { useSprintTasks } from '../../stores/sprintTasks'
```

(Note: `useCallback` is already imported via React — add it to the existing React import destructure if needed, or keep separate. `useSprintTasks` is a new import.)

Inside `TaskPillInner`, add this after the existing `const costUsd = useTaskCost(...)` line:

```typescript
  const blockingTitles = useSprintTasks(
    useCallback(
      (s) => {
        if (task.status !== 'blocked' || !task.depends_on?.length) return null
        return task.depends_on
          .map((d) => s.tasks.find((t) => t.id === d.id)?.title ?? d.id)
          .join(', ')
      },
      [task.status, task.depends_on]
    )
  )
```

On the outer `motion.div`, add the `title` prop after `aria-label`:

```typescript
      title={blockingTitles ? `Blocked by: ${blockingTitles}` : undefined}
```

- [ ] **Step 5: Run tests to confirm they pass**

```bash
npm test -- --run src/renderer/src/components/sprint/__tests__/TaskPill.test.tsx
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/sprint/TaskPill.tsx \
        src/renderer/src/components/sprint/__tests__/TaskPill.test.tsx
git commit -m "feat(sprint): add hover tooltip on blocked tasks showing blocking task names"
```

---

### Task 4: Spec editor hint text

**Files:**
- Modify: `src/renderer/src/components/task-workbench/SpecEditor.tsx`
- Modify: `src/renderer/src/components/task-workbench/SpecEditor.css`
- Modify: `src/renderer/src/components/task-workbench/__tests__/SpecEditor.test.tsx`

**Background:** The spec editor textarea has no label explaining what a spec is. Users (especially via the MCP API) confused `spec` (executed verbatim) with a loose prompt. A one-line hint below the toolbar closes this gap.

- [ ] **Step 1: Write the failing test**

In `src/renderer/src/components/task-workbench/__tests__/SpecEditor.test.tsx`, add:

```typescript
  it('renders a hint that the spec is executed verbatim', () => {
    render(<SpecEditor {...defaultProps} />)
    expect(screen.getByText(/Agent executes this spec verbatim/)).toBeInTheDocument()
  })
```

- [ ] **Step 2: Run to confirm the test fails**

```bash
npm test -- --run src/renderer/src/components/task-workbench/__tests__/SpecEditor.test.tsx
```

Expected: new test fails — hint text not found.

- [ ] **Step 3: Add the hint paragraph to `SpecEditor.tsx`**

In the `return` of `SpecEditor`, add a `<p>` between the toolbar div and the textarea:

```typescript
  return (
    <div className="wb-spec">
      <div className="wb-spec__toolbar">
        {/* existing toolbar content unchanged */}
      </div>
      <p className="wb-spec__hint">
        Agent executes this spec verbatim — use <code>##</code> headings (Goal, Files to Change, How to Test).
      </p>
      <textarea
        id="wb-form-spec"
        {/* existing textarea props unchanged */}
      />
      <ConfirmModal {...confirmProps} />
    </div>
  )
```

- [ ] **Step 4: Add the hint style to `SpecEditor.css`**

Append to `src/renderer/src/components/task-workbench/SpecEditor.css`:

```css
.wb-spec__hint {
  margin: 0;
  font-size: var(--fleet-size-xs);
  color: var(--fleet-text-muted);
  line-height: 1.4;
}

.wb-spec__hint code {
  font-family: var(--fleet-font-mono, monospace);
  background: var(--fleet-overlay, rgba(255, 255, 255, 0.06));
  padding: 0 3px;
  border-radius: 3px;
}
```

- [ ] **Step 5: Run tests to confirm they pass**

```bash
npm test -- --run src/renderer/src/components/task-workbench/__tests__/SpecEditor.test.tsx
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/task-workbench/SpecEditor.tsx \
        src/renderer/src/components/task-workbench/SpecEditor.css \
        src/renderer/src/components/task-workbench/__tests__/SpecEditor.test.tsx
git commit -m "feat(workbench): add spec editor hint clarifying verbatim execution"
```

---

### Task 5: Dependency cascade semantics

**Files:**
- Modify: `src/renderer/src/components/task-workbench/DependencyPicker.tsx`
- Modify: `src/renderer/src/components/task-workbench/DependencyPicker.css`
- Modify: `src/renderer/src/components/task-workbench/__tests__/DependencyPicker.test.tsx`

**Background:** The condition `<select>` in the dep picker has a placeholder "Default (type-based)" that doesn't tell the user what "type-based" means. Adding a visible "Unblock when:" label and changing the placeholder to reference the Hard/Soft rule above makes the cascade semantics self-documenting.

- [ ] **Step 1: Write the failing tests**

In `src/renderer/src/components/task-workbench/__tests__/DependencyPicker.test.tsx`, add:

```typescript
  it('renders "Unblock when:" label for each dependency condition select', () => {
    const deps: TaskDependency[] = [{ id: '1', type: 'hard' }]
    render(
      <DependencyPicker
        dependencies={deps}
        availableTasks={mockTasks}
        onChange={vi.fn()}
        currentTaskId={undefined}
      />
    )
    expect(screen.getByText('Unblock when:')).toBeInTheDocument()
  })

  it('shows updated placeholder text in the condition select', () => {
    const deps: TaskDependency[] = [{ id: '1', type: 'hard' }]
    render(
      <DependencyPicker
        dependencies={deps}
        availableTasks={mockTasks}
        onChange={vi.fn()}
        currentTaskId={undefined}
      />
    )
    expect(
      screen.getByRole('option', { name: /Default — follows Hard\/Soft rule above/ })
    ).toBeInTheDocument()
  })
```

- [ ] **Step 2: Run to confirm the tests fail**

```bash
npm test -- --run src/renderer/src/components/task-workbench/__tests__/DependencyPicker.test.tsx
```

Expected: both new tests fail.

- [ ] **Step 3: Update `DependencyPicker.tsx`**

Find the dep item render in `DependencyPicker.tsx`. Inside the `{dependencies.map((dep) => (` block, find the `<select>` for the condition and add a `<label>` immediately before it, and update the placeholder option text:

```typescript
              <label
                className="wb-deps__condition-label"
                htmlFor={`dep-condition-${dep.id}`}
              >
                Unblock when:
              </label>
              <select
                id={`dep-condition-${dep.id}`}
                className="wb-deps__condition fleet-select"
                value={dep.condition ?? ''}
                onChange={(e) =>
                  handleChangeCondition(
                    dep.id,
                    e.target.value === ''
                      ? undefined
                      : (e.target.value as 'on_success' | 'on_failure' | 'always')
                  )
                }
                aria-label="Dependency condition"
                title="When should this dependency be satisfied?"
              >
                <option value="">Default — follows Hard/Soft rule above</option>
                <option value="on_success">On Success</option>
                <option value="on_failure">On Failure</option>
                <option value="always">Always (any terminal status)</option>
              </select>
```

- [ ] **Step 4: Add the label style to `DependencyPicker.css`**

Append to `src/renderer/src/components/task-workbench/DependencyPicker.css`:

```css
.wb-deps__condition-label {
  font-size: var(--fleet-size-xs);
  color: var(--fleet-text-muted);
  white-space: nowrap;
  flex-shrink: 0;
}
```

- [ ] **Step 5: Run tests to confirm they pass**

```bash
npm test -- --run src/renderer/src/components/task-workbench/__tests__/DependencyPicker.test.tsx
```

Expected: all tests pass.

- [ ] **Step 6: Run full suite**

```bash
npm run typecheck && npm test -- --run
```

Expected: zero type errors, all tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/components/task-workbench/DependencyPicker.tsx \
        src/renderer/src/components/task-workbench/DependencyPicker.css \
        src/renderer/src/components/task-workbench/__tests__/DependencyPicker.test.tsx
git commit -m "feat(workbench): clarify dependency cascade semantics with label and updated placeholder"
```

---

## Self-Review

**Spec coverage:**
- ✅ Fix 1 (verification notes): `parseRevisionFeedback` moved to shared (Task 1), `VerificationDiagnostics` + conditional render in drawer (Task 2)
- ✅ Fix 1 fallback: freeform notes still render as `<pre>` (Task 2, Step 4)
- ✅ Fix 2 (blocked tooltip): `useSprintTasks` selector + `title` attribute on pill (Task 3)
- ✅ Fix 3 (spec hint): `<p className="wb-spec__hint">` + CSS (Task 4)
- ✅ Fix 4 (dep semantics): `<label>Unblock when:</label>` + changed placeholder (Task 5)

**Placeholder scan:** None found.

**Type consistency:**
- `RevisionFeedback` and `RevisionDiagnostic` imported from `src/shared/types/revision` in Task 2 — same source as Task 1's export. ✅
- `blockingTitles: string | null` in Task 3 — used directly in ternary. ✅
- `dep.id` used as `htmlFor`/`id` suffix in Task 5 — consistent with the dep map key. ✅
