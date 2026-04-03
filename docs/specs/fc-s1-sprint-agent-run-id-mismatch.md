# FC-S1: Sprint agent_run_id never persisted to database

## Problem Statement

When an agent is launched from a sprint task, the frontend sends an update patch with the field `agent_session_id`, but the backend `sprint:update` handler's allowlist only includes `agent_run_id`. The mismatched key is silently stripped from the update, so the `agent_run_id` column in SQLite stays `NULL`. Sprint task logs work while the app is running (the ID lives in React state), but after a restart the link between task and agent is permanently lost — LogDrawer shows "No agent session linked to this task."

## Root Cause

Three-way naming inconsistency:

| Layer                                                     | Field name         | Source            |
| --------------------------------------------------------- | ------------------ | ----------------- |
| DB schema (`src/main/db.ts:58`)                           | `agent_run_id`     | SQLite column     |
| Backend allowlist (`src/main/handlers/sprint.ts:144-147`) | `agent_run_id`     | Allowed in UPDATE |
| Frontend type + patch (`SprintCenter.tsx:28, 174-178`)    | `agent_session_id` | Sent in update    |

The frontend sends `{ agent_session_id: result.id }` but the handler only permits `agent_run_id`, so the field is silently dropped.

## Files to Change

| File                                                  | Change                                                                                                                |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `src/renderer/src/components/sprint/SprintCenter.tsx` | Rename `agent_session_id` → `agent_run_id` in the `SprintTask` type (line 28) and in the launch patch (lines 174-178) |
| `src/renderer/src/components/sprint/LogDrawer.tsx`    | Update all references from `task.agent_session_id` to `task.agent_run_id` (lines 28, 56)                              |
| `src/renderer/src/components/sprint/TaskCard.tsx`     | Update any references from `agent_session_id` to `agent_run_id`                                                       |

## Implementation Notes

- This is a rename-only fix — no schema migration needed since the DB column already uses `agent_run_id`.
- The `sprint:update` allowlist already includes `agent_run_id`, so the backend needs zero changes.
- After the rename, verify the `bde:navigate` event in LogDrawer still sends the correct value as `sessionId` in the event detail — the event detail key `sessionId` does NOT need to match the DB column name, it just needs to carry the right value.
- Search the entire renderer for any other references to `agent_session_id` to ensure nothing is missed.

## Success Criteria

1. Launch an agent from a sprint task
2. Restart the app (full quit + relaunch)
3. Open the sprint task's LogDrawer
4. Agent log content is displayed correctly (not "No agent session linked")
5. "Open in Sessions" button in LogDrawer still navigates correctly
