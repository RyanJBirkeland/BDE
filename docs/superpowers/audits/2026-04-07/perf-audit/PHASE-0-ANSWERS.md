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

**Method:**

**Findings:**

**Decision:**

---

### Q5: Are pipeline `agent_events` ever read after task completion?
*Affects: Phase 2 row F-t1-sre-1 / F-t3-model-2 (retention strategy)*

**Method:**

**Findings:**

**Decision (retention strategy):**

---

### Q6: Is `sprint_tasks.max_cost_usd` ever read?
*Affects: Phase 6 row F-t4-cost-5*

**Method:**

**Findings:**

**Decision (enforce or drop):**

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
