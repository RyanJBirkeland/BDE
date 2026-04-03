# BDE Sprint Center v2 — Spec

> **Status: IMPLEMENTED (2026-03-16)**
> Core features shipped: 4-column Kanban (backlog/queued/active/done), New Ticket modal,
> glass column styling, "Push to Sprint" action, SpecDrawer with Ask Paul.
> **Data layer note:** This spec originally referenced Supabase — the data layer is now local SQLite (`~/.bde/bde.db`).
> All `supabaseFetch()` references below should be read as SQLite queries via `getDb()`.

**Date:** 2026-03-16
**Branch:** feat/sprint-center-v2
**Vision:** Santa's Workshop for spec-driven agentic tasks. Create tickets, flesh out specs with AI help, then deliberately push to the queue when ready.

---

## Core Problem with v1

1. **Creating a card immediately queues it** — no separation between "drafting an idea" and "sending to agent". The backlog IS the queue.
2. **AddCardForm is too minimal** — just a title + description text field. No templates, no spec scaffolding.
3. **SpecDrawer is passive** — just an editor. No AI assist, no "send to queue" action.
4. **No visual hierarchy** — all columns look the same, no glass/gradient treatment.

---

## New Architecture: Backlog → Sprint → Active → Done

### Column Definitions

| Column          | Meaning                             | Supabase status | Task runner picks up? |
| --------------- | ----------------------------------- | --------------- | --------------------- |
| **Backlog**     | Draft ideas, work in progress specs | `backlog`       | ❌ No                 |
| **Sprint**      | Approved, ready for agent pickup    | `queued`        | ✅ Yes                |
| **In Progress** | Agent actively working              | `active`        | — (claimed)           |
| **Done**        | Completed, PR opened                | `done`          | —                     |

**Key change:** Tasks created via "New Ticket" land in **Backlog** with `status: 'backlog'` in Supabase. The task runner ignores `status: 'backlog'`. Only when Ryan explicitly drags to Sprint OR clicks "Push to Sprint" does it become `status: 'queued'` and get picked up.

### Data Layer

Currently SprintCenter reads from `memory/projects/bde-agent-queue.json` via `window.api.readMemoryFile`. This is a local file, not the Supabase sprint_tasks table. The task runner reads from Supabase.

**New data layer:** SprintCenter must read/write Supabase `sprint_tasks` directly. Add IPC handlers to main process:

```typescript
// src/main/handlers/sprint.ts

// Uses fetch + service role key from config/env (same pattern as task-runner.js)
ipcMain.handle('sprint:list', async () => {
  return supabaseFetch('sprint_tasks?order=priority.asc&limit=200&select=*')
})

ipcMain.handle('sprint:create', async (_, task: CreateTaskInput) => {
  return supabaseFetch('sprint_tasks', 'POST', task)
})

ipcMain.handle('sprint:update', async (_, id: string, patch: Partial<SprintTask>) => {
  return supabaseFetch(`sprint_tasks?id=eq.${id}`, 'PATCH', patch)
})

ipcMain.handle('sprint:delete', async (_, id: string) => {
  return supabaseFetch(`sprint_tasks?id=eq.${id}`, 'DELETE')
})
```

Expose via preload:

```typescript
sprint: {
  list: () => ipcRenderer.invoke('sprint:list'),
  create: (task) => ipcRenderer.invoke('sprint:create', task),
  update: (id, patch) => ipcRenderer.invoke('sprint:update', id, patch),
  delete: (id) => ipcRenderer.invoke('sprint:delete', id),
}
```

The Supabase URL and service role key come from `window.api.getConfig()` — these are already stored in the gateway config. Add `supabaseUrl` and `supabaseServiceKey` to the IPC config response, or read from `~/.openclaw/openclaw.json` / env.

---

## Feature 1: New Ticket Modal

Replace `AddCardForm` (the tiny "+ Add Card" at bottom of Backlog column) with a proper **"New Ticket" button** in the Sprint Center header that opens a full modal.

### Layout

```
┌─────────────────────────────────────────────────────────────────┐
│  glass-modal elevation-3                                         │
│                                                                   │
│  ✦ NEW TICKET                                          [×]       │
│  ──────────────────────────────────────────────────────────────  │
│                                                                   │
│  Title                                                            │
│  ┌─────────────────────────────────────────────────────────┐     │
│  │ e.g. "Add recipe search to Feast onboarding"            │     │
│  └─────────────────────────────────────────────────────────┘     │
│                                                                   │
│  Repo              Priority                                       │
│  [BDE ▼]           [● Medium ▼]                                  │
│                                                                   │
│  Template                                                         │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐           │
│  │ Feature  │ │ Bug Fix  │ │ Refactor │ │  Audit   │           │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘           │
│  ┌──────────┐ ┌──────────┐                                       │
│  │ UX Polish│ │  Infra   │                                       │
│  └──────────┘ └──────────┘                                       │
│                                                                   │
│  Spec  ·  [✨ Ask Paul to generate]                              │
│  ┌─────────────────────────────────────────────────────────┐     │
│  │                                                         │     │
│  │  (template pre-fills this, user edits)                  │     │
│  │                                                         │     │
│  └─────────────────────────────────────────────────────────┘     │
│                                                                   │
│                          [Cancel]  [Save to Backlog]             │
└─────────────────────────────────────────────────────────────────┘
```

### Templates

Each template pre-fills the spec textarea with a markdown scaffold:

```typescript
const TEMPLATES: Record<string, string> = {
  feature: `## Problem\n<!-- What's broken or missing and why it matters -->\n\n## Solution\n<!-- What will be built -->\n\n## Files to Change\n<!-- Explicit list -->\n\n## Out of Scope\n<!-- What is NOT being built in this PR -->`,

  bugfix: `## Bug Description\n<!-- What's broken -->\n\n## Root Cause\n<!-- Why it's broken (investigate before writing spec if unknown) -->\n\n## Fix\n<!-- Exact change needed -->\n\n## Files to Change\n\n## How to Test`,

  refactor: `## What's Being Refactored\n<!-- Current state and why it needs changing -->\n\n## Target State\n<!-- What it should look like after -->\n\n## Files to Change\n\n## Out of Scope`,

  audit: `## Audit Scope\n<!-- What is being reviewed -->\n\n## Criteria\n<!-- What to look for -->\n\n## Deliverable\n<!-- What the agent should output: findings doc, fixed PR, etc -->`,

  ux: `## UX Problem\n<!-- What's confusing or broken in the UI -->\n\n## Target Design\n<!-- ASCII wireframe or bullet description of desired state -->\n\n## Files to Change\n<!-- CSS + TSX files -->\n\n## Visual References\n<!-- See docs/visual-identity-spec.md -->`,

  infra: `## Infrastructure Task\n<!-- What service/config/script is being set up or changed -->\n\n## Steps\n<!-- Ordered list -->\n\n## Verification\n<!-- How to confirm it worked -->`
}
```

### "✨ Ask Paul" — AI Spec Generation

The "Ask Paul to generate" button calls the OpenClaw gateway to generate a spec from the title + current draft:

```typescript
async function askPaulToGenerateSpec(title: string, repo: string, draft: string): Promise<string> {
  const prompt = `You are a senior engineer writing a coding agent spec for BDE (Birkeland Development Environment).

Task title: "${title}"
Repo: ${repo}
Current notes: ${draft || '(none)'}

Write a complete, spec-ready prompt for a Claude Code agent to implement this task. Follow the spec format in memory/spec-template.md. Include: Problem, Solution, Data shapes (if applicable), Files to Change, Out of Scope. Be specific and technical. Output only the spec markdown, no commentary.`

  const result = await window.api.invokeTool('sessions_send', {
    sessionKey: 'main',
    message: prompt,
    timeoutSeconds: 30
  })
  return result?.response ?? ''
}
```

While generating, show a loading state in the spec textarea ("✨ Paul is writing your spec...").

---

## Feature 2: Kanban Columns Redesign

### 4-Column Layout

```
Backlog (n)     Sprint (n)      In Progress (n)    Done (n)
```

### Column Visual Treatment (glass + gradient, DOUBLE DOWN)

Each column gets its own color identity:

```css
/* Backlog — cool blue/indigo */
.kanban-col--backlog .kanban-col__header {
  background: linear-gradient(135deg, rgba(108, 142, 239, 0.12) 0%, transparent 100%);
  border-left: 2px solid rgba(108, 142, 239, 0.5);
  color: #6c8eef;
}

/* Sprint — aurora green */
.kanban-col--sprint .kanban-col__header {
  background: linear-gradient(135deg, rgba(0, 211, 127, 0.12) 0%, transparent 100%);
  border-left: 2px solid rgba(0, 211, 127, 0.5);
  color: var(--accent);
}
/* Sprint column cards get a faint aurora tint to distinguish from backlog */
.kanban-col--sprint {
  background: linear-gradient(180deg, rgba(0, 211, 127, 0.02) 0%, transparent 40%);
}

/* In Progress — electric purple */
.kanban-col--active .kanban-col__header {
  background: linear-gradient(135deg, rgba(167, 139, 250, 0.12) 0%, transparent 100%);
  border-left: 2px solid rgba(167, 139, 250, 0.5);
  color: var(--color-ai);
}

/* Done — muted green */
.kanban-col--done .kanban-col__header {
  background: linear-gradient(135deg, rgba(0, 168, 99, 0.1) 0%, transparent 100%);
  border-left: 2px solid rgba(0, 168, 99, 0.3);
  color: var(--accent-dim);
}
```

Columns themselves are glass panels:

```css
.kanban-col {
  background: var(--glass-tint-dark);
  backdrop-filter: var(--glass-blur-md) var(--glass-saturate);
  border: 1px solid var(--border);
  border-radius: 12px;
  /* ... */
}
```

### Task Cards — Glass Upgrade

```css
.task-card {
  background: rgba(22, 22, 31, 0.85);
  backdrop-filter: blur(8px);
  border: 1px solid var(--border);
  border-radius: 8px;
  transition: all 0.15s ease-out;
}
.task-card:hover {
  border-color: var(--border-light);
  background: rgba(28, 28, 39, 0.9);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
  transform: translateY(-1px);
}
/* Sprint cards get a faint green left edge */
.kanban-col--sprint .task-card {
  border-left: 2px solid rgba(0, 211, 127, 0.25);
}
.kanban-col--sprint .task-card:hover {
  border-left-color: rgba(0, 211, 127, 0.5);
  box-shadow:
    0 4px 16px rgba(0, 0, 0, 0.25),
    -2px 0 12px rgba(0, 211, 127, 0.08);
}
```

---

## Feature 3: Sprint Center Header Redesign

```
┌────────────────────────────────────────────────────────────────────┐
│  ✦ SPRINT CENTER                    [BDE] [Feast] [Life OS] [All]  │
│  ──────────────────────────────── gradient line ────────────────── │
│  [+ New Ticket]                                          [↻ Refresh]│
└────────────────────────────────────────────────────────────────────┘
```

```css
.sprint-center__title {
  /* Aurora gradient text — same as sessions sidebar "AGENTS" */
  background: var(--gradient-aurora);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

/* gradient line under header */
.sprint-center__header::after {
  content: '';
  position: absolute;
  bottom: 0;
  left: 16px;
  right: 16px;
  height: 1px;
  background: linear-gradient(
    90deg,
    rgba(0, 211, 127, 0.4) 0%,
    rgba(108, 142, 239, 0.2) 60%,
    transparent 100%
  );
}

/* New Ticket button — aurora gradient primary */
.sprint-new-ticket-btn {
  /* Use .btn-primary from design-system.css */
}
```

---

## Feature 4: "Push to Sprint" Action on Task Cards

In Backlog, each TaskCard gets a **"→ Sprint"** button instead of (or alongside) "Launch":

```tsx
{
  task.status === 'backlog' && (
    <>
      <Button variant="primary" size="sm" onClick={() => onPushToSprint(task)}>
        → Sprint
      </Button>
      <Button variant="ghost" size="sm" onClick={() => onViewSpec(task)}>
        Spec
      </Button>
    </>
  )
}
```

`onPushToSprint` calls `window.api.sprint.update(task.id, { status: 'queued' })` — this is what the task runner actually picks up.

Dragging a card from Backlog column → Sprint column also triggers `onPushToSprint`.
Dragging from Sprint → Backlog triggers `window.api.sprint.update(task.id, { status: 'backlog' })`.

---

## Feature 5: SpecDrawer Upgrade

Add to the drawer footer:

```tsx
<Button variant="primary" size="sm" onClick={() => onPushToSprint(task)} disabled={task.status !== 'backlog'}>
  {task.status === 'backlog' ? '→ Push to Sprint' : task.status === 'queued' ? '✓ In Sprint' : task.status}
</Button>
<Button variant="ghost" size="sm" onClick={handleAskPaul} disabled={generating}>
  {generating ? '✨ Generating...' : '✨ Ask Paul'}
</Button>
```

---

## Files to Change / Create

| File                                                    | Action            | What                                                                                             |
| ------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------ |
| `src/main/handlers/sprint.ts`                           | **CREATE**        | IPC handlers: sprint:list, sprint:create, sprint:update, sprint:delete — calls Supabase REST API |
| `src/main/index.ts`                                     | **MODIFY**        | Import + register sprint handlers                                                                |
| `src/preload/index.ts`                                  | **MODIFY**        | Expose `window.api.sprint.*`                                                                     |
| `src/renderer/src/components/sprint/SprintCenter.tsx`   | **REWRITE**       | Use `window.api.sprint.*` instead of readMemoryFile; 4 columns; New Ticket button                |
| `src/renderer/src/components/sprint/KanbanBoard.tsx`    | **MODIFY**        | 4 columns (add Sprint column); column color classes                                              |
| `src/renderer/src/components/sprint/KanbanColumn.tsx`   | **MODIFY**        | Column color variant prop; remove AddCardForm from backlog                                       |
| `src/renderer/src/components/sprint/TaskCard.tsx`       | **MODIFY**        | "→ Sprint" button in backlog; glass hover; sprint cards get accent left border                   |
| `src/renderer/src/components/sprint/NewTicketModal.tsx` | **CREATE**        | Title, repo, priority, template picker, spec textarea, Ask Paul button, glass-modal              |
| `src/renderer/src/components/sprint/SpecDrawer.tsx`     | **MODIFY**        | Add "→ Sprint" + "✨ Ask Paul" buttons                                                           |
| `src/renderer/src/assets/sprint.css`                    | **CREATE/MODIFY** | All sprint-specific styles: columns, cards, header, modal, glass treatments                      |
| `src/renderer/src/components/sprint/AddCardForm.tsx`    | **DELETE**        | Replaced by NewTicketModal                                                                       |

---

## Out of Scope

- Sprint planning / velocity tracking / dates
- Multi-sprint management (one sprint at a time is fine)
- Drag-to-reorder within a column (keeping existing dnd-kit behavior)
- PR review flow changes
- Notification when task is picked up by agent

---

## Supabase Schema Note

`sprint_tasks` already has `status` column. Need to confirm `backlog` is a valid enum value. If not, the migration is:

```sql
ALTER TYPE sprint_tasks_status_enum ADD VALUE IF NOT EXISTS 'backlog';
-- or if it's a CHECK constraint:
ALTER TABLE sprint_tasks DROP CONSTRAINT IF EXISTS sprint_tasks_status_check;
ALTER TABLE sprint_tasks ADD CONSTRAINT sprint_tasks_status_check
  CHECK (status IN ('backlog', 'queued', 'active', 'done', 'cancelled'));
```

---

## Supabase Config in IPC

The sprint IPC handlers need the Supabase URL + service role key. These should be read from:

1. `process.env.SUPABASE_SERVICE_ROLE_KEY` (already set in launchd plist via life-os .env)
2. `process.env.VITE_SUPABASE_URL`

Both are already in `~/Documents/Repositories/life-os/.env` and loaded by the task runner. The BDE main process launchd plist (`com.rbtechbot.bde-dev`) may not have these env vars. Agent should:

1. Check if they're available via `process.env`
2. If not, read `~/Documents/Repositories/life-os/.env` at startup and inject

---

## Success Criteria

- [ ] New Ticket modal opens from header button, has template picker + spec editor + Ask Paul
- [ ] Creating a ticket lands in Backlog (status: 'backlog'), NOT immediately queued
- [ ] "→ Sprint" button / drag to Sprint column sets status: 'queued'
- [ ] Task runner still picks up queued tasks correctly (no regression)
- [ ] 4-column Kanban with distinct color identities per column
- [ ] All columns are glass panels
- [ ] Task cards have glass hover + lift effect
- [ ] Sprint cards have green left-edge accent
- [ ] Sprint Center header has aurora gradient title + gradient line
- [ ] SpecDrawer has "→ Sprint" + "✨ Ask Paul" buttons
- [ ] npm test passes
