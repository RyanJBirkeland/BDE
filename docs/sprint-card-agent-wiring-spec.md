# Sprint Card → Agent Log Wiring Spec

> **Status: IMPLEMENTED (2026-03-16)**
> LogDrawer component shipped. Agent logs are viewable inline from sprint task cards.
> **Data layer note:** This spec originally referenced Supabase and `~/.bde/agents.json`.
> The data layer is now local SQLite (`~/.bde/bde.db` — `agent_runs` table).
> `agent_run_id` on `sprint_tasks` is a foreign key to `agent_runs.id`.

**Date:** 2026-03-16
**Branch:** feat/sprint-agent-wiring
**Goal:** Click "View Output" on any active/done task card → see the full agent log inline in a log drawer, without leaving the Sprint tab.

---

## Problem

- TaskCard has a "View Output" button for active/done tasks
- `handleViewOutput` dispatches `bde:navigate` — but nothing listens to this event
- Even if it navigated to Sessions, the agent lookup is broken: task_runner stores `agent_session: "task-runner-{pid}-{timestamp}"` in Supabase, but BDE agent history uses UUIDs from `~/.bde/agents.json`
- Result: clicking "View Output" does nothing

---

## Solution: Inline Log Drawer

Add a **LogDrawer** component that slides up from the bottom of the Sprint tab (same pattern as SpecDrawer). Shows the agent's full streamed output. Connects to `~/.bde/agents.json` by matching the agent via task ID.

### Data Flow

1. Task runner (task-runner.js) already registers agents in `~/.bde/agents.json` with a UUID and writes output to `~/.bde/agent-logs/<date>/<uuid>/output.log`
2. When task runner picks up a sprint task, it calls `updateTask(id, { agent_session: sessionId })` — but this is the OpenClaw session key, not the BDE agent UUID
3. **Fix in task-runner.js**: after `registerBdeAgent()`, also store the BDE agent UUID in `sprint_tasks.agent_session_id` via Supabase PATCH:
   ```javascript
   // After registerBdeAgent(...)
   await updateTask(task.id, { agent_session_id: agentId }) // agentId is the UUID from registerBdeAgent
   ```
4. In BDE, `handleViewOutput` looks up the agent in `~/.bde/agents.json` by `agent_session_id`, gets the `logPath`, and opens the LogDrawer

### LogDrawer Component

New file: `src/renderer/src/components/sprint/LogDrawer.tsx`

Props:

```typescript
type LogDrawerProps = {
  task: SprintTask | null // null = closed
  onClose: () => void
}
```

Layout (slides up from bottom, 50vh height, glass panel):

```
┌──────────────────────────────────────────────────────────────────┐
│  🤖 agent/<short-id>  ·  feat/sprint-center-v2  ·  ● running    [×]
│  Task: "BDE Sprint Center v2 — backlog/sprint separation..."     │
│  ─────────────────────────────────────────── gradient line ────  │
│                                                                    │
│  [scrollable log output — uses existing ChatThread component]    │
│                                                                    │
│  ────────────────────────────────────────────────────────────── │
│  [Open in Sessions]                          [Close]             │
└──────────────────────────────────────────────────────────────────┘
```

Implementation:

- Uses existing `parseStreamJson` + `chatItemsToMessages` + `ChatThread` from Sessions view
- Polls the log file via a new IPC: `sprint:readLog(agentId)` → returns `{ content: string; status: string }`
- Polls every 2s while task is active, stops when task is done/failed
- "Open in Sessions" dispatches `bde:navigate` (now also handled in App.tsx)

### New IPC: sprint:readLog

Add to `src/main/handlers/sprint.ts`:

```typescript
safeHandle('sprint:readLog', async (_e, agentId: string) => {
  // Look up agent in ~/.bde/agents.json by id
  const agents = readBdeAgentsIndex() // reads ~/.bde/agents.json
  const agent = agents.find((a) => a.id === agentId)
  if (!agent?.logPath) return { content: '', status: 'unknown' }

  const content = await readFile(agent.logPath, 'utf-8').catch(() => '')
  return { content, status: agent.status }
})
```

Expose in preload:

```typescript
sprint: {
  // ...existing
  readLog: (agentId: string) => ipcRenderer.invoke('sprint:readLog', agentId),
}
```

### App.tsx — handle bde:navigate

Add event listener in App.tsx `useEffect`:

```typescript
useEffect(() => {
  const handler = (e: CustomEvent) => {
    const { view, sessionId } = e.detail
    if (view === 'sessions') {
      setActiveView('sessions')
      if (sessionId) {
        useAgentHistoryStore.getState().selectAgent(sessionId)
      }
    }
  }
  window.addEventListener('bde:navigate', handler as EventListener)
  return () => window.removeEventListener('bde:navigate', handler as EventListener)
}, [setActiveView])
```

### SprintCenter wiring

- Add `logDrawerTask: SprintTask | null` state
- `handleViewOutput` sets `logDrawerTask = task` (opens drawer)
- Render `<LogDrawer task={logDrawerTask} onClose={() => setLogDrawerTask(null)} />` at bottom of sprint-center div

---

## Files to Change / Create

| File                                                      | Action     | What                                                                                           |
| --------------------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------- |
| `~/Documents/Repositories/life-os/scripts/task-runner.js` | **MODIFY** | After `registerBdeAgent()`, PATCH `sprint_tasks.agent_session_id = agentId` (the BDE UUID)     |
| `src/main/handlers/sprint.ts`                             | **MODIFY** | Add `sprint:readLog` IPC handler; import `readFile` from fs; add `readBdeAgentsIndex()` helper |
| `src/preload/index.ts`                                    | **MODIFY** | Expose `sprint.readLog`                                                                        |
| `src/preload/index.d.ts`                                  | **MODIFY** | Add type for `sprint.readLog`                                                                  |
| `src/renderer/src/components/sprint/LogDrawer.tsx`        | **CREATE** | Sliding glass drawer showing agent log with ChatThread                                         |
| `src/renderer/src/components/sprint/SprintCenter.tsx`     | **MODIFY** | Add `logDrawerTask` state, `handleViewOutput` opens drawer, render LogDrawer                   |
| `src/renderer/src/App.tsx`                                | **MODIFY** | Listen to `bde:navigate` event → switch view + select agent                                    |
| `src/renderer/src/assets/sprint.css`                      | **MODIFY** | LogDrawer styles: slide-up animation, glass panel, 50vh height, position absolute bottom-0     |

---

## LogDrawer CSS

```css
.log-drawer {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 50vh;
  background: var(--glass-tint-dark);
  backdrop-filter: var(--glass-blur-md) var(--glass-saturate);
  border-top: 1px solid var(--border-light);
  border-radius: 12px 12px 0 0;
  display: flex;
  flex-direction: column;
  z-index: 100;
  animation: log-drawer-up 250ms cubic-bezier(0.22, 1, 0.36, 1);
}

@keyframes log-drawer-up {
  from {
    transform: translateY(100%);
    opacity: 0;
  }
  to {
    transform: translateY(0);
    opacity: 1;
  }
}

.log-drawer__header {
  height: 40px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 12px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.log-drawer__title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text);
}
.log-drawer__meta {
  font-size: 11px;
  color: var(--text-muted);
}

.log-drawer__body {
  flex: 1;
  overflow-y: auto;
  padding: 8px 0;
}

.log-drawer__footer {
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px;
  border-top: 1px solid var(--border);
  flex-shrink: 0;
}
```

---

## Out of Scope

- Full Sessions-style steering/stdin input from drawer (read-only view only)
- Log search/filter
- Multi-task log comparison
