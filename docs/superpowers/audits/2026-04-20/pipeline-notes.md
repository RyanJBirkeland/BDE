# Pipeline dogfood notes — audit 2026-04-20

Live-log of observations while the 23-task audit batch runs through the FLEET
pipeline. Each entry is timestamped. Categories: **Pain point**, **Annoyance**,
**Bug**, **Positive**, **Process note**.

Kept as an append-only journal — don't rewrite earlier entries, correct them
with follow-up entries if context changes.

---

## Setup observations (pre-run)

- **Annoyance — MCP `tasks.create` readiness check is stricter than direct-SQL insert.**
  The spec-template readiness check required `## Overview` even though the
  spec_type was `bug-fix`/`refactor`/`test-coverage` with hand-validated content
  in different sections (`## Context`, `## Files to Change`, `## How to Test`,
  `## Acceptance`). Fell back to direct SQL per CLAUDE.md. Worth checking
  whether the required-sections list is actually aligned with what pipeline
  agents need, or just what the UI form defaults to.
- **Annoyance — MCP `epics.create` has `icon` capped at 4 chars with no hint.**
  First attempt with `"icon": "shield"` failed with a Zod length error.
  Emoji works. A one-line description in the schema ("single emoji glyph")
  would have saved a round-trip.
- **Annoyance — No MCP `tasks.create` option to say "skip readiness check, I
  hand-validated this."** Direct SQL bypasses safety that's otherwise useful.
  Could expose a `skip_readiness_check: true` parameter for admin/batch use.
- **Process note — Wrote 23 spec files to `docs/superpowers/audits/2026-04-20/`
  before queueing.** All under 500 words per CLAUDE.md guidance. Every spec
  has `## Files to Change`, `## How to Test`, `## Acceptance`.

## t=0 → t+4min (pipeline blocked en masse)

**Result:** 16 of 23 tasks fast-failed to `error` status in ~4 minutes. 7 still `queued`. 0 reached `active`/`review`.

### Pain points observed

1. **🔴 PAIN — Circular dependency: dogfood audit blocked by its own artifacts.**
   The `main-repo-guard` refuses to ff-merge origin/main into a worktree if the
   main repo has uncommitted or untracked files. But the act of authoring an
   audit naturally produces untracked files (this `docs/superpowers/audits/
   2026-04-20/` directory). So the audit whose tasks we want to run is itself
   what blocks them from running. Workaround: commit the docs before queueing.
   But the UX doesn't warn about this — the queueing step succeeds and the
   drain loop only surfaces the error after it has burned attempts on N tasks.
   **Design suggestion:** either (a) scope the dirty check to files the task
   actually touches, (b) ignore `docs/**/*.md` / `**/*.md` patterns from the
   guard, (c) pre-flight check at queue time, or (d) pause the drain loop
   on the first dirty-main error instead of fast-failing every task.

2. **🔴 PAIN — Fast-fail scorched 16 tasks in 4 minutes.**
   Fast-fail detection (3 failures within 30s → `error`) is appropriate for a
   genuinely-broken spec. But when the root cause is environmental (dirty main
   repo), every task in the queue hits the same guard and goes to `error`
   before the user can react. Entire batches can be destroyed by a single
   pre-flight violation. **Design suggestion:** differentiate environmental
   errors (dirty main, missing auth, missing network) from spec-level errors.
   Environmental errors should pause the drain loop or move tasks to `blocked`,
   not fast-fail to `error`. The spec is fine; the environment isn't.

3. **🟡 ANNOYANCE — `failure_reason` column is empty on errored tasks.**
   The diagnostic is in `~/.fleet/fleet.log` with full detail, but the task row
   itself shows `error` status with no explanation. A user inspecting the
   Task Pipeline has to know to open the log file to learn what broke. The
   `failure_reason` field exists (it's in the schema). It's just not populated
   on environmental errors.

4. **🟡 ANNOYANCE — No queue-wide status banner on en-masse environmental errors.**
   A UI affordance like "drain loop paused: main repo has uncommitted changes
   in docs/superpowers/audits/2026-04-20/" would be enormously helpful in the
   Dashboard or Task Pipeline view.

5. **🟢 POSITIVE — Log is clear and actionable.**
   Once I checked `~/.fleet/fleet.log`, the error (`main-repo-guard: Main repo
   dirty ... ?? docs/superpowers/audits/2026-04-20/`) was immediately obvious.
   Good instrumentation on the main-repo-guard check.

6. **🟢 POSITIVE — The guard itself is correct.**
   Agents ff-merging into a dirty main would be dangerous. The guard is doing
   its job. The issue is how the failure flows through the scheduling layer,
   not whether the check should exist.

### Current state

- 16 tasks in `error` status (permanently stuck, need manual re-queue)
- 7 tasks still in `queued` status (will keep fast-failing if drain loop
  continues; at 2 concurrent × 30s fast-fail this takes ~2 more minutes)
- Only blocker: untracked `docs/superpowers/audits/2026-04-20/` (the audit
  docs themselves). No uncommitted source changes remain.

### Next step pending user decision

To unblock: commit the audit docs to main (doc-only commit, no code touched).
Then re-queue the 16 errored tasks via `UPDATE sprint_tasks SET status='queued'
WHERE status='error' AND tags LIKE '%audit-2026-04-20%'`.

Neither of these is something I should do unilaterally — the commit is covered
by the "never commit without asking" rule, and the bulk re-queue already
triggered a permission denial when attempted earlier.

---
