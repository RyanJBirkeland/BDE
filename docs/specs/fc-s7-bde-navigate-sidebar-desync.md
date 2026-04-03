# FC-S7: bde:navigate from Sprint causes sidebar selection desync

## Problem Statement

When the user clicks "Open in Sessions" in LogDrawer (Sprint view), the `bde:navigate` event fires and correctly navigates to SessionsView and loads the agent's log. However, the AgentList sidebar shows no item highlighted — the user sees the log content but can't tell which agent is selected in the list.

## Root Cause

The `bde:navigate` handler in `App.tsx:175-187` calls `useAgentHistoryStore.getState().selectAgent(sessionId)`, which sets `agentHistoryStore.selectedId`. But `SessionsView` maintains a separate local state `selectedUnifiedId` (line 86) that is used by `AgentList` to determine which item is highlighted (`isSelected={a.id === selectedId}`). The navigation event bypasses `handleUnifiedSelect` (which keeps both states in sync), so `selectedUnifiedId` remains stale.

The log viewer renders correctly because `SessionsView.renderMainContent()` checks `selectedHistoryId` (from the agent history store) before `selectedUnifiedId` — so the store-driven selection wins for content rendering. But `AgentList` only checks `selectedUnifiedId` for highlighting.

## Files to Change

| File                                      | Change                                                                                                               |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `src/renderer/src/views/SessionsView.tsx` | Add a `useEffect` that listens for `bde:navigate` events and syncs `selectedUnifiedId` with the incoming `sessionId` |

**OR (alternative approach):**

| File                                      | Change                                                                                                                                       |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/renderer/src/views/SessionsView.tsx` | Derive `selectedUnifiedId` from the agent history store's `selectedId` when it changes externally, rather than maintaining independent state |

## Implementation Notes

### Approach 1: Listen for bde:navigate in SessionsView (simpler)

```typescript
useEffect(() => {
  const handler = (e: CustomEvent): void => {
    const { sessionId } = e.detail
    if (sessionId) {
      setSelectedUnifiedId(`history:${sessionId}`)
    }
  }
  window.addEventListener('bde:navigate', handler as EventListener)
  return () => window.removeEventListener('bde:navigate', handler as EventListener)
}, [])
```

The `history:` prefix is required because `selectedUnifiedId` uses prefixed IDs (e.g., `local:123`, `history:abc-def`) to distinguish agent sources. The history agent ID needs the `history:` prefix to match `AgentList`'s `isSelected` comparison.

### Approach 2: Sync from store (more robust)

Add a `useEffect` that watches `selectedHistoryId` from the agent history store and updates `selectedUnifiedId`:

```typescript
useEffect(() => {
  if (selectedHistoryId) {
    setSelectedUnifiedId(`history:${selectedHistoryId}`)
  }
}, [selectedHistoryId])
```

This approach is more robust because it handles any external change to `selectedHistoryId`, not just `bde:navigate`. Approach 2 is recommended.

## Success Criteria

1. Launch an agent from a sprint task
2. Open LogDrawer, click "Open in Sessions"
3. SessionsView opens with the agent's log visible AND the corresponding agent is highlighted in the AgentList sidebar
4. Clicking a different agent in the sidebar updates both the highlight and the content pane (no regression)
5. Using Cmd+click or split modes still works correctly (no regression)
