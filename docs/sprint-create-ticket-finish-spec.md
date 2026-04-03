# Sprint Create Ticket — Finish & Polish Spec

> **Status: IMPLEMENTED (2026-03-16)**
> Create ticket flow is functional end-to-end.
> **Data layer note:** This spec originally referenced Supabase. The data layer is now local
> SQLite (`~/.bde/bde.db`). All "Supabase enum" references should be read as SQLite CHECK constraints.
> Repo values are stored as lowercase strings: `bde`, `feast`, `life-os`.

**Date:** 2026-03-16
**Branch:** feat/sprint-ticket-finish
**Goal:** Finish the create ticket flow end-to-end. Fix the repo enum mismatch, wire Ask Paul properly, add validation feedback, and make the full backlog→sprint→launch flow feel complete.

---

## Problems

### 1. Repo label vs enum mismatch

NewTicketModal stores repo as display label (e.g. "BDE", "Feast", "Life OS") but sprint_tasks expects lowercase enum values (e.g. "bde", "feast", "life-os"). Creating a ticket will likely fail with a Supabase enum error.

**Fix:** Map display label → enum value before `window.api.sprint.create()`:

```typescript
const REPO_LABEL_TO_ENUM: Record<string, string> = {
  BDE: 'bde',
  Feast: 'feast',
  'Life OS': 'life-os'
}
```

### 2. SprintCenter.createTask needs to write to Supabase

Currently `handleCreate` in SprintCenter should call `window.api.sprint.create()`. Verify the full create→backlog flow works end-to-end and tasks appear in the Backlog column immediately (optimistic update or refetch).

### 3. Ask Paul response shape

`window.api.invokeTool('sessions_send', {...})` — the response from `sessions_send` returns `{ sessionKey, response }` or similar. Need to verify the response shape and extract the message text correctly. Current code does `result?.response` — validate this works or fix.

**How to test:** In sprint.ts main handler, log the raw response from `invokeTool` to confirm shape. The actual sessions_send tool returns `{ ok: true, result: { content: [{type, text}] } }` via the gateway.

Correct extraction:

```typescript
// Gateway tool response shape
const gatewayResult = result as {
  ok?: boolean
  result?: { content?: Array<{ type: string; text: string }> }
} | null
const text = gatewayResult?.result?.content?.[0]?.text ?? ''
if (text) setSpec(text)
```

### 4. Missing prompt field in createTask

The `sprint_tasks.prompt` column is NOT NULL. When creating a ticket from UI, the `prompt` should default to the spec content (since the spec IS the prompt for the agent). If no spec, use the title.

Fix in SprintCenter `handleCreate`:

```typescript
window.api.sprint.create({
  title: data.title,
  repo: repoEnum,
  prompt: data.spec || data.title, // prompt = spec, required
  status: 'backlog',
  priority: data.priority
})
```

### 5. No optimistic UI / feedback after create

After clicking "Save to Backlog", the card should appear immediately in the Backlog column. Currently there's likely a refetch delay or no feedback. Add:

- Optimistic insert to local `tasks` state immediately after create
- Refetch from Supabase to get the server-assigned ID
- Toast: "Ticket created — saved to Backlog"

### 6. SpecDrawer "Push to Sprint" button missing

The spec says SpecDrawer should have a "→ Push to Sprint" button for backlog tasks. Check if it's implemented; if not, add it. Should call `handlePushToSprint(task)` from SprintCenter.

---

## Files to Change

| File                                                    | Action     | What                                                                                                                          |
| ------------------------------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `src/renderer/src/components/sprint/NewTicketModal.tsx` | **MODIFY** | Fix Ask Paul response extraction; fix repo label→enum mapping in handleSubmit                                                 |
| `src/renderer/src/components/sprint/SprintCenter.tsx`   | **MODIFY** | handleCreate: add `prompt` field, map repo to enum, optimistic insert, toast on success; handle Supabase errors gracefully    |
| `src/renderer/src/components/sprint/SpecDrawer.tsx`     | **MODIFY** | Add "→ Push to Sprint" button if missing; wire to onPushToSprint prop                                                         |
| `src/main/handlers/sprint.ts`                           | **MODIFY** | Log raw invokeTool response in a debug comment; ensure createTask returns the created row (use Prefer: return=representation) |

---

## Repo Enum Values (from Supabase schema)

Check `task_repo` enum values — likely: `bde`, `feast`, `life-os`, `other`
Run this to confirm: `SELECT enum_range(NULL::task_repo);`

---

## Success Criteria

- [ ] Creating a ticket via "New Ticket" modal → appears in Backlog immediately
- [ ] Repo selected as "BDE" → stores as `bde` in Supabase (no enum error)
- [ ] Ask Paul button with a title → replaces spec textarea with generated spec
- [ ] "Save to Backlog" shows a toast confirmation
- [ ] SpecDrawer "Push to Sprint" button works for backlog tasks
- [ ] No console errors during full create→push→spec flow

---

## Out of Scope

- Editing an existing task's title/repo/priority (just spec for now)
- Markdown preview in spec editor
- Multi-repo ticket (one repo per ticket)
