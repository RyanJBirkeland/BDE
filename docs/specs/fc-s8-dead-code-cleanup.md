# FC-S8: Dead code cleanup — AgentHistoryPanel, sessions:getHistory, AddCardForm

## Problem Statement

Three separate pieces of dead code exist in the codebase, each adding maintenance confusion and false leads for anyone reading or searching the code:

1. **`AgentHistoryPanel`** — A fully-implemented 100+ line component with its own polling loop, filter UI, and agent selection logic. It was superseded by `AgentList` + `useUnifiedAgents` but never removed. It duplicates store subscriptions and contains stale logic.

2. **`sessions:getHistory` IPC handler** — Registered in `agent-handlers.ts:61-63`, always returns `[]`. No renderer code calls this channel — `ChatThread` uses the gateway `sessions_history` tool instead. The stub is misleading: it suggests the feature was planned but gives a false sense that it's partially implemented.

3. **`AddCardForm`** — A complete inline card-creation form for the Sprint board. Never imported or rendered anywhere — superseded by `NewTicketModal`. Contains its own state management and IPC calls.

## Files to Change

| File                                                                        | Action                                                 |
| --------------------------------------------------------------------------- | ------------------------------------------------------ |
| `src/renderer/src/components/sessions/AgentHistoryPanel.tsx`                | Delete                                                 |
| `src/renderer/src/components/sessions/__tests__/AgentHistoryPanel.test.tsx` | Delete (if exists)                                     |
| `src/main/handlers/agent-handlers.ts`                                       | Remove the `sessions:getHistory` handler (lines 61-63) |
| `src/renderer/src/components/sprint/AddCardForm.tsx`                        | Delete                                                 |

## Implementation Notes

### Pre-deletion verification

Before deleting each file, verify no imports exist:

```bash
# Check for any remaining imports
grep -r "AgentHistoryPanel" src/ --include="*.ts" --include="*.tsx"
grep -r "sessions:getHistory" src/ --include="*.ts" --include="*.tsx"
grep -r "AddCardForm" src/ --include="*.ts" --include="*.tsx"
```

Expected: each search returns only the file being deleted (its own definition and possibly its own test).

### AgentHistoryPanel removal

- Check if the `agentHistory` Zustand store is still used by other consumers (it is — `useUnifiedAgents.ts` and `AgentLogViewer` both use it). The store itself must NOT be deleted, only the `AgentHistoryPanel` component.
- Check for any re-exports in barrel files (e.g., `components/sessions/index.ts`).

### sessions:getHistory removal

- Remove the 3-line handler from `agent-handlers.ts`.
- Check that no preload bridge declares this channel. The preload only has `agents:list`, `agents:getMeta`, `agents:readLog`, `agents:import`, `agents:markDone` — `sessions:getHistory` is not in the preload, confirming it's unused.

### AddCardForm removal

- Verify no barrel export references it.
- The component uses `sprint:create` IPC which is also used by `NewTicketModal` — the IPC channel itself must NOT be removed.

## Success Criteria

1. All three files are deleted
2. The `sessions:getHistory` handler is removed from `agent-handlers.ts`
3. `npm run build` passes with no type errors or missing import errors
4. `npm test` passes (no broken test imports)
5. `grep -r` confirms zero remaining references to the deleted code
6. Agent history functionality (via `AgentList` + `useUnifiedAgents` + `AgentLogViewer`) still works correctly
