# BDE Feature Reference Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a ~400-line feature reference document that all BDE agents auto-load, giving them product knowledge they currently lack.

**Architecture:** Single markdown file (`docs/BDE_FEATURES.md`) loaded via `@` directive in CLAUDE.md. SDK `settingSources` handles injection into all agent contexts automatically.

**Tech Stack:** Markdown only. No code changes, no dependencies.

**Spec:** `docs/superpowers/specs/2026-03-30-bde-feature-reference-design.md`

---

### Task 1: Create BDE_FEATURES.md — Header & Workflow Overview

**Files:**

- Create: `docs/BDE_FEATURES.md`

- [ ] **Step 1: Create the file with header and workflow overview**

Write `docs/BDE_FEATURES.md` with the following content (this is the foundation — subsequent tasks append sections):

```markdown
# BDE Feature Reference

BDE (Birkeland Development Environment) is an Electron desktop app for autonomous software development. It orchestrates AI agents that execute sprint tasks — from spec creation through code, PR, and merge.

This document is auto-loaded by all BDE agents via the `@` directive in CLAUDE.md. It serves as both agent context and user documentation.

## How Work Flows Through BDE

1. **Create** — Task Workbench: draft specs with AI copilot assistance, define dependencies between tasks, run readiness checks before queuing
2. **Queue** — Tasks enter the Sprint Pipeline with status `queued`. External services (Life OS, claude-chat-service, claude-task-runner) can submit tasks via the Queue API on port 18790
3. **Execute** — Agent Manager claims queued tasks, spawns pipeline agents in isolated git worktrees. Agents write code, run tests, and commit. If `playground_enabled` is set, HTML file writes render inline via Dev Playground
4. **Review** — Agents push branches and open PRs automatically. PR Station provides full code review (CI status, diffs, inline comments, merge controls). Sprint PR Poller auto-tracks merge/close every 60s
5. **Complete** — Merged PRs mark tasks `done`. Dependency resolution automatically unblocks downstream tasks with satisfied dependencies

**Supporting views:** Dashboard (aggregated metrics), IDE (Monaco editor + terminal), Source Control (git staging/commits/push), Settings (9 configuration tabs)
```

- [ ] **Step 2: Verify the file exists and reads correctly**

Run: `head -20 docs/BDE_FEATURES.md`
Expected: The header and first few lines of the workflow overview.

- [ ] **Step 3: Commit**

```bash
git add docs/BDE_FEATURES.md
git commit -m "docs: create BDE feature reference — header and workflow overview"
```

---

### Task 2: Add Task System section

**Files:**

- Modify: `docs/BDE_FEATURES.md` (append)

- [ ] **Step 1: Append Task System section**

Append to `docs/BDE_FEATURES.md`:

```markdown
## Task System

### Task Workbench

Planning and spec creation interface. Users draft task specs with AI copilot assistance, configure task properties, and run readiness checks before queuing.

- **Copilot**: AI chat assistant for drafting specs. Text-only, uses Agent SDK streaming via `workbench:chatStream` IPC. Messages persist to localStorage under `bde:copilot-messages` (capped at 100). Cannot use tools or explore code — for codebase-aware spec generation, use the Synthesizer instead
- **Readiness checks**: Validates spec quality before queuing. Specs require at least 2 `## heading` sections. Semantic checks use SDK with haiku model for speed
- **Spec types**: `spec` (structured markdown with headings — required for `status=queued`) or `prompt` (freeform text)
- **Dev Playground toggle**: Enables inline HTML rendering for the task's pipeline agent. When enabled, any `.html` file the agent writes will render in-app
- Related: Sprint Pipeline, Copilot, Synthesizer

### Sprint Pipeline

Execution monitoring view. Shows tasks flowing through stages as a vertical pipeline with real-time status updates.

- **Task statuses**: `backlog` | `queued` | `blocked` | `active` | `done` | `cancelled` | `failed` | `error`
- **UI partitions** (7 buckets): `backlog`, `todo`, `blocked`, `inProgress`, `awaitingReview`, `done`, `failed`. All UI components must use `partitionSprintTasks()` from the sprint tasks store — never map raw statuses directly
- **awaitingReview**: Tasks that are `active` or `done` with `pr_status=open` — shown separately so users can see what needs human review
- **failed bucket**: Combines `failed` + `error` + `cancelled` statuses
- **done sorting**: Most recent `completed_at` first
- Related: Task Workbench, Agent Manager, PR Station

### Task Dependencies

Tasks can declare dependencies on other tasks with `hard` or `soft` edges.

- **Hard dependency**: Downstream task is `blocked` until upstream completes successfully. If upstream fails, downstream stays blocked
- **Soft dependency**: Downstream unblocks regardless of upstream outcome (success or failure)
- **Auto-blocking**: Tasks with unsatisfied hard dependencies are automatically set to `blocked` status at creation time (handled in `sprint-local.ts` IPC handler)
- **Auto-resolution**: All terminal status paths (agent completion, manual status change, Queue API, PR poller) route through `TaskTerminalService` which triggers `resolve-dependents.ts` to unblock waiting tasks. Direct SQLite writes bypass this — always use IPC or Queue API
- **Dependency format**: `{id, type}` where `type` is `"hard"` or `"soft"`. Note: uses `id` not `taskId`
- **Cycle detection**: `dependency-index.ts` maintains an in-memory reverse index and rejects cycles at creation time
- Related: Sprint Pipeline, Queue API

### Queue API

Local HTTP server on port 18790 for external task management. Used by Life OS, claude-chat-service, and claude-task-runner.

- **Auth**: Bearer token via `Authorization` header or `?token=` query param. Key auto-generated on first access (`randomBytes(32)`, persisted to `taskRunner.apiKey` setting). If no key exists yet, unauthenticated requests are accepted
- **Base path**: All task endpoints use `/queue/tasks` prefix (not `/tasks`)
- **Endpoints**:
  - `POST /queue/tasks` — create task (requires `repo` field; `status=queued` requires `spec` or `?skipValidation=true`)
  - `GET /queue/tasks` — list tasks (supports `?status=` filter)
  - `GET /queue/tasks/:id` — get single task
  - `PATCH /queue/tasks/:id` — update safe fields only (`GENERAL_PATCH_FIELDS`)
  - `PATCH /queue/tasks/:id/status` — status transitions (validated)
  - `PATCH /queue/tasks/:id/dependencies` — update dependencies
- **WIP limit**: `MAX_ACTIVE_TASKS=5` enforced at claim endpoint — prevents overloading the agent pipeline
- **SSE**: `GET /queue/events` for real-time task update streaming
- **Field format**: API uses camelCase; internal SQLite uses snake_case. Mapping handled automatically
- Related: Task Dependencies, Agent Manager, Sprint Pipeline
```

- [ ] **Step 2: Verify section was appended**

Run: `grep -c "^###" docs/BDE_FEATURES.md`
Expected: 4 (Task Workbench, Sprint Pipeline, Task Dependencies, Queue API)

- [ ] **Step 3: Commit**

```bash
git add docs/BDE_FEATURES.md
git commit -m "docs: add Task System section to BDE feature reference"
```

---

### Task 3: Add Agent System section

**Files:**

- Modify: `docs/BDE_FEATURES.md` (append)

- [ ] **Step 1: Append Agent System section**

Append to `docs/BDE_FEATURES.md`:

```markdown
## Agent System

### Agent Types

BDE spawns five types of AI agents, each with different capabilities and contexts:

| Type        | Spawned by           | Interactive      | Tool access      | Worktree       | Playground |
| ----------- | -------------------- | ---------------- | ---------------- | -------------- | ---------- |
| Pipeline    | Agent Manager (auto) | No               | Full             | Yes (isolated) | If enabled |
| Adhoc       | User (Agents view)   | Yes (multi-turn) | Full             | No (repo dir)  | Always     |
| Assistant   | User (Agents view)   | Yes (multi-turn) | Full             | No (repo dir)  | Always     |
| Copilot     | Task Workbench       | Yes (chat)       | None (text-only) | No             | No         |
| Synthesizer | Task Workbench       | No (single-turn) | None             | No             | No         |

- **Pipeline**: Executes sprint tasks autonomously. Works in isolated git worktree. Commits, pushes branch, opens PR on completion. Prompt includes task spec/prompt and branch name
- **Adhoc**: User-spawned one-off tasks from the Agents view. Multi-turn sessions via SDK `query()` with session resumption (`resume: sessionId`). Works in repo directory directly
- **Assistant**: Same as adhoc but with assistant role framing — answers questions, suggests approaches, recommends Dev Playground for visual/UI work
- **Copilot**: Text-only spec drafting helper in Task Workbench. ~500 word limit. Cannot use tools, open URLs, or explore code. Helps users refine task specs through conversation
- **Synthesizer**: Generates structured specs from codebase context + user answers. Receives file tree and relevant code snippets. Outputs markdown with `## heading` sections. Single-turn (`maxTurns: 1`)

All agent types inherit project knowledge from CLAUDE.md (and this file) via SDK `settingSources: ['user', 'project', 'local']`. Prompts are composed by `buildAgentPrompt()` in `src/main/agent-manager/prompt-composer.ts`.

### Agent Manager

Orchestrates pipeline agent lifecycle. Core module: `src/main/agent-manager/`.

- **Drain loop**: Continuously watches for `queued` tasks, claims them (sets `claimed_by`), spawns agents in git worktrees via SDK
- **WIP limit**: `MAX_ACTIVE_TASKS` concurrent agents, enforced at Queue API claim endpoint
- **Watchdog**: Monitors agent health with configurable timeout. Default 1 hour, overridable per-task via `max_runtime_ms` field
- **Completion flow**: Agent exits normally → classify exit → push branch → open PR via `gh` CLI → mark task `done` → resolve dependents. On failure: retry up to 3x, then mark `failed`
- **Fast-fail detection**: 3 failures within 30s of starting = exhausted. Task marked `error` with diagnostic notes pointing to `~/.bde/agent-manager.log`
- **Worktree isolation**: Each pipeline agent gets `~/worktrees/bde/agent/<task-slug>`. Worktree cleaned up after completion (success or failure). Stale worktrees from previous runs should be cleaned with `git worktree prune`
- **Config**: Max concurrent agents, worktree base path, and max runtime are read once at startup. Changes via Settings UI take effect on next app restart
- Related: Sprint Pipeline, Task Dependencies, Queue API

### Dev Playground

Inline HTML rendering for visual prototyping, UI exploration, and interactive tools. Renders natively inside BDE — agents should never open a browser.

- **How it works**: When an agent writes an `.html` file (via the Write tool), BDE detects the `tool_result` message, reads the file, sanitizes it with DOMPurify, and broadcasts an `agent:playground` event to the renderer
- **User experience**: A PlaygroundCard appears in the agent's chat stream showing filename and size. Click it to open PlaygroundModal — a full-screen overlay with a sandboxed iframe. Three view modes: split (source + preview), preview only, source only
- **Security**: HTML sanitized via DOMPurify (strips `<script>` tags, event handlers like `onclick`/`onerror`, and `javascript:` URLs). Iframe uses `sandbox="allow-scripts"`. Maximum file size: 5MB
- **Pipeline agents**: Playground detection gated by `playground_enabled` flag on the task. File path must be within the agent's worktree (path traversal prevention)
- **Adhoc/assistant agents**: Playground always enabled. No path restriction since the user directly controls the session
- **When to use**: CSS theme builders, component playgrounds, data visualizations, architecture diagrams, interactive configuration tools, mockups — anything that benefits from visual output rendered in-app
- **How agents should use it**: Write a self-contained `.html` file using the Write tool. Include all CSS and JS inline. BDE handles detection, sanitization, and rendering automatically. Do NOT use shell `open` commands to launch a browser — the playground renders natively in the app
- Related: Agent Types, Task Workbench (playground toggle)
```

- [ ] **Step 2: Verify section was appended**

Run: `grep -c "^###" docs/BDE_FEATURES.md`
Expected: 7 (previous 4 + Agent Types, Agent Manager, Dev Playground)

- [ ] **Step 3: Commit**

```bash
git add docs/BDE_FEATURES.md
git commit -m "docs: add Agent System section to BDE feature reference"
```

---

### Task 4: Add Code Review section

**Files:**

- Modify: `docs/BDE_FEATURES.md` (append)

- [ ] **Step 1: Append Code Review section**

Append to `docs/BDE_FEATURES.md`:

```markdown
## Code Review

### PR Station

Full-featured code review dashboard for GitHub pull requests across all configured repositories.

- **PR list**: Multi-repo view with filter chips (by repo), status filtering (open/draft), sorting by title/date/checks. Real-time CI badge updates
- **Detail panel**: PR metadata, branch info, CI check status with failure annotations, merge status flags, conflict detection warnings
- **Diff viewer**: Side-by-side file diffs with syntax highlighting. Per-file status badges (Added/Deleted/Modified). Inline comment indicators with reply threads
- **Review workflow**: Inline comments on diff lines, batch review submission dialog (approve/request changes/comment), conversation timeline showing all review activity
- **Merge controls**: Squash, merge commit, or rebase strategies. Merge button disabled if conflicts detected or required checks failing. Confirmation dialog before merge
- **GitHub API**: All calls proxied through `github:fetch` IPC (token never in renderer). Response caching with 30s TTL via `github-cache.ts`. Call `invalidateCache()` after mutations
- Related: Sprint PR Poller, Sprint Pipeline

### Sprint PR Poller

Background process that automatically tracks PR outcomes for sprint tasks.

- **Runs every 60s** in main process (independent of renderer — works even if no window is focused)
- **Watches**: Tasks with `pr_status=open` — polls their GitHub PR for merge/close events
- **Auto-transitions**: Merged PR → task marked `done`. Closed PR → task marked `cancelled`. Both trigger dependency resolution via `TaskTerminalService`
- **PR fields** (`pr_url`, `pr_number`, `pr_status`): Set internally by completion handler and poller — NOT patchable via Queue API `GENERAL_PATCH_FIELDS`
- Related: PR Station, Agent Manager (completion flow)
```

- [ ] **Step 2: Commit**

```bash
git add docs/BDE_FEATURES.md
git commit -m "docs: add Code Review section to BDE feature reference"
```

---

### Task 5: Add Development Tools and App Shell sections

**Files:**

- Modify: `docs/BDE_FEATURES.md` (append)

- [ ] **Step 1: Append Development Tools and App Shell sections**

Append to `docs/BDE_FEATURES.md`:

```markdown
## Development Tools

### IDE

Integrated code editor with file explorer and terminal, built on Monaco.

- **Editor**: Monaco with syntax highlighting (auto-detected per file extension), multi-tab interface with dirty state tracking, unsaved-changes confirmation dialogs. CSP configured for Monaco web workers (`worker-src 'self' blob:`)
- **File explorer**: Tree view sidebar with expand/collapse state persistence. Double-click to open files. Binary file detection (opens read-only). Path-scoped to opened root directory for security
- **Terminal**: Multi-tab integrated terminal with split panes. Find-in-terminal, zoom controls (Cmd+/Cmd-/Cmd+0), new tab (Cmd+T), clear (Ctrl+L)
- **State persistence**: Open tabs, active file, sidebar and terminal collapse state saved to `ide.state` setting and restored on app launch (2s debounce on saves)
- **Keyboard shortcuts**: Cmd+B (toggle sidebar), Cmd+J (toggle terminal), Cmd+O (open folder), Cmd+S (save), Cmd+W (close tab), Cmd+/ (show shortcuts overlay)
- Related: Source Control, Panel System

### Source Control

Git workflow interface for staging, committing, and pushing across configured repositories.

- **Multi-repo support**: Repository selector when multiple repos configured. Branch selector with checkout
- **File sections**: Three groups — Staged changes, Modified (unstaged tracked files), Untracked (new files). Stage/unstage individual files or entire sections
- **Commit and push**: Commit message text area with "Commit" button (disabled when no staged files). Separate "Push" button with loading state feedback
- **Inline diff**: Click any file to preview diff in a drawer. Shows additions (green), deletions (red), and unchanged context lines
- **Error handling**: Persistent error banner at bottom with Retry and Dismiss buttons for commit/push failures
- **Auto-refresh**: Polls git status every 30s while the view is visible
- Related: IDE, PR Station

## App Shell

### Dashboard

Overview of task pipeline health, agent execution metrics, and recent activity. Default landing view (Cmd+1).

- **Status counters**: Active (cyan), Queued (orange), Blocked (red), PRs (blue), Done (cyan) — color-coded, clickable
- **Pipeline flow**: Visual stage boxes showing task progression through queued → active → blocked → done
- **Charts**: Hourly completions sparkline (last 24h), cost-per-run trend (last 20 runs), success rate donut (% done vs failed), average duration
- **Activity feed**: Recent agent events (errors, completions) color-coded by type, capped at 30 entries
- **Recent completions**: Last 5 done tasks with relative time labels. 24h cost total
- **Data refresh**: Polls every 60s with jitter + exponential backoff on errors via `useBackoffInterval`
- Related: Sprint Pipeline, Agent Manager

### Panel System

Flexible split-pane layout system for arranging views side-by-side with drag-and-drop docking.

- **Layout structure**: Recursive tree of leaf nodes (tab sets) and split nodes (horizontal/vertical). Each leaf holds one or more view tabs
- **Drag-and-drop**: 5-zone drop targets (top/bottom/left/right/center) for docking views. Visual overlay shows target zone during drag
- **Persistence**: Layout tree and active tabs saved to `panel.layout` setting on every mutation. Restored on app launch
- **Tear-off windows**: Views can be torn off into separate Electron windows. Each tear-off has its own independent panel layout. Tear-off windows set `persistable: false` to prevent overwriting the main window's saved layout
- **View shortcuts**: Dashboard (Cmd+1), Agents (Cmd+2), IDE (Cmd+3), Task Pipeline (Cmd+4), PR Station (Cmd+5), Source Control (Cmd+6), Settings (Cmd+7)
- Related: All views

### Settings

Application configuration organized into 9 tabs. Most settings persisted to SQLite `settings` table.

- **Connections**: GitHub token configuration, Claude API auth status, token refresh
- **Repositories**: Add/remove repos with `name`, `localPath`, `githubOwner`, `githubRepo`
- **Templates**: Task templates for common patterns
- **Agent**: SDK model selection, API key display
- **Agent Manager**: Max concurrent agents, worktree base path, max runtime per task. Changes require app restart
- **Cost**: Anthropic API billing information and cost tracking
- **Memory**: Local caching statistics
- **Appearance**: Theme toggle (dark/light), motion preferences
- **About**: Version info, log file locations, GitHub link
- **Keyboard navigation**: Arrow Left/Right, Home/End to cycle tabs
- Related: Agent Manager, Queue API (API key)
```

- [ ] **Step 2: Check total line count**

Run: `wc -l docs/BDE_FEATURES.md`
Expected: ~350-450 lines (within our target range)

- [ ] **Step 3: Commit**

```bash
git add docs/BDE_FEATURES.md
git commit -m "docs: add Development Tools and App Shell sections to BDE feature reference"
```

---

### Task 6: Wire into CLAUDE.md and verify

**Files:**

- Modify: `CLAUDE.md` (add 1 line)

- [ ] **Step 1: Add `@` directive to CLAUDE.md**

Add `@docs/BDE_FEATURES.md` on line 4 of `CLAUDE.md`, after the existing `@../../ARCHITECTURE.md` directive:

```markdown
# CLAUDE.md — BDE

@../../ARCHITECTURE.md
@docs/BDE_FEATURES.md

Electron desktop app (electron-vite + React + TypeScript) — the Birkeland Development Environment.
```

- [ ] **Step 2: Verify directive placement**

Run: `head -6 CLAUDE.md`
Expected: Both `@` directives visible on lines 3-4.

- [ ] **Step 3: Run typecheck and tests to confirm no regressions**

Run: `npm run typecheck`
Expected: Clean exit (no errors). The `@` directive is markdown-only — it should not affect TypeScript.

Run: `npm test`
Expected: All renderer tests pass. No test references `BDE_FEATURES.md`.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: wire BDE feature reference into CLAUDE.md via @ directive"
```

---

### Task 7: Manual verification — spawn adhoc agent

This is a manual verification step. After all commits are done:

- [ ] **Step 1: Start BDE dev server**

Run: `npm run dev`

- [ ] **Step 2: Spawn an adhoc agent from the Agents view**

Give it a task like: "How does the Dev Playground work in BDE?"

- [ ] **Step 3: Verify agent has feature knowledge**

The agent should answer from the BDE_FEATURES.md content without needing to `grep` or `Read` source files. It should know:

- Playground renders HTML inline (not in browser)
- It uses DOMPurify sanitization
- Pipeline agents need `playground_enabled`, adhoc always has it
- PlaygroundCard appears in chat, click for PlaygroundModal

If the agent doesn't have this knowledge, check that the `@docs/BDE_FEATURES.md` directive is being resolved by the SDK.
