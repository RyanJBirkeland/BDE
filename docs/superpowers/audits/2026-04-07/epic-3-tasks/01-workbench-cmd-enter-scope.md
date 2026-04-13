# Scope Workbench Cmd+Enter handler to the form element

## Problem

`WorkbenchForm.tsx:348-369` attaches a Cmd+Enter keydown handler directly to `window`:

```ts
window.addEventListener('keydown', handler)
```

This fires from anywhere in the app — including typing in the IDE editor, the Code Review conversation tab, Agents view CommandBar, or a tear-off window. With BDE's split panes and tear-off windows the Workbench is rarely the only thing focused. A misplaced Cmd+Enter can accidentally queue a half-finished task, burning agent runtime and watchdog slots before the user notices.

Alpha Senior Dev flagged this as CRITICAL in the 2026-04-07 audit.

## Solution

Attach the keydown listener to the form's root `<div>` via a React `onKeyDown` prop instead of a `window.addEventListener`. The handler should only fire when focus is inside the Workbench form. Keep the existing pre-flight check behavior (`describeQueueBlocker` etc.) unchanged.

Specifically:

1. Find the `useEffect` that registers the `window.addEventListener('keydown', ...)` for Cmd+Enter (lines 348-369)
2. Delete it
3. On the outermost form container `<div>` (or `<form>` / `<section>`), add an `onKeyDown={handleKeyDown}` prop that calls the same logic
4. The new handler reads `e.metaKey && e.key === 'Enter'` and calls the same queue logic the old listener called
5. The default `Enter` (form submit) behavior should still work on text inputs — the onKeyDown only intercepts Cmd+Enter

## Files to Change

- `src/renderer/src/components/task-workbench/WorkbenchForm.tsx` — replace window-scoped listener with onKeyDown prop

## How to Test

1. `npm run typecheck` — 0 errors
2. `npm run test:coverage` — all tests pass
3. `npm run lint` — 0 errors
4. Test in isolation first if you see failures — parallel agents may be running tests too.
5. `grep -n "window.addEventListener.*keydown" src/renderer/src/components/task-workbench/WorkbenchForm.tsx` — must return zero matches after the fix
6. Manual: focus the Workbench title field, press Cmd+Enter — should still queue. Focus somewhere else (e.g., a text field outside the workbench if testable) — Cmd+Enter should NOT trigger the workbench queue.

## Out of Scope

- Changing `describeQueueBlocker` or any pre-flight validation logic
- Moving the keyboard shortcut to a different combo
- Touching other views' keyboard handlers
