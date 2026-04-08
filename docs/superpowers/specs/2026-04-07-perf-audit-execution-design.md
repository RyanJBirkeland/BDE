# BDE Performance Audit — Execution Design

**Date:** 2026-04-07
**Status:** Approved for planning
**Owner:** Ryan
**Source audit:** `docs/superpowers/audits/2026-04-07/perf-audit/SYNTHESIS.md`
**Branch:** `chore/perf-audit-2026-04-07` at `~/worktrees/bde/perf-audit`

## Background

A 10-lens performance audit of BDE on 2026-04-07 produced 70 findings consolidated into a synthesis with a Top 10, 12 quick wins, and a deferred list. This spec turns the audit into an executable, phased workplan that can be paused and resumed across multiple sessions without losing context.

## Goal

Execute every audit finding that has positive ROI (55 of 70). Document the 15 explicitly deferred findings so future audits don't re-discover them. Phase the work so each phase produces working, shippable code and the workplan can resume cleanly across sessions.

### Finding accounting (math closes)

The synthesis lists 70 finding IDs. They are accounted for as follows:

- **55 distinct work items** land as commits across Phases 1-6 (see phase tables below)
- **6 dedup pairs** fold into their canonical entry (one commit covers both IDs):
  - `F-t4-prompt-2` ≡ `F-t4-ctx-1` (canonical: ctx-1)
  - `F-t4-prompt-4` ≡ `F-t4-ctx-2` (canonical: ctx-2)
  - `F-t3-model-3` ≡ `F-t3-db-6` (canonical: db-6)
  - `F-t4-ctx-3` ≡ `F-t4-prompt-7` (canonical: prompt-7)
  - `F-t4-ctx-6` ≡ `F-t4-prompt-5` (both deferred)
  - `F-t1-concur-7` ≡ `F-t1-sysprof-1` (canonical: sysprof-1)
- **15 explicitly deferred** with reasons (see Deferred section below)

55 work items (covering 61 distinct IDs through dedup) + 15 deferred − 6 dedup overlap counted twice = **70 total ✓**.

### Bundling clarification

Some phase rows bundle 2 IDs into one work item. There are two reasons for bundling:

1. **Dedup pair** — both IDs name the same root cause and the same fix. Example: `F-t4-ctx-1` / `F-t4-prompt-2`. Lands as one commit citing both IDs.
2. **Tightly-coupled fixes** — two related but distinct fixes that share a code path and naturally land together. Example: `F-t1-sysprof-1` (cache deps comparison) and `F-t1-sysprof-4` (drop deep compare). Lands as one commit citing both IDs, OR as two adjacent commits if the second is non-trivial.

**Commit-per-finding rule, restated:** the default is one commit per finding ID. Bundled rows in the phase tables land as one commit listing all bundled IDs in the message. If during execution a bundle turns out to be 2 separable fixes, split into 2 commits.

## Non-Goals

- Re-running the audit. The findings are fixed inputs.
- Re-scoring findings. The synthesis ranking is treated as authoritative unless an open question changes the picture.
- Touching deferred findings. They are documented as out-of-scope with a reason.
- Optimizing for a single mega-PR. Phases land independently, one commit per finding.

## Approach

### Phase Structure

Six execution phases plus a Phase 0 research pass. Each phase produces working code, runs the full test suite, and commits before moving on. Phases are ordered by risk (lowest first) and dependency (Phase 0 unblocks Phases 1, 6).

#### Phase 0 — Resolve blocking open questions

**Type:** Research only. No code changes.
**Output:** `docs/superpowers/audits/2026-04-07/perf-audit/PHASE-0-ANSWERS.md`

The questions split into **hard gates** (block specific findings — cannot ship those findings without an answer) and **soft gates** (tune severity but don't block execution).

**Hard gates — must answer before the gated phase row runs:**

| Question | Method | Hard-gates |
|---|---|---|
| Q2: Why is `cost_events` empty after 31K agent events? Drop the table, or wire the writer? | Grep `src/main/` for `cost_events` writers; check `db.ts` migration history. | Phase 1 row `F-t3-db-6`/`F-t3-model-3` |
| Q5: Are pipeline `agent_events` ever read after task completion, or only live-tailed? | Grep `src/main/` and `src/renderer/` for `agent_events` SELECT queries; trace event-load callsites. | Phase 2 row `F-t1-sre-1`/`F-t3-model-2` (retention aggressiveness) |
| Q6: Is `sprint_tasks.max_cost_usd` ever read? | Grep for `max_cost_usd` references in `src/main/`. | Phase 6 row `F-t4-cost-5` (enforce vs drop the column) |

**Soft gates — answer when convenient, do not block execution:**

| Question | Method | Affects (severity tuning only) |
|---|---|---|
| Q1: Are the 128 zero-input agent runs cache hits or silent failures? | Query `agent_runs WHERE tokens_in IS NULL OR tokens_in = 0` joined to `agent_events` to see if real work happened. | Phase 6 row `F-t4-cost-4` (becomes a reliability bug if failures, becomes a deferred item if cache hits) |
| Q3: What is the actual `MAX_ACTIVE_TASKS` setting in production? | Read from snapshot `settings` table or live config. | Severity of `F-t1-concur-1`/`-2`/`-3`/`-5` — collapses several Highs to Lows if N=1, doesn't change the work shape |
| Q4: Real SQLite write latency at single-agent baseline | Optional micro-benchmark on the snapshot db; skip if too expensive. | `F-t1-concur-2` priority confirmation |

**Cold-start baseline (added by review):** Capture renderer cold-start time-to-first-render before Phase 5 starts, so the bundle improvements have a measurable delta. Method: launch the app from a kill state, log a timestamp at `main.tsx` entry and at first `App.tsx` render, record both. Save to PHASE-0-ANSWERS.md.

**Phase-0 cleanup rule:** If a soft-gate answer collapses a finding's severity to Low *and* the finding is now negative-ROI, move it to the deferred list with the new reason. Don't silently drop it.

**Mandatory Phase 0 invocation:** Phase 0 hard gates must be answered before starting any phase whose hard-gated row would otherwise be skipped. **Phases 3, 4, 5 have no hard gates** — they can run immediately after Phase 2. Phases 1, 2, 6 each have one hard-gated row that depends on a specific Phase 0 answer (Q2, Q5, Q6 respectively). Other rows in those phases can run before Phase 0 finishes.

#### Phase 1 — Data Layer Quick Wins (8 work items, 9 IDs)

**Risk:** Low. Pure DDL + small query rewrites in `src/main/data/` and `src/main/db.ts`.

| Finding | Title | File |
|---|---|---|
| `F-t3-db-1` | PR composite index `(pr_status, pr_number)` | `src/main/data/sprint-queries.ts:788-809` |
| `F-t3-db-3` | Composite `(status, claimed_by)` index | `src/main/db.ts` (new migration) |
| `F-t3-db-7` | `task_changes(task_id, changed_at DESC)` composite | `src/main/data/task-changes.ts:64-70` |
| `F-t3-db-6` / `F-t3-model-3` | `cost_events` decision (drop or wire) — **HARD GATE on Phase 0 Q2** | `src/main/db.ts` and/or wherever the writer would live |
| `F-t3-model-1` | Skip unchanged-field writes in `recordTaskChanges` | `src/main/data/task-changes.ts:19-53` |
| `F-t3-db-2` | `listTasksRecent` OR-clause fix | `src/main/data/sprint-queries.ts` |
| `F-t3-db-4` | Batch loop-based audit inserts in `markTaskDoneByPrNumber` | `src/main/data/sprint-queries.ts` |
| `F-t3-db-5` | Replace `SELECT *` with targeted column lists on hot reads | `src/main/data/sprint-queries.ts` (especially `listTasksRecent`, `listTasksWithOpenPrs`) |

**Verification per finding:**
- For new indexes: `EXPLAIN QUERY PLAN` against the snapshot before and after, show `USING INDEX` line
- For `recordTaskChanges`: count `task_changes` row delta on a representative status loop
- For `listTasksRecent`: `EXPLAIN QUERY PLAN` shows index usage instead of `SCAN`

#### Phase 2 — Pipeline Hot Path (9 work items, 10 IDs)

**Risk:** High. Touches the running drain loop and event mapper. Regression risk on agent throughput.

| Finding | Title | File |
|---|---|---|
| `F-t1-concur-6` | Reverse broadcast/write order in `emitAgentEvent` | `src/main/agent-event-mapper.ts:83-95` |
| `F-t1-concur-2` | Batch `agent_events` writes (50-event/100ms transactions) | `src/main/agent-event-mapper.ts` |
| `F-t1-sre-1` / `F-t3-model-2` | Cap `agent_events` retention (per-task pruning) — **HARD GATE on Phase 0 Q5** | `src/main/agent-manager/completion.ts` and/or DB cleanup path |
| `F-t1-sysprof-1` / `F-t1-sysprof-4` | Cache `_depsEqual` comparison, kill sort thrash | `src/main/agent-manager/index.ts:608-625` |
| `F-t1-sysprof-2` | Defer `JSON.stringify` in event hot loop | `src/main/agent-event-mapper.ts` |
| `F-t1-concur-1` | Coalesce broadcast IPC fan-out per task terminal | `src/main/agent-manager/completion.ts` |
| `F-t1-concur-3` | Coalesce `resolveDependents` cascade | `src/main/agent-manager/resolve-dependents.ts` |
| `F-t1-concur-4` | Fix race between task claim and dependency check | `src/main/agent-manager/index.ts` (drain loop, `taskStatusMap` build) |
| `F-t1-concur-5` | PR poller + sprint-PR poller DB contention | `src/main/pr-poller.ts`, `src/main/sprint-pr-poller.ts` |

**Verification per finding:**
- For batching: count SQLite writes per agent run before/after, confirm count drops by ≥10×
- For sort thrash: add a counter on `_depsEqual` calls, confirm post-fix runs hit the fast path on unchanged ticks
- For broadcast coalescing: count IPC messages per task terminal before/after
- **Synthetic 3-agent pipeline test:** This test does not yet exist. **Building it is the first task of Phase 2.** Spec: spawn 3 trivial sprint tasks (each a no-op like "echo hello > /tmp/x"), let them run through the pipeline to completion, capture timing + SQLite write count + IPC message count + peak memory. Pass criterion: all 3 tasks reach `done` status without error within 5 minutes. Save the script at `scripts/perf-pipeline-smoke.sh` (or similar) for reuse on subsequent commits in this phase.

#### Phase 3 — SRE / Resource Hygiene (7 findings)

**Risk:** Low–Medium. Bounded-resource leaks; mostly mechanical fixes.

| Finding | Title | File |
|---|---|---|
| `F-t1-sre-2` | `setMaxListeners` on child stderr | `src/main/agent-manager/sdk-adapter.ts` (or wherever `child.spawn` happens) |
| `F-t1-sre-3` / `F-t1-concur-8` | Prune settled `_agentPromises` | `src/main/agent-manager/index.ts` |
| `F-t1-sre-4` | Simplify PR poller backoff timer | `src/main/pr-poller.ts` |
| `F-t1-sre-6` | TTL eviction on `_lastTaskDeps` | `src/main/agent-manager/dependency-index.ts` |
| `F-t1-sre-5` | Worktree disk reservation under concurrency | `src/main/agent-manager/worktree.ts` |
| `F-t1-sysprof-5` | OAuth token cache with TTL | `src/main/auth-guard.ts` or wherever `checkOAuthToken` lives |
| `F-t1-sysprof-3` | `getUserMemory` mtime cache | `src/main/agent-system/memory/index.ts` |

**Verification per finding:**
- For leak fixes: log the resource size at startup and after a 3-task simulated run, confirm no growth
- For caches: log cache hit/miss ratio over 10 calls

#### Phase 4 — Renderer Performance (7 findings)

**Risk:** Medium. UI regression risk; React behavior changes can be subtle.

| Finding | Title | File |
|---|---|---|
| `F-t2-react-1` | **SprintPipeline `useShallow` consolidation** ← Critical | `src/renderer/src/components/sprint/SprintPipeline.tsx:73-85` |
| `F-t2-react-3` | Decouple Dashboard `now` ticker | `src/renderer/src/views/DashboardView.tsx` |
| `F-t2-react-2` | `useDashboardMetrics` `now` dependency | `src/renderer/src/components/dashboard/` |
| `F-t2-react-4` | `useSprintPolling` `.some()` re-scan | `src/renderer/src/stores/sprintTasks.ts` or polling hook |
| `F-t2-react-5` | TaskRow callback identity | `src/renderer/src/components/sprint/PipelineStage.tsx` |
| `F-t2-react-6` | ActivitySection callback identity | `src/renderer/src/components/dashboard/ActivitySection.tsx` |
| `F-t2-react-7` | `useVisibilityAwareInterval` for inactive tasks | `src/renderer/src/components/sprint/TaskPill.tsx` |

**Verification per finding:**
- Add `console.count` in the affected component's render body in dev mode. Capture render count for a fixed user-flow (e.g. "click 5 task pills in 5s"). Pass criterion: post-fix count is **at least 30% lower** than pre-fix for the same flow. Log both numbers in the commit message body.
- Manual smoke: open Sprint Pipeline + Dashboard simultaneously, click 5 different task pills, switch tabs once, confirm no visual regression.
- Run `npm run test` for any updated component tests.

#### Phase 5 — Bundle / Asset (6 findings)

**Risk:** Low–Medium. Build config changes can break dev/prod parity.

| Finding | Title | File |
|---|---|---|
| `F-t2-bundle-1` / `F-t2-bundle-6` | xterm + TerminalPane `React.lazy` + Suspense | `src/renderer/src/components/terminal/` |
| `F-t2-bundle-2` | Lazy view CSS imports | `src/renderer/src/main.css`, view-specific CSS files |
| `F-t2-bundle-3` | Monaco worker config | wherever Monaco is set up |
| `F-t2-bundle-4` | View preload on hover | view registry / panel system |
| `F-t2-bundle-5` | App.tsx top-level fan-out | `src/renderer/src/App.tsx` |
| `F-t2-bundle-8` | Confirm SDK marked external | `electron.vite.config.ts` |

**Verification per finding:**
- Run `npm run build` and inspect chunk sizes in `dist/`. Pass criterion: total renderer bundle gzipped is **at least 100KB smaller** than the Phase 0 baseline, OR the specific finding's targeted chunk shrinks measurably.
- **Cold-start measurement** uses the baseline captured in Phase 0. Re-measure after each Phase 5 commit; pass criterion is improvement vs that baseline.
- Confirm IDE view still works: open a file, edit a line, save, open the terminal, run a command, close.

#### Phase 6 — Token Economy (13 work items, 17 IDs)

**Risk:** Medium. Prompt changes can subtly degrade agent behavior. Heavy regression testing.

| Finding | Title | File |
|---|---|---|
| `F-t4-ctx-1` / `F-t4-prompt-2` | Flip `isBdeRepo` default to false | `src/main/agent-system/memory/index.ts:17-25` |
| `F-t4-ctx-2` / `F-t4-prompt-4` / `F-t4-ctx-9` | Build lazy-inject infrastructure + lazy-load skills (front-load index, defer details). The `ctx-9` "no lazy-inject mechanism exists" finding is the architectural enabler — implementing skill lazy-load *is* the mechanism. | `src/main/agent-manager/prompt-composer.ts:265-268`, `src/main/agent-system/skills/index.ts` |
| `F-t4-prompt-3` | Trim copilot `SPEC_DRAFTING_PREAMBLE` | `src/main/agent-manager/prompt-composer.ts` |
| `F-t4-prompt-7` / `F-t4-ctx-3` | Cap `taskContent` at 2000 chars | `src/main/agent-manager/prompt-composer.ts` |
| `F-t4-ctx-4` | Document/justify upstream context diff cap (2000 chars) and add inline rationale | wherever upstream context diffs are built |
| `F-t4-ctx-5` | Cap copilot conversation history | wherever copilot history is composed |
| `F-t4-ctx-7` | Add compression strategy (summarization / dedup) for upstream context payloads | wherever upstream context is built |
| `F-t4-prompt-1` / `F-t4-ctx-10` | Decouple CLAUDE.md per agent type — spec-drafting agents should NOT inherit coding-specific context | `src/main/agent-manager/prompt-composer.ts` |
| `F-t4-cost-1` / `F-t4-cost-3` | Per-class output caps + categorize tasks by class | spec generation + agent prompts |
| `F-t4-cost-2` | Investigate success-tail dominance — explore early-exit / review-only mode for tasks where full code generation is unnecessary | agent prompts, task class definition |
| `F-t4-cost-4` | Resolve zero-input-cohort mystery (depends on Phase 0 Q1 outcome). If silent failures: fix the failure path. If cache hits: document and celebrate. | depends on Phase 0 Q1 |
| `F-t4-cost-5` | Enforce `sprint_tasks.max_cost_usd` — **HARD GATE on Phase 0 Q6** (only if column is currently unread) | `src/main/agent-manager/run-agent.ts` or wherever cost is checked |

**Verification per finding:**
- **Pinned regression task:** Before Phase 6 starts, pin one specific real sprint task ID from the snapshot db (preferably a recent simple `done` task with `tokens_in` around the p50) as the regression target. Re-run that task (or a copy) after each Phase 6 commit and capture `tokens_in` from the resulting `agent_runs` row. Pass criterion: token count drops by the *expected magnitude* documented per-finding (e.g. `F-t4-ctx-1` should drop ~978 tokens; `F-t4-ctx-2` should drop ~2,600 tokens for non-skill-using runs).
- **Spec each fix's expected delta in the commit message** so future audits can verify it landed.
- For output caps: dispatch a known generation-heavy task and confirm the cap fires (and the resulting code is still functional).
- **Hard rule:** if a fix saves tokens but the pinned regression task fails or produces visibly worse output, **revert and document why**. Token savings are not worth task failure.

### Phase Dependencies (hard, not "ideally")

Only hard dependencies are listed. "Ideally precedes" is not a dependency — phases without arrows below can run in any order.

```
Phase 0 hard gates:
  ├─ Q2 (cost_events) → required before Phase 1 row F-t3-db-6
  ├─ Q5 (events read?) → required before Phase 2 row F-t1-sre-1
  └─ Q6 (max_cost_usd read?) → required before Phase 6 row F-t4-cost-5

Phase ordering:
  Phase 1, 2, 3, 4, 5, 6 have NO hard inter-phase dependencies.
  They are sequenced 1→6 by risk (lowest first) and code-area locality
  (data → pipeline → resource hygiene → renderer → bundle → prompts),
  not by causal requirement.
```

**Sequencing rationale (not a dependency):** Running Phase 1 before Phase 2 means the drain-loop changes in Phase 2 land on top of cleaner DB query patterns, which makes Phase 2 verification easier (fewer SQLite writes to count when measuring `agent_events` batching). Similarly, Phase 2 before Phase 3 means the new event batching is in place before SRE leak fixes touch the same code. Neither is a hard requirement; an executor can run Phase 4, 5, or 6 first if local context favors it.

### Cross-Phase Conventions

- **Branch:** Continue on existing branch `chore/perf-audit-2026-04-07` at `~/worktrees/bde/perf-audit`. No new branches per phase.
- **Commit format:** One commit per finding. Message: `fix(perf): F-tX-name-N — <short title>`. Body explains the before/after and links the finding ID.
- **Pre-commit checks (per CLAUDE.md):** Every commit must pass `npm run typecheck && npm test && npm run lint`. Failing checks → fix or revert, never commit broken state.
- **TDD where it fits:** Pure logic changes (e.g. `_depsEqual`, dedup helpers, cap functions) get a failing test first. UI re-render fixes get a render counter assertion if practical, otherwise manual verification with a recorded check. DDL migrations get an `EXPLAIN QUERY PLAN` snapshot check.
- **Resumability — phase granularity:** This spec is *the durable artifact*. Per-finding checkboxes live in the implementation plan that `superpowers:writing-plans` will produce — that plan, not this spec, is the resume target. A new session loads the plan, scans `git log` for the last `chore(perf): phase N complete` boundary commit, identifies the next unchecked task in the plan, and resumes from there. **Resumption granularity is per-finding (within the implementation plan), per-phase (via the boundary commits in `git log`).** Mid-finding interruption is possible — in that case the new session re-runs the verification step for the in-progress finding before continuing.
- **Phase boundary commits:** At the end of each phase, a doc commit marks the boundary: `chore(perf): phase N complete — N findings landed`. The doc commit either updates this spec's status section (if added later) or appends a one-line entry to PHASE-0-ANSWERS.md noting which phase finished. This makes resumption obvious in `git log`.
- **Verification artifacts:** Where a finding has a measurable before/after (query plan, render count, bundle size), capture both in the commit message body.

## Deferred Findings (15)

Each finding is documented with a reason so future audits don't re-discover it as "missed work."

| ID | Reason for deferral |
|---|---|
| `F-t2-react-8` | Score 0.75 — premature for 525-row dataset; revisit at 5K+ tasks |
| `F-t4-prompt-5` / `F-t4-ctx-6` | Score 1.0 — ~$0.01/mo savings, defer to docs reorg |
| `F-t4-prompt-6` | Score 1.0 — ~$0.18/mo, personality consolidation is style not perf |
| `F-t4-prompt-8` | Score 1.0 — diff cap audit blocked on usage telemetry |
| `F-t4-prompt-9` | Score 0.5 — naming clarity, no perf impact |
| `F-t4-prompt-10` | Score 1.0 — UX nit |
| `F-t4-ctx-8` | Score 2.0 — pipeline 900-token tax is necessary overhead (judgment rules + DoD); not waste, just cost |
| `F-t2-bundle-9` | Score 0.25 — CSS Modules migration (L) too speculative |
| `F-t2-bundle-7` | Score 1.0 — verify-only task, low payoff |
| `F-t3-model-5` | Score 1.0 — file watcher debounce, speculative; no observed missed events |
| `F-t3-model-6` | Score 1.0 — `spec` column externalization is Low/Low; defer until any list query becomes a perf problem |
| `F-t3-model-7` | Score 1.0 — JSON blob size limits, no observed bloat in production |
| `F-t1-sysprof-6` | Score 0.5 — retry-only optimization, low frequency |
| `F-t3-model-4` | Score 0.5 — `depends_on` relational migration is L effort, only 106 rows; revisit when graph depth grows |
| `F-t1-concur-7` | Synthesis-confirmed duplicate of `F-t1-sysprof-1`/`-4` — folded into Phase 2 commit (no separate work) |

`F-t1-sre-6` (`_lastTaskDeps` no shrink) and `F-t1-concur-8` (settled `_agentPromises` pruning) appear in the synthesis Score Table at scores 2.0 and 1.0 respectively. The synthesis itself put both in Phase 3 work via the dup with `F-t1-sre-3`. They land in Phase 3 as quick mechanical fixes — listed there, not here.

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Phase 2 (pipeline) regression breaks running agents in production | Run a synthetic 3-agent pipeline test after each Phase 2 commit. Revert immediately on failure. |
| Phase 6 prompt changes degrade agent task success rate | Spot-check prompts before/after with a sample task. If the fix saves tokens but the agent fails the task, revert. |
| Session ends mid-phase | The per-finding checklist + per-phase boundary commits make resumption obvious. The next session reads this spec, scans `git log` for the last `chore(perf): phase N complete` marker, and resumes from there. |
| A Phase 0 answer invalidates a downstream finding | The Phase 0 doc records the rationale. Affected findings move to the deferred list with the new reason. |
| Cumulative test runtime grows and slows iteration | Each commit runs the full suite. If runtime becomes painful, opt into `npm run test` (skip coverage) per-commit and run `npm run test:coverage` at phase boundaries only. |
| Merge conflicts with `main` if the audit branch lives long | Phases 4, 5 touch frequently-edited files (`App.tsx`, build config). At each phase boundary, **merge `main` into the audit branch** (do not rebase — rebasing 50+ commits across phases cascades conflict resolution). Better still: land each completed phase as its own PR to `main` so the audit branch stays short. |
| Reverification work on session resume | If a session ends mid-finding, the new session re-runs the verification step for that finding before continuing. The implementation plan checkbox tracks per-finding state; phase boundary commits provide the coarse marker. |

## Success Criteria

- 55 work items landed as commits on `chore/perf-audit-2026-04-07` (covering 61 distinct finding IDs through dedup folding), each with a passing test suite at the time of commit.
- 15 deferred findings documented in this spec with reasons. The remaining 6 finding IDs are dedup pairs whose canonical entries are in phase tables.
- Phase 0 doc exists at `docs/superpowers/audits/2026-04-07/perf-audit/PHASE-0-ANSWERS.md` with answers to all 3 hard-gate questions and the cold-start baseline.
- Six `chore(perf): phase N complete` boundary commits in `git log`.
- **Measured improvements with before/after numbers** captured in commit messages for at least:
  - Phase 1: query plan changes from `SCAN` to `USING INDEX` for at least the 3 new indexes
  - Phase 2: SQLite write count per agent run drops by ≥10× (from event batching)
  - Phase 4: SprintPipeline render count for the pinned interaction drops ≥30%
  - Phase 5: cold-start time to first render improves vs the Phase 0 baseline
  - Phase 6: pinned regression task `tokens_in` drops by the documented per-finding magnitude
- The branch is mergeable to `main` with no broken tests.

## Out of Scope

- Re-running the audit or adding new findings.
- Refactoring beyond what each finding's recommendation requires.
- Improving UI design / UX beyond performance characteristics.
- Updating dependencies (unless a dep update is the recommended fix).
- E2E benchmarks beyond the per-phase verification described above.

## Next Step

Invoke `superpowers:writing-plans` to turn each phase into a checklist of bite-sized implementation tasks with exact commands, expected outputs, and per-finding TDD steps where applicable. The plan is what an executor (subagent or this session) will work from task by task.
