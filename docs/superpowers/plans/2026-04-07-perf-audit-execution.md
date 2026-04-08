# BDE Performance Audit — Execution Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **Resume target: this file.** A new session reads this file, scans `git log` for the most recent `chore(perf): phase N complete` commit to identify the last completed phase, then finds the next unchecked task in the next phase.

**Goal:** Land 55 work items (covering 61 distinct audit finding IDs through dedup) on `chore/perf-audit-2026-04-07`, organized into 6 phases plus a Phase 0 research pass, with measurable before/after numbers and one commit per finding.

**Architecture:** Each finding becomes one task with files / change description / verification / commit steps. Phase 0 + Phase 1 use full TDD breakdown as the pattern-setting reference. Phases 2-6 use compact task-per-finding format. Cross-phase conventions defined once below.

**Tech Stack:** TypeScript strict mode, Electron, React, Zustand, SQLite (better-sqlite3 in WAL mode), vitest, Playwright (e2e), electron-vite. No new dependencies allowed without explicit approval (per CLAUDE.md).

**Spec:** `docs/superpowers/specs/2026-04-07-perf-audit-execution-design.md` (read this if you don't have the audit context).

**Source audit:** `docs/superpowers/audits/2026-04-07/perf-audit/SYNTHESIS.md` (the ranked findings being executed).

---

## Cross-Phase Conventions (read once, apply to every task)

### Branch and worktree

- **Worktree:** `~/worktrees/bde/perf-audit`
- **Branch:** `chore/perf-audit-2026-04-07` (already exists)
- All `cd` commands assume the worktree. If a tool resets cwd, use absolute paths (`/Users/ryan/worktrees/bde/perf-audit/...`).
- **Do NOT switch branches.** Do NOT create per-phase branches. Do NOT create new worktrees per phase.

### Commit format (mandatory)

One commit per finding. Message format:

```
fix(perf): F-tX-name-N — short title

Body explaining before/after, citing measurements where applicable.
Lists all bundled finding IDs if multiple fold into this commit.

Closes F-tX-name-N
```

For doc commits / phase boundaries:

```
chore(perf): phase N complete — N findings landed
```

**Bundled-ID format:** when one commit covers multiple finding IDs (dedup pairs or tightly-coupled fixes), use this template:

```
fix(perf): F-tA-X-1 + F-tB-Y-2 — short title

Body explaining the fix and citing measurements.

Closes F-tA-X-1
Closes F-tB-Y-2
```

The first ID in the title is the canonical entry from the synthesis. The body lists all bundled IDs explicitly. Each gets its own `Closes` footer line so issue trackers / future searches find them.

### Pre-commit gate (mandatory per CLAUDE.md)

Before EVERY commit, run all three:

```bash
npm run typecheck   # Zero errors required
npm test            # All tests must pass
npm run lint        # Zero errors required (warnings OK)
```

If any check fails, fix the issue and re-run all three. Do NOT commit broken state. Do NOT use `--no-verify`.

### Phase boundary commits

At the end of each phase:

```bash
git commit --allow-empty -m "chore(perf): phase N complete — N findings landed"
```

This makes resumption obvious in `git log`. Use `--allow-empty` because the meaningful work is in the per-finding commits before this marker.

### Verification artifact rule

For findings with measurable before/after (indexes, write counts, render counts, bundle sizes, token counts), capture both numbers in the commit message body. Format:

```
Before: <metric> = <value>
After:  <metric> = <value>
```

### Test gate strategy

- **Pure logic changes** (helpers, dedup functions, cap utilities, sort/compare): **TDD required.** Write the failing test first.
- **DDL migrations** (CREATE INDEX): no test, but `EXPLAIN QUERY PLAN` snapshot before/after captured in commit message.
- **React render fixes:** `console.count` measurement before/after captured in commit message; component test if practical.
- **Prompt changes:** Pinned regression task re-run + token delta captured in commit message.
- **Resource hygiene fixes** (listener caps, eviction): unit test for the eviction logic + manual smoke.

### Failure recovery

If a fix causes a test failure that can't be resolved within the task scope:
1. Revert the working tree changes (`git restore .`)
2. Mark the task as `- [!]` (blocked) in this plan
3. Add a note explaining the blocker
4. Move to the next task

Do NOT commit broken code. Do NOT skip tests.

### Plan checkbox update protocol (resumability)

After each task's `fix(perf):` commit, mark its checkbox(es) as `[x]` in this plan file and stage the plan in the next commit:

```bash
# After committing the fix:
cd /Users/ryan/worktrees/bde/perf-audit
# Edit this file to mark the checkboxes done, then:
git add docs/superpowers/plans/2026-04-07-perf-audit-execution.md
git commit -m "docs(plan): mark Task X.Y complete"
```

Two-commit pattern (one for the fix, one for the plan update) keeps the fix commit clean. If you'd rather, fold the plan update into the fix commit — both are acceptable. The point is the plan file always reflects what's actually done.

### Cross-finding context

When you need more detail on a finding than the plan provides, look it up in `docs/superpowers/audits/2026-04-07/perf-audit/SYNTHESIS.md` (the score table) or in the originating lens file (e.g. `team-1-pipeline-hot-path/lens-systems-profiler.md`). The plan is the to-do list; the synthesis and lens files are the rationale.

---

## Phase 0 — Research (resolve blocking open questions)

**Type:** Research only. No source code changes.
**Output:** `docs/superpowers/audits/2026-04-07/perf-audit/PHASE-0-ANSWERS.md`
**Goal:** Answer 3 hard-gate questions and 3 soft-gate questions; capture cold-start baseline.

### Task P0.0: Create the Phase 0 answers doc

**Files:**
- Create: `docs/superpowers/audits/2026-04-07/perf-audit/PHASE-0-ANSWERS.md`

- [ ] **Step 1: Create the file with the skeleton**

The file should contain a section per question (Q1-Q6 + cold-start baseline) with placeholders for **Method**, **Findings**, and **Decision/Severity adjustment**. Use the Write tool to create it directly with that structure.

- [ ] **Step 2: Commit the skeleton**

```bash
cd /Users/ryan/worktrees/bde/perf-audit
git add docs/superpowers/audits/2026-04-07/perf-audit/PHASE-0-ANSWERS.md
git commit -m "docs(audit): scaffold PHASE-0-ANSWERS skeleton"
```

### Task P0.1: Answer Q2 — cost_events writer status

**Goal:** Determine whether `cost_events` is supposed to be populated. Decide drop-vs-wire.

- [ ] **Step 1: Grep for any code that writes to `cost_events`**

```
Grep pattern: cost_events
Glob: src/**/*.ts
Path: /Users/ryan/worktrees/bde/perf-audit
output_mode: files_with_matches
```

- [ ] **Step 2: For every file matched, read the surrounding context to classify**

For each match: is it a write (INSERT/UPDATE), a read (SELECT), schema definition (CREATE TABLE), or a comment/dead code? Record in PHASE-0-ANSWERS.md under Q2 → Findings.

- [ ] **Step 3: Check the migration history in `db.ts`**

```
Read: /Users/ryan/worktrees/bde/perf-audit/src/main/db.ts
```

Find the migration that created `cost_events`. Note the migration version, the date in git history, and any comment explaining intent.

- [ ] **Step 4: Make the decision and record it**

Decision tree:
- If a writer exists in code but is never called: **wire it** (Phase 1 finding becomes "fix the broken writer")
- If no writer exists and no read site uses the table: **drop the table** (Phase 1 finding becomes "drop migration + add migration to remove it")
- If a writer is intended but never built (TODO comment, etc.): **drop the table** with a note explaining the abandoned design

Update PHASE-0-ANSWERS.md with the decision.

- [ ] **Step 5: Commit**

```bash
cd /Users/ryan/worktrees/bde/perf-audit
git add docs/superpowers/audits/2026-04-07/perf-audit/PHASE-0-ANSWERS.md
git commit -m "docs(audit): Phase 0 Q2 — cost_events writer decision"
```

### Task P0.2: Answer Q5 — agent_events read sites

**Goal:** Determine whether `agent_events` is read after task completion or only live-tailed. Drives retention aggressiveness.

- [ ] **Step 1: Grep for SELECT queries against `agent_events`**

```
Grep pattern: FROM agent_events|from agent_events
Glob: src/**/*.ts
Path: /Users/ryan/worktrees/bde/perf-audit
output_mode: content
-C: 3
```

- [ ] **Step 2: For each match, classify the read site**

Categories:
- **Live-tail:** read happens during an agent run (e.g. UI streaming)
- **Post-completion:** read happens after the task is `done`/`failed` (e.g. agent console replay)
- **Background:** read happens in a poller, retention job, or migration

Record each match in PHASE-0-ANSWERS.md under Q5 → Findings.

- [ ] **Step 3: Decide retention strategy**

- If only live-tail reads: **aggressive pruning OK** — drop events ≥1 hour after task termination
- If post-completion reads exist: **conservative pruning** — keep events for 7 days or until manually pruned
- If background readers exist: **figure out their cadence** before deciding

Update PHASE-0-ANSWERS.md with the decision.

- [ ] **Step 4: Commit**

```bash
cd /Users/ryan/worktrees/bde/perf-audit
git add docs/superpowers/audits/2026-04-07/perf-audit/PHASE-0-ANSWERS.md
git commit -m "docs(audit): Phase 0 Q5 — agent_events retention strategy"
```

### Task P0.3: Answer Q6 — max_cost_usd enforcement

**Goal:** Determine whether `sprint_tasks.max_cost_usd` is read by any code path.

- [ ] **Step 1: Grep for max_cost_usd references**

```
Grep pattern: max_cost_usd
Glob: src/**/*.ts
Path: /Users/ryan/worktrees/bde/perf-audit
output_mode: content
-C: 2
```

- [ ] **Step 2: Classify each match**

- **Schema only:** column defined in migration, never read → enforce in Phase 6
- **Read in IPC handler / form:** column is exposed to UI but no enforcement → enforce in Phase 6
- **Already enforced:** column is read and triggers cancellation → mark Phase 6 cost-5 as DONE before starting
- **Read but no-op:** column is read into memory but never compared → enforce in Phase 6

- [ ] **Step 3: Record decision in PHASE-0-ANSWERS.md and commit**

```bash
cd /Users/ryan/worktrees/bde/perf-audit
git add docs/superpowers/audits/2026-04-07/perf-audit/PHASE-0-ANSWERS.md
git commit -m "docs(audit): Phase 0 Q6 — max_cost_usd enforcement decision"
```

### Task P0.4: Answer Q1 — zero-input cohort (soft gate)

**Goal:** Determine whether 128 `agent_runs` rows with `tokens_in IS NULL OR = 0` are cache hits or silent failures.

- [ ] **Step 1: Query the snapshot for the cohort**

```bash
sqlite3 /Users/ryan/worktrees/bde/perf-audit/docs/superpowers/audits/2026-04-07/perf-audit/.snapshot/bde.db "SELECT id, status, sprint_task_id, tokens_in, tokens_out, cost_usd, started_at, finished_at FROM agent_runs WHERE tokens_in IS NULL OR tokens_in = 0 LIMIT 20;"
```

- [ ] **Step 2: For each id in the result, count corresponding agent_events**

```bash
sqlite3 /Users/ryan/worktrees/bde/perf-audit/docs/superpowers/audits/2026-04-07/perf-audit/.snapshot/bde.db "SELECT agent_id, event_type, COUNT(*) FROM agent_events WHERE agent_id IN ('<id1>', '<id2>', ...) GROUP BY agent_id, event_type;"
```

- [ ] **Step 3: Classify**

- If most have `agent:tool_call` events → real work ran, but `tokens_in` wasn't recorded (writer bug)
- If most have only `agent:started` and `agent:error` → silent failures
- If most have nothing → ghost rows / abandoned spawns

Record in PHASE-0-ANSWERS.md.

- [ ] **Step 4: Decide F-t4-cost-4 fate**

- Real work but missing tokens → **Phase 6 task: fix the token-writer path** (different from cost-5)
- Silent failures → **Phase 6 task: investigate failure path** (becomes a reliability bug)
- Ghost rows → **Phase 1 task: prune zero-input rows on startup** (or just defer)
- Cache hits → defer

- [ ] **Step 5: Commit**

```bash
cd /Users/ryan/worktrees/bde/perf-audit
git add docs/superpowers/audits/2026-04-07/perf-audit/PHASE-0-ANSWERS.md
git commit -m "docs(audit): Phase 0 Q1 — zero-input cohort classification"
```

### Task P0.5: Answer Q3 — actual MAX_ACTIVE_TASKS (soft gate)

- [ ] **Step 1: Read from snapshot settings**

```bash
sqlite3 /Users/ryan/worktrees/bde/perf-audit/docs/superpowers/audits/2026-04-07/perf-audit/.snapshot/bde.db "SELECT key, value FROM settings WHERE key LIKE '%active%' OR key LIKE '%concurrent%' OR key LIKE '%max%';"
```

- [ ] **Step 2: Note the value, record in PHASE-0-ANSWERS.md**

If N=1: note that all "High" concurrency findings should be re-rated Medium-Low when reviewing Phase 2.
If N≥3: keep concurrency findings as rated.

- [ ] **Step 3: Commit**

```bash
cd /Users/ryan/worktrees/bde/perf-audit
git add docs/superpowers/audits/2026-04-07/perf-audit/PHASE-0-ANSWERS.md
git commit -m "docs(audit): Phase 0 Q3 — MAX_ACTIVE_TASKS in production"
```

### Task P0.6: Cold-start baseline measurement

**Goal:** Capture renderer cold-start time-to-first-render before Phase 5 modifies it.

- [ ] **Step 1: Add temporary timing logs**

In `/Users/ryan/worktrees/bde/perf-audit/src/renderer/src/main.tsx` at the top of the file (after imports):

```typescript
console.log('[perf] main.tsx entry', Date.now());
```

In `/Users/ryan/worktrees/bde/perf-audit/src/renderer/src/App.tsx` at the very start of the `App` component body (or first render effect):

```typescript
console.log('[perf] App first render', Date.now());
```

- [ ] **Step 2: Build the app**

```bash
cd /Users/ryan/worktrees/bde/perf-audit
npm run build
```

Expected: clean build.

- [ ] **Step 3: Cold-start the app 3 times, capture both timestamps each time**

For each run: kill the app fully, relaunch, open the dev console, copy both `[perf]` log lines. Compute `App first render - main.tsx entry` for each run.

Record the 3 runs and the median in PHASE-0-ANSWERS.md.

- [ ] **Step 4: Revert the timing logs (do NOT commit them)**

```bash
cd /Users/ryan/worktrees/bde/perf-audit
git restore src/renderer/src/main.tsx src/renderer/src/App.tsx
```

- [ ] **Step 5: Commit the PHASE-0-ANSWERS.md update**

```bash
cd /Users/ryan/worktrees/bde/perf-audit
git add docs/superpowers/audits/2026-04-07/perf-audit/PHASE-0-ANSWERS.md
git commit -m "docs(audit): Phase 0 — cold-start baseline captured"
```

### Task P0.Final: Phase 0 boundary commit

- [ ] **Mark phase complete**

```bash
cd /Users/ryan/worktrees/bde/perf-audit
git commit --allow-empty -m "chore(perf): phase 0 complete — research answers captured"
```

---

## Phase 1 — Data Layer Quick Wins (8 work items, 9 IDs)

**Risk:** Low. Pure DDL + small query rewrites. Each finding lands as one commit.

### Task 1.1: F-t3-db-1 — PR composite index

**Goal:** Add `(pr_status, pr_number)` index so `listTasksWithOpenPrs` uses it instead of full-scanning `sprint_tasks`.

**Files:**
- Modify: `/Users/ryan/worktrees/bde/perf-audit/src/main/db.ts` (append migration)

- [ ] **Step 1: Capture before-state query plan**

```bash
sqlite3 /Users/ryan/worktrees/bde/perf-audit/docs/superpowers/audits/2026-04-07/perf-audit/.snapshot/bde.db "EXPLAIN QUERY PLAN SELECT * FROM sprint_tasks WHERE pr_status = 'open' AND pr_number IS NOT NULL;"
```

Expected output line: should contain `SCAN sprint_tasks` (no index used). Save it for the commit message.

- [ ] **Step 2: Add a new migration to `db.ts`**

```
Read: /Users/ryan/worktrees/bde/perf-audit/src/main/db.ts
```

Find the migrations array at the bottom. Note the highest existing version (per CLAUDE.md it's currently v34 — verify by reading). Append a new migration at version `last + 1`. Use the project's existing migration pattern (it uses better-sqlite3's exec method on a Database instance). Pseudo-shape:

```
{
  version: <last + 1>,
  description: 'Add composite index on sprint_tasks(pr_status, pr_number) for listTasksWithOpenPrs',
  up: (database) => {
    // call the database's SQL execution method with this DDL:
    //   CREATE INDEX IF NOT EXISTS idx_sprint_tasks_pr_open
    //     ON sprint_tasks(pr_status, pr_number)
    //     WHERE pr_status = 'open';
  },
}
```

Match the actual migration pattern in `db.ts` — the example above is shape-only.

- [ ] **Step 3: Run typecheck and tests**

```bash
cd /Users/ryan/worktrees/bde/perf-audit
npm run typecheck && npm test && npm run lint
```

Expected: all pass.

- [ ] **Step 4: Verify the index lands and is used**

Apply the migration to a fresh test db (the snapshot won't auto-migrate; either copy it and run the migration, or rely on the db.ts startup migration to run on next launch). Then re-run EXPLAIN QUERY PLAN against the migrated copy.

Expected output line: should contain `USING INDEX idx_sprint_tasks_pr_open`. Save it for the commit message.

- [ ] **Step 5: Commit**

```bash
cd /Users/ryan/worktrees/bde/perf-audit
git add src/main/db.ts
git commit -m "fix(perf): F-t3-db-1 — composite index on sprint_tasks(pr_status, pr_number)

PR poller's listTasksWithOpenPrs was full-scanning sprint_tasks every
60s. Added partial composite index.

Before: SCAN sprint_tasks
After:  SEARCH sprint_tasks USING INDEX idx_sprint_tasks_pr_open

Closes F-t3-db-1"
```

### Task 1.2: F-t3-db-3 — `(status, claimed_by)` composite index

**Goal:** Add composite index for orphaned-task and WIP queries.

**Files:**
- Modify: `/Users/ryan/worktrees/bde/perf-audit/src/main/db.ts` (append migration)

- [ ] **Step 1: Capture before-state query plan**

Identify the actual query first by reading the source:

```
Grep pattern: claimed_by
Glob: /Users/ryan/worktrees/bde/perf-audit/src/main/data/sprint-queries.ts
output_mode: content
-C: 5
```

For each query that uses `claimed_by` in a `WHERE`, run EXPLAIN QUERY PLAN against the snapshot. Save the line(s) showing SCAN.

- [ ] **Step 2: Add migration**

DDL to apply:

```sql
CREATE INDEX IF NOT EXISTS idx_sprint_tasks_status_claimed
  ON sprint_tasks(status, claimed_by);
```

Wrap in a migration object matching the existing pattern in db.ts.

- [ ] **Step 3: typecheck/test/lint, verify, commit (same pattern as Task 1.1)**

```bash
cd /Users/ryan/worktrees/bde/perf-audit && npm run typecheck && npm test && npm run lint
cd /Users/ryan/worktrees/bde/perf-audit
git add src/main/db.ts
git commit -m "fix(perf): F-t3-db-3 — composite index on sprint_tasks(status, claimed_by)

Before: <SCAN line>
After:  <USING INDEX line>

Closes F-t3-db-3"
```

### Task 1.3: F-t3-db-7 — `task_changes(task_id, changed_at DESC)` composite

**Goal:** Eliminate temp sort on task history queries that already hit 2,600 rows per task.

**Files:**
- Modify: `/Users/ryan/worktrees/bde/perf-audit/src/main/db.ts` (append migration)

- [ ] **Steps:** Same pattern as 1.1 / 1.2.

```sql
CREATE INDEX IF NOT EXISTS idx_task_changes_task_changed
  ON task_changes(task_id, changed_at DESC);
```

EXPLAIN QUERY PLAN target query (find via grep `FROM task_changes` in `task-changes.ts` and `sprint-queries.ts`). Capture SCAN→INDEX delta. Commit.

### Task 1.4: F-t3-db-6 / F-t3-model-3 — `cost_events` decision (HARD GATE on Phase 0 Q2)

> ⛔ **BLOCKED until Phase 0 Q2 is answered.** Read PHASE-0-ANSWERS.md → Q2 → Decision before starting. Do not run this task on assumption.

**Branch on Phase 0 Q2 outcome:**

#### Option A: Drop the table (no writer exists)

- [ ] **Step 1: Add a migration that drops the table**

DDL to apply:

```sql
DROP TABLE IF EXISTS cost_events;
```

Wrap in a migration object.

- [ ] **Step 2: Verify no read sites exist (re-grep)**

```
Grep pattern: cost_events
Glob: /Users/ryan/worktrees/bde/perf-audit/src/**/*.ts
```

If matches exist: stop, re-classify, fix the read sites first.

- [ ] **Step 3: typecheck/test/lint, commit**

```bash
git commit -m "fix(perf): F-t3-db-6 + F-t3-model-3 — drop dark cost_events table

Phase 0 Q2 confirmed no writer exists; table never populated after 31K
agent events. Removed via migration.

Closes F-t3-db-6
Closes F-t3-model-3"
```

#### Option B: Wire the writer (writer exists but is broken)

- [ ] **Step 1: Read PHASE-0-ANSWERS.md → Q2 → Findings**

The Phase 0 doc identifies the writer file path and the reason it doesn't fire. Open it and capture the writer's location.

- [ ] **Step 2: Read the writer source**

```
Read: <writer file path from Phase 0>
```

Identify: where the function is defined, where it should be called, and the dead-code path.

- [ ] **Step 3: Write a failing test**

In the test file colocated with the writer (`<writer-dir>/<writer>.test.ts`):

The test should:
1. Set up an in-memory better-sqlite3 db with the `cost_events` schema
2. Trigger the code path that should write a cost event (e.g. simulate a completed agent run)
3. Assert exactly one row appears in `cost_events` with the expected `source`, `model`, `total_tokens`, `cost_usd`

- [ ] **Step 4: Run test, expect FAIL**

```bash
cd /Users/ryan/worktrees/bde/perf-audit
npx vitest run <writer-test-file>
```

- [ ] **Step 5: Fix the writer**

Wire the call site so the writer fires on the right event. The fix is small by definition (it's a missing call or a misrouted handler — Phase 0 already characterized the bug).

- [ ] **Step 6: Run test, expect PASS, then full suite**

```bash
npx vitest run <writer-test-file>
cd /Users/ryan/worktrees/bde/perf-audit && npm run typecheck && npm test && npm run lint
```

- [ ] **Step 7: Commit**

```bash
cd /Users/ryan/worktrees/bde/perf-audit
git add <writer file> <test file>
git commit -m "fix(perf): F-t3-db-6 + F-t3-model-3 — wire cost_events writer

Phase 0 Q2 found that <reason from PHASE-0-ANSWERS.md>. Wired the
writer so cost events are recorded.

Closes F-t3-db-6
Closes F-t3-model-3"
```

### Task 1.5: F-t3-model-1 — Skip unchanged-field writes in `recordTaskChanges`

**Goal:** Stop recording `task_changes` rows when `oldValue === newValue`. Eliminates the bulk of the 38-rows-per-task average.

**Files:**
- Modify: `/Users/ryan/worktrees/bde/perf-audit/src/main/data/task-changes.ts` (function `recordTaskChanges` around lines 19-53)
- Test: `/Users/ryan/worktrees/bde/perf-audit/src/main/data/task-changes.test.ts` (create or extend)

- [ ] **Step 1: Read the current implementation**

```
Read: /Users/ryan/worktrees/bde/perf-audit/src/main/data/task-changes.ts
```

Note exact function signature, current diff logic (if any), and how `oldValue`/`newValue` are typed.

- [ ] **Step 2: Write a failing test for "no row when value unchanged"**

The test should:
1. Set up an in-memory better-sqlite3 database with the `task_changes` schema
2. Call `recordTaskChanges` with a payload where `oldValue === newValue` for all fields
3. Assert zero rows in `task_changes`
4. Add a complementary positive test: payload with at least one differing field → exactly one row

The exact API of `recordTaskChanges` may differ — read the source first and adapt the test to the real signature. The pattern is: arrange in-memory db, act with the target function, assert on row count.

- [ ] **Step 3: Run the test, expect FAIL**

```bash
cd /Users/ryan/projects/BDE
npx vitest run src/main/data/task-changes.test.ts
```

Expected: at least the first test fails (currently inserts a row even for unchanged values).

- [ ] **Step 4: Implement the skip-unchanged check**

In `recordTaskChanges`, before each insert, add a guard: if `oldValue === newValue` (or a deep-equal check appropriate for the column type), skip the insert. For object/array values use a structural compare.

- [ ] **Step 5: Run the test, expect PASS**

```bash
npx vitest run src/main/data/task-changes.test.ts
```

- [ ] **Step 6: Run the full test suite + lint + typecheck**

```bash
npm run typecheck && npm test && npm run lint
```

- [ ] **Step 7: Measure write amplification delta**

Run a representative status-loop scenario (e.g. take a sprint task through `queued → active → review → done`) against a test db, count `task_changes` rows. Repeat against the snapshot baseline (which has 20,044 rows for 525 tasks = 38 rows/task) to compare. Save to commit message.

- [ ] **Step 8: Commit**

```bash
cd /Users/ryan/worktrees/bde/perf-audit
git add src/main/data/task-changes.ts src/main/data/task-changes.test.ts
git commit -m "fix(perf): F-t3-model-1 — skip unchanged-field writes in recordTaskChanges

Audit trail was recording every patched field even when oldValue === newValue.
On a 525-task snapshot this produced 20,044 task_changes rows (38/task avg).
A single status loop wrote 5,584 entries.

Before: <N rows for status loop scenario>
After:  <N rows for same scenario>

Closes F-t3-model-1"
```

### Task 1.6: F-t3-db-2 — `listTasksRecent` OR-clause fix

**Goal:** Replace OR-clause that prevents index use with a UNION or explicit branch, allowing index lookup + smaller temp sort.

**Files:**
- Modify: `/Users/ryan/worktrees/bde/perf-audit/src/main/data/sprint-queries.ts` (function `listTasksRecent`)

- [ ] **Step 1: Read the current implementation, identify the OR clause and the affected indexes**
- [ ] **Step 2: Capture before-state query plan against snapshot**
- [ ] **Step 3: Rewrite the query** — common patterns:
  - `WHERE a = X OR b = Y` → `... WHERE a = X UNION ALL ... WHERE b = Y AND a != X` (allows two index lookups)
  - Or split into two prepared statements joined in code
- [ ] **Step 4: Write a test** asserting the new query returns the same rows for a representative input
- [ ] **Step 5: Run typecheck/test/lint**
- [ ] **Step 6: Capture after-state query plan**
- [ ] **Step 7: Commit with before/after EXPLAIN QUERY PLAN in body**

### Task 1.7: F-t3-db-4 — Batch loop-based audit inserts

**Goal:** `markTaskDoneByPrNumber` currently inserts audit rows in a JS loop (one prepared-statement call per row). Wrap in a transaction or use a single prepared statement with multiple bindings.

**Files:**
- Modify: `/Users/ryan/worktrees/bde/perf-audit/src/main/data/sprint-queries.ts` (function `markTaskDoneByPrNumber`)

- [ ] **Step 1: Read the function**
- [ ] **Step 2: Identify the loop and the per-row insert**
- [ ] **Step 3: Wrap in `db.transaction(...)` and re-prepare the statement once outside the loop**
- [ ] **Step 4: Write a test** that calls the function with a task that triggers ≥10 audit inserts and asserts they all land
- [ ] **Step 5: Run typecheck/test/lint**
- [ ] **Step 6: Measure delta** — count individual SQL execute calls before/after via a counter or by inspecting the prepared-statement reuse
- [ ] **Step 7: Commit**

### Task 1.8: F-t3-db-5 — Replace `SELECT *` with targeted column lists on hot reads

**Goal:** Hot list queries pull 40+ columns including multi-KB blobs (`spec`, `review_diff_snapshot`). Replace with targeted column lists for the 5-10 columns the renderer actually uses.

**Files:**
- Modify: `/Users/ryan/worktrees/bde/perf-audit/src/main/data/sprint-queries.ts` (functions `listTasksRecent`, `listTasksWithOpenPrs`, others using `SELECT *`)
- Modify: `/Users/ryan/worktrees/bde/perf-audit/src/shared/types.ts` (or wherever `SprintTaskListItem` lives — may need a new type)

- [ ] **Step 1: Grep for `SELECT *` in sprint-queries.ts and classify each by hotness**

```
Grep pattern: SELECT \*
Glob: /Users/ryan/worktrees/bde/perf-audit/src/main/data/sprint-queries.ts
output_mode: content
-C: 5
```

- [ ] **Step 2: For each hot read, identify which columns the caller actually uses**

Trace `listTasksRecent` consumers in renderer code (likely via Zustand store). List the columns actually accessed.

- [ ] **Step 3: Define a `SprintTaskListItem` type with just those columns (if not already)**

If `SprintTask` is used for both list and detail views, introduce a list-specific type to avoid widening the API surface.

- [ ] **Step 4: Update the queries to select the targeted columns**
- [ ] **Step 5: Update callers if the type changes**
- [ ] **Step 6: Run typecheck/test/lint**
- [ ] **Step 7: Measure column-count delta** for at least one query (40 → N)
- [ ] **Step 8: Commit**

### Task 1.Final: Phase 1 boundary commit

- [ ] **Mark phase complete**

```bash
cd /Users/ryan/worktrees/bde/perf-audit
git commit --allow-empty -m "chore(perf): phase 1 complete — 8 data layer findings landed"
```

---

## Phase 2 — Pipeline Hot Path (9 work items, 10 IDs)

**Risk:** High. Touches the running drain loop. Run the synthetic 3-agent pipeline test (built in Task 2.0) after every commit.

### Task 2.0: Build the synthetic 3-agent pipeline test

**Goal:** Repeatable test that spawns 3 trivial sprint tasks and verifies the pipeline handles them. Used as the verification gate for Tasks 2.1 - 2.9.

**Files:**
- Create: `/Users/ryan/worktrees/bde/perf-audit/scripts/perf-pipeline-smoke.sh`

- [ ] **Step 1: Write the script**

The script should:
1. Insert 3 sprint tasks into the local SQLite db with `status='queued'` and a no-op spec ("echo hello > /tmp/perf-test-N")
2. Wait for them to reach `done` or `failed` status (timeout 5 minutes)
3. Print: total time, write count to `agent_events` (via row count delta), and exit code based on whether all 3 succeeded

A starting structure is straightforward bash that uses the `sqlite3` CLI to:
- Snapshot row counts at start
- Insert 3 unique-id sprint tasks (use a timestamp prefix in the id)
- Poll every 5s until all 3 inserted tasks reach a terminal status, with a 300s deadline
- Snapshot row counts at end
- Print elapsed seconds, agent_events row delta, and failure count
- Exit non-zero if any task failed

The executor writes the script following that recipe. Make it idempotent (use unique task ids) and safe to re-run.

- [ ] **Step 2: Make executable and commit**

```bash
chmod +x /Users/ryan/worktrees/bde/perf-audit/scripts/perf-pipeline-smoke.sh
cd /Users/ryan/worktrees/bde/perf-audit
git add scripts/perf-pipeline-smoke.sh
git commit -m "test(perf): add 3-agent pipeline smoke test for Phase 2 verification"
```

- [ ] **Step 3: Run it once against the current baseline**

```bash
/Users/ryan/worktrees/bde/perf-audit/scripts/perf-pipeline-smoke.sh
```

Capture the elapsed time + event delta as the **Phase 2 baseline**.

- [ ] **Step 4: Append baseline to PHASE-0-ANSWERS.md and commit**

Append a "Phase 2 baseline (perf-pipeline-smoke before changes)" section to `/Users/ryan/worktrees/bde/perf-audit/docs/superpowers/audits/2026-04-07/perf-audit/PHASE-0-ANSWERS.md` containing the elapsed seconds, event delta, and any failure count. Then commit:

```bash
cd /Users/ryan/worktrees/bde/perf-audit
git add docs/superpowers/audits/2026-04-07/perf-audit/PHASE-0-ANSWERS.md
git commit -m "docs(audit): Phase 2 baseline — perf-pipeline-smoke before changes"
```

---

### Task 2.1: F-t1-concur-6 — Reverse broadcast/write order

**Goal:** `emitAgentEvent` currently broadcasts to renderer before persisting to SQLite. Under lock contention this loses events. Reverse the order: persist first, broadcast second.

**Files:**
- Modify: `/Users/ryan/worktrees/bde/perf-audit/src/main/agent-event-mapper.ts:83-95` (the `emitAgentEvent` function)
- Test: `/Users/ryan/worktrees/bde/perf-audit/src/main/agent-event-mapper.test.ts` (create or extend)

- [ ] Read current `emitAgentEvent`, note exact ordering
- [ ] Write a test that mocks the broadcast + db calls and asserts call order: db.run before broadcast
- [ ] Run test (FAIL)
- [ ] Reverse the order in source
- [ ] Run test (PASS)
- [ ] typecheck/test/lint
- [ ] Run perf-pipeline-smoke.sh, confirm it still passes
- [ ] Commit

### Task 2.2: F-t1-concur-2 — Batch agent_events writes

**Goal:** Replace per-message synchronous insert with a 50-event/100ms batch flushed in one transaction.

**Files:**
- Modify: `/Users/ryan/worktrees/bde/perf-audit/src/main/agent-event-mapper.ts`
- Test: `src/main/agent-event-mapper.test.ts`

- [ ] Read current per-event write path
- [ ] Design: a small `EventBatcher` class with `enqueue(event)` + a 100ms timer + flush on size 50 or shutdown
- [ ] Write a failing test: enqueue 50 events rapidly, assert exactly 1 SQLite transaction is opened (use a counter on the mock db)
- [ ] Implement the batcher
- [ ] Test passes
- [ ] Add a flush-on-shutdown hook in `agent-manager/index.ts` to drain the batch before exit
- [ ] typecheck/test/lint
- [ ] **CRITICAL:** Run perf-pipeline-smoke.sh. Capture event-write count before/after — should drop ≥10×.
- [ ] Commit with before/after numbers

### Task 2.3: F-t1-sre-1 / F-t3-model-2 — Cap agent_events retention (HARD GATE on Phase 0 Q5)

> ⛔ **BLOCKED until Phase 0 Q5 is answered.** Read PHASE-0-ANSWERS.md → Q5 → Decision before choosing Option A vs B.

**Branch on Phase 0 Q5 outcome:**

#### Option A: Aggressive retention (only live-tail reads)

- [ ] Add a cleanup hook in `agent-manager/completion.ts` that runs on task termination: `DELETE FROM agent_events WHERE agent_id = ? AND timestamp < (now - 1 hour)`
- [ ] Test: insert 100 events for a fake agent, run cleanup, assert count drops to events newer than 1 hour
- [ ] Verify the live-tail UI still receives events (by reading the event-load callsites identified in Phase 0)
- [ ] typecheck/test/lint
- [ ] Run smoke test
- [ ] Commit

#### Option B: Conservative retention (post-completion reads exist)

- [ ] Add a daily background prune: `DELETE FROM agent_events WHERE timestamp < (now - 7 days)`
- [ ] Hook the prune into the existing daily backup task in `db.ts` (or wherever the 24h backup runs)
- [ ] Test the prune logic with synthetic timestamps
- [ ] Commit

### Task 2.4: F-t1-sysprof-1 / F-t1-sysprof-4 — Cache `_depsEqual` comparison

**Goal:** Two `[...arr].sort()` allocations per task per drain tick. Cache a stable hash of `depends_on` at storage time, or detect "same array, same indices" fast path.

**Files:**
- Modify: `/Users/ryan/worktrees/bde/perf-audit/src/main/agent-manager/index.ts:608-625` (or wherever `_depsEqual` lives)
- Test: corresponding `.test.ts`

- [ ] Read `_depsEqual` and its callers
- [ ] Decide approach: hash cache (cleaner) or fast-path identity check (smaller diff)
- [ ] Write failing test: equal arrays return true without sorting (assert via spy on `Array.prototype.sort` or via a counter wrapper)
- [ ] Implement
- [ ] typecheck/test/lint
- [ ] Smoke test
- [ ] Commit

### Task 2.5: F-t1-sysprof-2 — Defer JSON.stringify in event hot loop

**Goal:** `JSON.stringify` runs synchronously per message in the event loop. Either skip when payload is unused or defer to the batch flush.

**Files:**
- Modify: `/Users/ryan/worktrees/bde/perf-audit/src/main/agent-event-mapper.ts`

- [ ] Identify where `JSON.stringify` runs in the message handler
- [ ] Determine whether the stringified payload is needed immediately or only on persist/broadcast
- [ ] If only on persist: move stringify into the batch flush (Task 2.2 batcher)
- [ ] If only on broadcast: keep but make conditional on whether anyone is subscribed
- [ ] Test: enqueue 1000 events, assert stringify count drops appropriately
- [ ] Smoke test, commit

### Task 2.6: F-t1-concur-1 — Coalesce broadcast IPC fan-out

**Goal:** Each task terminal triggers IPC broadcasts to all renderer windows. Coalesce so M windows × N concurrent terminations doesn't multiply.

**Files:**
- Modify: `/Users/ryan/worktrees/bde/perf-audit/src/main/agent-manager/completion.ts`

- [ ] Identify the broadcast call site
- [ ] Add a per-tick coalescer: collect terminal events for 16ms (one frame), then send one broadcast
- [ ] Test the coalescer logic in isolation
- [ ] Smoke test, commit

### Task 2.7: F-t1-concur-3 — Coalesce resolveDependents cascade

**Goal:** `resolveDependents()` runs synchronously per terminal event with no dedup. Coalesce multi-event runs.

**Files:**
- Modify: `/Users/ryan/worktrees/bde/perf-audit/src/main/agent-manager/resolve-dependents.ts`

- [ ] Read current `resolveDependents` and its caller in completion path
- [ ] Add a debounce or microtask flush so multiple terminal events in the same tick run resolution once
- [ ] Test with 5 terminal events fired in the same tick, assert resolveDependents runs once
- [ ] Smoke test, commit

### Task 2.8: F-t1-concur-4 — Race between task claim and dependency check

**Goal:** `taskStatusMap` is built once per drain loop; simultaneous completions can transition state inconsistently.

**Files:**
- Modify: `/Users/ryan/worktrees/bde/perf-audit/src/main/agent-manager/index.ts` (drain loop)

- [ ] Read drain loop, identify where `taskStatusMap` is constructed and consumed
- [ ] Choose fix: rebuild map after each claim, or use an immutable snapshot per claim attempt
- [ ] Write a test that simulates 2 simultaneous completions and asserts no spurious state transitions
- [ ] Smoke test, commit

### Task 2.9: F-t1-concur-5 — PR poller DB contention

**Goal:** PR poller and sprint-PR poller fire on unsynchronized 60s intervals competing with the drain loop for DB locks.

**Files:**
- Modify: `/Users/ryan/worktrees/bde/perf-audit/src/main/pr-poller.ts`
- Modify: `/Users/ryan/worktrees/bde/perf-audit/src/main/sprint-pr-poller.ts`

- [ ] Read both pollers
- [ ] Choose fix: stagger their start (offset second poller by 30s), OR coordinate via a shared mutex, OR move shared work into a single poller
- [ ] Implement the simplest fix that removes the contention
- [ ] Smoke test, commit

### Task 2.Final: Phase 2 boundary commit

```bash
cd /Users/ryan/worktrees/bde/perf-audit
git commit --allow-empty -m "chore(perf): phase 2 complete — 9 pipeline hot path findings landed"
```

---

## Phase 3 — SRE / Resource Hygiene (7 work items)

**Risk:** Low–Medium. Mostly mechanical resource-leak fixes.

For each task: read the file, identify the leak/resource, write a test for the eviction/cap behavior, implement, run typecheck/test/lint, run smoke test, commit. Same pattern as Phase 1 with TDD where possible.

### Task 3.1: F-t1-sre-2 — `setMaxListeners` on child stderr

**Files:** wherever `child.spawn` happens (likely `src/main/agent-manager/sdk-adapter.ts`)
**Change:** call `child.setMaxListeners(5)` (or appropriate cap) before registering stderr/exit handlers
**Test:** spawn a child, register 6 listeners, assert no MaxListenersExceededWarning

### Task 3.2: F-t1-sre-3 / F-t1-concur-8 — Prune settled `_agentPromises`

**Files:** `src/main/agent-manager/index.ts` (the `_agentPromises` Set)
**Change:** in the agent completion handler, `_agentPromises.delete(promise)` after settle
**Test:** spawn 5 fake agent promises, settle them, assert set size returns to 0

### Task 3.3: F-t1-sre-4 — Simplify PR poller backoff timer

**Files:** `src/main/pr-poller.ts`
**Change:** use a single `setInterval` and move backoff logic into the poll function (state, not timer recreation)
**Test:** trigger 3 backoff cycles, assert no orphaned timers

### Task 3.4: F-t1-sre-6 — TTL on `_lastTaskDeps`

**Files:** `src/main/agent-manager/dependency-index.ts` (or wherever `_lastTaskDeps` is)
**Change:** add a periodic eviction sweep that removes entries for tasks not seen in N drain cycles, OR sync the map's keyset to the active task list each tick
**Test:** insert 10 entries, advance the tick counter, assert evicted entries match expectation

### Task 3.5: F-t1-sre-5 — Worktree disk reservation under concurrency

**Files:** `src/main/agent-manager/worktree.ts`
**Change:** check disk after acquiring a per-worktree lock, OR atomically reserve disk per spawn (track planned-allocation in memory)
**Test:** simulate 5 concurrent worktree creations against a constrained disk-mock, assert at most N succeed where N matches the available capacity

### Task 3.6: F-t1-sysprof-5 — OAuth token cache with TTL

**Files:** `src/main/auth-guard.ts` (or wherever `checkOAuthToken` lives)
**Change:** cache the token in memory with a TTL (5 min?); only re-read file on expiry
**Test:** call check 100 times in quick succession, assert file is read once

### Task 3.7: F-t1-sysprof-3 — `getUserMemory` mtime cache

**Files:** `src/main/agent-system/memory/index.ts`
**Change:** cache the parsed memory result keyed on `(path, mtime)`; only re-read when mtime changes
**Test:** call 100 times against an unchanged file, assert one read; change mtime, assert one more read

### Task 3.Final: Phase 3 boundary commit

```bash
git commit --allow-empty -m "chore(perf): phase 3 complete — 7 SRE/hygiene findings landed"
```

---

## Phase 4 — Renderer Performance (7 work items)

**Risk:** Medium. UI regression risk; React behavior changes can be subtle. Use `console.count` for render measurement, capture pre/post numbers.

**Pre-phase:** Add a render-counter helper hook (`useRenderCount(label)`) to a shared util if it doesn't exist. Use it for all Phase 4 measurements; remove it (or keep behind a `__DEV__` guard) before commit.

### Task 4.1: F-t2-react-1 — SprintPipeline `useShallow` consolidation (THE Critical)

**Files:** `/Users/ryan/worktrees/bde/perf-audit/src/renderer/src/components/sprint/SprintPipeline.tsx:73-85`

**Change:** Replace 13 individual `useSprintUI` selectors with one `useSprintUI(useShallow(state => ({...})))` call. Keep stable setter references separate (they don't need shallow-eq).

- [ ] Read current 13 selectors and their consumers
- [ ] Identify which fields are state (need shallow-eq) vs setters (already stable)
- [ ] Refactor to one shallow selector for state + direct setter access
- [ ] Add `useRenderCount('SprintPipeline')` for measurement
- [ ] Capture baseline render count for the pinned interaction ("click 5 task pills in 5s")
- [ ] Capture post-fix count, assert ≥30% drop
- [ ] Remove the render counter (or guard it)
- [ ] typecheck/test/lint
- [ ] Manual smoke (click around, no visual regression)
- [ ] Commit with before/after counts

### Task 4.2: F-t2-react-3 — Decouple Dashboard `now` ticker

**Files:** `/Users/ryan/worktrees/bde/perf-audit/src/renderer/src/views/DashboardView.tsx`
**Change:** the `now` state updates every 10s and triggers full re-render. Move `now` into a child component that owns its own ticker, OR use a ref + manual force-update for the elements that actually need it.
**Verify:** render count for DashboardView body drops; child components that need `now` still update

### Task 4.3: F-t2-react-2 — `useDashboardMetrics` `now` dependency

**Files:** `src/renderer/src/components/dashboard/useDashboardMetrics.ts` (or wherever this hook lives)
**Change:** the `now` dep in `useMemo` causes recomputation every 10s. Either remove `now` from the dep array (if the metrics don't actually change with `now`), OR memoize the expensive part separately
**Verify:** the expensive derivation runs ≤1 per minute instead of every 10s

### Task 4.4: F-t2-react-4 — `useSprintPolling` `.some()` re-scan

**Files:** `src/renderer/src/stores/sprintTasks.ts` or wherever the polling hook is
**Change:** `.some()` over the entire task array on every store update is wasteful. Use a Map keyed by status, or maintain a counter incrementally
**Verify:** scan count drops for typical update patterns

### Task 4.5: F-t2-react-5 — TaskRow callback identity stability

**Files:** `src/renderer/src/components/sprint/PipelineStage.tsx` (parent of TaskRow)
**Change:** `handleTaskClick` is recreated per render, breaking memoization on TaskPill. Wrap in `useCallback` with stable deps, OR pass the task id and resolve the click target inside TaskRow
**Verify:** TaskPill render count drops on parent re-renders that don't change the click target

### Task 4.6: F-t2-react-6 — ActivitySection callback identity

**Files:** `src/renderer/src/components/dashboard/ActivitySection.tsx`
**Change:** same pattern as 4.5 — `onCompletionClick` should be stable across the 10s re-render driven by `now`
**Verify:** ActivitySection child render count is decoupled from the parent's `now` ticker

### Task 4.7: F-t2-react-7 — `useVisibilityAwareInterval` for inactive tasks

**Files:** `src/renderer/src/components/sprint/TaskPill.tsx` or `TaskRow.tsx`
**Change:** the visibility-aware interval registers an event listener for every task, even hidden ones. Either lift the listener to a parent + use a context dispatcher, OR only register for visible tasks
**Verify:** with 50 tasks rendered, listener count ≤ visible count + 1, not 50

### Task 4.Final: Phase 4 boundary commit

```bash
git commit --allow-empty -m "chore(perf): phase 4 complete — 7 renderer findings landed"
```

---

## Phase 5 — Bundle / Asset (6 work items)

**Risk:** Low–Medium. Build config changes can break dev/prod parity. Re-run `npm run build` after every commit and verify the IDE still works manually.

**Pre-phase:** Cold-start baseline must be captured in Phase 0. If it isn't, do that first.

### Task 5.1: F-t2-bundle-1 / F-t2-bundle-6 — xterm + TerminalPane `React.lazy`

**Files:**
- `/Users/ryan/worktrees/bde/perf-audit/src/renderer/src/components/terminal/TerminalContent.tsx:50-74`
- `/Users/ryan/worktrees/bde/perf-audit/src/renderer/src/components/terminal/TerminalPane.tsx:1-10`
- Wherever TerminalPane is consumed in IDEView

**Change:**
- Wrap TerminalPane import in `React.lazy(() => import('./TerminalPane'))`
- Wrap consumer in `<Suspense fallback={<TerminalPlaceholder />}>` 
- Move xterm + addon imports inside TerminalPane so they're in the lazy chunk

**Verify:**
- `npm run build` produces a separate chunk for TerminalPane
- Cold-start time-to-first-render improves vs the Phase 0 baseline
- Open IDE → terminal still works (open tab, type, see output)

### Task 5.2: F-t2-bundle-2 — Lazy view CSS imports

**Files:** `/Users/ryan/worktrees/bde/perf-audit/src/renderer/src/main.css` and view-specific CSS files

**Change:** view-specific CSS (Sprint Pipeline neon, Task Workbench neon, Code Review neon, etc.) is currently imported at app entry. Move each into the respective view component file so it's bundled with the view chunk.

**Verify:** initial CSS payload drops; view-switch still loads the right styles

### Task 5.3: F-t2-bundle-3 — Monaco worker config

**Files:** wherever Monaco is set up (grep `monaco` in `src/renderer/`)

**Change:** ensure `MonacoEnvironment.getWorkerUrl` (or the equivalent) explicitly returns the right worker URL for the Electron context. Without it Monaco may fall back to inline workers or fail silently in the asar context.

**Verify:** Monaco loads its workers in the dev console; no `Could not create web worker(s)` warnings

### Task 5.4: F-t2-bundle-4 — View preload on hover

**Files:** view registry / panel system (likely `src/renderer/src/lib/view-registry.ts` and `src/renderer/src/components/panels/PanelTabBar.tsx`)

**Change:** when a tab is hovered (or focused via keyboard), call the lazy import for that view. Reduces switch latency from "wait for chunk" to "already there."

**Verify:** hover a tab → check Network panel for the chunk request; click → instant switch

### Task 5.5: F-t2-bundle-5 — App.tsx top-level fan-out

**Files:** `/Users/ryan/worktrees/bde/perf-audit/src/renderer/src/App.tsx`

**Change:** App.tsx pulls in `framer-motion` and all stores synchronously at the top level. Move heavy deps behind dynamic import or lift them into the views that actually use them.

**Verify:** `npm run build` shows reduced size for the App.tsx chunk

### Task 5.6: F-t2-bundle-8 — Confirm SDK marked external

**Files:** `/Users/ryan/worktrees/bde/perf-audit/electron.vite.config.ts`

**Change:** ensure `@anthropic-ai/claude-agent-sdk` is in the renderer config's `external` list (it should NEVER be bundled into the renderer — it's a main-process dep)

**Verify:** `npm run build` then grep the renderer dist bundle for `@anthropic-ai/claude-agent-sdk` — should not appear

### Task 5.Final: Phase 5 boundary commit

```bash
git commit --allow-empty -m "chore(perf): phase 5 complete — 6 bundle findings landed"
```

---

## Phase 6 — Token Economy (13 work items, 17 IDs)

**Risk:** Medium. Prompt changes can subtly degrade agent behavior.

### Task 6.0: Pin a regression task and capture baseline

**Goal:** Choose one specific recent `done` sprint task with `tokens_in` near the p50 (~10) or median (~200). Re-running this task after each Phase 6 commit should produce a token delta matching the per-finding expectation.

- [ ] Query the snapshot for a candidate

```bash
sqlite3 /Users/ryan/worktrees/bde/perf-audit/docs/superpowers/audits/2026-04-07/perf-audit/.snapshot/bde.db "SELECT id, sprint_task_id, tokens_in, tokens_out, cost_usd FROM agent_runs WHERE status='done' AND tokens_in > 100 AND tokens_in < 500 ORDER BY started_at DESC LIMIT 5;"
```

- [ ] Pick one. Pull its full sprint_tasks row (title, prompt, spec) and save to PHASE-0-ANSWERS.md as "Phase 6 regression task: <id>"
- [ ] Document the baseline: `tokens_in`, `tokens_out`, `cost_usd`, `duration_ms`
- [ ] **Note for the executor:** re-running the same task on the live system requires inserting a copy of the spec as a new sprint task. Don't re-run the original (history is immutable).

### Task 6.1: F-t4-ctx-1 / F-t4-prompt-2 — Flip `isBdeRepo` default to false

**Files:** `/Users/ryan/worktrees/bde/perf-audit/src/main/agent-system/memory/index.ts:17-25`, `/Users/ryan/worktrees/bde/perf-audit/src/main/agent-manager/prompt-composer.ts:249-255`

**Change:** `isBdeRepo(undefined)` currently returns `true`. Flip to `false`. Audit all spawn sites to confirm they pass `repoName` explicitly when they're actually working in BDE.

**TDD:**
- [ ] Test: `isBdeRepo(undefined) === false`
- [ ] Test: `isBdeRepo('BDE') === true`, `isBdeRepo('other') === false`
- [ ] Implement the flip
- [ ] Audit spawn callsites; pass `repoName` where needed
- [ ] Re-run pinned regression task, expect ~978 token drop on `tokens_in`
- [ ] Commit with token delta

### Task 6.2: F-t4-ctx-2 / F-t4-prompt-4 / F-t4-ctx-9 — Lazy-inject skills

**Files:** `/Users/ryan/worktrees/bde/perf-audit/src/main/agent-manager/prompt-composer.ts:265-268`, `/Users/ryan/worktrees/bde/perf-audit/src/main/agent-system/skills/index.ts`

**Change:** Replace the unconditional skill bundle (~2,601 tokens) with:
- Front-loaded: a 100-char skill *index* listing skill names + one-line descriptions
- Lazy: full skill bodies loaded on demand via a tool call (e.g. `bde:getSkill(name)`)

This is the architectural lazy-inject mechanism `F-t4-ctx-9` flags as missing — building it for skills is the proof-of-concept.

**TDD:**
- [ ] Test: prompt composer for an assistant agent contains skill *index* but not skill *bodies*
- [ ] Test: a `bde:getSkill(name)` tool call returns the full skill body
- [ ] Implement the index generator + lazy fetch tool
- [ ] Re-run pinned regression task, expect ~2,601 token drop (if the task didn't actually use skills)
- [ ] Commit

### Task 6.3: F-t4-prompt-3 — Trim copilot SPEC_DRAFTING_PREAMBLE

**Files:** `src/main/agent-manager/prompt-composer.ts` (the preamble constant)

**Change:** the preamble currently contains 269 tokens of defensive language about embedded instructions and file content interpretation. In a UI-controlled context this is unnecessary. Trim to ~50 tokens covering the essential framing only.

**Verify:** read the trimmed version, confirm it still conveys (1) "you are drafting a spec, not implementing" and (2) "you cannot use tools." Re-run a copilot-spawn task, capture token delta.

### Task 6.4: F-t4-prompt-7 / F-t4-ctx-3 — Cap `taskContent` at 2000 chars

**Files:** `src/main/agent-manager/prompt-composer.ts` (where task spec is injected)

**Change:** add a cap function that truncates `taskContent` at 2000 chars (~500 tokens) with a "...[truncated, see source]" marker. Also add UI-side validation that warns when a spec exceeds the cap before queueing.

**TDD:**
- [ ] Test: 1500-char input passes through unchanged
- [ ] Test: 5000-char input is truncated to 2000 chars + marker
- [ ] Implement
- [ ] Update Task Workbench validation to flag oversized specs (optional follow-up)
- [ ] Commit

### Task 6.5: F-t4-ctx-4 — Document/justify upstream context diff cap

**Files:** wherever upstream context diffs are built (likely `src/main/agent-manager/prompt-composer.ts` or a `context-builder.ts`)

**Change:** the 2000-char cap exists with no inline rationale. Either keep the cap with a code comment explaining *why* 2000, or replace with a configurable constant + JSDoc.

**Verify:** comment is present and references the audit finding.

### Task 6.6: F-t4-ctx-5 — Cap copilot conversation history

**Files:** wherever copilot history is composed (likely `src/main/handlers/workbench.ts` or `prompt-composer.ts`)

**Change:** copilot sessions can accumulate 4-5K tokens of history. Cap at the last 10 turns (or similar) and add a "Start fresh" UI button.

**Verify:** simulate a 20-turn copilot session, assert prompt only contains the last 10 turns.

### Task 6.7: F-t4-ctx-7 — Compress upstream context diffs

**Files:** wherever upstream context is built

**Change:** for upstream task context, summarize/dedupe instead of pasting raw diffs. Could be: (1) collapse identical lines, (2) summarize per-file at 100 tokens max, (3) include only the relevant section pointed to by the spec.

**Verify:** measure prompt size before/after for a multi-task workflow.

### Task 6.8: F-t4-prompt-1 / F-t4-ctx-10 — Decouple CLAUDE.md per agent type

**Files:** `src/main/agent-manager/prompt-composer.ts`, possibly `sdk-adapter.ts` (if `settingSources` is set there)

**Change:** spec-drafting agents (copilot, synthesizer) currently inherit CLAUDE.md + BDE_FEATURES.md via SDK `settingSources`. They don't need that ~9,800 tokens. Override `settingSources` to `[]` (or just `['user']`) for spec-drafting agent types.

**TDD:**
- [ ] Test: copilot prompt does NOT include "BDE Performance Audit" or other BDE_FEATURES.md content
- [ ] Test: pipeline prompt DOES include it (regression check)
- [ ] Implement
- [ ] Re-run pinned regression task — but note: pinned task is likely a pipeline agent, so this won't show as a token drop. Manually spawn a copilot session and capture its `tokens_in` for the delta.

### Task 6.9: F-t4-cost-1 / F-t4-cost-3 — Per-class output caps

**Files:** spec generation files + agent prompts; possibly add a new `task_class` field

**Change:** introduce task classes (audit, refactor, generate, fix, doc) and per-class output caps. Implementations vary:
- Soft: include the cap as a hint in the system prompt ("aim for ≤8K output tokens for refactor tasks")
- Hard: enforce via SDK `max_tokens` parameter on the agent spawn

**TDD:**
- [ ] Test: agent spawn for a `generate` class task uses the right cap
- [ ] Test: `audit` class uses a smaller cap
- [ ] Implement classification (could be heuristic on task title for v1)

### Task 6.10: F-t4-cost-2 — Investigate success-tail dominance

**Goal:** Successful tasks average $1.65 vs $0.24 for failed. Explore whether some "successful" runs could complete with summary-only output.

**Files:** agent prompts, possibly task class definition

**Change:** depends on investigation. Likely action: introduce a "review-only" class where the agent reads + comments but doesn't generate code, with a strict output cap.

- [ ] Pull 10 successful task specs from the snapshot
- [ ] Identify which ones produced full code vs analysis output
- [ ] Categorize and propose the smallest possible "review-only" mode
- [ ] Implement if scope permits, otherwise document and defer to a follow-up

### Task 6.11: F-t4-cost-4 — Resolve zero-input cohort (depends on Phase 0 Q1)

**Branch on Phase 0 Q1 outcome:**
- **Silent failures:** fix the failure path (becomes a reliability bug, not a perf fix)
- **Cache hits:** document in PHASE-0-ANSWERS.md and CLOSE the finding without code change
- **Ghost rows:** add a startup prune for `agent_runs WHERE tokens_in IS NULL`

### Task 6.12: F-t4-cost-5 — Enforce `max_cost_usd` (HARD GATE on Phase 0 Q6)

> ⛔ **BLOCKED until Phase 0 Q6 is answered.** Read PHASE-0-ANSWERS.md → Q6 → Decision. If "already enforced" mark this task DONE without a code commit.

**Branch on Phase 0 Q6 outcome:**
- **Schema only / never read:** add enforcement in `run-agent.ts` — check `cost_usd` after each turn, abort if exceeded
- **Already enforced:** mark task DONE before starting, no commit needed
- **Read but no-op:** add the comparison + abort

**TDD:**
- [ ] Test: agent run with `max_cost_usd=0.10` aborts when cost reaches $0.10
- [ ] Test: agent run without `max_cost_usd` runs to completion
- [ ] Implement
- [ ] Smoke test on a cheap task

### Task 6.Final: Phase 6 boundary commit

```bash
git commit --allow-empty -m "chore(perf): phase 6 complete — 13 token economy findings landed"
```

---

## Final Wrap (after all phases complete)

### Task F.1: Verify all 55 work items are committed

```bash
cd /Users/ryan/worktrees/bde/perf-audit
git log --oneline chore/perf-audit-2026-04-07 ^main | grep -c "^[a-f0-9]* fix(perf): F-"
```

Expected: 55 (or close — depends on how many bundled commits split).

### Task F.2: Count phase boundary commits

```bash
git log --oneline chore/perf-audit-2026-04-07 ^main | grep -c "phase [0-6] complete"
```

Expected: 7 (Phase 0 + Phases 1-6).

### Task F.3: Run the full test suite one more time

```bash
cd /Users/ryan/projects/BDE
npm run typecheck && npm run test:coverage && npm run test:main && npm run lint
```

Expected: clean.

### Task F.4: Run the synthetic pipeline smoke one final time

```bash
/Users/ryan/worktrees/bde/perf-audit/scripts/perf-pipeline-smoke.sh
```

Expected: pass, with elapsed time and event delta noted vs the Phase 2 baseline.

### Task F.5: Summary commit (optional doc update)

Update PHASE-0-ANSWERS.md with a "Final Results" section summarizing:
- Total findings landed
- Most impactful improvements (with numbers)
- Any items that were reverted
- Remaining open questions

```bash
git commit -am "docs(audit): perf audit execution complete — final results"
```

### Task F.6: Decide next step

Options:
- **Merge to main locally** via `superpowers:finishing-a-development-branch`
- **Open a single PR** for the entire branch
- **Open one PR per phase** by cherry-picking phase commits onto separate branches (cleaner review, more work)

User decides.

---

## Notes for the executor

- **Phase 0 first.** Don't skip it. The hard gates (Q2/Q5/Q6) really do change what Phase 1, 2, and 6 do.
- **The Phase 0 doc is the cross-phase scratchpad.** Append baselines, decisions, and pinned task IDs there. It's the durable record that survives session boundaries.
- **Run the smoke test after every Phase 2 commit.** No exceptions. The drain loop is fragile.
- **Don't refactor beyond what each finding requires.** Stay surgical. The audit branch is already long.
- **If a finding turns out to be wrong** (e.g. you read the code and the issue doesn't actually exist), document the disagreement in a commit message and move it to deferred. Don't silently skip.
- **If a session ends mid-finding,** the next session re-runs the verification step before resuming. Don't trust half-applied state.
- **Resume protocol:** read this file → scan `git log` for the most recent `chore(perf): phase N complete` → find the next unchecked task in this file under Phase N+1 → run it.
