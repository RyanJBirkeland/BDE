# Remediation Audit Synthesis — Dashboard, Agents, Task Pipeline

**Date:** 2026-04-02
**Auditors:** 9 agents (Sr. Dev × 3, Principal Eng × 3, Design Eng × 3)
**Raw findings:** 209 total → **~85 unique** after dedup

---

## Cross-View Systemic Issues

These patterns appear across all 3 views:

### S1: Neon primitives use inline styles (ALL views) — High

StatCounter, NeonCard, ActivityFeed, NeonBadge, StatusBar — the shared neon primitives are 100% inline-styled. AgentCard, AgentList, PlaygroundModal also entirely inline. This is the single most pervasive convention violation.
**Sources:** Dashboard Sr#9, Dashboard PE#2, Dashboard DE#12-13, Agents DE#1-4, Agents Sr#12

### S2: Double-opacity stacking makes text nearly invisible — Medium

Multiple CSS rules apply `opacity: 0.6-0.85` on top of `var(--neon-text-dim)` which is already 0.3 alpha. Effective opacity: 0.18-0.25. Affects freshness timestamp, completion times, ring breakdown, duration meta.
**Sources:** Dashboard DE#27-29

### S3: Missing focus-visible on new interactive elements — Medium

All three views added interactive elements in recent overhauls without `:focus-visible` styles. Dashboard: attention items, completion rows, new-task button. Agents: action buttons, search bar, autocomplete, pills. Pipeline: done history items, conflict rows.
**Sources:** Dashboard Sr#30, Dashboard DE#22-23, Agents Sr#20-22, Agents DE#13, Pipeline DE#8-9

### S4: No dedicated store tests — High

`dashboardData.ts`, `costData.ts`, and `agentHistory.ts` stores have no test files. `sprintTasks.ts` got tests in this session but coverage is basic.
**Sources:** Dashboard Sr#18, Agents PE (implied)

### S5: Hardcoded particle/SVG colors break light theme — Medium

SankeyPipeline particles use hex strings in SVG `<animate>`. ParticleField renders in light theme despite `--neon-particle-count: 0`. StatusBar breathing animation ignores reduced-motion.
**Sources:** Dashboard Sr#7, Dashboard DE#6,16-17

---

## Dashboard (33 Sr + 17 PE + 37 DE = ~45 unique)

### Critical/High

| #   | Finding                                              | Sources          |
| --- | ---------------------------------------------------- | ---------------- |
| D1  | "Cost 24h" shows lifetime cost, not 24h              | Sr#1, PE#1, PE#5 |
| D2  | `fetchAll` has no concurrency guard — race condition | Sr#4, PE#4       |
| D3  | Sankey label font 9px below minimum                  | DE#7             |
| D4  | No `dashboardData` store tests                       | Sr#18            |

### Medium

| #   | Finding                                                                |
| --- | ---------------------------------------------------------------------- |
| D5  | SuccessRing `failed` count includes cancelled (inconsistent with rate) |
| D6  | StatCounter uses useState for hover (unnecessary re-renders)           |
| D7  | Redundant PR fetching (dashboard + PR poller both fetch)               |
| D8  | Dual task stats computation (stats + partitions independently)         |
| D9  | Dashboard computes derived data in view, not store/hook                |
| D10 | MiniChart tooltip hardcoded `rgba(0,0,0,0.85)`                         |
| D11 | ActivityFeed items have small click targets (~18px)                    |
| D12 | Completion row title truncation without tooltip                        |
| D13 | Feed event labels truncated without tooltip                            |
| D14 | Responsive breakpoints need tuning at 700-800px                        |

---

## Agents (23 Sr + 15 PE + 24 DE = ~40 unique)

### Critical/High

| #   | Finding                                                                | Sources     |
| --- | ---------------------------------------------------------------------- | ----------- |
| A1  | `pairEvents()` recomputes entire array on every event — CPU bottleneck | PE#5        |
| A2  | Live events lost during `loadHistory()` — race condition               | PE#1        |
| A3  | Event pairing misses non-adjacent tool_call/result pairs               | Sr#1, PE#15 |
| A4  | AgentCard + AgentList entirely inline-styled                           | DE#1-2      |

### Medium

| #   | Finding                                                           |
| --- | ----------------------------------------------------------------- |
| A5  | Pending message removal races with event ordering                 |
| A6  | CommandAutocomplete keyboard handler conflicts with CommandBar    |
| A7  | O(n) `matchingIndices.includes()` in virtual scroll render        |
| A8  | LiveActivityStrip selector creates new reference every render     |
| A9  | Every IPC event creates full state spread — allocation pressure   |
| A10 | Orphaned `tool_result` rendered as `tool_call` — misleading       |
| A11 | Event arrays grow unbounded across agents — memory leak           |
| A12 | `init()` listener not idempotent — double-subscription possible   |
| A13 | Duplicated `formatFileSize` and `formatDuration` functions        |
| A14 | `console-line--playground` CSS class referenced but never defined |
| A15 | GroupHeader pulse animation references `pulse` not `neon-pulse`   |
| A16 | PlaygroundModal entirely inline-styled                            |
| A17 | Virtual scroll container lacks ARIA role                          |
| A18 | AgentList has no keyboard navigation between cards                |
| A19 | ConsoleSearchBar input is uncontrolled — stale on reopen          |

---

## Task Pipeline (18 Sr + 19 PE + 15 DE = ~35 unique)

### Critical/High

| #   | Finding                                                                      | Sources    |
| --- | ---------------------------------------------------------------------------- | ---------- |
| P1  | `statusFilter` set but never consumed — clicks are no-ops                    | Sr#1, PE#1 |
| P2  | Sidebar overflow conflict — `overflow: hidden` overwrites `overflow-y: auto` | DE#1       |
| P3  | Missing `@keyframes spin` for conflict drawer spinner                        | DE#4       |
| P4  | `sprint:retry` skips dependency validation — can queue with unmet deps       | PE#12      |
| P5  | `sprint:unblockTask` also skips dependency validation                        | PE#13      |

### Medium

| #   | Finding                                                              |
| --- | -------------------------------------------------------------------- |
| P6  | `multiSelected` prop never passed to TaskPill — no visual feedback   |
| P7  | `handleRerun` drops `depends_on` from cloned tasks                   |
| P8  | `handlePushToSprint` doesn't await updateTask — premature toast      |
| P9  | `launchTask` uses client-side WIP check, bypasses atomic `claimTask` |
| P10 | Escape key double-fires with DoneHistoryPanel                        |
| P11 | Retry handler double-notifies SSE (service + explicit)               |
| P12 | No-op hover states on primary/danger buttons                         |
| P13 | Reduced motion doesn't cover activity dot + conflict spinner         |
| P14 | HealthCheckDrawer rescue doesn't clean up worktree (unlike retry)    |
| P15 | Keyboard shortcuts `r`/`d` not wired in SprintPipeline               |

---

## Prioritized Remediation Plan

### Tier 1: Bugs & Data Correctness (ship immediately)

1. **P1** — Wire `statusFilter` into filteredTasks (or remove clicks)
2. **P4/P5** — Add dependency validation to retry + unblock handlers
3. **P2** — Fix sidebar overflow conflict
4. **D1** — Fix "Cost 24h" to actually filter by 24h
5. **A2** — Fix loadHistory race (merge instead of replace)
6. **A3** — Fix event pairing for non-adjacent pairs
7. **P7** — handleRerun preserves depends_on
8. **P8** — Await updateTask in handlePushToSprint
9. **A5** — Fix pending message removal race

### Tier 2: Performance & Memory

10. **A1** — Incremental pairEvents + event batching
11. **A9/A11** — Event store batching + LRU eviction
12. **A7** — Convert matchingIndices to Set
13. **D2** — Add concurrency guard to fetchAll
14. **A8** — Memoize runningAgents in LiveActivityStrip

### Tier 3: Design System Consistency

15. **S1** — Migrate neon primitives from inline to CSS (StatCounter, NeonCard, etc.)
16. **A4** — Migrate AgentCard + AgentList to CSS classes
17. **A16** — Migrate PlaygroundModal to CSS classes
18. **S2** — Fix double-opacity stacking
19. **S5** — Fix particle/SVG colors for light theme
20. **D3** — Bump Sankey label to 10px

### Tier 4: Accessibility & Polish

21. **S3** — Add focus-visible to all new interactive elements
22. **A17** — Add ARIA role to virtual scroll
23. **A14** — Add missing console-line--playground CSS
24. **A15** — Fix GroupHeader pulse keyframe name
25. **P3** — Add @keyframes spin to pipeline CSS
26. **P6** — Wire multiSelected prop through PipelineStage
27. **P10** — Fix Escape double-fire
28. **P12/P13** — Fix no-op hover states + reduced motion gaps

### Tier 5: Tests & Cleanup

29. **S4** — Store tests (dashboardData, costData, agentHistory)
30. **A13** — Extract shared format utilities
31. **P15** — Wire keyboard shortcuts r/d
32. **D7** — Eliminate redundant PR fetching
33. **D9** — Extract dashboard metrics to hook
