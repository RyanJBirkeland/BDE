# Epic: Testing & QA (TQ)

**Date:** 2026-03-16
**Owner:** QA Engineering
**Goal:** Raise test coverage from ~47% file coverage (32 of 103 source files) to >80%, fix broken test infrastructure, and establish E2E testing for the 5 most critical user flows.

---

## Context

The engineering audit (`docs/audit-engineering-report.md` §5) and testing audit (`docs/audit-testing.md`) identified severe coverage gaps:

- **Main process: 3 of 9 files tested** (git.ts, agent-history.ts, db.ts). Zero handler files tested. `local-agents.ts` (316 LOC, process spawning + lifecycle) and `config.ts` (90 LOC, auth config) are completely uncovered.
- **IPC handlers: 0 of 8 handler files tested.** All IPC wiring — agent spawn, git operations, terminal PTY, gateway proxy, filesystem — ships without a single assertion.
- **Renderer stores: 9 of 10 tested** but `localAgents.ts` and `unifiedAgents.ts` only gained tests recently. `commandPalette.ts` trivial but untested.
- **Sprint components: 0 of 11 tested** (1,420 LOC). Kanban board, ticket creation, PR list, spec drawer — all uncovered.
- **Views: smoke tests only.** All 7 views render-without-crash but zero behavioral tests.
- **E2E: none.** No Playwright/Spectron setup exists.
- **Vitest config bug:** `.worktrees/` not excluded — picks up Jest-based `.spec.ts` from dependency trees in worktree `node_modules`, causing `jest is not defined` failures.

### Risk Matrix

| Gap | Risk | Impact if Bug Ships |
|-----|------|---------------------|
| IPC handlers untested | Critical | Silent data loss, security bypass, crash loops |
| local-agents.ts untested | Critical | Zombie processes, log corruption, spawn failures |
| Terminal PTY untested | High | Memory leaks, lost I/O, shell injection |
| fs.ts path traversal | High | Arbitrary file read/write outside memory root |
| config.ts error paths | High | App crash on missing config, credential exposure |
| Sprint components | Medium | Broken Kanban, lost tickets, failed PR merges |
| No E2E | Medium | Regression in critical flows undetectable |
| Vitest config bleed | Low | CI failures, false negatives in coverage |

---

## Current Test Inventory (32 files)

```
src/main/__tests__/              (3)  git, agent-history, db, sprint
src/renderer/src/stores/__tests__/ (9)  agentHistory, gateway, localAgents,
                                        sessions, terminal, theme, toasts,
                                        ui, unifiedAgents
src/renderer/src/lib/__tests__/   (4)  cost, diff-parser, gateway, rpc
src/renderer/src/components/
  ui/__tests__/                   (7)  Badge, Button, EmptyState,
                                        ErrorBoundary, Input, Spinner, Textarea
  layout/__tests__/               (4)  CommandPalette, StatusBar, TitleBar,
                                        ToastContainer
  sessions/__tests__/             (3)  ChatThread, MessageInput, SpawnModal
src/renderer/src/views/__tests__/ (1)  smoke (all 7 views)
```

---

## Stories

| ID | Title | Priority | Type | Estimate |
|----|-------|----------|------|----------|
| TQ-S1 | Fix Vitest configuration & coverage reporting | P0 | Infra | S |
| TQ-S2 | Unit tests for local-agents.ts | P0 | Unit | L |
| TQ-S3 | Unit tests for config.ts + fs.ts | P0 | Unit | M |
| TQ-S4 | IPC handler registration tests | P0 | Integration | L |
| TQ-S5 | Terminal PTY lifecycle tests | P1 | Unit | M |
| TQ-S6 | Renderer test gap closure (hooks + services) | P1 | Unit | M |
| TQ-S7 | Sprint component tests | P1 | Component | L |
| TQ-S8 | E2E infrastructure + 5 critical flows | P2 | E2E | XL |

## Execution Order

```
TQ-S1 (vitest config fix) ──────────────────────────────┐
                                                         │
TQ-S2 (local-agents) ─┐                                 │
TQ-S3 (config + fs)   ├── TQ-S4 (IPC handlers) ─────────┤
                       │                                  │
TQ-S5 (terminal PTY) ─┘                                 │
                                                         ├── TQ-S8 (E2E)
TQ-S6 (renderer gaps) ──────────────────────────────────┤
TQ-S7 (sprint components) ─────────────────────────────┘
```

TQ-S1 must land first — broken test discovery makes all other stories unreliable. TQ-S2/S3 are prerequisites for TQ-S4 (handler tests depend on understanding the underlying modules). TQ-S8 is last because it requires the app to be testable at every layer first.

---

## Success Criteria

- `npm test` passes with zero worktree bleed errors
- `npm run test:coverage` reports ≥60% statement coverage (up from ~40%)
- Every `src/main/handlers/*.ts` file has at least one test
- `local-agents.ts`, `config.ts`, `fs.ts` have ≥80% branch coverage
- Terminal PTY create/write/resize/kill lifecycle is tested
- Sprint components have render + interaction tests for SprintCenter, KanbanBoard, NewTicketModal
- Playwright E2E suite covers: session list load, agent spawn, terminal I/O, command palette navigation, agent log viewer
- Coverage thresholds enforced in `vitest.config.ts` (statements: 60%, branches: 45%, functions: 55%, lines: 60%)

---

## Out of Scope

- Performance/load testing (separate epic)
- Visual regression testing (screenshot comparison)
- CI/CD pipeline setup (separate story, depends on TQ-S1)
- Refactoring production code to improve testability (do inline where needed, but don't create refactoring-only stories)
