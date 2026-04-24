# Phase B Results — Header Injection A/B

**Experiment ran:** 2026-04-24, 13:50 → 13:56 local
**Status:** **completed early due to environmental contamination caused by the experiment itself** (see §3). N=5 Arm A runs, n=1 Arm B run before contamination blocked further runs.
**Companion artifacts:** [`phase_b_raw.txt`](./phase_b_raw.txt), [`phase_b_results.json`](./phase_b_results.json), [`phase_b_setup.md`](./phase-b-setup.md).

> **Headline:** the data — even partial — is decisive on three points. (1) The 30-turn default budget is **catastrophically too small** for *every* task tested, including the narrow ones. (2) For at least one of the tested tasks (T-47), the 75-turn cap is *also* not enough. (3) **A pipeline agent (B-arm T-47) wrote to the main repo instead of its worktree**, contaminating the environment and blocking subsequent runs. Painpoint #1 ("turn budget starvation") is confirmed and **larger** than originally framed; the fix is bigger than just "add a spec linter."

---

## 1. Per-pair comparison

| # | Pair (Arm A → B) | A status | A turns | A cost | A retries | B status | B turns | B cost | B retries |
|---|------------------|----------|---------|--------|-----------|----------|---------|--------|-----------|
| 1 | T-22 escapeXmlContent | error | 31 | $0.51 | 1 | error (never ran) | – | – | 0 |
| 2 | T-23 propagate disallowedTools | error | 31 | $0.72 | 1 | error (never ran) | – | – | 0 |
| 3 | T-44 orphan recovery | error | 31 | $0.55 | 1 | error (never ran) | – | – | 0 |
| 4 | T-47 reset fast_fail_count | error | 31 | $0.60 | 2 | **error at 76** | 76 | $1.21 | 1 |
| 5 | T-50 redirect fast-fail log | error | 31 | $0.39 | 2 | error (never ran) | – | – | 0 |

**Aggregate:** Arm A 0/5 pass, mean turns 31.0 (every single Arm A run hit the cap). Arm B 0/1 pass, single run hit 76 turns. `max_turns_exceeded` event count: 7 in Arm A, 1 in Arm B. Total cost: $3.99.

## 2. What the partial data tells us with high confidence

### 2.1 The 30-turn default is wildly insufficient — even for narrow tasks

All 5 Arm A originals hit `max_turns_exceeded` at `num_turns=31`. The agent manager classified them as `incomplete_files` because the agent ran out of turns before touching all the files listed in `## Files to Change`. **Notably, T-44 was a 2-line change to a single file** (`src/main/agent-manager/index.ts:455-456`) plus an integration test — yet still ran out at 31 turns. The spec asked for a regression test, and the agent burnt its budget on test setup before getting to the production change.

This means the 30-turn default isn't just a problem for "obviously multi-file" specs (the original framing). It's a problem for **any task that includes a meaningful test asks** — which is almost every refactor. The audit's "21-turn cluster" of successes was probably tiny tasks with no test asks; the moment you add a test, you blow past 30.

**Implication:** the linter alone won't fix this. Even if the linter forces every spec to add `## Multi-File: true`, the *root* problem is that 30 is a bad default. **The default should be ≥75 (the current "high" tier)** with the header optional rather than required.

### 2.2 75 turns is also insufficient for at least one task class

The single Arm B run (T-47, with `## Multi-File: true` header) hit max_turns at 76. Same `incomplete_files` failure. T-47's spec asks for changes to `run-agent.ts` and `sprint-task-repository.ts` plus an integration test. With 75 turns and a moderate test ask, the agent still ran out.

n=1 isn't enough to call the cap conclusively too low, but combined with the audit data (37 of the recent successful runs hit ≥71 turns), the cap is at minimum **the operating point**, not a margin. **A bump to 100-125 turns is worth testing.**

### 2.3 Pipeline agents are NOT properly isolated to their worktrees

This is the painful surprise. While running, B-arm T-47 (agent run `dafed796-…`) made tool calls with absolute paths to BOTH:
- `/Users/ryanbirkeland/.bde/worktrees/.../e79e2836…/src/main/agent-manager/review-transition.ts` (its own worktree — correct)
- `/Users/ryanbirkeland/Projects/git-repos/BDE/src/main/agent-manager/review-transition.ts` (**main repo — wrong**)

The agent successfully Read, Grep'd, and *Wrote* to main repo paths. Specifically, it created `src/main/agent-manager/__tests__/review-transition.test.ts` in main via the Write tool (preserved as evidence at [`contamination/review-transition.test.ts.evidence`](./contamination/review-transition.test.ts.evidence)). The Edit attempt on `review-transition.ts` failed (string mismatch), so only the new file made it through.

**This contaminated main**, tripping the agent manager's `assertRepoCleanOrAbort` (the `pre-ffMergeMain` guard). All four remaining B-arm clones — and several Arm A retries — were rejected by the guard with `setupWorktree failed: Main repo has uncommitted changes`. The experiment killed itself.

**Implications, in order of severity:**

1. **Safety/security.** A prompt-injected pipeline agent could overwrite source files in main without going through the Code Review Station gate. The current "isolation" is convention-based (the prompt says "your worktree is at X"), not enforced. The agent received absolute main-repo paths via Grep/find results, then trusted them.
2. **Reliability.** A misbehaving agent can deadlock the entire pipeline by leaving an untracked file in main, since the dirty-guard then rejects every subsequent worktree spawn.
3. **Audit trail.** The agent wrote to main *outside* of any branch. There's no PR, no commit, no review — just an untracked file appearing in `git status`.

The fix is a tool-layer guard: **reject Write/Edit/Bash tool calls whose absolute path is outside the agent's worktree**. The `Bash` tool is the harder case — agents can `cd ../../..` and write anywhere. Could be enforced by wrapping the SDK's tool calls or by making the worktree the only readable/writable area (chroot-style, expensive).

Lower-effort interim mitigation: extend `assertRepoCleanOrAbort` to *report which agent created the dirty path*, and surface that in the UI so the user can spot and react quickly.

## 3. Why the experiment couldn't complete

Timeline (all times today, local):

| Time | Event |
|---|---|
| 13:50 | Phase B setup ran; 10 tasks queued. |
| 13:51 | Drain loop spawned 4 originals + 1 [B-arm T-47] (WIP=4 + a slot opening up). |
| 13:52 | Originals T-22, T-23, T-44, T-50, T-47 each hit `num_turns=31` and failed with `max_turns_exceeded`. |
| 13:53–55 | Originals auto-retried; some hit fast-fail. **B-arm T-47 (`dafed796`) wrote to MAIN at 13:54 (`review-transition.test.ts`).** |
| 13:54 | First `setupWorktree failed: Main repo has uncommitted changes` error fires. |
| 13:55 | All subsequent retries and all 4 unrun B-arms blocked by the dirty-guard. |
| 13:56 | All 10 tasks at terminal `error`. Monitor exited. |

So we got 5 Arm A data points and 1 Arm B data point — enough to call the **30-turn-default-is-too-small** finding decisive, weak signal on the **75-cap-also-low** question, and a brand-new **path-traversal** finding that wasn't in the original 6 painpoints at all.

## 4. Updated recommendations (supersedes RCA section §4 / Phase B spec §6)

**Tier 1 — ship now:**

1. **Raise `DEFAULT_MAX_TURNS` from 30 to 75** in `src/main/agent-manager/turn-budget.ts`. The audit + Phase B together show 30 is wrong for almost every realistic task. Make 75 the floor; let the header bump higher if we ever need it.
2. **Build the spec linter** — still valuable as a positive nudge for spec quality (`## Files to Change`, `## How to Test`, no exploration verbs), but stop treating the Multi-File header as the *gating* factor. The linter is about spec quality, not turn budget rescue.
3. **Tool-layer worktree isolation.** Wrap the SDK's tool dispatch so any absolute path outside the agent's worktree is rejected. Even a soft enforcement (warn + reject + emit `agent:error`) is much better than the current convention-only model.

**Tier 2 — design and test:**

4. Run a **3-arm Phase C** with cap-raise (75 → 125) once Tier 1 is in. Same 5 task pairs (or fresh equivalents). This time isolate against the path-traversal bug by either fixing it first OR adding a `pre-spawn` cleanup of any agent-created files in main.
5. Make the dirty-guard error message identify the *agent* responsible for the dirty path, not just list the paths. Today the user has to trace timestamps to figure out which run did it.

**Tier 3 — track:**

6. The cap might still be too low even at 125 — depends on Phase C results. Eventually we may need a per-task `max_turns` override field, surfaced in the Workbench UI.
7. The state-machine `cancelled` sink (painpoint #3) didn't bite in Phase B but is still a real design issue.

## 5. Cleanup status

- **Main repo: cleaned.** The agent-created `review-transition.test.ts` was moved to [`contamination/review-transition.test.ts.evidence`](./contamination/review-transition.test.ts.evidence) (preserves the work for review; main is no longer dirty).
- **5 [B-arm] clones: deleted.** SQL `DELETE` against `sprint_tasks` removed all 5 rows. No worktrees or branches existed for them (the `setupWorktree` failures aborted before either was created), so no further pruning was needed.
- **5 originals: still at status=`error`** with retry exhausted. They can't be productively re-queued until the running BDE process picks up the new 75-turn default — which requires rebuild + restart (the running app is using the pre-commit code). After restart, the user should `resetTaskForRetry(id)` (or `sprint:retry` IPC / `tasks.update` MCP) for each to clear `retry_count` / `failure_reason` / `completed_at` cleanly. Manual SQL `UPDATE sprint_tasks SET status='queued'` is *not* recommended — leaves stale fields per CLAUDE.md.

## 6. Status of follow-ups

- ✅ **Painpoint #1 — turn budget starvation** — `DEFAULT_MAX_TURNS` 30→75 in commit `a9b5b09b`. Removes the cap-binding pain for the common case.
- ✅ **Painpoint #2 — multi-file cap too tight** — `MULTI_FILE_MAX_TURNS` 75→100 in commit `f39d3799`. Gives explicit-header refactors real headroom.
- ✅ **Painpoint #3 — `cancelled` is a state-machine sink** — added `cancelled→done`, `failed→done`, `error→done` manual recovery escape hatches in commit `40ea321b`. Audit trail preserved via `task_changes`.
- ✅ **Painpoint #4 — brittle handler test assertions** — added `assertHandlersRegistered` helper that's tolerant to extra positional args (`parseArgs` validators) in commit `dee23608`. Workbench test refactored as canonical example; other handler tests can migrate as touched.
- ✅ **Painpoint #5 — `_-prefixed` fields as test API** — introduced typed `__testInternals` view on `AgentManagerImpl` in commit `7778d332`. All 17 underscore-prefixed members tests reach into now route through one stable mapping; renames touch the seam, not 35+ test sites.
- ✅ **Painpoint #6 — `BatchImportTask` four-way drift** — unified into a single shared type in commit `b296fbce`. IPC channel, handler, preload, and service all import from `src/shared/types`.
- ✅ **B-arm cleanup done** — see §5.
- ✅ **Main repo cleaned** — see §5.
- ⏳ **Spec linter** — not yet built. Now a much lower-priority follow-up; the default-bump made the gap mostly cosmetic.
- ⏳ **Tool-layer worktree guard** — the path-traversal finding (§2.3) is a safety issue that warrants its own scoped spec; contained for now because the agent manager's `assertRepoCleanOrAbort` guard at least surfaces the contamination loudly.
- ⏳ **Phase C (cap-raise A/B)** — moot now that the multi-file cap is 100. Skip unless real-world runs show T-47-class tasks still hitting it.

What I want your decision on (when you're back):

1. **The agent-created test file** at [`contamination/review-transition.test.ts.evidence`](./contamination/review-transition.test.ts.evidence) — keep, fix, or discard? It's a draft of a real test for `review-transition.ts`; might be salvageable.
2. **Path-traversal spec** — want me to draft it as a queued task once the new turn budget is in production?
3. **The 5 originals** — once you rebuild + restart BDE, do you want me to draft the `resetTaskForRetry` calls, or do that yourself?
