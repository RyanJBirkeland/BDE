# Phase 0 Answers — Perf Audit Execution

**Started:** 2026-04-08T01:42:00Z (approximately — orchestrator session)
**Plan:** `docs/superpowers/plans/2026-04-07-perf-audit-execution.md`
**Spec:** `docs/superpowers/specs/2026-04-07-perf-audit-execution-design.md`
**Synthesis:** `docs/superpowers/audits/2026-04-07/perf-audit/SYNTHESIS.md`

This is the cross-phase scratchpad. Append baselines, decisions, and pinned task IDs as you go. Survives session boundaries.

---

## Hard gates

### Q2: Why is `cost_events` empty after 31K agent events?
*Affects: Phase 1 row F-t3-db-6 / F-t3-model-3*

**Method:** `Grep cost_events|cost_event|CostEvent|costEvent` across `src/`. Then `Grep FROM cost_events` to find readers. Then a broader glob to confirm no other extensions.

**Findings:**

Only 3 files reference `cost_events` in the entire codebase:

1. **`src/main/db.ts:153-167`** — migration v4 creates the table. That's the only schema reference.
2. **`src/main/__tests__/db.test.ts:100, 176, 178, 188, 190, 192`** — migration test verifies that v4 creates the table. Tests structure only, doesn't use it.
3. **`src/main/__tests__/integration/db-crud.test.ts:152-183`** — a `cost_events CRUD` test that INSERTs and SELECTs against the table directly. This is the *only* INSERT in the codebase, and it's only run in tests.

**Zero production writers. Zero production readers.** The table was created in migration v4 (very early — likely before the cost-tracking feature was scoped) and never wired up. The actual cost tracking happens in `agent_runs` (`tokens_in`, `tokens_out`, `cache_read`, `cache_create`, `cost_usd`, `duration_ms`, `num_turns`) which is populated by the SDK adapter.

**Decision:** **DROP the table** (Phase 1 Task 1.4 Option A). The CRUD tests in `db-crud.test.ts:152-183` and the migration verification in `db.test.ts:100, 176-192` must be removed/updated as part of the same commit. The drop migration will be the next available version (v35 or v36 depending on what other Phase 1 migrations land first).

---

### Q5: Are pipeline `agent_events` ever read after task completion?
*Affects: Phase 2 row F-t1-sre-1 / F-t3-model-2 (retention strategy)*

**Method:** `Grep FROM agent_events|from agent_events` then trace `getEventHistory`/`pruneOldEvents` callsites.

**Findings — production read sites (3):**

1. **`src/main/handlers/dashboard-handlers.ts:49`** — Dashboard activity feed reads agent_events JOINed to agent_runs and sprint_tasks. Post-completion read (Dashboard shows recent activity from completed agents).
2. **`src/main/data/event-queries.ts:21`** — `getEventHistory(agentId)` SELECTs full payload list for one agent ordered by timestamp. Used by agent console replay.
3. **`src/main/handlers/agent-handlers.ts:83-85`** — IPC handler `agent:getHistory` calls `getEventHistory`. Renderer-driven replay of historical agent runs.

**Existing pruning infrastructure (already wired):**

- `src/main/data/event-queries.ts:25-27` — `pruneOldEvents(db, retentionDays)` deletes events older than N days.
- `src/main/index.ts:156, 162` — pruning runs at startup AND every 24 hours via `setInterval`.
- `src/main/config.ts:7-9` — retention is configurable via `agent.eventRetentionDays` setting; **default is 30 days.**
- `event-queries.ts:131, 135` — also has bulk-delete-by-agent-ids for when agents themselves are pruned.

**Decision (retention strategy):** **Hybrid — conservative default + per-task tail trim.**

Phase 2 Task 2.3 should:
1. **Keep the existing 30-day global prune** (it works, leave it alone). Maybe lower the default to 14 days as a separate decision in Phase 0 Q3.
2. **Add per-task tail trim on agent termination** — when an agent reaches `done`/`failed`/`cancelled`, immediately delete its agent_events older than 1 hour. Rationale: live-tail readers no longer need them after termination, and the Dashboard activity feed pulls from the most recent rows anyway (it doesn't need 30 days of old terminated agents). This is the audit's actual finding from `F-t1-sre-1` — per-task cleanup, not global.
3. **Cap per-agent event count at 5,000** as a safety valve for runaway agents (the audit notes a current ~63 events/agent average; 5K is 80× the average).

This is **Option B** in the plan's Task 2.3 (conservative retention) **plus a per-task termination trim**.

---

### Q6: Is `sprint_tasks.max_cost_usd` ever read?
*Affects: Phase 6 row F-t4-cost-5*

**Method:** `Grep max_cost_usd|maxCostUsd|maxCostUSD` across `src/`. Trace each match to determine read/write/enforce status.

**Findings — IT IS ALREADY ENFORCED:**

- **`src/main/agent-manager/watchdog.ts:20`** — the watchdog returns `'cost-budget-exceeded'` when `agent.costUsd >= agent.maxCostUsd`. This runs on every health check tick.
- **`src/main/agent-manager/index.ts:181`** — produces a user-facing error message when budget is exceeded: *"Agent exceeded the cost budget (max_cost_usd). The task consumed more API credits than allowed."*
- **`src/main/agent-manager/run-agent.ts:349`** — `maxCostUsd: task.max_cost_usd ?? null` plumbs the task field into the agent runtime config.
- **`src/main/agent-manager/types.ts:66`** — `maxCostUsd: number | null` is part of the agent's runtime type.
- **`src/main/agent-manager/__tests__/watchdog.test.ts:111-149`** — 4 tests covering the enforcement logic (meets, exceeds, below, null).
- **`src/renderer/src/components/task-workbench/WorkbenchForm.tsx:477-479`** — Task Workbench UI exposes the field for user input.
- **`src/main/data/sprint-queries.ts`** — column read in 14 SELECT statements across the file (every query that returns a SprintTask reads it).

**Decision (enforce or drop):** **DONE — already enforced.** Phase 6 Task 6.12 should be marked complete with a doc-only commit (no code change). The audit's `F-t4-cost-5` finding was based on incomplete grep — the column IS wired, the watchdog DOES enforce it. The synthesis ranked this as Med/Med (score 4.5) which made sense if it was unenforced; reality is **closed/no-op** and it should drop off the Phase 6 worklist.

---

## Soft gates

### Q1: Are 128 zero-input agent runs cache hits or silent failures?
*Affects: F-t4-cost-4 severity*

**Method:**

**Findings:**

**Severity adjustment:**

---

### Q3: Actual MAX_ACTIVE_TASKS in production?
*Affects: F-t1-concur-1 / -2 / -3 / -5 severity tuning*

**Method:**

**Findings:**

**Severity adjustment:**

---

### Q4: SQLite write latency at single-agent baseline (optional)
*Affects: F-t1-concur-2 priority confirmation*

**Method:**

**Findings:**

---

## Cold-start baseline (for Phase 5)

**Method:**

**Measurements:**

| Run | main.tsx entry → first App.tsx render (ms) |
|-----|---------------------------------------------|
| 1   |                                             |
| 2   |                                             |
| 3   |                                             |
| **median** |                                      |

---

## Phase 2 baseline (perf-pipeline-smoke before changes)

*To be filled in by Task 2.0 after the smoke test runs.*

---

## Phase 6 regression task

*To be pinned by Task 6.0 — a real done sprint task with mid-range tokens_in.*
