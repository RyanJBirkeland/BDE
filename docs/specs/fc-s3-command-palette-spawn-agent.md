# FC-S3: CommandPalette "Spawn Agent" command is broken

## Problem Statement

The "Spawn Agent" command in the CommandPalette (`src/renderer/src/components/layout/CommandPalette.tsx:99-110`) dispatches a `bde:open-spawn-modal` custom event after navigating to the Sessions view. However, no component in the entire codebase listens for this event. `SessionsView` controls the `spawnOpen` state via `useState` and only opens the modal through a local button click handler. The result: the command palette closes, the Sessions view appears, but the SpawnModal never opens.

## Root Cause

The event dispatch was added to `CommandPalette` but the corresponding `addEventListener` was never added to `SessionsView`. The `spawnOpen` state is entirely local — no external trigger path exists.

## Files to Change

| File                                      | Change                                                                                                    |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `src/renderer/src/views/SessionsView.tsx` | Add a `useEffect` that listens for the `bde:open-spawn-modal` custom event and sets `spawnOpen` to `true` |

## Implementation Notes

Add to `SessionsView.tsx`, near the existing `useEffect` blocks:

```typescript
useEffect(() => {
  const handler = (): void => setSpawnOpen(true)
  window.addEventListener('bde:open-spawn-modal', handler)
  return () => window.removeEventListener('bde:open-spawn-modal', handler)
}, [])
```

This is a 4-line fix. No changes needed in `CommandPalette.tsx` — the dispatch is already correct.

### Alternative considered

Instead of a custom event, `CommandPalette` could import and call a Zustand action. However, the existing `bde:navigate` pattern already uses custom events for cross-view communication, so this approach is consistent with the codebase conventions.

## Success Criteria

1. Open CommandPalette (Cmd+P) from any view
2. Select "Spawn Agent"
3. App navigates to Sessions view AND the SpawnModal opens
4. Modal is functional — can fill fields and spawn an agent
