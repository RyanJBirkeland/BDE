# Epic: Feature Completeness

> **Status: COMPLETE** — All 8 stories resolved as of 2026-03-23.

## Summary

All 8 feature-completeness issues identified in the original audit have been fixed across the embedded agent manager, task dependency, and code quality remediation work sessions.

## Stories

### FC-S1: Sprint agent_run_id never persisted to database

**Status:** fixed
**Area:** SprintView / LogDrawer / sprint handler
**Problem:** The frontend sends `agent_session_id` in the update patch, but the backend allowlist only accepts `agent_run_id`. The agent run link is silently dropped — sprint task logs work in-memory but are lost after app restart.
**Acceptance Criteria:**

- [ ] Align field name between frontend type and DB schema
- [ ] `sprint:update` allowlist includes the correct field name
- [ ] After launching an agent from a sprint task, restarting the app, and opening LogDrawer, the agent log is still retrievable
      **Estimated size:** S

### FC-S2: Git push silently swallows failures

**Status:** fixed
**Area:** DiffView / git.ts
**Problem:** `gitPush()` uses `spawnSync` but never checks `result.status` for non-zero exit codes. Push rejections (no upstream, force-push denied, auth failure) return the error text as a success string. The UI shows failure output with no error styling.
**Acceptance Criteria:**

- [ ] `gitPush()` throws on non-zero exit code
- [ ] DiffView shows push errors distinctly from success (red banner or error toast)
- [ ] Unit test covers push rejection path
      **Estimated size:** S

### FC-S3: CommandPalette "Spawn Agent" command is broken

**Status:** fixed
**Area:** CommandPalette / SessionsView
**Problem:** The "Spawn Agent" command dispatches a `bde:open-spawn-modal` custom event, but no component listens for it. The command navigates to Sessions but the SpawnModal never opens.
**Acceptance Criteria:**

- [ ] "Spawn Agent" from CommandPalette opens the SpawnModal in SessionsView
- [ ] Works regardless of which view the user is currently on
      **Estimated size:** S

### FC-S4: Sprint drag-and-drop fails when dropping onto existing cards

**Status:** fixed
**Area:** SprintView / KanbanBoard
**Problem:** `handleDragEnd` validates `over.id` against `VALID_STATUSES`, but when a card is dropped onto another card (not the column's empty space), `over.id` is the target card's UUID — not a status string. The drop is silently ignored.
**Acceptance Criteria:**

- [ ] Dropping a card onto another card in a different column moves it to that column
- [ ] Within-column reorder via drag works correctly
- [ ] Visual drag overlay provides feedback during drag
      **Estimated size:** M

### FC-S5: MemoryView new file creation fails for subdirectories

**Status:** fixed
**Area:** MemoryView / fs.ts
**Problem:** `writeMemoryFile()` calls `writeFile()` without first creating the parent directory. If a user creates `projects/myfile.md` and the `projects/` folder doesn't exist, it throws ENOENT. `createFile()` in MemoryView has no try/catch, so the error is an unhandled rejection with no user feedback.
**Acceptance Criteria:**

- [ ] `writeMemoryFile()` creates parent directories recursively before writing
- [ ] `createFile()` wraps the write in try/catch and shows a toast on error
- [ ] Creating a file in a non-existent subdirectory works end-to-end
      **Estimated size:** S

### FC-S6: SpawnModal has no loading guard and spawned agent doesn't appear immediately

**Status:** fixed
**Area:** SessionsView / SpawnModal / AgentList
**Problem:** (1) `repoPaths` is fetched async on mount but the submit button is enabled immediately — submitting before the fetch resolves produces a confusing error toast. (2) After a successful spawn, the new agent doesn't appear in AgentList until the next 5-second poll cycle — no immediate `fetchProcesses()` call.
**Acceptance Criteria:**

- [ ] Submit button is disabled (or a spinner is shown) while `repoPaths` is loading
- [ ] After successful spawn, `fetchProcesses()` is called immediately so the agent appears in the list
- [ ] Toast or inline error if repo paths fail to load
      **Estimated size:** S

### FC-S7: bde:navigate from Sprint causes sidebar selection desync

**Status:** fixed
**Area:** App.tsx / SessionsView / AgentList
**Problem:** When `bde:navigate` fires from LogDrawer, it sets `agentHistoryStore.selectedId` directly — but `SessionsView`'s local `selectedUnifiedId` state is not updated. The correct log viewer renders, but AgentList shows no item highlighted because it compares against `selectedUnifiedId`.
**Acceptance Criteria:**

- [ ] After navigating from Sprint → Sessions via `bde:navigate`, the correct agent is highlighted in the sidebar
- [ ] The log viewer and sidebar selection are always in sync
      **Estimated size:** S

### FC-S8: Dead code cleanup — AgentHistoryPanel, sessions:getHistory stub, AddCardForm

**Status:** fixed
**Area:** Sessions / Sprint / agent-handlers
**Problem:** Three pieces of dead code add maintenance confusion: (1) `AgentHistoryPanel` is a fully-implemented component with its own polling loop that is never rendered — superseded by `AgentList` + `useUnifiedAgents`. (2) `sessions:getHistory` IPC handler always returns `[]` and is never called by any renderer code. (3) `AddCardForm` is a complete sprint card creation form that is never imported — superseded by `NewTicketModal`.
**Acceptance Criteria:**

- [ ] `AgentHistoryPanel` component and its test (if any) are removed
- [ ] `sessions:getHistory` handler is removed from agent-handlers.ts
- [ ] `AddCardForm` component is removed
- [ ] No remaining imports or references to any of the removed code
- [ ] `npm run build` and `npm test` pass
      **Estimated size:** S
