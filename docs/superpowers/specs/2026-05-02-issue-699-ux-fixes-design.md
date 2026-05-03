# Issue #699 UX Fixes

**Issue:** #699 — User Feedback Suggestions  
**Date:** 2026-05-02

## Scope

Four targeted UX fixes from the dogfooding session, in priority order:

1. Render verification failure notes as structured diagnostics instead of raw JSON
2. Hover tooltip on blocked tasks showing which tasks are blocking them
3. Spec editor hint text clarifying "agent executes this verbatim"
4. Dependency cascade semantics — label the condition selector more clearly

---

## Fix 1 — Verification Failure Notes Rendering

### Problem

When the pre-review verification gate fails, `task.notes` is set to
`JSON.stringify(RevisionFeedback)`. `RevisionFeedback` is a structured object with a
`summary` string and a `diagnostics[]` array (file, line, kind, message, suggestedFix).
`TaskDetailDrawer` renders `task.notes` verbatim inside a `<pre>` tag, so users see raw
JSON instead of readable diagnostic output. The actual file/line/message are present in
the data — they're just unformatted.

### Solution

**Move `parseRevisionFeedback` + `isRevisionFeedback` to `src/shared/types/revision.ts`**
(where `RevisionFeedback` and `RevisionDiagnostic` types already live). Both functions
are pure — no main-process dependencies. `revision-feedback-builder.ts` imports them
from shared instead of re-defining them.

**In `TaskDetailDrawer.tsx`**, replace the bare `{task.notes}` branch with a conditional:

```
if parseRevisionFeedback(task.notes) → render VerificationDiagnostics component
else                                  → fall back to existing <pre>{task.notes}</pre>
```

**`VerificationDiagnostics`** is a small presentational component (can live in the same
file or as a sibling) that renders:

```
Previous attempt failed: <summary>

  src/foo.ts:42 [typecheck]
    Property 'bar' does not exist on type 'Baz'
    Fix: Change 'bar' to 'baz'

  src/tests/foo.test.ts [test]
    Expected 3 to equal 4
```

Each diagnostic row shows `file:line [kind]`, then the message, then the suggested fix
(if present) indented below. File and line are omitted when absent (test failures often
have no file reference). The component uses existing CSS vars for color — no new tokens.

### Fallback behaviour

`parseRevisionFeedback` returns `null` for any non-JSON or JSON that doesn't match the
`RevisionFeedback` shape (watchdog notes, noop notes, legacy freeform strings). Those
continue to render as `<pre>{task.notes}</pre>` unchanged.

### Files

| File | Change |
|---|---|
| `src/shared/types/revision.ts` | Add `isRevisionFeedback()` + `parseRevisionFeedback()` |
| `src/main/agent-manager/revision-feedback-builder.ts` | Import from `../../shared/types/revision` instead of re-defining |
| `src/renderer/src/components/sprint/TaskDetailDrawer.tsx` | Replace bare notes `<pre>` with conditional render; add `VerificationDiagnostics` |

---

## Fix 2 — Blocked Task Hover Tooltip

### Problem

When a task is `blocked`, the pipeline shows the blocked pill with no indication of
*which* tasks are blocking it. The user has to open the full task drawer to find out.

### Solution

`TaskPill` computes the blocking task titles when `task.status === 'blocked'` and sets
them on the outer `motion.div` as an HTML `title` attribute.

`task.depends_on` contains the ids of the blocking tasks. To resolve their titles,
`TaskPill` calls `useSprintTasksStore(selectTasks)` — it already imports from other
stores. A memoized selector computes the titles only when `status === 'blocked'`:

```ts
const blockingTitles = useSprintTasksStore(
  useCallback(
    (s) =>
      task.status === 'blocked' && task.depends_on
        ? task.depends_on
            .map((d) => s.tasks.find((t) => t.id === d.id)?.title ?? d.id)
            .join(', ')
        : null,
    [task.status, task.depends_on]
  )
)
```

The computed string is set as `title` on the outer div:

```tsx
title={blockingTitles ? `Blocked by: ${blockingTitles}` : undefined}
```

`React.memo` already wraps `TaskPillInner` — this change adds one store subscription per
rendered pill only when `task.status === 'blocked'`. Non-blocked pills skip the selector
entirely (returns `null` immediately from the conditional). Performance impact is
negligible.

### Files

| File | Change |
|---|---|
| `src/renderer/src/components/sprint/TaskPill.tsx` | Add blocking title selector + `title` attribute |

---

## Fix 3 — Spec Editor Hint Text

### Problem

Users (especially via the MCP API) confused `spec` (structured markdown, executed
verbatim) with `prompt` (orientation text, not authoritative). The Workbench spec editor
has no label communicating the authority of its contents.

### Solution

Add a one-line hint below the "Generate Spec" / template toolbar in `SpecEditor.tsx`:

```
Agent executes this spec verbatim — use ## headings (Goal, Files to Change, How to Test).
```

This is a `<p className="wb-spec__hint">` placed inside the `.wb-spec` div, below the
toolbar, above the textarea. Styled with the existing dim-text color token.

No changes to data model, store, or IPC.

### Files

| File | Change |
|---|---|
| `src/renderer/src/components/task-workbench/SpecEditor.tsx` | Add hint `<p>` below toolbar |
| `src/renderer/src/components/task-workbench/SpecEditor.css` | Add `.wb-spec__hint` style (font-size 11px, dim color, margin) |

---

## Fix 4 — Dependency Cascade Semantics

### Problem

`DependencyPicker` has a `<select>` for the dependency condition (`on_success`,
`on_failure`, `always`) with the placeholder "Default (type-based)". Users don't know
what "type-based" means in this context without reading source code. The relationship
between `hard`/`soft` type and the condition override is opaque.

### Solution

Two targeted changes to `DependencyPicker.tsx`:

1. **Change placeholder text** from `"Default (type-based)"` to
   `"Default — follows Hard/Soft rule above"`. This makes the hierarchy explicit:
   Hard/Soft is the default rule; condition is an explicit override.

2. **Add a visible label** before the `<select>`:

   ```tsx
   <label className="wb-deps__condition-label" htmlFor={`dep-condition-${dep.id}`}>
     Unblock when:
   </label>
   <select id={`dep-condition-${dep.id}`} ...>
   ```

   The `<label>` uses a small dim-text style matching the existing `wb-deps__help` line.

The existing help text "Hard = blocks on upstream failure · Soft = unblocks regardless"
stays — it explains the default rule that the condition field overrides.

No changes to data model, store, or IPC.

### Files

| File | Change |
|---|---|
| `src/renderer/src/components/task-workbench/DependencyPicker.tsx` | Change placeholder text; add `<label>` before condition `<select>` |
| `src/renderer/src/components/task-workbench/DependencyPicker.css` | Add `.wb-deps__condition-label` style |

---

## Testing

### Fix 1 — Verification notes

- Unit test `parseRevisionFeedback` and `isRevisionFeedback` in `src/shared/types/revision.ts`
  (move existing tests from `revision-feedback-builder.test.ts` — they already cover these
  two functions).
- Render test for `VerificationDiagnostics`: given a `RevisionFeedback` with two
  diagnostics, expect file, line, kind, and message to appear in the DOM.
- Render test for `TaskDetailDrawer` notes section: when `task.notes` is a valid JSON
  `RevisionFeedback`, expect the `VerificationDiagnostics` to render (not raw JSON);
  when `task.notes` is a freeform string, expect the `<pre>` fallback.

### Fix 2 — Blocked tooltip

- Render test for `TaskPill` with `status: 'blocked'` and `depends_on: [{id: 'task-1', type: 'hard'}]`:
  expect the pill's `title` attribute to contain "Blocked by: <task title>".
- When `status` is not `'blocked'`, `title` attribute is absent or undefined.

### Fix 3 — Spec hint

- Render test: `SpecEditor` renders a hint paragraph containing "Agent executes this spec
  verbatim".

### Fix 4 — Dep semantics

- Render test: `DependencyPicker` with one dep renders a `<label>` containing "Unblock
  when:" and a `<select>` with placeholder option text "Default — follows Hard/Soft rule
  above".

---

## What This Does Not Do

- Does not add a custom Tooltip component for the blocked tooltip — HTML `title` is
  sufficient and consistent with existing usage in `TaskPill`.
- Does not add a spec/prompt mode toggle to the Workbench — the hint text is sufficient
  without introducing a new mode.
- Does not change the `hard`/`soft` toggle interaction in `DependencyPicker` — the badge
  button behavior is unchanged.
- Does not address the remaining #699 items (poll drain loop, bulk import, lock-spec,
  pause epic, agent PID) — those are deferred.
