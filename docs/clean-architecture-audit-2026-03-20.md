# Clean Architecture Audit — BDE

**Date:** 2026-03-20
**Audited by:** Claude (requested by Ryan)

---

## Executive Summary

- **Overall architectural health: B+**
- **Guiding principle (High Cohesion, Low Coupling):** Strong foundations — process boundaries are textbook, core orchestration (AgentManager) is exemplary. Specific modules need decoupling.
- **Top 3 wins:**
  1. AgentManager is fully dependency-injected with 100% mockable deps — best-in-class for an Electron app
  2. End-to-end typed IPC via `IpcChannelMap` + `safeHandle()` + `typedInvoke()` — single source of truth for 64 channels
  3. Data layer (`src/main/data/`) follows repository pattern perfectly — all functions accept `db` as parameter, testable with in-memory SQLite
- **Top 3 priorities:**
  1. Move `AgentEvent` type to `src/shared/types.ts` — fixes the only dependency direction violation (cascades to 8 files)
  2. Extract raw SQL from `src/main/index.ts` into `data/sprint-queries.ts` — the composition root has absorbed query logic
  3. Split `git.ts` (4 concerns) and `local-agents.ts` (6 concerns) — these are the codebase's two god files

---

## Structural Overview

**262 TypeScript/TSX files** across 4 process boundaries:

```
src/
├── main/                    (21 root files + 4 subdirs)
│   ├── agent-manager/       (9 files) — task orchestration engine
│   ├── agents/              (5 files) — SDK integration, event pipeline
│   ├── handlers/            (12 files) — IPC handler adapters
│   └── data/                (5 files) — SQL query functions
├── renderer/src/
│   ├── components/          (~76 files) — feature UI: sprint, agents, terminal, panels, ui
│   ├── stores/              (16 files) — Zustand state, one per domain
│   ├── views/               (7 files) — top-level view containers
│   ├── lib/                 (15 files) — utilities
│   └── hooks/               (11 files) — custom React hooks
├── shared/                  (8 files) — cross-process types and constants
└── preload/                 (2 files) — Electron context bridge
```

**Organization pattern:** Hybrid layer-based (main/renderer/preload/shared) with feature-based nesting within each layer.

**Largest non-test files:** `DiffViewer.tsx` (456), `TicketEditor.tsx` (436), `panelLayout.ts` (428), `TaskTable.tsx` (373), `local-agents.ts` (333), `db.ts` (332).

**Churn hotspots (last 50 commits):** Renderer (47%), integration tests (8%), handlers (7%), AgentManager (6%).

---

## Dependency Direction Map

```
                    ┌──────────────┐
                    │   shared/    │  ← Pure types, zero runtime deps
                    │ types.ts     │
                    │ ipc-channels │
                    └──────┬───────┘
                           │ (imported by all layers)
              ┌────────────┼────────────┐
              ▼            ▼            ▼
      ┌───────────┐ ┌──────────┐ ┌──────────────┐
      │  preload/  │ │  main/   │ │  renderer/   │
      │  bridge    │ │  process │ │  process     │
      └─────┬─────┘ └────┬─────┘ └──────┬───────┘
            │             │              │
            └─────────────┘              │
              IPC boundary               │
              (typed channels)           │
                                         │
                          window.api ─────┘
```

### Violations (1 root cause, 8 affected files)

**Root cause:** `AgentEvent` type defined in `src/main/agents/types.ts` instead of `src/shared/types.ts`.

| Violation       | File                                                                 | Line | Direction                                                |
| --------------- | -------------------------------------------------------------------- | ---- | -------------------------------------------------------- |
| shared → main   | `src/shared/ipc-channels.ts`                                         | 10   | `import type { AgentEvent } from '../main/agents/types'` |
| preload → main  | `src/preload/index.ts`                                               | 5    | Same import                                              |
| preload → main  | `src/preload/index.d.ts`                                             | 4    | Same import                                              |
| renderer → main | `src/renderer/src/stores/agentEvents.ts`                             | 2    | Same import                                              |
| renderer → main | `src/renderer/src/stores/sprintEvents.ts`                            | 3    | Same import                                              |
| renderer → main | `src/renderer/src/components/agents/AgentDetail.tsx`                 | —    | Same import                                              |
| renderer → main | `src/renderer/src/components/agents/ChatRenderer.tsx`                | —    | Same import                                              |
| renderer → main | `src/renderer/src/components/agents/__tests__/ChatRenderer.test.tsx` | —    | Same import                                              |

**Fix:** Move `AgentEvent` and `AgentEventType` to `src/shared/types.ts`, update 8 imports. ~15 minutes, zero logic changes.

**No circular dependencies found.** Verified all major import chains.

---

## Layer Boundary Analysis

| Layer                    | Location                                                  | Status                                                       |
| ------------------------ | --------------------------------------------------------- | ------------------------------------------------------------ |
| **Entities/Domain**      | `src/shared/types.ts`, `src/shared/models.ts`             | Clean — pure data structures, no framework deps              |
| **Use Cases**            | `src/main/agent-manager/`, `src/main/agents/event-bus.ts` | Clean — AgentManager fully DI, event bus is mediator pattern |
| **Interface Adapters**   | `src/main/handlers/`, `src/preload/index.ts`              | Clean — handlers are thin adapters using `safeHandle()`      |
| **Frameworks & Drivers** | `src/main/db.ts`, `src/main/git.ts`, `src/renderer/src/`  | Mostly clean — 3 SQL leak points (see below)                 |

### Layer Violations

1. **Raw SQL in composition root:** `src/main/index.ts:151-181` — two `db.prepare()` lambdas bypass `data/sprint-queries.ts`
2. **Raw SQL in handler:** `src/main/handlers/cost-handlers.ts:63` — `getDb().prepare()` call instead of using `data/cost-queries.ts`
3. **Raw SQL in handler:** `src/main/handlers/sprint-local.ts:178` — inline `getDb().prepare()` instead of calling a data function
4. **Poller depends on handler layer:** `src/main/sprint-pr-poller.ts:7-13` imports from `handlers/sprint-local.ts` — should import from `data/` directly

---

## SOLID Violations

### High Severity (7)

| Principle | File:Line                                            | Description                                                                                                                                       |
| --------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| SRP       | `src/main/index.ts:149-198`                          | `app.whenReady()` is a god-function: DB init, file-watcher, poller lifecycle, handler registration, inline AgentManager construction with raw SQL |
| SRP       | `src/main/index.ts:150-181`                          | Two duplicate raw-SQL `updateTask` closures inlined — belong in `data/sprint-queries.ts`                                                          |
| ISP       | `src/main/agent-manager/agent-manager.ts:33`         | `handleCompletion` accepts `Record<string, unknown>` — deliberately untyped. Should be typed to `CompletionContext`                               |
| ISP       | `src/main/agent-manager/agent-manager.ts:29`         | `updateTask` accepts `Record<string, unknown>` — erases type safety on field names, risky near dynamic SQL                                        |
| DIP       | `src/main/local-agents.ts:152`                       | `new SdkProvider()` instantiated per call — concrete dep, not injectable                                                                          |
| DIP       | `src/main/auth-guard.ts:1-82`                        | Directly invokes `execFileAsync('security', ...)` — no abstraction over credential store                                                          |
| DIP       | `src/main/sprint-pr-poller.ts:7-13`                  | Imports from handler layer — business service depends on IPC adapter                                                                              |
| DIP       | `src/main/agent-manager/completion-handler.ts:29-46` | `pushBranchAndOpenPr` hardcodes `execFileAsync('git'/'gh')` — inconsistent with DI pattern of parent AgentManager                                 |

### Medium Severity (16)

| Principle | File:Line                                                    | Description                                                                                        |
| --------- | ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| SRP       | `src/main/index.ts:32-60`                                    | `startDbWatcher` lives in app entry point — should be `db-watcher.ts`                              |
| SRP       | `src/main/local-agents.ts:54-112`                            | `extractAgentCost` is a log parser in an agent lifecycle module                                    |
| SRP       | `src/main/local-agents.ts:187-227`                           | `consumeEvents` does 3 things: file append, bus emit, DB update                                    |
| SRP       | `src/main/handlers/sprint-local.ts:111-196`                  | Mixes IPC wiring with ad-hoc SQL and log-reading logic                                             |
| SRP       | `src/main/handlers/agent-handlers.ts:30-78`                  | Three handler domains in one file + side-effecting cleanup calls                                   |
| SRP       | `src/renderer/src/components/sprint/TicketEditor.tsx:32-291` | Three responsibilities: form state, multi-state UI, inline submission                              |
| OCP       | `src/main/agents/sdk-provider.ts:20-96`                      | `mapSdkMessage` switch — closed to extension for new SDK event types                               |
| OCP       | `src/main/agent-manager/completion-handler.ts:61-103`        | Retry policy hardcoded — adding new strategy requires modification                                 |
| OCP       | `src/renderer/src/components/sprint/TaskTable.tsx:128-155`   | Section row renderer — ternary chains closed to new section types                                  |
| OCP       | `src/preload/index.ts:21-216`                                | Flat manual registry — every new IPC channel requires editing                                      |
| ISP       | `src/shared/ipc-channels.ts:28-316`                          | Monolithic `IpcChannelMap` with ~50 entries — should be segregated by domain                       |
| ISP       | `src/shared/types.ts:156-171`                                | `UnifiedAgent` carries all fields from both `local` and `history` sources — fat optional interface |
| DIP       | `src/main/agent-manager/completion-handler.ts:49`            | `getActualBranch()` from concrete `worktree-ops` import                                            |
| DIP       | `src/main/sprint-pr-poller.ts:8`                             | `pollPrStatuses` imported directly from `git.ts`                                                   |
| DIP       | `src/renderer/src/stores/ui.ts:22-36`                        | `setView` calls `usePanelLayoutStore.getState()` — cross-store concrete coupling                   |
| DIP       | `src/main/auth-guard.ts:25-28`                               | `CLI_SEARCH_PATHS` hardcoded to macOS/Linux — not configurable                                     |

### Low Severity (10)

| Principle | File:Line                                                 | Description                                                                                        |
| --------- | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| SRP       | `src/main/index.ts:207-230`                               | CSP header construction inlined in entry point                                                     |
| SRP       | `src/main/db.ts:37-314`                                   | Migrations array growing — approaching 300 LOC ceiling                                             |
| SRP       | `src/renderer/src/components/diff/DiffViewer.tsx:271-454` | Virtualization + keyboard nav + scroll logic in one component                                      |
| OCP       | `src/renderer/src/components/sprint/TaskTable.tsx:95`     | Section header labels hardcoded to 3 known types                                                   |
| OCP       | `src/main/handlers/sprint-spec.ts:70-81`                  | `SCAFFOLDS` hardcoded — should be part of template records                                         |
| ISP       | `src/shared/types.ts:173-186`                             | `Attachment` mixes image and text fields — should be discriminated union                           |
| ISP       | `src/preload/index.ts:21-216`                             | Entire IPC surface exposed as single `window.api` — no capability boundaries                       |
| LSP       | `src/main/agent-manager/agent-manager.ts:192-194`         | Special handling of `agent:completed` — if new terminal events are added, the break will be missed |
| LSP       | `src/renderer/src/components/diff/DiffViewer.tsx:75-79`   | `rowHeight` switches on `row.kind` — subtypes not substitutable                                    |
| DIP       | `src/renderer/src/components/sprint/TicketEditor.tsx:47`  | Direct `window.api` call from component — not injectable                                           |

---

## Clean Code Findings

### Naming

| Issue                                                                                         | Location                                                                             | Severity |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | -------- |
| Inconsistent vocabulary: `fetchLocalAgents` / `fetchAgents` / `loadData` for the same concept | `stores/costData.ts:8`, `stores/agentHistory.ts:11`, `stores/sprintTasks.ts:26`      | Medium   |
| Typo: `replacLeafWithSplit` (missing 'e')                                                     | `stores/panelLayout.ts:244` — called in 4 places                                     | Medium   |
| Dead prop: `sessionCount={0}` always hardcoded                                                | `App.tsx:248`                                                                        | Low      |
| Duplicate functions: `isAgentInteractive` and `isKnownAgentPid` are identical                 | `local-agents.ts:326,331`                                                            | Low      |
| Magic number `10 * 1024 * 1024` repeated 8 times                                              | `git.ts:27,55,69,78,86,94,106,130` — `fs.ts` defines `MAX_READ_BYTES` for same value | Medium   |
| Priority default mismatch: renderer uses `3`, DB schema defaults to `1`                       | `TicketEditor.tsx:39,63` vs `db.ts:140`                                              | Medium   |
| Inconsistent term: `update` / `patch` for partial field updates                               | `agent-manager.ts:29`, `sprint-local.ts:69`, `index.ts:157`                          | Low      |

### Functions

| Issue                                                                                                  | Location                       | Severity |
| ------------------------------------------------------------------------------------------------------ | ------------------------------ | -------- |
| `createTask` — 89 LOC, 4+ responsibilities (optimistic insert, spec generation, DOM events, toasts)    | `stores/sprintTasks.ts:83-172` | High     |
| `runTask` — 49 LOC, auth + repo lookup + DB update + worktree + spawn + watchdog + consumer            | `agent-manager.ts:122-171`     | Medium   |
| `spawnClaudeAgent` — 54 LOC, DB record + spawn + PID update + map registration + event consumer        | `local-agents.ts:130-184`      | Medium   |
| Duplicated SQL UPDATE builder — appears twice in `index.ts`, bypasses allowlist in `sprint-queries.ts` | `index.ts:157-162,176-181`     | High     |
| CQS violations — `claimTask`, `updateTask`, `releaseTask` mutate DB + fire IPC + return row            | `sprint-local.ts:63-79`        | Medium   |
| `moveTab` — boolean-disguised flag argument (`zone === 'center'` triggers entirely different logic)    | `panelLayout.ts:191-238`       | Low      |

### Error Handling

| Issue                                                                                                | Location                         | Severity |
| ---------------------------------------------------------------------------------------------------- | -------------------------------- | -------- |
| `.catch(() => {})` — stale agent reconciliation failure silently dropped                             | `agent-scanner.ts:182`           | Medium   |
| `.catch(() => {})` — layout persistence failures silently dropped (2 locations)                      | `panelLayout.ts:379,426`         | Medium   |
| `.catch(() => {})` — AgentsView status poll swallowed                                                | `AgentsView.tsx:156`             | Medium   |
| `parseInt(oauth.expiresAt!, 10)` — non-null assertion on user data; `NaN` silently treated as valid  | `auth-guard.ts:63`               | High     |
| `void this.consumeEvents(...)` — unhandled rejection if `handle.events` is not iterable              | `agent-manager.ts:164`           | Medium   |
| `catch {}` in `gitBranches`, `fetchPrStatusRest`, `checkConflictFiles` — return defaults with no log | `git.ts:121-123,179-181,235-237` | Medium   |
| Cost fetch failure logged to devtools only — UI shows stale `$0.00`                                  | `costData.ts:24`                 | Low      |
| `contextBridge.exposeInMainWorld` failure logged but app continues broken                            | `preload/index.ts:223`           | Low      |

### Comments

| Issue                                                                          | Location                      | Severity    |
| ------------------------------------------------------------------------------ | ----------------------------- | ----------- |
| TODO: sandbox:false security migration (well-documented, dated)                | `index.ts:76-78`              | — (tracked) |
| TODO: copy all scrollback — no owner, no date                                  | `TerminalView.tsx:147`        | Low         |
| TODO: CWD polling — no owner, no date                                          | `PaneStatusBar.tsx:13`        | Low         |
| Vague catch comment: "Non-critical" (2 locations)                              | `agentHistory.ts:37-39,81-83` | Low         |
| `prompt` silently aliased to `spec` with no comment explaining the duplication | `TicketEditor.tsx:97`         | Medium      |

---

## Module Scorecard

| Module                          | Ca       | Ce     | Cohesion  | Score | Notes                                                             |
| ------------------------------- | -------- | ------ | --------- | ----- | ----------------------------------------------------------------- |
| `main/agent-manager/`           | 2        | 3      | Excellent | **A** | Fully DI, single-purpose files, exemplary                         |
| `main/data/`                    | 6        | 1      | Excellent | **A** | Pure query functions, all accept `db` param                       |
| `shared/`                       | 12+      | 0      | Excellent | **A** | Pure types, no runtime deps                                       |
| `renderer/components/ui/`       | High     | 0-1    | Excellent | **A** | Zero business logic, pure design system                           |
| `renderer/components/panels/`   | 2        | 1-2    | Excellent | **A** | Recursive tree manipulation, clear interfaces                     |
| `main/agents/`                  | 5        | 4      | Good      | **B** | event-bus mixes persistence + broadcast                           |
| `renderer/stores/`              | High     | 1-3    | Good      | **B** | One-domain-per-store; `unifiedAgents` cross-couples               |
| `renderer/components/sprint/`   | 2-3      | 2-5    | Good      | **B** | Cohesive domain; `TicketEditor` overloaded                        |
| `renderer/components/agents/`   | 2-3      | 2-4    | Good      | **B** | Cohesive; `AgentDetail` highest fan-out                           |
| `renderer/components/terminal/` | 1-2      | 1-3    | Good      | **B** | Clean IPC via window.api                                          |
| `renderer/lib/`                 | Moderate | 0-2    | Good      | **B** | `chat-markdown.tsx` imports component — boundary violation        |
| `main/handlers/`                | 1        | 12+    | Mixed     | **C** | Mostly thin adapters; `sprint-local` and `cost-handlers` leak SQL |
| `main/` root files              | Varies   | Varies | Mixed     | **C** | `git.ts` and `local-agents.ts` are god files                      |

---

## Framework Independence

### The Swap Test

| Framework            | Properly Isolated?                            | Files to Change                                                                                     | Business Logic Impacted?                  |
| -------------------- | --------------------------------------------- | --------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| **React**            | Yes — contained to `renderer/`                | ~76 component + 16 store + 11 hook files                                                            | No — zero React in main/shared/preload    |
| **Electron**         | Mostly — 4 leaks beyond expected entry points | `fs.ts` (dialog), `terminal-handlers.ts`, `window-handlers.ts` bypass `broadcast.ts`; sandbox:false | No business logic coupled                 |
| **SQLite**           | Mostly — 3 leak points                        | `data/` (6 files) + `index.ts`, `cost-handlers.ts`, `sprint-local.ts`                               | Leak points contain business-adjacent SQL |
| **Zustand**          | Yes — renderer only                           | 16 stores + consumers                                                                               | No cross-process coupling                 |
| **Claude Agent SDK** | Yes — wrapped in `sdk-provider.ts`            | 1 file to swap                                                                                      | Clean adapter boundary                    |

### Framework Coupling Heat Map

```
MODULE                          ELECTRON  SQLITE  REACT  ZUSTAND
────────────────────────────────────────────────────────────────
main/agent-manager/*             -         -       -      -      CLEAN
main/agents/sdk-provider.ts      -         -       -      -      CLEAN
main/agents/event-bus.ts         MED*      MED     -      -
main/data/*                      -         TYPE    -      -      IDEAL
main/handlers/ (most)            -         -       -      -      CLEAN
main/handlers/terminal-*         HIGH*     -       -      -
main/handlers/window-*           HIGH*     -       -      -
main/handlers/cost-*             -         MED*    -      -
main/handlers/sprint-local       -         MED*    -      -
main/index.ts                    HIGH      MED*    -      -
main/db.ts                       -         HIGH    -      -
main/git.ts                      -         -       -      -      CLEAN
main/auth-guard.ts               -         -       -      -      CLEAN
main/fs.ts                       MED*      -       -      -
shared/*                         -         -       -      -      CLEAN
preload/index.ts                 HIGH      -       -      -      JUSTIFIED
renderer/stores/*                -         -       -      HIGH   EXPECTED
renderer/lib/chat-markdown.tsx   -         -       LOW*   -

* = unexpected coupling or layer violation
```

---

## Testability Assessment

### Test Infrastructure

- **45 test files** across 3 vitest configs (renderer/jsdom, main/node, integration)
- **Coverage thresholds:** 40% statements/lines, 30% branches, 35% functions (renderer)
- **Test data patterns:** In-memory SQLite for data tests, `vi.mock` for external deps, `vi.useFakeTimers()` for time-dependent code

### Testability Grades

| Module                       | Grade | Notes                                                   |
| ---------------------------- | ----- | ------------------------------------------------------- |
| `agent-manager/`             | A     | Full DI, comprehensive unit + integration tests         |
| `auth-guard.ts`              | A     | Simple deps, both unit and integration covered          |
| `data/*.ts`                  | A     | In-memory SQLite, all CRUD tested                       |
| `watchdog.ts`                | A     | Pure timer logic, fully deterministic                   |
| `sdk-provider.ts`            | A-    | All event mappings, minor model alias gap               |
| `git.ts`                     | B+    | Good coverage, fragile promisify mock, 3 known failures |
| `local-agents.ts`            | B     | Comprehensive except `extractAgentCost` untested        |
| Renderer stores (pure)       | B+    | Well-tested where mutations are pure                    |
| Renderer stores (polling)    | D     | `sprintTasks`, `sprintEvents`, `costData` — zero tests  |
| `sprint-pr-poller.ts`        | D     | Not tested, module-level deps prevent injection         |
| `pr-poller.ts`               | D     | Not tested, same coupling issue                         |
| Renderer views               | D     | Smoke-only (render-without-crash)                       |
| Handler business logic       | C     | Registration tested, behavior mostly not                |
| `github:fetch` URL allowlist | F     | Security-relevant, zero dedicated tests                 |

### Key Testability Gaps

1. **`sprint-pr-poller.ts` / `pr-poller.ts`** — Module-level state + direct imports make injection impossible. Apply AgentManager DI pattern.
2. **`github:fetch` URL allowlist** — Security guarantee in `git-handlers.ts` with no behavior test.
3. **`extractAgentCost`** — Complex multi-format JSON parser in `local-agents.ts` with no test.
4. **Renderer polling stores** — `sprintTasks.ts` is the primary data store with no tests.
5. **View-level behavior** — All 7 views have smoke-only tests.

---

## Refactoring Roadmap

### Tier 1: High Impact, Low Effort (Do First)

#### Move AgentEvent to shared/types.ts

- **What:** Move `AgentEvent`, `AgentEventType`, and `AgentHandle` from `src/main/agents/types.ts` to `src/shared/types.ts`
- **Why:** Single root cause of all 8 dependency direction violations
- **Coupling impact:** Restores shared/ as truly process-neutral; eliminates all renderer → main imports
- **Files affected:** 8 import updates
- **Complexity:** Low (~15 min)

#### Type the AgentManagerDeps contract

- **What:** Replace `Record<string, unknown>` in `updateTask` and `handleCompletion` with proper typed interfaces
- **Why:** Untyped contracts erase safety near dynamic SQL construction — correctness risk
- **Coupling impact:** Makes the DI contract explicit and verifiable at compile time
- **Files affected:** 2 (agent-manager.ts, index.ts)
- **Complexity:** Low

#### Extract raw SQL from index.ts

- **What:** Move the two `db.prepare()` lambdas from `src/main/index.ts:151-181` into `data/sprint-queries.ts`
- **Why:** Composition root has absorbed query logic; duplicates bypass the allowlist in sprint-queries
- **Coupling impact:** Restores index.ts to pure wiring; consolidates all SQL in data layer
- **Files affected:** 2 (index.ts, sprint-queries.ts)
- **Complexity:** Low

#### Fix the `replacLeafWithSplit` typo

- **What:** Rename to `replaceLeafWithSplit` across `panelLayout.ts`
- **Why:** Typo in a function called from 4 locations; appears in stack traces
- **Files affected:** 1
- **Complexity:** Trivial

#### Extract `MAX_BUFFER` constant in git.ts

- **What:** Replace 8 instances of `10 * 1024 * 1024` with a named constant (reuse `MAX_READ_BYTES` from fs.ts or define shared)
- **Why:** Magic number repeated 8 times
- **Files affected:** 1
- **Complexity:** Trivial

### Tier 2: High Impact, Medium Effort

#### Split git.ts into focused modules

- **What:** Extract into `git-local.ts` (status, branches, diff), `github-fetch.ts` (REST API), `pr-polling.ts` (PR status), `conflict-check.ts`
- **Why:** 4 distinct concerns in one file; high churn area
- **Coupling impact:** Reduces Ce by ~4 per consumer; enables targeted testing
- **Files affected:** ~8
- **Complexity:** Medium

#### Split local-agents.ts into focused modules

- **What:** Extract `agent-cost-parser.ts` (extractAgentCost), `agent-event-consumer.ts` (consumeEvents), `agent-log-manager.ts` (log cleanup/tailing)
- **Why:** 6 concerns in 333 LOC; enables independent testing of cost parser
- **Coupling impact:** Each new module has 1-2 deps instead of 6+
- **Files affected:** ~5
- **Complexity:** Medium

#### Inject deps into sprint-pr-poller.ts

- **What:** Apply AgentManager DI pattern — accept `SprintPrPollerDeps` interface
- **Why:** Currently untestable (grade D); imports from handler layer (layering violation)
- **Coupling impact:** Fixes layering violation; enables unit testing
- **Files affected:** 3
- **Complexity:** Medium

#### Inject broadcast into event-bus.ts

- **What:** Accept a `notify: (channel, payload) => void` callback instead of importing `broadcast.ts`
- **Why:** Couples event bus permanently to Electron's BrowserWindow
- **Coupling impact:** Enables headless agent execution and testing
- **Files affected:** 3
- **Complexity:** Medium

#### Inject VCS abstraction into completion-handler.ts

- **What:** Define `interface VcsClient { pushBranch(): Promise<void>; createPr(): Promise<{ prUrl: string }> }`
- **Why:** Hardcodes `execFileAsync('git'/'gh')` — inconsistent with parent AgentManager's DI
- **Coupling impact:** Enables testing without git repos; consistent DI throughout agent pipeline
- **Files affected:** 3
- **Complexity:** Medium

### Tier 3: Structural (Plan For)

#### Segregate IpcChannelMap by domain

- **What:** Split monolithic `IpcChannelMap` into `SettingsChannels & GitChannels & SprintChannels & AgentChannels & ...`
- **Why:** All consumers pull entire 50-channel map; makes capability boundaries explicit
- **Files affected:** ~15
- **Complexity:** High (mechanical)

#### Extract bootstrap module from index.ts

- **What:** Move DB init, file-watcher setup, poller lifecycle, CSP construction out of `app.whenReady()` into `bootstrap.ts`
- **Why:** Entry point has 5 distinct responsibilities
- **Files affected:** 2-3
- **Complexity:** Medium

#### Convert UnifiedAgent to discriminated union

- **What:** Replace fat optional interface with `{ source: 'local'; ... } | { source: 'history'; ... }`
- **Why:** Consumers guard against fields that can't exist for their source type
- **Files affected:** ~10
- **Complexity:** Medium

#### Add auth abstraction for credential storage

- **What:** Define `interface CredentialStore { getToken(): Promise<TokenResult> }` with macOS Keychain implementation
- **Why:** `auth-guard.ts` is hardcoded to macOS `security` command; can't unit test or port
- **Files affected:** 3
- **Complexity:** Medium

### Dependency Graph: Before → After

**Before:**

```
index.ts ──→ db.prepare() (raw SQL)
           ──→ handlers/sprint-local (SQL + handlers mixed)
sprint-pr-poller ──→ handlers/sprint-local (wrong layer)
event-bus ──→ broadcast.ts (Electron coupled)
completion-handler ──→ execFileAsync('git'/'gh') (hardcoded)
local-agents ──→ new SdkProvider() (hardcoded)
shared/ ──→ main/agents/types (direction violation)
```

**After (Tier 1+2):**

```
index.ts ──→ data/sprint-queries (clean delegation)
           ──→ handlers/ (pure adapters)
sprint-pr-poller ──→ SprintPrPollerDeps interface (injectable)
event-bus ──→ notify callback (injectable)
completion-handler ──→ VcsClient interface (injectable)
local-agents ──→ SdkProvider interface (injectable)
shared/ ──→ (self-contained, all types here)
```

---

## What BDE Does Well

1. **Process boundary discipline** — Zero direct cross-process references; all IPC typed end-to-end
2. **AgentManager** — Textbook dependency injection; the integration test suite proves the pattern works
3. **Data layer** — Repository pattern with `db` parameter injection; in-memory SQLite tests
4. **Type safety** — `IpcChannelMap` + `safeHandle()` + `typedInvoke()` eliminate an entire class of IPC bugs
5. **UI component design** — `components/ui/` is a clean design system with zero business logic; panels are well-abstracted
6. **Path validation** — `validateRepoPath` prevents path traversal at the IPC boundary
7. **Test infrastructure** — 3 vitest configs, 45 test files, comprehensive integration tests for the agent pipeline
