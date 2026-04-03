# BDE Engineering Audit Report

> **Status: PARTIALLY ADDRESSED (2026-03-16)**
> Key fixes since this audit:
>
> - #1 (Shell injection in git.ts): Fixed — `execSync` string interpolation replaced with `execFileSync` argument arrays.
> - #8 (agents.json concurrent write corruption): Fixed — SQLite migration completed. `agents.json` replaced by `agent_runs` table.
> - Epic 3 (SQLite Migration): Completed. See `sqlite-migration-spec.md`.
> - #5 (Hardcoded Node version): Fixed — PATH uses `process.execPath` directory.
> - Remaining open: #2 (path validation), #3 (sandbox), #4 (handler test coverage), #6 (cost computation), #7 (TerminalView inline styles).

**Date:** 2026-03-16
**Auditor:** Senior Engineering Review (Claude Opus 4.6)
**Scope:** Full codebase — `src/` (103 non-test TS/TSX files, ~7,760 LOC in components/views)
**Version:** 0.1.0 (Electron 39.2.6, React 19.2.1, Zustand 5.0.11)

---

## 1. Architecture Assessment

### 1.1 Process Boundary Model

BDE follows the standard Electron three-process model:

| Layer        | Path                   | Responsibility                                                              |
| ------------ | ---------------------- | --------------------------------------------------------------------------- |
| **Main**     | `src/main/`            | Window lifecycle, IPC handlers, child process spawning, filesystem, git CLI |
| **Preload**  | `src/preload/index.ts` | Context bridge — 50+ typed API endpoints                                    |
| **Renderer** | `src/renderer/src/`    | React UI, Zustand stores, gateway WebSocket                                 |

**Verdict:** Clean separation. The preload bridge (`src/preload/index.ts:5-125`) is the sole IPC surface. No direct `require('electron')` calls leak into the renderer.

### 1.2 Clean Architecture Compliance

**Strengths:**

- Shared types live in `src/shared/types.ts` — single source of truth for `AgentMeta`, `SpawnLocalAgentArgs`, `SpawnLocalAgentResult`.
- All IPC handlers use a consistent `safeHandle()` wrapper (`src/main/ipc-utils.ts:4-16`) for centralized error logging.
- RPC to the gateway is proxied through main process (`src/main/handlers/gateway-handlers.ts:5-15`) to avoid CORS — correct architectural decision.

**Boundary Violations:**

1. **git.ts mixes shell execution styles** (`src/main/git.ts`): Lines 24, 48, 121 use `execSync()` with string interpolation while lines 97-98, 107, 112, 116, 153 correctly use `execFileSync()` with argument arrays. Inconsistent and creates injection surface (see Security §4).
2. **Hardcoded repo paths** (`src/main/git.ts:6-10`): `REPO_PATHS` maps repo names to `~/Documents/Repositories/{name}`. This couples the main process to a specific filesystem layout. Should be config-driven.
3. **Module-scope mutable state**: `_pendingKillTimers` in `sessions.ts:36`, `cwdCache` in `local-agents.ts:48`, `activeAgentProcesses` in `local-agents.ts:45`, `_gatewayClient` in `gateway.ts:16` — all live outside Zustand. Documented as intentional (non-serializable objects), but no lifecycle registry exists.

### 1.3 Store Design

10 Zustand stores with clear single-responsibility:

| Store            | File                       | LOC | Polling                        | Persistence                       |
| ---------------- | -------------------------- | --- | ------------------------------ | --------------------------------- |
| `sessions`       | `stores/sessions.ts`       | 248 | Via `SessionsView` setInterval | No                                |
| `gateway`        | `stores/gateway.ts`        | 79  | WebSocket auto-reconnect       | No                                |
| `terminal`       | `stores/terminal.ts`       | 116 | No                             | No                                |
| `localAgents`    | `stores/localAgents.ts`    | 136 | Via consumers                  | `zustand/persist` (spawnedAgents) |
| `agentHistory`   | `stores/agentHistory.ts`   | 86  | Log polling 1s                 | No                                |
| `splitLayout`    | `stores/splitLayout.ts`    | 43  | No                             | No                                |
| `toasts`         | `stores/toasts.ts`         | 73  | Auto-dismiss timers            | No                                |
| `theme`          | `stores/theme.ts`          | 36  | No                             | localStorage                      |
| `ui`             | `stores/ui.ts`             | 14  | No                             | No                                |
| `commandPalette` | `stores/commandPalette.ts` | 16  | No                             | No                                |

**Good:** Zustand selectors used throughout (`useSessionsStore((s) => s.sessions)`) to minimize re-renders. The `logPoller.ts` abstraction is cleanly shared between `localAgents` and `agentHistory` stores.

**Concern:** Polling intervals are scattered across consumers (`SessionsView.tsx:48`, `ChatThread.tsx:145-151`), not centralized in stores. This means unmounting a view silently kills its polling — correct for cleanup, but makes it hard to audit which polls are active at any time.

---

## 2. Code Quality

### 2.1 Functions Doing Multiple Things

| File              | Lines  | Function              | Issue                                                                                                                                                                 |
| ----------------- | ------ | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `local-agents.ts` | 97-172 | `getAgentProcesses()` | Parses `ps` output, resolves CWDs via `lsof`, evicts cache, AND reconciles agent history. 75 lines, 4 responsibilities.                                               |
| `sessions.ts`     | 76-139 | `fetchSessions()`     | Fetches sessions + sub-agents in parallel (good), then handles auto-follow logic. The label derivation (`deriveLabel`, lines 108-113) is inline instead of extracted. |
| `ChatThread.tsx`  | 64-118 | `poll()`              | Fetches messages, detects new/reset/streaming states, updates refs, manages scroll position, and detects streaming — all in one callback.                             |

### 2.2 Naming

Generally strong. A few issues:

- `_isActive` in `SubAgent` interface (`sessions.ts:32`) — underscore prefix on a public interface field implies private/internal but it's used in `useUnifiedAgents.ts:99`.
- `truncate()` in `useUnifiedAgents.ts:34` — generic name shadows potential String prototype extensions. Better: `truncateLabel()`.
- `termId` counter (`terminal-handlers.ts:9`) — global mutable counter. Should use `crypto.randomUUID()` for consistency with the rest of the codebase.

### 2.3 Magic Numbers

Constants are well-extracted to `src/renderer/src/lib/constants.ts`. Exceptions:

| File               | Line  | Value                     | Should Be                                            |
| ------------------ | ----- | ------------------------- | ---------------------------------------------------- |
| `ChatThread.tsx`   | 18-19 | `1_000`, `5_000`          | `POLL_STREAMING`, `POLL_IDLE` in constants.ts        |
| `local-agents.ts`  | 21    | `7 * 24 * 60 * 60 * 1000` | `LOG_MAX_AGE_MS` (named but not in shared constants) |
| `local-agents.ts`  | 31    | `v22.22.0`                | Hardcoded Node version in PATH                       |
| `agent-history.ts` | 143   | `500`                     | `MAX_AGENT_HISTORY_COUNT`                            |
| `gateway.ts` (lib) | 6-7   | `30_000`, `1_000`         | Already named `MAX_BACKOFF`/`BASE_BACKOFF` — good    |
| `App.tsx`          | 190   | `'1'...'7'`               | Derived from `VIEW_ORDER.length`                     |

### 2.4 Null Handling

Mostly defensive. Notable patterns:

- `useUnifiedAgents.ts:55-60`: `safeTimestamp()` handles null, undefined, number, and string — excellent.
- `sessions.ts:92`: `sessionsResult.value.sessions ?? []` — proper nullish coalescing.
- `agent-history.ts:25`: Bare `catch {}` swallows all errors including permission denied, disk full. Should distinguish ENOENT from other failures.

### 2.5 Component Size

Files over 200 LOC (excluding tests):

| File                 | LOC | Verdict                                                                                             |
| -------------------- | --- | --------------------------------------------------------------------------------------------------- |
| `TerminalView.tsx`   | 446 | **Too large.** 350+ lines of inline styles. Should extract tab-bar and toolbar into sub-components. |
| `CostView.tsx`       | 444 | **Too large.** View + chart logic + table rendering in one file.                                    |
| `DiffView.tsx`       | 410 | Borderline. Complex but cohesive.                                                                   |
| `SessionsView.tsx`   | 358 | Acceptable — multi-layout orchestrator.                                                             |
| `ChatThread.tsx`     | 321 | Acceptable — complex polling + rendering logic.                                                     |
| `MemoryView.tsx`     | 299 | Borderline. Could extract file list.                                                                |
| `SettingsView.tsx`   | 276 | Acceptable.                                                                                         |
| `CommandPalette.tsx` | 266 | Acceptable — self-contained modal.                                                                  |

---

## 3. Performance

### 3.1 Re-render Analysis

**App.tsx:151-155 — Cost computation on every render:**

```ts
const totalCost = sessions.reduce((sum, s) => { ... }, 0)
```

This recalculates cost for every session on every render of `App`. Since `sessions` is subscribed via Zustand selector, any session update (including `updatedAt` ticks from polling) triggers a full reduce. Should be `useMemo` or a derived store field.

**ChatThread.tsx:242 — Message list not virtualized:**
The full message array (up to `CHAT_HISTORY_LIMIT = 100`) renders inline. Each message runs `renderContent()` (markdown parsing). For long conversations with code blocks, this could cause frame drops. Consider `react-window` or similar.

**TerminalView.tsx:390-442 — All tabs mounted:**
All terminal tabs are mounted simultaneously with `display: none` toggling. Each mounted `TerminalPane` holds an xterm.js instance. With 5+ tabs, this consumes significant memory (xterm buffers).

**AgentList.tsx — Filter on every keystroke:**
Filter input at `SessionsView.tsx:297` triggers re-render of `AgentList` on every keystroke. The unified agent list is re-derived via `useUnifiedAgents()` hook (useMemo). Currently acceptable for small lists but no debounce.

### 3.2 Polling Cleanup

| Poller                | Cleanup                                                    | Verified |
| --------------------- | ---------------------------------------------------------- | -------- |
| Sessions (10s)        | `SessionsView.tsx:49` clearInterval in useEffect return    | Yes      |
| Chat (1s/5s adaptive) | `ChatThread.tsx:153-155` clearTimeout in useEffect return  | Yes      |
| Log (1s)              | `logPoller.ts:37-42` clearInterval in `stopLogPolling()`   | Yes      |
| Gateway WS reconnect  | `gateway.ts:209-222` cleanup() clears timer + closes WS    | Yes      |
| Toast auto-dismiss    | `toasts.ts:42-44` setTimeout per toast, removed on dismiss | Yes      |

All pollers have proper cleanup. No leaked intervals detected.

### 3.3 Bundle

Dependencies are reasonable for an Electron app. Potential bloat:

- `framer-motion@12.37.0` — used for 3 animations (ShortcutsOverlay, ToastContainer, CommandPalette). Tree-shaking mitigates but still ~30KB min+gz.
- `lucide-react@0.577.0` — icon library, tree-shakeable.
- `react-resizable-panels@4.7.2` — used only in TerminalView split. Lightweight.

No obvious bundle issues for a desktop app.

---

## 4. Security

### 4.1 Shell Injection

**CRITICAL — `src/main/git.ts:24`:**

```ts
execSync(`git diff ${ref}...HEAD`, { cwd: repoPath, ... })
```

The `ref` parameter comes from `getDiff(repoPath, base?)` where `base` defaults to `'origin/main'`. The IPC handler at `git-handlers.ts:23` passes user-supplied `base` directly:

```ts
safeHandle('get-diff', (_e, repoPath: string, base?: string) => getDiff(repoPath, base))
```

If a renderer-side exploit could control `base`, it could inject arbitrary shell commands. **Fix:** Use `execFileSync('git', ['diff', `${ref}...HEAD`], ...)`.

**MODERATE — `src/main/git.ts:48`:**

```ts
execSync(`git log --oneline -${count}`, ...)
```

`count` is typed as `number` but comes from IPC (`git-handlers.ts:25`). If a malicious renderer passes a string, JS coercion could produce unexpected results. Low practical risk but inconsistent with the safe patterns used elsewhere.

**SAFE — Agent spawning (`local-agents.ts:205-217`):**
Uses `spawn('claude', [...args])` with argument array — correct. PATH augmentation (`local-agents.ts:26-32`) uses hardcoded paths, not user input.

### 4.2 safeHandle Coverage

All 30+ IPC handlers are wrapped in `safeHandle()` (**verified by audit**). The one exception is `terminal:write` (`terminal-handlers.ts:37`) which uses `ipcMain.on()` (fire-and-forget) instead of `ipcMain.handle()` — acceptable since it's a write-only data pipe with no return value.

### 4.3 Credential Exposure

| Credential        | Storage                                                                            | Exposure                                                                                 |
| ----------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Gateway token     | `~/.openclaw/openclaw.json` (disk) → main process memory → gateway.ts module scope | Token crosses IPC once via `getGatewayConfig()`. Not persisted in renderer localStorage. |
| GitHub token      | Same config file → main process only                                               | Fetched via `getGitHubToken()` IPC. Not cached in renderer.                              |
| Supabase anon key | Config file or `VITE_SUPABASE_ANON_KEY` env                                        | **Public key** — acceptable in renderer. Used for read-only sprint queries.              |

**Electron sandbox:** `sandbox: false` at `src/main/index.ts:28`. This means the renderer process has access to Node.js APIs if context isolation fails. Context isolation is not explicitly set but defaults to `true` in Electron 39.x. **Recommendation:** Explicitly set `contextIsolation: true` and consider `sandbox: true`.

### 4.4 Path Traversal

- `readMemoryFile(path)` at `preload/index.ts:19` — passes user-supplied path to `ipcRenderer.invoke('read-memory-file', path)`. The main-side handler should validate the path is within `~/.openclaw/workspace/memory/`. **Not audited — handler in `fs.ts` not reviewed in detail.**
- `tailAgentLog({ logPath })` at `preload/index.ts:67-71` — same concern. `logPath` could point anywhere.

---

## 5. Test Coverage

### 5.0 Test Runner Status

**`npm test` (vitest run) fails/hangs.** Two issues observed:

1. **Worktree bleed:** Vitest picks up `.spec.ts` files from `.worktrees/` directories (e.g., `.worktrees/tech-debt-s6/node_modules/exponential-backoff/src/backoff.spec.ts`). These are Jest-based tests that fail with `jest is not defined` under Vitest. The Vitest config needs an explicit `exclude` for `.worktrees/` and `node_modules/`.
2. **Flaky assertion:** `localAgents.test.ts` > `sendToAgent calls IPC and logs error on { ok: false }` fails with `→ agent busy` — suggests the mock isn't properly isolating state between tests, or a real IPC call is leaking.

### 5.1 What's Tested (29 test files)

**Stores (9 files):** agentHistory, gateway, localAgents, sessions, terminal, theme, toasts, ui, unifiedAgents — **excellent store coverage**.

**Components (10 files):** Button, Badge, EmptyState, ErrorBoundary, Input, Spinner, Textarea (UI primitives), CommandPalette, StatusBar, TitleBar, ToastContainer, ChatThread, MessageInput, SpawnModal.

**Libs (4 files):** cost, diff-parser, gateway client, rpc.

**Main process (1 file):** `git.test.ts` only.

**Views (1 file):** `smoke.test.tsx` — likely just import/render checks.

### 5.2 Critical Untested Paths

| Gap                            | Risk   | File                                                                               |
| ------------------------------ | ------ | ---------------------------------------------------------------------------------- |
| Main process handlers          | High   | `src/main/handlers/*.ts` — no tests for any of the 8 handler registrations         |
| Agent spawning + lifecycle     | High   | `src/main/local-agents.ts` — spawn, kill, stdin messaging, CWD resolution untested |
| Agent history persistence      | High   | `src/main/agent-history.ts` — JSON file read/write, pruning, log management        |
| IPC round-trip                 | High   | No integration test from renderer → preload → main → response                      |
| Terminal PTY lifecycle         | Medium | `terminal-handlers.ts` — create, write, resize, kill, data broadcast               |
| Config file parsing            | Medium | `src/main/config.ts` — error paths (missing file, missing token, corrupt JSON)     |
| Path traversal in fs handlers  | High   | `src/main/fs.ts` — file read/write with user-supplied paths                        |
| DiffView, CostView, MemoryView | Low    | No component tests for 3 of 7 views                                                |
| Keyboard shortcuts             | Medium | App-level and view-level shortcuts untested end-to-end                             |

---

## 6. Top 10 Issues (Ranked by Severity)

### #1 — Shell Injection in git.ts (Critical)

- **File:** `src/main/git.ts:24`
- **Lines:** 21-31
- **Description:** `execSync(\`git diff ${ref}...HEAD\`)`interpolates user-supplied`ref` parameter into a shell command string. An attacker who controls the renderer (XSS, compromised dependency) could execute arbitrary commands.
- **Fix:** Replace with `execFileSync('git', ['diff', ref + '...HEAD'], opts)`. Apply same pattern to `getLog()` at line 48 and `gitPush()` at line 121.

### #2 — No Path Validation on File Read/Write IPC (High)

- **File:** `src/preload/index.ts:18-21`
- **Lines:** 18-21
- **Description:** `readMemoryFile(path)` and `writeMemoryFile(path, content)` accept arbitrary paths from the renderer. A compromised renderer could read `/etc/passwd` or write to sensitive locations.
- **Fix:** Validate paths in the main process handler — ensure they start with `~/.openclaw/workspace/memory/` and contain no `..` traversal.

### #3 — Sandbox Disabled, Context Isolation Implicit (High)

- **File:** `src/main/index.ts:26-29`
- **Lines:** 26-29
- **Description:** `sandbox: false` is set explicitly. `contextIsolation` is not set (relies on Electron default). If a future Electron update changes defaults or a bug bypasses context isolation, the renderer gains full Node.js access.
- **Fix:** Explicitly set `contextIsolation: true, sandbox: true`. Audit preload bridge for any APIs that would break under sandbox.

### #4 — Zero Test Coverage for Main Process Handlers (High)

- **File:** `src/main/handlers/*.ts` (all 8 files)
- **Lines:** All
- **Description:** No unit or integration tests exist for any IPC handler. Agent spawning, git operations, terminal PTY management, and config loading are entirely untested. The single `git.test.ts` only tests the git utility functions, not the IPC wiring.
- **Fix:** Create handler-level tests using Electron's `ipcMain` test harness or extract pure functions for unit testing.

### #5 — Hardcoded Node Version in PATH (Medium)

- **File:** `src/main/local-agents.ts:31`
- **Lines:** 26-32
- **Description:** `${process.env.HOME}/.nvm/versions/node/v22.22.0/bin` is hardcoded. When the user updates Node, the spawned `claude` process won't find the correct binary.
- **Fix:** Resolve the active nvm version dynamically: `execSync('bash -lc "which node"')` or read the nvm alias, or use `process.execPath` to find the running Node's bin directory.

### #6 — Cost Computed on Every Render (Medium)

- **File:** `src/renderer/src/App.tsx:151-155`
- **Lines:** 151-155
- **Description:** `sessions.reduce(...)` runs `calcCost()` for every session on every render of the root `App` component. Since `sessions` changes on every 10s poll, this triggers unnecessary work including a full re-render of `TitleBar`.
- **Fix:** Wrap in `useMemo(() => ..., [sessions])` or move to a derived field in the sessions store.

### #7 — TerminalView Inline Styles (Medium)

- **File:** `src/renderer/src/views/TerminalView.tsx`
- **Lines:** 94-443 (350 lines of inline style objects)
- **Description:** The entire TerminalView uses inline `style={{...}}` objects that are recreated on every render. This defeats React's reconciliation optimization (new objects every time = always re-render). Also 446 LOC in one file.
- **Fix:** Extract to CSS classes or use the design-system tokens via a stylesheet. Break into `TerminalTabBar`, `TerminalToolbar`, and `TerminalContent` sub-components.

### #8 — agents.json Concurrent Write Corruption (Medium)

- **File:** `src/main/agent-history.ts:30-33`
- **Lines:** 30-33, 98-103
- **Description:** `readIndex()` → `writeIndex()` is not atomic. If two concurrent IPC calls (e.g., `appendLog` and `updateAgentMeta`) race, one write clobbers the other. The `getAgentProcesses()` reconciliation loop (`local-agents.ts:154-167`) runs every 5s and calls `updateAgentMeta()` for each stale agent sequentially — amplifying the race window.
- **Fix:** Use a file lock (e.g., `proper-lockfile`) or switch to SQLite (per existing `sqlite-migration-spec.md`).

### #9 — Terminal Data Broadcast to All Windows (Low)

- **File:** `src/main/handlers/terminal-handlers.ts:27`
- **Lines:** 26-31
- **Description:** `BrowserWindow.getAllWindows()[0]?.webContents.send(...)` assumes only one window. If multiple windows exist, only the first receives terminal data. Other windows get nothing.
- **Fix:** Track which `BrowserWindow` created each terminal and send data to that specific window.

### #10 — Session `sessions:getHistory` Returns Empty Array (Low)

- **File:** `src/main/handlers/agent-handlers.ts:61-63`
- **Lines:** 61-63
- **Description:** `sessions:getHistory` handler always returns `[]` — a stub. This means the agent output tab feature (`AgentOutputTab.tsx`) can never display session history through this code path.
- **Fix:** Implement the handler or remove the dead registration to avoid confusion.

---

## 7. Epic Candidates (Next 2 Weeks)

### Epic 1: Security Hardening

**Goal:** Eliminate injection vectors and lock down IPC boundaries.

| Story                                                                                           | Estimate | Priority |
| ----------------------------------------------------------------------------------------------- | -------- | -------- |
| Replace all `execSync()` string interpolation in `git.ts` with `execFileSync()` argument arrays | S        | P0       |
| Add path validation to `readMemoryFile` / `writeMemoryFile` / `tailAgentLog` IPC handlers       | S        | P0       |
| Set `contextIsolation: true, sandbox: true` in `BrowserWindow` config; audit preload for compat | M        | P0       |
| Resolve nvm Node path dynamically instead of hardcoding `v22.22.0`                              | S        | P1       |

### Epic 2: Main Process Test Coverage

**Goal:** Cover the untested main process — handlers, agent lifecycle, persistence.

| Story                                                                           | Estimate | Priority |
| ------------------------------------------------------------------------------- | -------- | -------- |
| Unit tests for `agent-history.ts` — CRUD, pruning, concurrent writes            | M        | P0       |
| Unit tests for `local-agents.ts` — spawn, kill, CWD resolution, stdin messaging | L        | P0       |
| Integration tests for git handlers — status, diff, commit, push round-trips     | M        | P1       |
| Test `config.ts` error paths — missing file, missing token, corrupt JSON        | S        | P1       |
| Terminal handler tests — create, write, resize, kill lifecycle                  | M        | P2       |

### Epic 3: SQLite Migration (per existing spec)

**Goal:** Replace `agents.json` with SQLite to fix concurrent write corruption.

| Story                                                              | Estimate | Priority |
| ------------------------------------------------------------------ | -------- | -------- |
| Design schema: agents table, logs table, migrations runner         | M        | P0       |
| Implement `AgentRepository` class with CRUD + pruning              | L        | P0       |
| Migration script: read existing `agents.json` → insert into SQLite | S        | P1       |
| Update all agent-history callers to use new repository             | M        | P1       |
| Remove JSON file code, update tests                                | S        | P2       |

### Epic 4: TerminalView Refactor

**Goal:** Reduce TerminalView from 446 LOC, eliminate inline styles, improve perf.

| Story                                                                 | Estimate | Priority |
| --------------------------------------------------------------------- | -------- | -------- |
| Extract `TerminalTabBar` component with CSS classes                   | M        | P1       |
| Extract `TerminalToolbar` component                                   | S        | P1       |
| Convert all inline `style={{}}` to design-system CSS                  | M        | P1       |
| Implement tab virtualization (unmount hidden PTYs after idle timeout) | L        | P2       |

### Epic 5: Performance Optimization

**Goal:** Fix known re-render and computation waste.

| Story                                                                                   | Estimate | Priority |
| --------------------------------------------------------------------------------------- | -------- | -------- |
| Memoize `totalCost` in `App.tsx` with `useMemo`                                         | S        | P1       |
| Add `react-window` virtualization to ChatThread message list                            | M        | P2       |
| Debounce agent list filter input (150ms)                                                | S        | P2       |
| Add derived `runningCount` + `totalCost` fields to sessions store (avoid recomputation) | S        | P2       |

### Epic 6: Polling Architecture Consolidation

**Goal:** Centralize polling lifecycle for debuggability and power efficiency.

| Story                                                                        | Estimate | Priority |
| ---------------------------------------------------------------------------- | -------- | -------- |
| Create `PollingRegistry` that tracks all active intervals with names + rates | M        | P2       |
| Add visibility-based throttling — slow polls when window is hidden           | M        | P2       |
| Add DevTools panel showing active pollers, last tick, next tick              | L        | P3       |

### Epic 7: IPC Type Safety

**Goal:** Ensure IPC channel names and payload shapes are type-checked end-to-end.

| Story                                                                      | Estimate | Priority |
| -------------------------------------------------------------------------- | -------- | -------- |
| Define `IpcChannelMap` type mapping channel names → request/response types | M        | P2       |
| Generate preload API from channel map (eliminate manual duplication)       | L        | P2       |
| Add exhaustiveness check — unused channels flagged at compile time         | M        | P3       |

---

## Appendix: File Inventory

### Source Files (103 non-test)

```
src/main/          (9 files)   — Electron main process
src/preload/       (2 files)   — IPC bridge
src/renderer/src/  (88 files)  — React application
  ├── stores/      (10 files)  — Zustand state
  ├── hooks/       (2 files)   — Custom React hooks
  ├── lib/         (13 files)  — Utilities, RPC, constants
  ├── components/  (32 files)  — UI components
  ├── views/       (7 files)   — Page-level views
  ├── services/    (3 files)   — Git, memory, settings
  └── design-system/ (2 files) — Tokens, exports
src/shared/        (1 file)    — Shared types
```

### Test Files (29)

```
src/main/__tests__/                        (1)
src/renderer/src/stores/__tests__/         (9)
src/renderer/src/lib/__tests__/            (4)
src/renderer/src/components/ui/__tests__/  (7)
src/renderer/src/components/layout/__tests__/ (4)
src/renderer/src/components/sessions/__tests__/ (3)
src/renderer/src/views/__tests__/          (1)
```

### Polling Intervals (from `constants.ts`)

| Constant                   | Interval | Consumer                  |
| -------------------------- | -------- | ------------------------- |
| `POLL_LOG_INTERVAL`        | 1s       | `logPoller.ts`            |
| `POLL_PROCESSES_INTERVAL`  | 5s       | `AgentHistoryPanel.tsx`   |
| `POLL_AGENTS_INTERVAL`     | 10s      | `AgentHistoryPanel.tsx`   |
| `POLL_SESSIONS_INTERVAL`   | 10s      | `SessionsView.tsx`        |
| `POLL_GIT_STATUS_INTERVAL` | 30s      | `DiffView.tsx`            |
| `POLL_SPRINT_INTERVAL`     | 30s      | `useTaskNotifications.ts` |
| `POLL_PR_LIST_INTERVAL`    | 60s      | `PRList.tsx`              |
| Chat streaming             | 1s       | `ChatThread.tsx` (inline) |
| Chat idle                  | 5s       | `ChatThread.tsx` (inline) |
