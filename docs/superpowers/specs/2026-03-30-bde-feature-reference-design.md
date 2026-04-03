# Design Spec: BDE Feature Reference

## Problem

Agents spawned by BDE (adhoc, pipeline, assistant, copilot, synthesizer) inherit developer conventions from CLAUDE.md but have zero knowledge of what BDE actually does as a product. They don't know about the Sprint Pipeline, Dev Playground, PR Station, task dependencies, or the Queue API unless they read source code. This leads to agents making poor decisions — like opening HTML files in an external browser instead of using BDE's built-in playground renderer.

Users also lack a single reference for BDE's features and workflows.

## Solution

Create `docs/BDE_FEATURES.md` — a ~400-line feature reference that agents auto-load via the existing `@` directive mechanism in CLAUDE.md. It serves as both agent context and user documentation.

## Document Structure

### Hybrid approach: workflow overview + feature catalog

1. **Workflow overview (~30 lines)** — Shows how work flows through BDE end-to-end (create → queue → execute → review → complete). Gives any reader the big picture in 60 seconds.

2. **Feature sections (~350 lines)** — Each feature gets its own section with: description, key capabilities, important details, and related features. Grouped by domain:
   - Task System (Workbench, Sprint Pipeline, Dependencies, Queue API)
   - Agent System (Agent Types, Agent Manager, Dev Playground)
   - Code Review (PR Station, Sprint PR Poller)
   - Development Tools (IDE, Source Control)
   - App Shell (Dashboard, Panel System, Settings)

### Integration

- `CLAUDE.md` gets one new line: `@docs/BDE_FEATURES.md`
- All agents inherit the reference automatically via SDK `settingSources`
- No changes to `prompt-composer.ts` — the SDK handles file loading

### Token budget

~400 lines, moderate detail. Each feature gets a short paragraph + key details (endpoints, capabilities, gotchas). Enough for an agent to act on without scanning source code.

## Content Specification

### Section 1: Header & Workflow Overview

```markdown
# BDE Feature Reference

BDE (Birkeland Development Environment) is an Electron desktop app for
autonomous software development. It orchestrates AI agents that execute
sprint tasks — from spec creation through code, PR, and merge.

## How Work Flows Through BDE

1. **Create** — Task Workbench: draft specs with AI copilot, define
   dependencies, run readiness checks
2. **Queue** — Tasks move to Sprint Pipeline as `queued`. External
   services submit via Queue API (port 18790)
3. **Execute** — Agent Manager claims tasks, spawns agents in git
   worktrees. Agents write code, run tests, commit. If playground
   enabled, HTML files render inline via Dev Playground
4. **Review** — Agents push branches and open PRs. PR Station shows
   CI status, diffs, inline comments. Sprint PR Poller auto-tracks
   merge/close
5. **Complete** — Merged PRs mark tasks done. Dependency resolution
   unblocks downstream tasks automatically

Supporting views: Dashboard (metrics), IDE (editor + terminal),
Source Control (git staging), Settings (configuration)
```

### Section 2: Task System

Covers Task Workbench, Sprint Pipeline, Task Dependencies, Queue API.

- **Task Workbench**: Spec creation with AI copilot (text-only, SDK streaming, localStorage persistence). Readiness checks validate spec quality. `playground_enabled` toggle. Spec types: `spec` (structured) or `prompt` (freeform).
- **Sprint Pipeline**: Vertical pipeline view with 7 UI partition buckets (backlog, todo, blocked, inProgress, awaitingReview, done, failed). Components must use `partitionSprintTasks()` — not raw statuses. `awaitingReview` = task with `pr_status=open`.
- **Task Dependencies**: `depends_on` with `hard`/`soft` edges. Hard deps block downstream until upstream succeeds. Auto-blocking at creation. Auto-resolution via `TaskTerminalService` on all terminal paths. Format: `{id, type}`.
- **Queue API**: HTTP on port 18790. Bearer auth (auto-generated key). All endpoints under `/queue/tasks`. POST requires `repo` field. Status=queued requires `spec`. WIP limit enforced at claim. SSE for real-time updates.

### Section 3: Agent System

Covers Agent Types, Agent Manager, Dev Playground.

- **Agent Types**: 5 types (pipeline, adhoc, assistant, copilot, synthesizer). Pipeline = automated in worktree. Adhoc/assistant = interactive with session resumption. Copilot = text-only spec helper. Synthesizer = spec generator from codebase context. All inherit CLAUDE.md via `settingSources`.
- **Agent Manager**: Drain loop claims queued tasks, spawns in worktrees. WIP limit, 1-hour watchdog (overridable via `max_runtime_ms`). Completion: push branch → open PR → mark done. Fast-fail: 3 failures in 30s = error. Config read at startup (restart required for changes).
- **Dev Playground**: Inline HTML rendering. Agent writes `.html` via Write tool → BDE detects, sanitizes (DOMPurify), broadcasts `agent:playground` event → PlaygroundCard in chat → click for PlaygroundModal (sandboxed iframe, split/preview/source). Pipeline: gated by `playground_enabled`, path must be in worktree. Adhoc: always enabled, no path restriction. 5MB limit. **Agents must NOT open browsers — playground renders natively in-app.**

### Section 4: Code Review

Covers PR Station, Sprint PR Poller.

- **PR Station**: Multi-repo PR dashboard. Filter by repo/status, sort by title/date/checks. Detail panel with CI badges, merge status, conflict detection. Inline diff viewer with syntax highlighting and comments. Batch review submission. Merge strategies: squash/merge/rebase. GitHub API proxied through IPC, cached 30s TTL.
- **Sprint PR Poller**: Runs every 60s in main process. Polls PR status for tasks with `pr_status=open`. Auto-marks tasks `done` (merged) or `cancelled` (closed). Independent of renderer.

### Section 5: Development Tools

Covers IDE, Source Control.

- **IDE**: Monaco editor with syntax highlighting, multi-tab, dirty state tracking. File explorer sidebar (tree view, persisted state). Integrated terminal with split panes, find, zoom. State persists across sessions. Keyboard shortcuts: Cmd+B/J/O/S/W, Cmd+/ for shortcuts overlay.
- **Source Control**: Multi-repo git UI. Staged/modified/untracked file sections. Stage/unstage individual or all. Commit + push with loading states. Inline diff drawer. Error banner with retry. Branch selector. Polls every 30s.

### Section 6: App Shell

Covers Dashboard, Panel System, Settings.

- **Dashboard**: Status counters (active, queued, blocked, PRs, done). Pipeline flow visualization. Charts: hourly completions, cost-per-run trend, success rate donut, average duration. Activity feed (30 events). Recent completions. Polls 60s with jitter/backoff.
- **Panel System**: Recursive split-pane layout. Drag-and-drop 5-zone docking. Multi-tab leaves. Layout persists to settings. Tear-off windows with independent layouts (`persistable: false` prevents overwriting main layout).
- **Settings**: 9 tabs — Connections, Repositories, Templates, Agent, Agent Manager, Cost, Memory, Appearance, About. Most settings in SQLite. Agent Manager config requires restart. Keyboard nav (arrow keys, Home/End).

## Implementation

### Files to create

- `docs/BDE_FEATURES.md` — the feature reference (~400 lines)

### Files to modify

- `CLAUDE.md` — add `@docs/BDE_FEATURES.md` directive

### What NOT to change

- `prompt-composer.ts` — no changes needed, SDK handles `@` loading
- No UI changes — this is documentation only
- No new dependencies

## Testing

- Verify `@docs/BDE_FEATURES.md` in CLAUDE.md resolves correctly (spawn an adhoc agent and check it has feature knowledge)
- Run `npm run typecheck` and `npm test` to confirm no regressions
- Manual: spawn an adhoc agent, ask it "how does the Dev Playground work?" — it should answer from the reference without reading source code

## Success Criteria

1. Any agent spawned by BDE can answer "what features does BDE have?" without scanning code
2. An adhoc agent asked to create visual output uses the playground (not browser)
3. The document is concise enough (~400 lines) to not bloat agent context
4. Users can read the same document as a feature overview
