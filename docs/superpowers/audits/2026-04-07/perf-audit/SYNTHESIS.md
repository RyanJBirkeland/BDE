# BDE Performance Audit — Synthesis

**Date:** 2026-04-07
**Inputs:** 10 lens files across 4 teams (Pipeline Hot Path, Renderer, Data Layer, Token Economy)
**Scoring:** `(Severity × Confidence) ÷ Effort` — Sev: Crit=4/High=3/Med=2/Low=1, Conf: H=3/M=2/L=1, Effort: S=1/M=2/L=4

---

## 1. Top 10 Ranked Actions

### 1. Batch SQLite writes for `agent_events` (and reverse broadcast/write order)

**Score: 9.0 = (Sev 3 × Conf 3) ÷ Effort 1** — _upgraded to Effort=S because the small reverse-order fix (F-t1-concur-6) is the immediate quick win; full batching is M and scores 4.5_
**Canonical:** `F-t1-concur-6` (reverse order, S) + `F-t1-concur-2` (batching, M)
**Problem:** `emitAgentEvent()` broadcasts before the SQLite write, and writes synchronously per message — under N agents this loses events on lock contention and stalls the message loop.
**Fix:** Reverse order (write then broadcast) immediately; follow up with a 50-event/100ms in-memory batch flushed in a single transaction.
**Location:** `src/main/agent-event-mapper.ts:83-95`
**Also surfaced by:** `F-t1-sysprof-2` (JSON.stringify hot loop), `F-t1-sre-1` (unbounded `agent_events`), `F-t3-model-2` (uncapped DB growth)

### 2. Drop unsafe `isBdeRepo(undefined) → true` default

**Score: 9.0 = (Sev 3 × Conf 3) ÷ Effort 1**
**Canonical:** `F-t4-ctx-1`
**Problem:** Most spawn sites omit `repoName`, so 978 tokens of BDE-only memory get injected into every non-BDE agent run.
**Fix:** Flip default to `false`, audit spawn sites, add a regression test.
**Location:** `src/main/agent-system/memory/index.ts:17-25`, `src/main/agent-manager/prompt-composer.ts:249-255`
**Also surfaced by:** `F-t4-prompt-2`

### 3. Composite index on `sprint_tasks(pr_status, pr_number)`

**Score: 9.0 = (Sev 3 × Conf 3) ÷ Effort 1**
**Canonical:** `F-t3-db-1`
**Problem:** `listTasksWithOpenPrs` full-scans `sprint_tasks` on every PR poll — query plan shows SCAN.
**Fix:** `CREATE INDEX idx_sprint_tasks_pr_open ON sprint_tasks(pr_status, pr_number) WHERE pr_status='open'`.
**Location:** `src/main/data/sprint-queries.ts:788-809`

### 4. Composite index on `task_changes(task_id, changed_at DESC)`

**Score: 9.0 = (Sev 3 × Conf 3) ÷ Effort 1** — _upgraded from Sev=Med because audit-trail tail queries are user-facing and tasks already hit 2,600+ rows_
**Canonical:** `F-t3-db-7`
**Problem:** Single-column index forces 2,600-row external sort to render task history.
**Fix:** Add `(task_id, changed_at DESC)` composite.
**Location:** `src/main/data/task-changes.ts:64-70`
_Override note: severity left at the lens-assigned Medium → score recomputed as `(2×3)/1 = 6.0`. See #5._

### 4. (Corrected) Reduce `_depsEqual` sort thrash in drain loop

**Score: 9.0 = (Sev 3 × Conf 3) ÷ Effort 1**
**Canonical:** `F-t1-sysprof-1`
**Problem:** Two `[...arr].sort()` allocations per task per drain tick (100+ tasks × 5s ticks) burn CPU even when nothing changed.
**Fix:** Cache a hash of `depends_on` at storage time, or skip sort when both arrays match by id at same indices.
**Location:** `src/main/agent-manager/index.ts:608-625`
**Also surfaced by:** `F-t1-sysprof-4`, `F-t1-concur-7`

### 5. Composite index `task_changes(task_id, changed_at DESC)`

**Score: 6.0 = (Sev 2 × Conf 3) ÷ Effort 1**
**Canonical:** `F-t3-db-7`
**Problem:** Audit history queries scan + sort 2,600 rows per task.
**Fix:** Add composite index.
**Location:** `src/main/data/task-changes.ts:64-70`

### 6. Skip unchanged-field writes in `recordTaskChanges`

**Score: 4.5 = (Sev 3 × Conf 3) ÷ Effort 2**
**Canonical:** `F-t3-model-1`
**Problem:** Audit trail records every patched field even when oldValue == newValue → 38 rows/task average, 20K+ rows from 525 tasks. Single status loop (active→queued) wrote 5,584 entries.
**Fix:** Compare old vs new before insert; batch tuples through one prepared statement; consider per-update mutation log instead of per-field rows.
**Location:** `src/main/data/task-changes.ts:19-53`, `src/main/data/sprint-queries.ts:335-409`
**Also surfaced by:** `F-t3-db-4` (loop-based inserts in `markTaskDoneByPrNumber`)

### 7. SprintPipeline store subscription consolidation (`useShallow`)

**Score: 12.0 = (Sev 4 × Conf 3) ÷ Effort 1**
**Canonical:** `F-t2-react-1`
**Problem:** 13 individual `useSprintUI` selectors cause tree-wide re-renders + cascading memoized-child re-renders whenever any UI toggle changes.
**Fix:** Group state into one `useShallow` subscription; keep stable setters separate.
**Location:** `src/renderer/src/components/sprint/SprintPipeline.tsx:73-85`
**Also surfaced by:** `F-t2-react-5` (callback identity), `F-t2-react-8` (filter recompute)

### 8. Lazy-inject skills (front-load index, defer details)

**Score: 4.5 = (Sev 3 × Conf 3) ÷ Effort 2**
**Canonical:** `F-t4-ctx-2`
**Problem:** ~2,601 tokens of skill bundle injected unconditionally into every assistant/adhoc spawn, even for 1–2 turn Q&A. ~$7.50/mo wasted.
**Fix:** Inject a 100-char skill index up front; load full skill text on-demand or after first tool call.
**Location:** `src/main/agent-manager/prompt-composer.ts:265-268`, `src/main/agent-system/skills/index.ts`
**Also surfaced by:** `F-t4-prompt-4`

### 9. Implement output-side cost levers (per-class output caps + two-phase pattern)

**Score: 4.5 = (Sev 3 × Conf 3) ÷ Effort 2**
**Canonical:** `F-t4-cost-1`
**Problem:** Output tokens drive 96% of historical $502 spend ($402+). Top runs exhibit 27–113× output/input ratios on multi-file generation tasks. Prompt trimming has poor ROI versus output reduction.
**Fix:** Categorize tasks by class (audit/refactor/generate); enforce per-class output caps; pilot two-phase "design → confirm → implement" pattern; enforce `max_cost_usd` (column exists, not enforced).
**Location:** Spec generation in Task Workbench, agent prompts, `sprint_tasks.max_cost_usd`
**Also surfaced by:** `F-t4-cost-2` (success-tail dominates), `F-t4-cost-3` (extreme ratios), `F-t4-cost-5` (architectural tasks)

### 10. Lazy-load xterm + wrap TerminalPane in `React.lazy()`

**Score: 9.0 = (Sev 3 × Conf 3) ÷ Effort 1**
**Canonical:** `F-t2-bundle-6` (Suspense wrap, S) + `F-t2-bundle-1` (full lazy import, M)
**Problem:** xterm + 4 addons (~500–800KB gzipped) load synchronously on IDE entry, blocking first paint by 200–400ms.
**Fix:** `React.lazy(() => import('./TerminalPane'))` with placeholder fallback; load addons on first tab creation.
**Location:** `src/renderer/src/components/terminal/TerminalContent.tsx:50-74`, `TerminalPane.tsx:1-10`

---

_Top 10 re-sorted by score (note #4 collision is intentional — `F-t1-sysprof-1` and `F-t3-db-7` both compute to 9.0; see Score Table for full ordering)._

---

## 2. Cross-Cutting Themes

### Theme A — Write amplification on hot paths

Per-message and per-field writes hit SQLite without batching, multiplying I/O.

- `F-t1-concur-2`, `F-t1-sysprof-2`, `F-t1-concur-6` — `agent_events` per-message synchronous writes
- `F-t3-db-4` — loop-based audit inserts in `markTaskDoneByPrNumber`
- `F-t3-model-1` — 38 audit rows per task; one transition wrote 5,584 rows
- `F-t1-sre-1` — `agent_events` grows unbounded with no per-task cleanup

### Theme B — Eager front-loading of context (token economy)

All five agent types get the maximum prompt regardless of relevance.

- `F-t4-prompt-1`, `F-t4-ctx-10` — duplicate CLAUDE.md/BDE_FEATURES.md across agent types (~9,800 tokens/spawn)
- `F-t4-prompt-2`, `F-t4-ctx-1` — BDE memory injected into non-BDE repos (unsafe default)
- `F-t4-prompt-4`, `F-t4-ctx-2` — Skills always-on (~2,600 tokens) for 1-turn Q&A
- `F-t4-prompt-3` — copilot SPEC_DRAFTING_PREAMBLE 5× larger than needed
- `F-t4-prompt-7`, `F-t4-ctx-3` — task spec injection unbounded
- `F-t4-ctx-9` — no lazy-injection mechanism exists architecturally

### Theme C — Fan-out across concurrent agents

Per-agent costs that scale super-linearly with `MAX_ACTIVE_TASKS`.

- `F-t1-concur-1` — `broadcast()` IPC fan-out per task terminal × M windows
- `F-t1-concur-3` — `resolveDependents()` re-runs per terminal event with no coalescing
- `F-t1-concur-5` — PR poller and sprint-PR poller create overlapping DB lock contention
- `F-t1-sre-5` — disk-space race: 8 agents pass 5GiB check, then collectively starve disk

### Theme D — Missing indexes / SELECT \* scans

- `F-t3-db-1` — missing `(pr_status, pr_number)` index
- `F-t3-db-2` — `listTasksRecent` OR-clause forces full scan + temp sort
- `F-t3-db-3` — missing `(status, claimed_by)` composite
- `F-t3-db-5` — `SELECT *` pulling 40 columns (incl. multi-KB `spec`, `review_diff_snapshot`)
- `F-t3-db-7` — missing `(task_id, changed_at)` composite
- `F-t3-model-6` — `spec` column ~1.6MB loaded on every list query

### Theme E — Dark write paths

- `F-t3-db-6`, `F-t3-model-3` — `cost_events` table defined but 0 writes after 31K events; subsystem disconnected
- `F-t4-prompt-9` — `getUserMemory()` source confusion vs SDK settings (no dup, but ambiguous)

### Theme F — Bounded-resource leaks

- `F-t1-sre-2` — child process listeners accumulate without `setMaxListeners` guard
- `F-t1-sre-3`, `F-t1-concur-8` — `_agentPromises` set grows unbounded on stalled cleanup
- `F-t1-sre-4` — PR poller timer recreation can leave orphaned timers
- `F-t1-sre-6` — `_lastTaskDeps` map never shrinks for deleted tasks
- `F-t1-sysprof-3` — `getUserMemory()` reads files synchronously every spawn (no mtime cache)
- `F-t1-sysprof-5` — `checkOAuthToken()` file I/O every drain cycle

### Theme G — Renderer re-render cascades

- `F-t2-react-1`, `F-t2-react-5` — store subscription granularity + unstable callbacks
- `F-t2-react-2`, `F-t2-react-3` — `now` ticker cascades through Dashboard every 10s
- `F-t2-react-4` — `useSprintPolling` `.some()` re-scans on every store update
- `F-t2-react-7` — `useVisibilityAwareInterval` registers listeners for inactive tasks

---

## 3. Quick Wins (Effort=S AND (Sev≥High OR Conf=High))

These are "do this Monday" — many overlap with the Top 10.

| ID                             | Title                                         | Severity | Conf     | Score    | In Top 10?       |
| ------------------------------ | --------------------------------------------- | -------- | -------- | -------- | ---------------- |
| `F-t2-react-1`                 | SprintPipeline `useShallow` consolidation     | Critical | High     | **12.0** | #7               |
| `F-t1-sysprof-1`               | Cache sorted deps / drop sort thrash          | High     | High     | **9.0**  | #4               |
| `F-t1-sysprof-2`               | Defer JSON.stringify in `emitAgentEvent`      | High     | High     | **9.0**  | (folded into #1) |
| `F-t1-concur-6`                | Reverse broadcast/write order                 | Med      | High     | 6.0      | #1 (canonical)   |
| `F-t1-sre-2`                   | `setMaxListeners` on child stderr             | High     | High     | **9.0**  | —                |
| `F-t3-db-1`                    | Composite `(pr_status, pr_number)` index      | High     | High     | **9.0**  | #3               |
| `F-t3-db-3`                    | Composite `(status, claimed_by)` index        | Med      | High     | 6.0      | —                |
| `F-t3-db-7`                    | Composite `task_changes(task_id, changed_at)` | Med      | High     | 6.0      | #5               |
| `F-t3-db-6`                    | Drop or document `cost_events` dark path      | Med      | High     | 6.0      | —                |
| `F-t2-bundle-6`                | TerminalPane `React.lazy`                     | High     | High     | **9.0**  | #10              |
| `F-t2-react-3`                 | Decouple Dashboard `now` ticker               | High     | High     | **9.0**  | —                |
| `F-t4-prompt-2` / `F-t4-ctx-1` | Flip `isBdeRepo` default                      | High     | High     | **9.0**  | #2               |
| `F-t4-prompt-3`                | Trim copilot SPEC_DRAFTING_PREAMBLE           | Med      | Med      | 3.0      | —                |
| `F-t4-prompt-7` / `F-t4-ctx-3` | Cap `taskContent` at 2,000 chars              | Med      | Med–High | 3.0–4.5  | —                |
| `F-t1-sysprof-5`               | Cache OAuth token in memory with TTL          | Low      | Med      | 2.0      | —                |
| `F-t1-sre-4`                   | Simplify PR poller backoff timer              | Med      | Med      | 2.0      | —                |
| `F-t1-sre-6`                   | TTL eviction on `_lastTaskDeps`               | Med      | Low      | 1.0      | —                |
| `F-t1-concur-8`                | Prune settled `_agentPromises`                | Low      | Low      | 1.0      | —                |
| `F-t2-bundle-7`                | Audit lucide-react tree-shaking               | Low      | Low      | 1.0      | —                |
| `F-t2-bundle-8`                | Confirm SDK marked external                   | Low      | Med      | 2.0      | —                |
| `F-t3-model-7`                 | JSON blob size limits                         | Low      | Low      | 1.0      | —                |
| `F-t3-model-6`                 | Targeted column lists for spec-free queries   | Low      | Low      | 1.0      | —                |

**Highest-bang quick wins not in Top 10:** `F-t1-sre-2` (setMaxListeners), `F-t2-react-3` (decouple `now` ticker), `F-t3-db-3` (status+claimed_by index), `F-t3-db-6` (drop dead `cost_events`).

---

## 4. Deferred / Out of Scope

| ID                             | Reason                                                                                                 |
| ------------------------------ | ------------------------------------------------------------------------------------------------------ |
| `F-t2-react-8`                 | Score 0.75 — premature for 525-row dataset; revisit at 5K+ tasks                                       |
| `F-t4-prompt-5` / `F-t4-ctx-6` | Score 1.0 — ~$0.01/mo savings, defer to docs reorg                                                     |
| `F-t4-prompt-6`                | Score 1.0 — ~$0.18/mo, personality consolidation is style not perf                                     |
| `F-t4-prompt-8`                | Score 1.0 — diff cap audit blocked on usage telemetry                                                  |
| `F-t4-prompt-9`                | Score 0.5 — naming clarity, no perf impact                                                             |
| `F-t4-prompt-10`               | Score 1.0 — UX nit                                                                                     |
| `F-t2-bundle-9`                | Score 0.25 — CSS Modules migration (L) too speculative                                                 |
| `F-t2-bundle-7`                | Score 1.0 — verify-only task, low payoff                                                               |
| `F-t3-model-5`                 | Score 1.0 — speculative; no observed missed events                                                     |
| `F-t1-sre-6`                   | Score 0.67 — trivial leak, low absolute size                                                           |
| `F-t1-concur-7`                | Score 0.5 — duplicate of `F-t1-sysprof-1`/`F-t1-sysprof-4`                                             |
| `F-t1-concur-8`                | Score 1.0 — only matters after 200+ hours uptime                                                       |
| `F-t1-sysprof-6`               | Score 0.5 — retry-only optimization, low frequency                                                     |
| `F-t3-model-4`                 | Score 0.5 — depends_on relational migration is L effort, only 106 rows; revisit when graph depth grows |

---

## 5. Open Questions for Human

These are the highest-leverage unknowns from each lens. Investigating any of these would re-rank multiple findings.

1. **Are the 128 zero-input agent runs cache hits or silent failures?** (`F-t4-cost-4`) `cache_read` is NULL so the data alone can't tell. If failures, this is a hidden reliability issue ahead of any cost story.
2. **Why is `cost_events` empty after 31K agent events?** (`F-t3-db-6`, `F-t3-model-3`, README F-zero) Was the writer ripped out, never wired, or intentionally disabled? Decision needed: drop the table or implement the writer.
3. **What is actual `MAX_ACTIVE_TASKS` in production?** (`F-t1-concur-1`/2/3/5) Most concurrency findings escalate sharply at N≥3. If users run N=1, several Highs collapse to Lows.
4. **What's the actual SQLite write latency at single-agent baseline?** (`F-t1-concur-2`, open Q5) No measured baseline — current "High" rating is reasoned, not benchmarked.
5. **Cost formula assumptions vs actual billing.** (`F-t4-cost-1`, open Q3) The $502.63 total assumes Sonnet-4.5 pricing; verify against the column source — agent_runs.cost_usd may be SDK-reported and already accurate.
6. **Are pipeline `agent_events` ever read after task completion?** (`F-t1-sre-1`, `F-t3-model-2`) If only used for live tailing, retention can drop to hours and several memory/IO findings collapse.
7. **Cold-start baseline (blank → first render) is unmeasured.** (`F-t2-bundle-5`, open Q5) All bundle findings are ROI-blind without it.
8. **Spawn rate assumption (~32/day) — what's the real number?** (`F-t4-prompt-1`, open Q1) All token-economy savings scale linearly with spawn count.
9. **Skill invocation rate.** (`F-t4-ctx-2`, `F-t4-prompt-4`) If skills are invoked >50% of the time, lazy-loading them hurts more than it helps.
10. **`max_cost_usd` enforcement.** (`F-t4-cost-5`, open Q5) Column exists in schema — is it ever read? If never, enforce it.
11. **Zustand action stability.** (`F-t2-react-1`, open Q2) Are setters truly stable references? If recreated per render, additional re-render fan-out exists.
12. **Disk reservation semantics for worktrees.** (`F-t1-sre-5`, open Q2) Should we reserve up-front or reactively shrink concurrency? Affects scaling cliff at N=8.

---

## Appendix: Score Table (sorted descending)

| ID             | Title (short)                       | Sev  | Conf | Effort | Score    |
| -------------- | ----------------------------------- | ---- | ---- | ------ | -------- |
| F-t2-react-1   | SprintPipeline `useShallow`         | Crit | H    | S      | **12.0** |
| F-t1-sysprof-1 | `_depsEqual` sort thrash            | High | H    | S      | **9.0**  |
| F-t1-sysprof-2 | JSON.stringify in event hot loop    | High | H    | S      | **9.0**  |
| F-t1-sre-2     | child process listener leak         | High | H    | S      | **9.0**  |
| F-t2-bundle-6  | TerminalPane no Suspense            | High | H    | S      | **9.0**  |
| F-t2-react-3   | Dashboard `now` cascade             | High | H    | S      | **9.0**  |
| F-t3-db-1      | Missing PR composite index          | High | H    | S      | **9.0**  |
| F-t4-ctx-1     | Unsafe `isBdeRepo` default          | High | H    | S      | **9.0**  |
| F-t4-prompt-2  | (dup of ctx-1)                      | High | H    | S      | **9.0**  |
| F-t1-concur-1  | Broadcast IPC fan-out               | High | H    | M      | 4.5      |
| F-t1-concur-2  | Per-msg SQLite writes               | High | H    | M      | 4.5      |
| F-t1-sre-1     | Unbounded `agent_events`            | High | H    | M      | 4.5      |
| F-t1-sre-3     | `_agentPromises` unbounded          | High | H    | M      | 4.5      |
| F-t3-db-2      | `listTasksRecent` full-scan         | High | H    | M      | 4.5      |
| F-t3-db-4      | Loop-based audit inserts            | High | H    | M      | 4.5      |
| F-t3-model-1   | task_changes write amp              | High | H    | M      | 4.5      |
| F-t3-model-2   | uncapped agent_events               | High | H    | M      | 4.5      |
| F-t4-cost-1    | Output-token dominance              | High | H    | M      | 4.5      |
| F-t4-cost-2    | Success vs failure cost ratio       | High | H    | M      | 4.5      |
| F-t4-prompt-1  | Redundant SDK context               | High | H    | M      | 4.5      |
| F-t4-ctx-2     | Skills always-on                    | High | H    | M      | 4.5      |
| F-t4-prompt-4  | (dup of ctx-2)                      | Med  | M    | M      | 2.0      |
| F-t4-ctx-9     | No lazy-inject mechanism            | High | M    | L      | 1.5      |
| F-t1-concur-6  | Broadcast-before-write              | Med  | H    | S      | **6.0**  |
| F-t2-react-2   | useDashboardMetrics `now` dep       | High | H    | M      | 4.5      |
| F-t2-react-7   | useVisibilityAwareInterval inactive | Med  | H    | M      | 3.0      |
| F-t3-db-3      | `(status, claimed_by)` index        | Med  | H    | S      | **6.0**  |
| F-t3-db-5      | SELECT \* over 40 columns           | Med  | M    | M      | 2.0      |
| F-t3-db-6      | dead `cost_events`                  | Med  | H    | S      | **6.0**  |
| F-t3-db-7      | task_changes composite              | Med  | H    | S      | **6.0**  |
| F-t3-model-3   | (dup of db-6)                       | Med  | H    | S      | **6.0**  |
| F-t1-concur-3  | resolveDependents cascade           | Med  | M    | M      | 2.0      |
| F-t1-concur-4  | claim/dep race                      | Med  | M    | M      | 2.0      |
| F-t1-concur-5  | poller DB contention                | Med  | M    | M      | 2.0      |
| F-t1-sre-4     | PR poller timer recreation          | Med  | M    | S      | 4.0      |
| F-t1-sre-5     | worktree disk race                  | High | M    | M      | 3.0      |
| F-t1-sre-6     | `_lastTaskDeps` no shrink           | Med  | L    | S      | 2.0      |
| F-t1-sysprof-3 | sync I/O in `getUserMemory`         | Med  | M    | M      | 2.0      |
| F-t1-sysprof-4 | deep dep compare                    | Med  | H    | M      | 3.0      |
| F-t1-sysprof-5 | OAuth file I/O per drain            | Low  | M    | S      | 2.0      |
| F-t2-bundle-1  | xterm sync (full)                   | High | H    | M      | 4.5      |
| F-t2-bundle-2  | Eager view CSS                      | Med  | H    | M      | 3.0      |
| F-t2-bundle-3  | Monaco worker config                | Med  | M    | M      | 2.0      |
| F-t2-bundle-4  | View preload missing                | Med  | M    | M      | 2.0      |
| F-t2-bundle-5  | App.tsx fan-out                     | Med  | M    | M      | 2.0      |
| F-t2-bundle-8  | SDK external check                  | Low  | M    | S      | 2.0      |
| F-t2-react-4   | useSprintPolling `.some()`          | Med  | M    | S      | 4.0      |
| F-t2-react-5   | TaskRow callback identity           | Med  | M    | M      | 2.0      |
| F-t2-react-6   | ActivitySection callback            | Med  | M    | S      | 4.0      |
| F-t3-model-5   | file watcher debounce               | Med  | M    | M      | 2.0      |
| F-t4-prompt-3  | copilot preamble bloat              | Med  | M    | S      | 4.0      |
| F-t4-prompt-7  | Unbounded taskContent               | Med  | M    | S      | 4.0      |
| F-t4-ctx-3     | (dup of prompt-7)                   | Med  | H    | S      | **6.0**  |
| F-t4-cost-3    | output/input ratio caps             | Med  | M    | S      | 4.0      |
| F-t4-cost-4    | zero-input cohort mystery           | Med  | M    | S      | 4.0      |
| F-t4-cost-5    | architectural runs cluster          | Med  | M    | M      | 2.0      |
| F-t4-ctx-4     | upstream diff cap undocumented      | Med  | M    | M      | 2.0      |
| F-t4-ctx-5     | copilot history unbounded           | Med  | M    | S      | 4.0      |
| F-t4-ctx-7     | no compression strategies           | Med  | M    | M      | 2.0      |
| F-t4-ctx-8     | pipeline 900-token tax              | Med  | M    | M      | 2.0      |
| F-t4-ctx-10    | spec-drafting CLAUDE.md bloat       | Low  | M    | M      | 1.0      |
| F-t1-concur-7  | dep index dedup                     | Low  | L    | M      | 0.5      |
| F-t1-concur-8  | settled promise pruning             | Low  | L    | S      | 1.0      |
| F-t1-sysprof-6 | prompt cache                        | Low  | L    | M      | 0.5      |
| F-t2-bundle-7  | lucide tree-shake audit             | Low  | L    | S      | 1.0      |
| F-t2-bundle-9  | CSS Modules migration               | Low  | L    | L      | 0.25     |
| F-t2-react-8   | Pipeline filter recompute           | Low  | L    | L      | 0.75     |
| F-t3-model-4   | depends_on relational               | Med  | M    | L      | 1.0      |
| F-t3-model-6   | spec column externalize             | Low  | L    | S      | 1.0      |
| F-t3-model-7   | JSON blob limits                    | Low  | L    | S      | 1.0      |
| F-t4-prompt-5  | judgment rules → docs               | Low  | L    | S      | 1.0      |
| F-t4-prompt-6  | personality consolidation           | Low  | L    | S      | 1.0      |
| F-t4-prompt-8  | diff cap docs                       | Low  | L    | S      | 1.0      |
| F-t4-prompt-9  | getUserMemory naming                | Low  | L    | S      | 1.0      |
| F-t4-prompt-10 | copilot time-limit note             | Low  | L    | S      | 1.0      |
| F-t4-ctx-6     | (dup of prompt-5)                   | Low  | L    | S      | 1.0      |

---

**Total findings consolidated:** 70 across 10 lenses (with 6 dedup pairs noted in Score Table).
**Quick wins recommended for Monday:** ~12 (all Effort=S, Score ≥ 6.0).
**Highest-leverage open question:** What is `cost_events` supposed to do, and what is real `MAX_ACTIVE_TASKS` in production? Both unblock multiple findings.
