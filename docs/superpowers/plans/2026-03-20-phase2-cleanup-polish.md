# Phase 2 Legacy Cleanup + Polish — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove all legacy sessions infrastructure, migrate Sprint/Terminal views to ChatRenderer, rewire SettingsView templates to the formal CRUD API.

**Architecture:** Seven sequential tasks. Tasks 1-2 are safe deletions/moves with no logic changes. Tasks 3-4 are the ChatThread→ChatRenderer migrations in LogDrawer and AgentOutputTab. Task 5 deletes everything that's now orphaned. Task 6 rewires SettingsView templates. Task 7 updates CLAUDE.md.

**Tech Stack:** TypeScript, React, Zustand, Electron IPC

**Spec:** `docs/superpowers/specs/2026-03-20-phase2-cleanup-polish-design.md`

---

## File Structure

### Files Deleted

```
src/renderer/src/components/sessions/AgentList.tsx
src/renderer/src/components/sessions/AgentRow.tsx
src/renderer/src/components/sessions/ChatPane.tsx
src/renderer/src/components/sessions/ChatThread.tsx
src/renderer/src/components/sessions/LocalAgentLogViewer.tsx
src/renderer/src/components/sessions/LocalAgentRow.tsx
src/renderer/src/components/sessions/MessageInput.tsx
src/renderer/src/components/sessions/MiniChatPane.tsx
src/renderer/src/components/sessions/SessionHeader.tsx
src/renderer/src/components/sessions/SessionMainContent.tsx
src/renderer/src/components/sessions/__tests__/ChatThread.test.tsx
src/renderer/src/components/sessions/__tests__/MessageInput.test.tsx
src/renderer/src/components/sessions/__tests__/SpawnModal.test.tsx
src/renderer/src/components/sessions/__tests__/TicketEditor.test.tsx
src/renderer/src/components/sprint/__tests__/LogDrawer.test.tsx
src/renderer/src/stores/splitLayout.ts
src/renderer/src/hooks/useSessionsKeyboardShortcuts.ts
src/renderer/src/assets/sessions.css
```

### Files Moved

```
src/renderer/src/components/sessions/SpawnModal.tsx     → src/renderer/src/components/agents/SpawnModal.tsx
src/renderer/src/components/sessions/TicketEditor.tsx   → src/renderer/src/components/sprint/TicketEditor.tsx
```

### Key Modified Files

| File                                                      | Change                                                   |
| --------------------------------------------------------- | -------------------------------------------------------- |
| `src/renderer/src/views/AgentsView.tsx`                   | Update SpawnModal import path                            |
| `src/renderer/src/lib/chat-markdown.tsx`                  | Update TicketEditor import path                          |
| `src/renderer/src/components/sprint/LogDrawer.tsx`        | Replace ChatThread with ChatRenderer + agentEvents store |
| `src/renderer/src/components/terminal/AgentOutputTab.tsx` | Replace ChatThread/LocalAgentLogViewer with ChatRenderer |
| `src/renderer/src/views/SettingsView.tsx`                 | Rewire to `window.api.templates.*` API                   |
| `src/renderer/src/assets/main.css`                        | Remove sessions.css import                               |
| `CLAUDE.md`                                               | Update architecture notes (Sessions → Agents)            |

---

## Task 1: Delete Dead Files + Move SpawnModal/TicketEditor

**Files:**

- Delete: all 18 files listed in "Files Deleted" above
- Move: `sessions/SpawnModal.tsx` → `agents/SpawnModal.tsx`
- Move: `sessions/TicketEditor.tsx` → `sprint/TicketEditor.tsx`
- Modify: `src/renderer/src/views/AgentsView.tsx` (import path)
- Modify: `src/renderer/src/lib/chat-markdown.tsx` (import path)
- Modify: `src/renderer/src/assets/main.css` (remove sessions.css import)

- [ ] **Step 1: Move SpawnModal to agents/**

```bash
mv src/renderer/src/components/sessions/SpawnModal.tsx src/renderer/src/components/agents/SpawnModal.tsx
```

- [ ] **Step 2: Update AgentsView import**

In `src/renderer/src/views/AgentsView.tsx`, change:

```typescript
// FROM:
import { SpawnModal } from '../components/sessions/SpawnModal'
// TO:
import { SpawnModal } from '../components/agents/SpawnModal'
```

- [ ] **Step 3: Move TicketEditor to sprint/**

```bash
mv src/renderer/src/components/sessions/TicketEditor.tsx src/renderer/src/components/sprint/TicketEditor.tsx
```

- [ ] **Step 4: Update chat-markdown.tsx import**

In `src/renderer/src/lib/chat-markdown.tsx`, change:

```typescript
// FROM:
import { TicketEditor } from '../components/sessions/TicketEditor'
import type { TicketDraft } from '../components/sessions/TicketEditor'
// TO:
import { TicketEditor } from '../components/sprint/TicketEditor'
import type { TicketDraft } from '../components/sprint/TicketEditor'
```

- [ ] **Step 5: Delete all dead session components and tests**

```bash
rm src/renderer/src/components/sessions/AgentList.tsx
rm src/renderer/src/components/sessions/AgentRow.tsx
rm src/renderer/src/components/sessions/ChatPane.tsx
rm src/renderer/src/components/sessions/MiniChatPane.tsx
rm src/renderer/src/components/sessions/SessionHeader.tsx
rm src/renderer/src/components/sessions/SessionMainContent.tsx
rm src/renderer/src/components/sessions/LocalAgentRow.tsx
rm src/renderer/src/components/sessions/MessageInput.tsx
rm -rf src/renderer/src/components/sessions/__tests__
```

- [ ] **Step 6: Delete dead store, hook, and CSS**

```bash
rm src/renderer/src/stores/splitLayout.ts
rm src/renderer/src/hooks/useSessionsKeyboardShortcuts.ts
rm src/renderer/src/assets/sessions.css
```

- [ ] **Step 7: Remove sessions.css import from main.css**

In `src/renderer/src/assets/main.css`, find and remove:

```css
@import './sessions.css';
```

- [ ] **Step 8: Verify typecheck + tests**

Run: `npm run typecheck && npm test`
Expected: PASS — no dangling imports to deleted files

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "chore: delete dead sessions components, move SpawnModal + TicketEditor"
```

---

## Task 2: Grep for Remaining 'sessions/' References

**Files:**

- Various renderer files

- [ ] **Step 1: Search for stale imports**

```bash
grep -r "from.*sessions/" src/renderer/src --include="*.ts" --include="*.tsx" | grep -v node_modules | grep -v __tests__
```

Any hits are stale imports that need updating or indicate files that shouldn't have been deleted. Fix each one.

- [ ] **Step 2: Search for 'sessions' string literals in non-legacy code**

Look for `'sessions'` in view routing, navigation, CSS class names, and custom events. Update to `'agents'` where appropriate.

Key known reference: LogDrawer line 200 dispatches `{ view: 'sessions', sessionId: ... }` — update to `{ view: 'agents', ... }`.

- [ ] **Step 3: Verify typecheck + tests**

Run: `npm run typecheck && npm test`
Expected: PASS

- [ ] **Step 4: Commit** (only if changes were needed)

```bash
git add -A
git commit -m "chore: fix remaining sessions references"
```

---

## Task 3: Migrate LogDrawer to ChatRenderer

**Files:**

- Modify: `src/renderer/src/components/sprint/LogDrawer.tsx`

- [ ] **Step 1: Update imports**

Replace:

```typescript
import { ChatThread } from '../sessions/ChatThread'
```

With:

```typescript
import { ChatRenderer } from '../agents/ChatRenderer'
import { useAgentEventsStore } from '../../stores/agentEvents'
import type { AgentEvent } from '../../../../main/agents/types'
```

- [ ] **Step 2: Add agentEvents store subscription**

Inside the `LogDrawer` component, after existing store reads (~line 36), add:

```typescript
const agentEvents = useAgentEventsStore((s) =>
  task?.agent_run_id ? s.events[task.agent_run_id] : undefined
)
const loadHistory = useAgentEventsStore((s) => s.loadHistory)

// Load agent events when drawer opens
useEffect(() => {
  if (task?.agent_run_id) {
    loadHistory(task.agent_run_id)
  }
}, [task?.agent_run_id, loadHistory])
```

- [ ] **Step 3: Replace render cascade**

Replace the body rendering section (the `hasEvents ? ... : hasStreamJson ? ... : hasPlainText ? ...` cascade) with:

```typescript
{task.agent_run_id ? (
  hasEvents ? (
    <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.space[1], padding: tokens.space[2] }}>
      {displayEvents.map((ev, i) => (
        <EventCard key={`${ev.timestamp}-${ev.type}-${i}`} event={ev} />
      ))}
    </div>
  ) : agentEvents && agentEvents.length > 0 ? (
    <ChatRenderer events={agentEvents} />
  ) : hasPlainText ? (
    <pre className="log-drawer__plain-text">{stripAnsi(logContent)}</pre>
  ) : (
    <div className="log-drawer__empty">Agent is starting up...</div>
  )
) : (
  <div className="log-drawer__no-session">No agent session linked to this task.</div>
)}
```

Priority: EventCard (task-runner events) → ChatRenderer (agent events) → plain text → empty state.

- [ ] **Step 4: Update "Open in Sessions" button**

Change `handleOpenInSessions` to navigate to `'agents'` instead of `'sessions'`:

```typescript
detail: { view: 'agents', sessionId: task.agent_run_id },
```

And rename the button label from "Open in Sessions" to "Open in Agents".

- [ ] **Step 5: Remove unused imports**

Remove any imports that are now unused after the ChatThread removal:

- `chatItemsToMessages` (if no longer used)
- `ChatMessage` type (if no longer used)
- `parseStreamJson` and related (if only used by ChatThread path)

Check if `logContent`, `parsedItems`, `allMessages`, `hasStreamJson` variables are still needed. If the only consumer was ChatThread, remove the parsing pipeline. Keep `logContent` for the plain-text fallback and Copy Log feature.

- [ ] **Step 6: Verify typecheck + tests**

Run: `npm run typecheck && npm test`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/components/sprint/LogDrawer.tsx
git commit -m "refactor(sprint): migrate LogDrawer from ChatThread to ChatRenderer"
```

---

## Task 4: Migrate AgentOutputTab to ChatRenderer

**Files:**

- Modify: `src/renderer/src/components/terminal/AgentOutputTab.tsx`

- [ ] **Step 1: Replace imports**

Replace:

```typescript
import { LocalAgentLogViewer, AgentLogViewer } from '../sessions/LocalAgentLogViewer'
import { parseStreamJson, type ChatItem } from '../../lib/stream-parser'
import { chatItemsToMessages } from '../../lib/agent-messages'
import { ChatThread } from '../sessions/ChatThread'
```

With:

```typescript
import { ChatRenderer } from '../agents/ChatRenderer'
import { useAgentEventsStore } from '../../stores/agentEvents'
```

- [ ] **Step 2: Rewrite component body**

Replace the entire component body with:

```typescript
export function AgentOutputTab({ agentId, agentOutput, sessionKey }: AgentOutputTabProps) {
  const events = useAgentEventsStore((s) => s.events[agentId])
  const loadHistory = useAgentEventsStore((s) => s.loadHistory)

  useEffect(() => {
    if (agentId) {
      loadHistory(agentId)
    }
  }, [agentId, loadHistory])

  // Agent events available — use ChatRenderer
  if (events && events.length > 0) {
    return (
      <div className="terminal-agent-tab">
        <ChatRenderer events={events} />
      </div>
    )
  }

  // Gateway session — plain text fallback (no AgentEvent source)
  if (sessionKey) {
    return (
      <div className="terminal-agent-tab">
        <div style={{
          padding: tokens.space[4],
          color: tokens.color.textDim,
          fontFamily: tokens.font.ui,
          fontSize: tokens.size.md,
          textAlign: 'center',
          marginTop: tokens.space[8]
        }}>
          Waiting for agent output…
        </div>
      </div>
    )
  }

  // Legacy plaintext output
  if (agentOutput && agentOutput.length > 0) {
    return (
      <div className="terminal-agent-tab">
        <div style={{
          padding: tokens.space[3],
          fontFamily: tokens.font.code,
          fontSize: tokens.size.md,
          color: tokens.color.text,
          whiteSpace: 'pre-wrap',
          lineHeight: 1.5
        }}>
          {agentOutput.map((chunk, i) => (
            <div key={i} style={{
              borderBottom: `1px solid ${tokens.color.border}`,
              paddingBottom: tokens.space[2],
              marginBottom: tokens.space[2]
            }}>
              {chunk}
            </div>
          ))}
        </div>
      </div>
    )
  }

  // Empty state
  return (
    <div className="terminal-agent-tab">
      <div style={{
        padding: tokens.space[4],
        color: tokens.color.textDim,
        fontFamily: tokens.font.ui,
        fontSize: tokens.size.md,
        textAlign: 'center',
        marginTop: tokens.space[8]
      }}>
        Waiting for agent output…
      </div>
    </div>
  )
}
```

Remove all the gateway polling, stream-json parsing, and ChatThread logic. Keep `tokens` import.

- [ ] **Step 3: Clean up unused imports**

Remove: `useVisibilityAwareInterval`, `useRef`, `useMemo`, `useCallback` if no longer used. Keep `useEffect`, `tokens`.

- [ ] **Step 4: Verify typecheck + tests**

Run: `npm run typecheck && npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/terminal/AgentOutputTab.tsx
git commit -m "refactor(terminal): migrate AgentOutputTab from ChatThread to ChatRenderer"
```

---

## Task 5: Delete ChatThread, LocalAgentLogViewer, LogDrawer Tests

**Files:**

- Delete: `src/renderer/src/components/sessions/ChatThread.tsx`
- Delete: `src/renderer/src/components/sessions/LocalAgentLogViewer.tsx`
- Delete: `src/renderer/src/components/sprint/__tests__/LogDrawer.test.tsx`
- Delete: `src/renderer/src/components/sessions/` directory (should be empty now)

- [ ] **Step 1: Verify no remaining imports**

```bash
grep -r "ChatThread\|LocalAgentLogViewer" src/renderer/src --include="*.ts" --include="*.tsx" | grep -v node_modules
```

Expected: zero matches (both consumers migrated in Tasks 3-4).

- [ ] **Step 2: Delete files**

```bash
rm src/renderer/src/components/sessions/ChatThread.tsx
rm src/renderer/src/components/sessions/LocalAgentLogViewer.tsx
rm src/renderer/src/components/sprint/__tests__/LogDrawer.test.tsx
rmdir src/renderer/src/components/sessions 2>/dev/null || true
```

- [ ] **Step 3: Verify typecheck + tests**

Run: `npm run typecheck && npm test`
Expected: PASS — test count will drop (deleted tests)

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: delete ChatThread, LocalAgentLogViewer, and LogDrawer tests"
```

---

## Task 6: Rewire SettingsView Templates to CRUD API

**Files:**

- Modify: `src/renderer/src/views/SettingsView.tsx`

- [ ] **Step 1: Replace data loading**

In `TaskTemplatesSection`, replace:

```typescript
useEffect(() => {
  window.api.settings.getJson('task.templates').then((raw) => {
    if (Array.isArray(raw)) {
      setTemplates(raw as TaskTemplate[])
    } else {
      const defaults = DEFAULT_TASK_TEMPLATES.map((t) => ({ ...t }))
      setTemplates(defaults)
      window.api.settings.setJson('task.templates', defaults)
    }
    setLoaded(true)
  })
}, [])
```

With:

```typescript
useEffect(() => {
  window.api.templates.list().then((list) => {
    setTemplates(list)
    setLoaded(true)
  })
}, [])
```

- [ ] **Step 2: Replace save handler**

Replace `saveTemplates`:

```typescript
const saveTemplates = useCallback(async (template: TaskTemplate) => {
  await window.api.templates.save(template)
  const list = await window.api.templates.list()
  setTemplates(list)
}, [])
```

- [ ] **Step 3: Update name/prefix change handlers**

Update `handleNameChange` and `handlePrefixChange` to call the new `saveTemplates` with the full template object:

```typescript
const handleNameChange = useCallback(
  (index: number, name: string) => {
    const t = templates[index]
    saveTemplates({ ...t, name })
  },
  [templates, saveTemplates]
)

const handlePrefixChange = useCallback(
  (index: number, promptPrefix: string) => {
    const t = templates[index]
    saveTemplates({ ...t, promptPrefix })
  },
  [templates, saveTemplates]
)
```

- [ ] **Step 4: Update add handler**

```typescript
const handleAdd = useCallback(async () => {
  await window.api.templates.save({ name: '', promptPrefix: '' })
  const list = await window.api.templates.list()
  setTemplates(list)
}, [])
```

- [ ] **Step 5: Update remove handler for custom vs built-in**

```typescript
const handleRemove = useCallback(
  async (index: number) => {
    const t = templates[index]
    if (t.isBuiltIn) {
      await window.api.templates.reset(t.name)
      toast.success('Template reset to default')
    } else {
      await window.api.templates.delete(t.name)
      toast.success('Template removed')
    }
    const list = await window.api.templates.list()
    setTemplates(list)
  },
  [templates]
)
```

- [ ] **Step 6: Update template row UI to show isBuiltIn badge + reset button**

In the template row JSX, add a built-in badge and change the delete button for built-in templates:

```tsx
<div className="settings-template-row__header">
  <input
    className="settings-field__input"
    placeholder="Template name"
    value={t.name}
    onChange={(e) => handleNameChange(i, e.target.value)}
    disabled={!!t.isBuiltIn}
  />
  {t.isBuiltIn && (
    <span
      style={{
        fontSize: tokens.size.xs,
        padding: '2px 6px',
        borderRadius: tokens.radius.full,
        background: tokens.color.infoDim,
        color: tokens.color.info
      }}
    >
      Built-in
    </span>
  )}
  <Button
    variant="icon"
    size="sm"
    onClick={() => handleRemove(i)}
    title={t.isBuiltIn ? 'Reset to default' : 'Remove template'}
    type="button"
  >
    {t.isBuiltIn ? <RotateCcw size={14} /> : <Trash2 size={14} />}
  </Button>
</div>
```

Add `RotateCcw` to the lucide-react imports. Add `tokens` import if not present.

- [ ] **Step 7: Remove unused DEFAULT_TASK_TEMPLATES import**

If `DEFAULT_TASK_TEMPLATES` is no longer used in SettingsView, remove the import.

- [ ] **Step 8: Verify typecheck + tests**

Run: `npm run typecheck && npm test`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add src/renderer/src/views/SettingsView.tsx
git commit -m "feat(settings): rewire template management to formal CRUD API"
```

---

## Task 7: Update CLAUDE.md

**Files:**

- Modify: `CLAUDE.md`

- [ ] **Step 1: Update architecture notes**

In the Architecture Notes section:

- Change "Views: 7 views ... Sessions, Terminal, Sprint..." → "Views: 7 views ... Agents, Terminal, Sprint..."
- Change "Agent spawning: `src/main/local-agents.ts` — spawns Claude CLI agents" → mention provider factory
- Add note about `src/main/agents/` directory (types, providers, event-bus, event-store)

- [ ] **Step 2: Verify no other stale references**

Grep CLAUDE.md for "Sessions" or "sessions" and update if needed.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md architecture notes for Phase 2"
```

---

## Summary

| Task | Description                                       | Files Changed           | Risk   |
| ---- | ------------------------------------------------- | ----------------------- | ------ |
| 1    | Delete dead files, move SpawnModal + TicketEditor | ~20 deleted, 3 modified | Low    |
| 2    | Grep for remaining sessions references            | 1-3 modified            | Low    |
| 3    | Migrate LogDrawer → ChatRenderer                  | 1 modified              | Medium |
| 4    | Migrate AgentOutputTab → ChatRenderer             | 1 modified              | Medium |
| 5    | Delete ChatThread, LocalAgentLogViewer, tests     | 3-4 deleted             | Low    |
| 6    | Rewire SettingsView templates                     | 1 modified              | Low    |
| 7    | Update CLAUDE.md                                  | 1 modified              | Low    |
