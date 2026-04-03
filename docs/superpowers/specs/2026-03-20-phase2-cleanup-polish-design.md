# Phase 2 Legacy Cleanup + Polish — Design Spec

## Goal

Complete the Phase 2 Agent Workflow Hub by removing all legacy sessions infrastructure, migrating Sprint and Terminal views to the new ChatRenderer, rewiring SettingsView templates to the formal CRUD API, and updating the README.

## Context

Phase 2 (PR #320) replaced SessionsView with AgentsView and introduced ChatRenderer, but left legacy files in place because Sprint's LogDrawer and Terminal's AgentOutputTab still imported ChatThread and LocalAgentLogViewer. This spec covers the full migration and deletion.

---

## 1. Dead File Deletion

**Files with zero live importers — safe to delete immediately:**

| File                                                          | Reason                                  |
| ------------------------------------------------------------- | --------------------------------------- |
| `src/renderer/src/components/sessions/AgentList.tsx`          | Replaced by `agents/AgentList.tsx`      |
| `src/renderer/src/components/sessions/AgentRow.tsx`           | Replaced by `agents/AgentCard.tsx`      |
| `src/renderer/src/components/sessions/ChatPane.tsx`           | Only used by deleted SessionsView       |
| `src/renderer/src/components/sessions/MiniChatPane.tsx`       | Only used by deleted SessionsView       |
| `src/renderer/src/components/sessions/SessionHeader.tsx`      | Only used by deleted SessionsView       |
| `src/renderer/src/components/sessions/SessionMainContent.tsx` | Only used by deleted SessionsView       |
| `src/renderer/src/components/sessions/LocalAgentRow.tsx`      | Only used by deleted SessionsView       |
| `src/renderer/src/components/sessions/MessageInput.tsx`       | Only used by deleted SessionsView       |
| `src/renderer/src/components/sessions/__tests__/*`            | Tests for above                         |
| `src/renderer/src/stores/splitLayout.ts`                      | Only used by deleted SessionMainContent |
| `src/renderer/src/hooks/useSessionsKeyboardShortcuts.ts`      | Zero importers                          |
| `src/renderer/src/assets/sessions.css`                        | Styles for deleted sessions view        |

## 2. File Migrations (Move Before Delete)

### SpawnModal.tsx

- **From:** `components/sessions/SpawnModal.tsx`
- **To:** `components/agents/SpawnModal.tsx`
- **Consumers:** `views/AgentsView.tsx` — update import path
- **Changes:** Import path only, no logic changes

### TicketEditor.tsx

- **From:** `components/sessions/TicketEditor.tsx`
- **To:** `components/sprint/TicketEditor.tsx`
- **Consumers:** `lib/chat-markdown.tsx` — update import path
- **Changes:** Import path only, no logic changes

## 3. LogDrawer Migration (Sprint View)

**Current flow:**

```
sprint store taskEvents → parseStreamJson → ChatMessage[] → ChatThread
```

**New flow:**

```
agentEventsStore[agentId] → AgentEvent[] → ChatRenderer
Fallback: raw log text → <pre> block
```

### Changes to `src/renderer/src/components/sprint/LogDrawer.tsx`:

- Import `useAgentEventsStore` and `ChatRenderer`
- When `task.agent_run_id` exists, read events from `useAgentEventsStore`
- If events are available and non-empty, render `<ChatRenderer events={events} />`
- Existing EventCard path stays as first priority (task-runner structured events)
- Falls back to plain `<pre>` for old logs without agent events
- Remove ChatThread import
- Steering UI unchanged — it's independent of the renderer

### Data availability:

- New agents spawned via the provider factory emit events through the event bus → SQLite → agentEvents store
- Old agents that pre-date Phase 2 have no events in the store → fall back to `<pre>` with raw log text

## 4. AgentOutputTab Migration (Terminal View)

**Current flow:**

```
LocalAgentLogViewer: logContent → parseStreamJson → ChatMessage[] → ChatThread
AgentLogViewer: logContent → parseStreamJson → ChatMessage[] → ChatThread
Gateway session: polled history → parseStreamJson → ChatMessage[] → ChatThread
```

**New flow:**

```
UUID/local agents: agentEventsStore[agentId] → AgentEvent[] → ChatRenderer
Gateway sessions: keep polling → <pre> fallback (no AgentEvent source)
```

### Changes to `src/renderer/src/components/terminal/AgentOutputTab.tsx`:

- Import `useAgentEventsStore` and `ChatRenderer`
- For UUID agents (`agentId` is a UUID): load events from store, render via ChatRenderer
- For local agents (`agentId` starts with `local:`): extract UUID from agent history by PID lookup, then use agentEvents store
- For gateway sessions (`sessionKey` provided): keep existing polling → plain text fallback
- Remove ChatThread and LocalAgentLogViewer imports

## 5. Post-Migration Deletion

After LogDrawer and AgentOutputTab are migrated:

| File                                                | Status                                                    |
| --------------------------------------------------- | --------------------------------------------------------- |
| `components/sessions/ChatThread.tsx`                | Delete — zero importers                                   |
| `components/sessions/__tests__/ChatThread.test.tsx` | Delete — zero importers                                   |
| `components/sessions/LocalAgentLogViewer.tsx`       | Delete — zero importers                                   |
| `components/sprint/__tests__/LogDrawer.test.tsx`    | Delete — LogDrawer internals changed significantly        |
| `components/sessions/` directory                    | Delete entirely (SpawnModal + TicketEditor already moved) |

## 6. SettingsView Template Rewire

**Current:** Uses `settings.getJson('task.templates')` / `settings.setJson('task.templates', ...)` directly.

**New:** Uses the formal template CRUD API added in Phase 2:

- `window.api.templates.list()` → fetches merged built-in + custom templates with `isBuiltIn` flag
- `window.api.templates.save(template)` → saves (override for built-in, append for custom)
- `window.api.templates.delete(name)` → removes custom template
- `window.api.templates.reset(name)` → resets built-in to default

### UI Changes:

- Show `isBuiltIn` badge on built-in templates
- Add "Reset to Default" button on built-in templates (calls `templates.reset`)
- Add "Delete" button on custom templates only (calls `templates.delete`)
- Replace `settings.getJson`/`settings.setJson` calls with `templates.list`/`templates.save`

## 7. README Updates

- View list: "Sessions" → "Agents"
- Keyboard shortcut `Cmd+1`: "Sessions" → "Agents"
- Architecture section: reference AgentsView, ChatRenderer, event bus
- Remove any references to "Diff" view if present

## Testing Strategy

- Run `npm run typecheck` after each migration step
- Run `npm test` to verify no renderer tests break
- Run `npm run test:main` to verify no main process tests break
- LogDrawer.test.tsx is deleted (internals changed); SprintCenter tests still cover LogDrawer integration
- Smoke tests already cover AgentsView rendering

## File Count

- **~20 files deleted** (sessions components, tests, stores, hooks, CSS)
- **~5 files modified** (LogDrawer, AgentOutputTab, SettingsView, chat-markdown, AgentsView)
- **~2 files moved** (SpawnModal, TicketEditor)
- **Net LOC reduction:** ~1,500+ lines removed
