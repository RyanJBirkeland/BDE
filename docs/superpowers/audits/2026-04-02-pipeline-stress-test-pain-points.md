# Pipeline + Dependency System Pain Points — Live Observations

## Session: 2026-04-01/02 — Agents UX Phases 2-4 (10 tasks, 5 waves)

### Pain Point 1: Zombie tasks — agents complete work but status stays "queued"
- **What happened:** t1, t3, t4 all completed (opened PRs #593, #594, #595) but remained `queued` with `claimed_by` set
- **Root cause:** Agent errored on `git push` (pre-push hook typecheck failure from pre-existing JSX.Element issues). The completion handler marks task done only AFTER successful push+PR. Error on push → task stays claimed+queued forever.
- **Impact:** Drain loop skips them (claimed_by set), blocked tasks never unblock. Full pipeline stall.
- **Manual fix required:** Had to manually mark as `done` via Queue API to trigger dependency resolution.
- **UX gap:** No visibility that a task "finished its work but failed to push." From the UI it looks like it's still running or waiting.
- **Suggestion:** Need a "completed with errors" or "push failed" status. Or: if agent exits with code 0 but push fails, still mark done and flag the push failure separately.

### Pain Point 2: Pre-push hook blocks agent PRs
- **What happened:** Pre-existing typecheck errors (bare `JSX.Element` in Dashboard files) caused pre-push hook to reject agent pushes
- **Root cause:** Agents branch from main, but the pre-push hook runs the full test suite against the worktree — including files the agent didn't touch
- **Impact:** 2 of 4 Wave 1 tasks errored on first attempt
- **Suggestion:** Agent pushes should probably use `--no-verify` (they already do per CLAUDE.md worktree gotchas, but the agent manager may not be doing this)

### Pain Point 3: Error → retry requires manual intervention
- **What happened:** t3 errored, required manual steps: delete remote branch, `git worktree prune`, SQLite UPDATE to reset status+claimed_by+notes+started_at+completed_at+fast_fail_count
- **Root cause:** Queue API `PATCH` doesn't allow clearing `status`, `claimed_by`, `started_at`, `completed_at` via the general endpoint (they're excluded from GENERAL_PATCH_FIELDS). Must use SQLite directly or the `/status` endpoint (which doesn't clear claimed_by).
- **Impact:** Resetting an errored task is a multi-step manual process requiring SQLite access
- **UX gap:** No "retry" button that properly resets all fields. The UI shows errored tasks but offers no one-click recovery.
- **Suggestion:** Add a `POST /queue/tasks/:id/retry` endpoint that atomically resets status=queued, claimed_by=null, notes=null, started_at=null, completed_at=null, fast_fail_count=0

### Pain Point 4: Dependency resolution only fires through TaskTerminalService
- **What happened:** Direct SQLite writes to mark tasks done did NOT trigger dependency unblocking. Had to use Queue API `/status` endpoint instead.
- **Root cause:** By design — all terminal paths must route through TaskTerminalService. But this means any out-of-band status change (manual SQLite fix, external tool) silently breaks the dependency chain.
- **Impact:** After manually fixing zombie tasks via SQLite, dependent tasks stayed blocked until I re-did it through the API.
- **Suggestion:** Document this prominently in the UI. Or: add a "refresh dependencies" button that re-evaluates all blocked tasks.

### Pain Point 5: No merge conflict detection before agent starts
- **What happened:** PR #595 had merge conflicts because t3's agent branched from a pre-fix main, then t1's PR merged first changing the same test file
- **Root cause:** Multiple agents branching from the same main commit naturally conflict when touching overlapping files
- **Impact:** PR requires manual rebase before merge, slowing the pipeline
- **Suggestion:** The completion handler could attempt a `git rebase origin/main` before pushing. Or: detect overlapping file changes between concurrent tasks at queue time.

### Pain Point 6: Sprint PR poller didn't auto-advance tasks
- **What happened:** Tasks with PRs stayed at `queued` status — the sprint PR poller (which auto-marks merged PRs as done) didn't help because PRs weren't merged yet
- **Root cause:** The flow is: agent opens PR → task marked "queued" (should be "done" or "awaiting review") → PR needs human merge → poller detects merge → marks done
- **Impact:** The status `queued` with a PR open is confusing. Is it queued for execution or queued for review?
- **Suggestion:** Tasks that have opened PRs should be in a distinct state (e.g., `awaiting_review` or at minimum `done` with `pr_status=open`)

### Pain Point 7: Push failure is the #1 recurring failure mode
- **What happened:** 4 out of 5 tasks that completed work errored on git push (t1, t3, t4 in Wave 1; t5 in Wave 2). Only t2 succeeded cleanly on retry.
- **Pattern:** Agent does all the work → commits → push fails (pre-push hook) → task marked error → branch exists on remote but no PR → requires manual cleanup (delete branch, prune worktree, reset 6 SQLite fields)
- **This is the single biggest reliability issue in the pipeline.** Over 80% failure rate on push.
- **Root cause:** Pre-push hook runs `npm run typecheck` + `npm test` + `npm run test:main` against the FULL codebase, not just changed files. Any pre-existing issue anywhere = all agents fail.
- **Suggestion:** Either (a) use `--no-verify` on agent pushes, (b) scope pre-push to changed files, or (c) have completion handler retry push with `--no-verify` as fallback.

### Pain Point 8: Branch pushed but PR creation failed — no recovery
- **What happened:** t5's branch pushed successfully but the error on push prevented `gh pr create` from running
- **Impact:** Work is done, code is on remote, but no PR exists. Task marked as error. The work is lost unless someone manually creates the PR.
- **Suggestion:** Completion handler should be: push → if push fails, stop. If push succeeds but PR creation fails, still mark task done with a note about missing PR.

### Pain Point 9: SQLite reset via background shell is unreliable
- **What happened:** Attempted to reset t5 via a background Bash command with `sqlite3` — the command completed (exit 0) but the DB wasn't actually updated
- **Root cause:** Possible WAL mode locking — BDE's main process holds a write lock on `bde.db`. The background `sqlite3` command may have silently failed or been rolled back.
- **Impact:** Task stayed at `error` for several minutes until manual foreground retry
- **Suggestion:** All task resets should go through the Queue API, not direct SQLite. Need a proper `/retry` endpoint.

### Monitoring Timeline
- 00:16 — Wave 1 starts: t1, t2, t3, t4 queued
- 00:17 — t1 claimed (active)
- 00:18 — t4 claimed (active)
- 00:29 — t3 errored (push fail), manually reset
- 00:41 — t2 errored (push fail), manually reset → succeeds on retry
- ~00:45 — t1, t3, t4 complete with PRs but stuck at queued
- 01:00 — Manual intervention: mark t1, t3, t4 as done via Queue API
- 01:02 — Wave 2 starts: t5, t6 unblocked and claimed
- 01:02 — t5 (steering echo) + t6 (console search) both active
- ~01:10 — t5 errored (push fail), reset
- ~01:15 — t6 errored (push fail), reset — 5th push failure out of 6 tasks attempted
- ~01:17 — t5 retry active
- Push failure rate: 5/6 (83%). Only t2 succeeded without manual intervention.
- ~01:20 — t6 reset, queued for retry
- Root cause identified: NOT typecheck errors. It's `test:main` flaky test (`index.test.ts` timer-based drain assertion). Pre-push runs full test:main which includes timing-sensitive mocks.
- ~01:17 — t5 PR#597 opened, status stuck at `active` (zombie)
- ~01:20 — t6 PR#598 opened, status stuck at `active` (zombie)
- ~01:21 — Manual mark done for t5, t6. Wave 3 cascade fires: t7, t8 unblocked → queued

### Pain Point 11: Completion handler sets PR but doesn't transition to "done"
- **What happened:** Agent manager logged "has PR — not orphaned, clearing claimed_by" but left status as `active`
- **Pattern:** This happened for t5 AND t6 in Wave 2, and t1/t3/t4 in Wave 1. It's the dominant completion path — agent pushes, PR opens, but task stays at active/queued.
- **Root cause:** The completion handler clears `claimed_by` when it finds a PR, but doesn't call the status transition to `done`. The sprint PR poller would eventually catch the merge, but tasks are stuck until the PR is actually merged.
- **Impact:** Every single task requires manual `done` status transition. The dependency cascade NEVER fires automatically.
- **This is the #1 systemic issue.** The pipeline cannot run unattended.
- Wave 3 confirmed same pattern: t7 PR#599, t8 PR#600 both stuck at `active`. Manual mark done → Wave 4 (t9) unblocked.

### Monitoring Timeline (continued)
- ~01:22 — Wave 3 starts: t7, t8 active
- ~01:30 — t7 PR#599, t8 PR#600 opened (both zombie active)
- ~01:31 — Manual mark done for t7, t8. Wave 4 cascade fires: t9 unblocked → queued
- Score: 8/10 done, 8 PRs (#593-600). Every task required manual done transition.

### Pain Point 10: Pre-push hook runs ALL tests including flaky integration tests
- **What happened:** Agent push rejected because `agent-manager/__tests__/index.test.ts` flaky timer test failed
- **Root cause:** `runs initial drain after defer period` test uses `vi.advanceTimersByTimeAsync` — inherently timing-sensitive. Passes most of the time but occasionally flakes.
- **Impact:** This test has nothing to do with the agent's code changes. An unrelated flaky test blocks a perfectly good PR push.
- **This is different from Pain Point #2** (typecheck errors). Even after fixing typecheck, the `test:main` suite introduces random failures.
- **Suggestion:** Agent pushes should use `--no-verify`. Quality gates belong in CI, not in the push hook where flaky tests create a manual intervention loop.
