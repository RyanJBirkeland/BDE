# Epic — Code Review View Redesign (2026-04-10)

Four pipeline tasks that implement the three-panel redesign described in `../2026-04-10-code-review-redesign-design.md`. Each task is scoped to 300–400 words, has explicit file paths, and includes a `## How to Test` section so the pipeline agent doesn't thrash.

## Sequencing

```
┌─────────────────────────┐
│ T1 FileTreePanel + store│  queued
│    hoist (pure refactor)│
└────────────┬────────────┘
             │ hard
             ▼
┌─────────────────────────┐
│ T2 Three-column shell + │  blocked
│    TopBar + layout swap │
└────────────┬────────────┘
             │ hard
             ▼
┌─────────────────────────┐
│ T3 AIAssistantPanel     │  blocked
│    (visual scaffolding) │
└────────────┬────────────┘
             │ hard
             ▼
┌─────────────────────────┐
│ T4 Batch + responsive + │  blocked
│    final polish         │
└─────────────────────────┘
```

Hard dependencies resolve only on `done` status (`HARD_SATISFIED_STATUSES` in `src/shared/task-transitions.ts`) — so each task waits for its predecessor to be **shipped to main**, not just reviewed. That's the right contract here: every task edits files the next one expects to find in their new shape.

## Why four tasks (not one)

- Each task is **one concern**: one file move, one component added, one style layer. Matches the "one feature per task" rule in `CLAUDE.md`.
- Task 1 is a **pure refactor with no visual change** — quickest to review, lowest risk of breaking the running app.
- Task 2 is the **big layout swap**. It flips the view to the new shell in a single commit so the review diff is easy to read (no half-migrated state).
- Task 3 adds the **new surface** (AIAssistant) without touching the layout again.
- Task 4 handles the **long tail** — batch mode folding into TopBar, responsive rails, and the token/lint/test sweep.

## Files in this folder

| File                                 | Purpose                                                               |
| ------------------------------------ | --------------------------------------------------------------------- |
| `README.md`                          | This file                                                             |
| `task-01-filetree-extraction.md`     | Task 1 spec (pipeline-agent-ready)                                    |
| `task-02-shell-topbar.md`            | Task 2 spec                                                           |
| `task-03-ai-assistant-scaffold.md`   | Task 3 spec                                                           |
| `task-04-batch-responsive-polish.md` | Task 4 spec                                                           |
| `queue.py`                           | Idempotent queueing script — direct SQL, bypasses IPC readiness check |

## Queueing

```bash
python3 docs/superpowers/specs/2026-04-10-code-review-redesign-epic/queue.py
```

The script:

1. Reads each `task-NN-*.md` file.
2. Generates a deterministic UUID per task (re-runs are no-ops).
3. Inserts T1 as `queued`, T2/T3/T4 as `blocked` with hard `depends_on` edges.
4. Prints the four task IDs so you can inspect them in the Task Pipeline or Code Review Station.

Re-running the script checks for existing IDs and skips already-inserted tasks. To re-queue from scratch, delete the four rows first:

```bash
sqlite3 ~/.bde/bde.db \
  "DELETE FROM sprint_tasks WHERE id IN (SELECT id FROM sprint_tasks WHERE title LIKE 'CR Redesign:%')"
```

## Review / merge order

After each task reaches `review`:

1. Open the Code Review Station → select the task → inspect the diff.
2. **Ship It** (merge locally + push, marks `done`). That fires `resolveDependents`, which moves the next task from `blocked` → `queued`. The drain loop picks it up within 30s.
3. Never queue the next task manually — let the dependency chain drive it. Manual re-queueing bypasses the merge order and will produce conflicts on subsequent tasks.

## What this epic does **not** do

- **No AI streaming wiring.** Task 3 ships the assistant panel as pure visual scaffolding — empty messages list, disabled input, non-functional quick-action chips. SDK streaming, thread persistence, and prompt composition are a follow-up epic.
- **No tree-mode FileTree.** Flat list only.
- **No resizable splitters.** Fixed `256 / flex / 384` widths.
- **No multi-file diff view.** One file at a time — same as today.
