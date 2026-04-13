# Agents View Redesign Session — Handoff

**Date:** 2026-04-10 (session ran into 2026-04-11 early morning UTC)
**Status:** 6 of 8 tasks shipped, 1 in flight, 1 blocked-waiting
**Main branch HEAD at handoff:** `7f2d938e`

---

## What this session was about

Started as an audit/remediation of the Agents view UI (the `Cmd+2` view). Expanded into a brainstorming → spec → epic → pipeline-driven implementation → RCA → follow-up fixes cycle. Along the way, discovered and fixed a critical bug in the pipeline agent prompt composer that was silently affecting every pipeline task in BDE.

The full design spec lives at `docs/superpowers/specs/2026-04-10-agents-view-redesign-design.md`. The epic task specs and queue script live at `docs/superpowers/audits/2026-04-10/epic-agents-view-redesign-tasks/`. Read those for the full scope; this doc is the state summary + next-steps.

---

## Pipeline state at handoff

```
id        title                                                   status
--------  ------------------------------------------------------  --------
999cfe07  Agents View Redesign 01: Inline-styles cleanup          done
7a9ebe77  Agents View Redesign 02: Sidebar card redesign          done
0d2f83f4  Agents View Redesign 03: Cockpit header growth          done
6c7fe200  Agents View Redesign 04: Console body file restructure  done
b08b2071  Agents View Redesign 05: Card grammar conversation      active   ← running
c7c3cd91  Agents View Redesign 06: Card grammar tool cards + diff blocked  ← waits on 05
1fb2e26a  Agents View Redesign 07: Fleet at a Glance empty state  done
a8332e32  Fix Task Pipeline filter state pollution + banner       done
```

6 of 8 tasks shipped to main. Task 05 was running at handoff time with the new (fixed) prompt composer — it had already modified all 7 conversation card files (`UserMessageCard`, `TextCard`, `ThinkingCard`, `ErrorCard`, `StderrCard`, `RateLimitedCard`, `StartedCard`) and created `cards/ConsoleCard.css`. That's the full Part-A scope of the spec. Task 06 (tool cards + `EditDiffCard`) is correctly blocked on 05's hard dep.

### Agent worktrees to know about

Task 05 lives at:

```
~/worktrees/bde/Users-ryan-projects-BDE/b08b2071bf4cbe52e8d610237f48aea6
```

…on branch `agent/agents-view-redesign-05-card-grammar-con-b08b2071`.

Note the case: **manual CLI worktrees go under `~/worktrees/BDE/` (uppercase)**, **agent-spawned worktrees go under `~/worktrees/bde/Users-ryan-projects-BDE/` (lowercase + flattened repo path)**. This is a documented convention in `CLAUDE.md` and it tripped me up briefly during Ship It commands.

---

## Immediate next steps

### 1. Watch task 05 through to completion

Check state:

```bash
sqlite3 ~/.bde/bde.db "SELECT status, claimed_by FROM sprint_tasks WHERE id='b08b2071bf4cbe52e8d610237f48aea6';"
```

**If `status=review`:** inspect the diff and Ship It. Diff is visible via:

```bash
cd ~/worktrees/bde/Users-ryan-projects-BDE/b08b2071bf4cbe52e8d610237f48aea6
git log --oneline main..HEAD
git diff main --stat
```

Review checklist for task 05's work:

- [ ] 7 conversation card files updated with new card chrome (no `[agent]`/`[user]`/etc. prefix text)
- [ ] `ThinkingCard.tsx` shows ~120-char preview by default (not hidden behind a click)
- [ ] `UserMessageCard.tsx` right-aligned via CSS
- [ ] `cards/ConsoleCard.css` exists with per-type accent classes
- [ ] **Tests written in `cards/__tests__/` for each new card type** — the prompt composer fix should finally make this happen. If tests are STILL missing, the fix didn't work and we need to dig further.
- [ ] CSS uses `--bde-space-*` tokens, not hardcoded pixel values (the filter-fix agent failed this; watch for it here)

**Ship It pattern** (from `CLAUDE.md`):

```bash
cd ~/projects/BDE
git fetch origin main
git rebase origin/main
git cherry-pick agent/agents-view-redesign-05-card-grammar-con-b08b2071
git push origin main
# then in DB:
sqlite3 ~/.bde/bde.db "UPDATE sprint_tasks SET status='done', completed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id='b08b2071bf4cbe52e8d610237f48aea6';"
# cleanup:
git worktree remove ~/worktrees/bde/Users-ryan-projects-BDE/b08b2071bf4cbe52e8d610237f48aea6 --force
git branch -D agent/agents-view-redesign-05-card-grammar-con-b08b2071
```

**If task 05 errors again:** check `~/.bde/bde.log` for watchdog kills, `spawn git ENOENT`, or idle timeouts. The prompt composer was almost certainly the cause of the first failure — if it happens a second time with the spec-truncation fix in place, investigate the SDK session / OAuth token / drain loop instead.

### 2. Let task 06 run

Once task 05 is `done`, task 06 (`c7c3cd91`) auto-unblocks via the terminal-status hook → `resolveDependents`. The drain loop picks it up within ~30s. It's a bigger task (4944-char spec, lucide tool icon replacement + `ToolActionCard`, `ToolPairCard`, `ToolGroupCard`, `BashCard`, `ReadCard`, `EditDiffCard`) so expect 20-40 min runtime.

Review checklist for task 06:

- [ ] `cards/util.ts` rewritten to return `{ Icon: LucideIcon, color: string }` instead of `{ letter, iconClass }`
- [ ] No more single-letter tool "icons" (`$`, `R`, `E`, `W`) anywhere
- [ ] `EditDiffCard.tsx` exists, uses `parseDiff()` from `lib/diff-parser.ts` to render synthetic diffs
- [ ] Clicking expand on an `edit` tool result shows a colored diff, not raw JSON
- [ ] Tests for `EditDiffCard` + tool cards

### 3. Visual QA pass after both land

After tasks 05 and 06 ship, the Agents view redesign is complete end-to-end. Walk through the acceptance checklist in `docs/superpowers/specs/2026-04-10-agents-view-redesign-design.md` (the "Acceptance Criteria" section near the end — 29 checkboxes). Some are grep-verifiable ("no `style={{}}` in `AgentsView.tsx`"), some require eyeballing the running app.

---

## What shipped this session

### Main-branch commits (in order, newest first)

```
7f2d938e docs: Agents View Redesign epic — 7 pipeline task specs + queue script
5bd0f246 docs: clarify AgentsView.css path + close diff-rendering open question
ea8f7d9d docs: Agents view redesign — design spec
aa1b31ca fix(pipeline): raise spec truncation cap from 2000 to 8000 chars + cleanup
6f3188cf test(pipeline): add test coverage for clearAllFilters + PipelineFilterBanner
4a253ec0 fix(pipeline): clear all filters on Dashboard navigation and add filter banner
8af2e30a feat(agents): replace empty state with FleetGlance overview
eaecd1b3 refactor(agents): redesign AgentCard to 3-row layout
0c1ff01e Agents View Redesign 04: Console body file restructure
304a563c Agents View Redesign 01: Inline-styles cleanup
f4b48a0c Agents View Redesign 03: Cockpit header growth + typography
```

### Key changes by file

- **`src/main/agent-manager/prompt-composer.ts`** — spec truncation cap raised `2000 → 8000` chars, added explicit instruction that Files to Change / How to Test / Out of Scope sections are required. This is the single most impactful fix of the session (see Discoveries section below).
- **`src/renderer/src/views/DashboardView.tsx`** — `navigateToSprintWithFilter` now resets `repoFilter` and `tagFilter` alongside `searchQuery`.
- **`src/renderer/src/stores/sprintUI.ts`** — new `clearAllFilters` action.
- **`src/renderer/src/components/sprint/PipelineFilterBanner.tsx`** (new) — shows "Showing N of M tasks" + chips + "Clear all filters" button whenever any filter is active.
- **`src/renderer/src/components/sprint/PipelineFilterBar.tsx`** — `hasActiveFilters` now includes `tagFilter` (was missing).
- **`src/renderer/src/components/sprint/SprintPipeline.tsx`** — renders `PipelineFilterBanner` between the filter bar and the pipeline body.
- **`src/renderer/src/views/AgentsView.tsx`**, **`AgentCard.tsx`**, **`ConsoleHeader.tsx`**, **`AgentConsole.tsx`**, **`FleetGlance.tsx`** (new), **`cards/` directory** (new, 13 card components split from `ConsoleLine.tsx`) — all from the first 5 shipped redesign tasks.

---

## Discoveries this session (save these for future reference)

### Prompt composer was silently cutting every pipeline spec at 2000 chars

`src/main/agent-manager/prompt-composer.ts:301` had `MAX_TASK_CONTENT_CHARS = 2000`. Every task spec longer than 2000 chars was silently truncated, cutting off whatever was at the bottom — typically "Files to Change", "How to Test", and "Out of Scope" sections.

**How I found it:** I was doing an RCA on why the filter-fix pipeline agent skipped all the tests I required in the spec. Assumed it was an agent behavior issue. Instead found the cap. Verified every shipped Agents View Redesign task spec was also over 2000 chars (2773, 3151, 3268, 4106, 4306, 4557, 4944). Every single one was truncated.

**Impact before the fix:** Pipeline agents were systematically shipping code without the test coverage the spec required. Tasks 01-04 and 07 still shipped usable code because their agents could infer scope from the Problem/Solution portions, but any requirement at the bottom of a spec was silently ignored. This is a product-wide quality tax that had been baked in for an unknown amount of time.

**The fix:** cap raised to 8000 chars (~2000 words) — covers the `CLAUDE.md` "under 500 words" guideline with headroom. Also added explicit prompt wording: _"If the spec lists test files to create or modify, writing those tests is REQUIRED, not optional."_

**Watch for:** task 05 is the first run with the fix in place. If it produces test files, the fix is validated. If it doesn't, there's a deeper prompt issue to dig into.

### Task Pipeline view filters silently hide tasks the Dashboard shows

`SprintPipeline.tsx` applies four filters (`statusFilter`, `repoFilter`, `tagFilter`, `searchQuery`) from the `useSprintUI` store before partitioning and rendering. `DashboardView.tsx` uses raw unfiltered tasks. This meant clicking a Dashboard stage box (via `navigateToSprintWithFilter`) left a persistent filter active that silently hid tasks when the user navigated to the Task Pipeline view.

Three secondary bugs compounded it:

1. `PipelineFilterBar.tsx:34` self-hides when there's only one repo + no searchQuery + no presets — no UI to see or clear an active filter
2. `hasActiveFilters` on that same bar was missing `tagFilter` in the check
3. "Show All Tasks" command palette only cleared `statusFilter`, not the other three

The fix (commits `4a253ec0` + `6f3188cf`) adds a `PipelineFilterBanner` that's always visible when any filter is active, exposes `clearAllFilters` from the store, and resets all 4 filters when navigating from Dashboard.

### Worktree path casing is inconsistent

- Manual CLI worktrees: `~/worktrees/BDE/<branch-name>` (uppercase `BDE`)
- Pipeline agent worktrees: `~/worktrees/bde/Users-ryan-projects-BDE/<32-char-taskId>` (lowercase `bde`, flattened subdir)
- macOS filesystem is case-insensitive so both work, but the path difference is annoying when scripting. Watch for this in scripts that search for worktrees.

### Direct SQL insert into `sprint_tasks` bypasses IPC-level auto-blocking, but the drain loop re-checks

`src/main/agent-manager/index.ts:388-389` has a defensive `_checkAndBlockDeps` call at claim time. So direct SQL inserts (bypassing `sprint:create` IPC) are safe — the drain loop catches unsatisfied dependencies at claim time and auto-blocks the task. Confirmed by reading the code _and_ seeing task 02 / 06 get correctly auto-blocked after direct SQL insertion in the redesign epic.

### Pipeline agent completion flow — what NOT to touch

When agents complete successfully:

1. Agent commits to their branch in the agent worktree
2. Task transitions `active → review`
3. **Worktree is preserved** for human inspection
4. User reviews in Code Review Station (or via Ship It CLI pattern)
5. On merge: worktree + branch cleaned up, task marked `done`, dependents resolved

The completion logic is in `src/main/agent-manager/completion.ts` (uses `git add -A`) and terminal-status handling is in `src/main/services/task-terminal-service.ts`. Don't touch these without understanding the whole flow — there's a memory about a worktree retry bug in this area.

---

## Deferred — good candidates for a future session

### High value

1. **"Ph13" CSS tokenization sweep.** Agents that shipped before the prompt composer fix (tasks 02, 03, 07 and tasks 01, 04) wrote CSS without seeing the "use `--bde-space-*` tokens" convention from `CLAUDE.md` — that part of the spec was truncated. The new files almost certainly have hardcoded pixel values. This is mechanical cleanup: same grep pattern as the Ph12 epic (`docs/superpowers/audits/2026-04-10/epic-css-ph12-tasks/01-spacing-tokens-ide-diff.md`), just scoped to the new files:
   - `src/renderer/src/components/agents/FleetGlance.css`
   - `src/renderer/src/components/agents/AgentCard.css`
   - `src/renderer/src/components/agents/ConsoleHeader.css`
   - `src/renderer/src/components/agents/cards/*.css` (after 05 + 06 land)
     Good candidate for a pipeline task with a small (~1500-word) spec.

2. **`spawn git ENOENT` in the partial-diff capture cleanup path.** When a task fails, BDE tries to capture a partial git diff from the agent's worktree. The spawn fails with ENOENT (git not found) — this is a PATH issue in Electron's child process environment during the error/cleanup hook. Log entry from task 05's first failed run:

   ```
   [WARN] [agent-manager] Failed to capture partial diff for task b08b2071...: Error: spawn git ENOENT
   ```

   Doesn't corrupt anything, just means the `partial_diff` column stays null on failed runs. Likely fix: use `execFile` with an absolute path or explicit env.PATH in the cleanup hook. Check `src/main/agent-manager/run-agent.ts` or `completion.ts` for the partial-diff code path.

3. **Visual QA pass against the spec's 29-item acceptance checklist.** After 05 + 06 land, spend ~30 minutes walking through `docs/superpowers/specs/2026-04-10-agents-view-redesign-design.md`'s "Acceptance Criteria" section with the running app. Expect ~3-5 iteration items.

### Lower value

4. **Live activity row on sidebar cards.** The spec had a stretch goal (Section 2, Open Question #1): show "▶ Currently: editing src/api.ts" on running agent cards in the fleet sidebar. Deferred because the data binding cost wasn't clear. After 05 + 06 ship, the cockpit body has card grammar, and at that point the sidebar cards look relatively minimal by comparison. Worth considering once you see the finished view.

5. **Minute-grouped timestamps in the cockpit body.** Currently each card has no timestamp (simpler than the old per-line stamps). Spec mentioned deferring minute-group labels to a follow-up. If you find yourself wanting "when did this happen" context in long runs, this is worth ~1 hour of work.

6. **Remove `statusFilter` from `SprintPipeline.tsx` entirely.** The RCA recommended a "Level 4 architectural fix" — the Task Pipeline view is a visualization of the full pipeline, so filtering by status is conceptually odd (why visualize an empty pipeline?). The Level 1+3 fix that shipped keeps `statusFilter` working but adds the banner. A future cleanup could rip it out and let users filter within each stage's expand/collapse instead. Not urgent.

---

## Files / paths to know

### Design + epic artifacts (now on main)

- `docs/superpowers/specs/2026-04-10-agents-view-redesign-design.md` — full design spec
- `docs/superpowers/audits/2026-04-10/epic-agents-view-redesign-tasks/README.md` — epic overview with dependency graph
- `docs/superpowers/audits/2026-04-10/epic-agents-view-redesign-tasks/01-*.md` through `07-*.md` — per-task specs
- `docs/superpowers/audits/2026-04-10/epic-agents-view-redesign-tasks/queue_epic.py` — reusable direct-SQL queue pattern with dep resolution

### Touch points from this session

- `src/main/agent-manager/prompt-composer.ts` (line 301 — truncation cap)
- `src/main/agent-manager/index.ts` (line 388 — defensive dep check at claim time)
- `src/renderer/src/views/DashboardView.tsx` (line 154 — navigateToSprintWithFilter)
- `src/renderer/src/stores/sprintUI.ts` — filter state + `clearAllFilters`
- `src/renderer/src/components/sprint/PipelineFilterBanner.tsx` — new
- `src/renderer/src/components/sprint/PipelineFilterBar.tsx` (line 30 — hasActiveFilters)
- `src/renderer/src/components/sprint/SprintPipeline.tsx` (line 524 — banner render site)
- `src/renderer/src/components/agents/cards/` — new directory from task 04, being populated by 05 + 06
- `src/renderer/src/lib/partitionSprintTasks.ts` — the 7-bucket partition logic (un-modified, but critical reference)
- `src/renderer/src/lib/diff-parser.ts` — `parseDiff(raw: string): DiffFile[]` used by the (upcoming) `EditDiffCard`

### Quick state queries

```bash
# Pipeline state of redesign tasks
sqlite3 ~/.bde/bde.db "SELECT substr(id,1,8), substr(title,27,40), status FROM sprint_tasks WHERE title LIKE 'Agents View Redesign%' ORDER BY title;"

# All active / queued / blocked tasks globally
sqlite3 ~/.bde/bde.db "SELECT substr(id,1,8), substr(title,1,50), status FROM sprint_tasks WHERE status IN ('active','queued','blocked','review') ORDER BY status, created_at;"

# Current BDE migration version
sqlite3 ~/.bde/bde.db "PRAGMA user_version"

# Live drain loop activity (BDE must be running)
tail -f ~/.bde/bde.log | grep -E 'agent-manager|worktree|watchdog' | grep -v test
```

### Worktree cheatsheet

```bash
# List all worktrees
git worktree list

# Create new manual worktree (uppercase BDE path)
git worktree add -b <branch> ~/worktrees/BDE/<branch> main

# Remove a worktree
git worktree remove ~/worktrees/BDE/<branch> --force
git branch -D <branch>

# Pipeline agent worktrees live here (lowercase bde, flattened)
ls ~/worktrees/bde/Users-ryan-projects-BDE/
```

---

## If things go sideways

### Task 05 or 06 errors again with the new prompt composer

1. Check `~/.bde/bde.log` for watchdog kills or errors around the failure time
2. Look at the agent's worktree state — did it make any commits or just hang?
3. If the spec is still being interpreted wrong, verify the full spec is actually in the agent's prompt:
   - Grep the log for the task ID around the claim time
   - The prompt itself isn't logged by default, but you can instrument `run-agent.ts` to dump the assembled prompt before spawning the SDK session
4. If it's an SDK/auth issue, check OAuth token freshness at `~/.bde/oauth-token` and re-run `claude login` if needed

### Need to abort and requeue

```bash
# Kill a stuck agent (if BDE UI isn't responding)
pgrep -lf 'claude-agent-sdk' | head -5
# then kill by PID

# Requeue a task from any terminal status
sqlite3 ~/.bde/bde.db "UPDATE sprint_tasks SET status='queued', claimed_by=NULL, retry_count=0, fast_fail_count=0, notes=NULL, started_at=NULL, completed_at=NULL, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id='<taskid>';"
```

### Need to roll back a commit that already merged

```bash
cd ~/projects/BDE
git fetch origin main
git rebase origin/main
git revert <commit-sha>   # creates a revert commit
git push origin main
```

Never force-push to main.

---

## Final session scoreboard

- **Spec written, reviewed, approved:** 1 (the redesign design spec)
- **Epic task specs written + queued:** 7 (the redesign tasks) + 1 (filter fix) = 8
- **Shipped to main:** 6 redesign tasks + 1 filter fix + 1 prompt composer fix + 2 test commits + 3 spec doc commits = 13 commits
- **In flight at handoff:** task 05 (active), task 06 (blocked-waiting)
- **Bugs discovered and fixed:** 3 (spec truncation, filter pollution, hasActiveFilters)
- **Bugs discovered and deferred:** 2 (spawn git ENOENT, Ph13 CSS)
- **RCAs performed:** 2 (filter rendering, agent skipping tests)
- **Critical infrastructure improvement:** raising spec truncation cap from 2000 to 8000 chars silently improves every future pipeline agent run

Good handoff point. Launch is working, pipeline is running, and the next session can pick up by checking task 05/06 state and reviewing their diffs.
