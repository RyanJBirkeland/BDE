# FLEET Feature Reference

FLEET (Agentic Development Environment) is an Electron desktop app for autonomous software development. It orchestrates AI agents that execute sprint tasks — from spec creation through code, PR, and merge.

This document is auto-loaded by all FLEET agents via the `@` directive in CLAUDE.md. It serves as both agent context and user documentation.

## How Work Flows Through FLEET

1. **Create** — Task Workbench: draft specs with AI copilot assistance, define dependencies between tasks, run validation checks before queuing
2. **Queue** — Tasks enter the Sprint Pipeline with status `queued` via the FLEET UI (Task Workbench or Sprint Pipeline)
3. **Execute** — Agent Manager claims queued tasks, spawns pipeline agents in isolated git worktrees. Agents write code, run tests, and commit. If `playground_enabled` is set, HTML file writes render inline via Dev Playground
4. **Review** — Agents complete work and transition tasks to `review` status, preserving the worktree. Code Review Station provides diff inspection, commit history, and action buttons (merge locally, create PR, request revision, discard). Users review changes before integration
5. **Complete** — Merged PRs or local merges mark tasks `done`. Dependency resolution automatically unblocks downstream tasks with satisfied dependencies

**Supporting views:** Dashboard (aggregated metrics), IDE (Monaco editor + terminal), Source Control (git staging/commits/push), Settings (8 configuration tabs)

## Task System

### Task Workbench

Planning and spec creation interface, presented as a centered modal (`TaskWorkbenchModal`). Opens from the Task Planner (Add Task / Edit Task) and from the Task Pipeline (Edit on a selected task). Users draft task specs with AI copilot assistance, configure task properties, and run validation checks before queuing.

- **Copilot**: AI chat assistant for drafting specs. Text-only, uses Agent SDK streaming via `workbench:chatStream` IPC. Messages persist to localStorage under `fleet:copilot-messages` (capped at 100). Cannot use tools or explore code — for codebase-aware spec generation, use the Synthesizer instead
- **Validation checks**: Validates spec quality before queuing. Specs require at least 2 `## heading` sections. Semantic checks use SDK with haiku model for speed
- **Spec types**: `spec` (structured markdown with headings — required for `status=queued`) or `prompt` (freeform text)
- **Dev Playground toggle**: Enables inline HTML rendering for the task's pipeline agent. When enabled, any `.html` file the agent writes will render in-app
- Related: Sprint Pipeline, Copilot, Synthesizer

### Sprint Pipeline

Execution monitoring view. Shows tasks flowing through stages as a vertical pipeline with real-time status updates.

- **Task statuses**: `backlog` | `queued` | `blocked` | `active` | `review` | `approved` | `done` | `cancelled` | `failed` | `error`
- **`approved` status**: Human-blessed state between `review` and `done`. The reviewer has accepted the code but hasn't pushed a PR yet. `approved` satisfies hard dependencies (downstream tasks can unblock before the PR merges). The Sprint PR Poller drives `approved → done` when the PR merges or the task is shipped locally
- **UI partitions** (9 buckets): `backlog`, `todo`, `blocked`, `inProgress`, `pendingReview`, `approved`, `openPrs`, `done`, `failed`. All UI components must use `partitionSprintTasks()` from the sprint tasks store — never map raw statuses directly
- **pendingReview**: Tasks with `status='review'` — agent done, awaiting human action in Code Review Station
- **approved bucket**: Tasks with `status='approved'` — code accepted, ready to be grouped into a PR via PR Builder
- **openPrs**: Tasks with `status='active'` and `pr_status='open'|'branch_only'` — open GitHub PRs in progress
- **failed bucket**: Combines `failed` + `error` + `cancelled` statuses
- **done sorting**: Most recent `completed_at` first
- Related: Task Workbench, Agent Manager, Code Review Station

### Task Dependencies

Tasks can declare dependencies on other tasks with `hard` or `soft` edges.

- **Hard dependency**: Downstream task is `blocked` until upstream completes successfully. If upstream fails, downstream stays blocked
- **Soft dependency**: Downstream unblocks regardless of upstream outcome (success or failure)
- **Auto-blocking**: Tasks with unsatisfied hard dependencies are automatically set to `blocked` status at creation time (handled in `sprint-local.ts` IPC handler)
- **Auto-resolution**: All terminal status paths (agent completion, manual status change, PR poller) route through `TaskTerminalService` which triggers `resolve-dependents.ts` to unblock waiting tasks. Direct SQLite writes bypass this — always use IPC handlers
- **Dependency format**: `{id, type}` where `type` is `"hard"` or `"soft"`. Note: uses `id` not `taskId`
- **Cycle detection**: `dependency-index.ts` maintains an in-memory reverse index and rejects cycles at creation time
- Related: Sprint Pipeline

### Task Planner

Multi-task workflow planning view (Cmd+8). Organizes tasks into epics (task groups) for phased execution.

- **Epics (Task Groups)**: Named collections of related tasks with shared goal, icon, and accent color. Each epic has a status: `draft` → `ready` → `in-pipeline` → `completed`
- **Epic list**: Left sidebar shows all epics with search/filter. Click to view epic details
- **Epic detail**: Right panel shows progress bar, task list with drag-to-reorder, and dependency management
- **Epic dependencies**: Epics can depend on other epics with three condition types: `on_success` (all upstream tasks must succeed), `always` (any outcome unblocks), or `manual` (requires explicit "Mark Complete" action). Cycle detection prevents circular dependencies
- **Task creation**: "Add Task" button opens Task Workbench with the epic pre-selected
- **Batch queuing**: "Queue All" transitions all draft tasks with specs to `queued` status in one action
- Related: Task Workbench, Sprint Pipeline, Task Dependencies

## Agent System

### Agent Types

FLEET spawns six types of AI agents, each with different capabilities and contexts:

| Type        | Spawned by             | Interactive      | Tool access      | Worktree              | Playground |
| ----------- | ---------------------- | ---------------- | ---------------- | --------------------- | ---------- |
| Pipeline    | Agent Manager (auto)   | No               | Full             | Yes (isolated)        | If enabled |
| Adhoc       | User (Agents view)     | Yes (multi-turn) | Full             | Yes (adhoc worktree)  | Always     |
| Assistant   | User (Agents view)     | Yes (multi-turn) | Full             | Yes (adhoc worktree)  | Always     |
| Reviewer    | Code Review Station    | Configurable     | Read + comment   | Yes (review worktree) | No         |
| Copilot     | Task Workbench         | Yes (chat)       | None (text-only) | No                    | No         |
| Synthesizer | Task Workbench         | No (single-turn) | None             | No                    | No         |

- **Pipeline**: Executes sprint tasks autonomously. Works in isolated git worktree. Commits changes and transitions to `review` status, preserving worktree for human inspection. Prompt includes task spec/prompt and branch name
- **Adhoc**: User-spawned one-off tasks from the Agents view. Multi-turn sessions via SDK `query()` with session resumption (`resume: sessionId`). Runs in a dedicated worktree under `~/.fleet/worktrees-adhoc/` so user sessions don't mutate the main repo tree
- **Assistant**: Same as adhoc but with assistant role framing — answers questions, suggests approaches, recommends Dev Playground for visual/UI work. Runs in a dedicated worktree under `~/.fleet/worktrees-adhoc/` (same setup as Adhoc) so user sessions never mutate the main repo tree
- **Reviewer**: Spawned from Code Review Station against a completed agent's worktree. Produces either a structured JSON review (via `buildStructuredReviewPrompt`) or an interactive conversation (via `buildInteractiveReviewPrompt`). Does not commit code
- **Copilot**: Text-only spec drafting helper in Task Workbench. ~500 word limit. Cannot use tools, open URLs, or explore code. Helps users refine task specs through conversation
- **Synthesizer**: Generates structured specs from codebase context + user answers. Receives file tree and relevant code snippets. Outputs markdown with `## heading` sections. Single-turn (`maxTurns: 1`)

Each agent type uses a specific `settingSources` value when spawning via the SDK:

| Agent type | `settingSources` | Rationale |
|---|---|---|
| Pipeline / Adhoc / Assistant / Reviewer | `['user', 'local']` | Inherits the user's global Claude Code config (**file-based** MCP servers, hooks, and permissions from `~/.claude/settings.json`). **claude.ai managed connectors (Atlassian, Zendesk, etc.) are not available** — the Agent SDK `query()` API does not expose them (upstream limitation). Use a normal `claude` CLI session for tasks that depend on those connectors. `'project'` is excluded — FLEET conventions are injected via the composed prompt, and re-loading repo CLAUDE.md via settings would double-inject the same context. |
| Copilot / Synthesizer | `[]` | Text-only spec helpers — extra MCP tools and hooks just inflate cost without adding value. Conventions injected via explicit prompt context. |

Prompts are composed by `buildAgentPrompt()` in `src/main/lib/prompt-composer.ts`. Reviewer prompts have dedicated builders in `src/main/agent-manager/prompt-composer-reviewer.ts`.

- **Universal preamble**: Cross-cutting rules (commit format, pre-commit checks, branch hygiene) are injected via the universal preamble in the prompt composer. No CLAUDE.md is required at spawn time.
- **User memory portability**: User memory (`~/.fleet/memory/`) is per-machine and is not synced across machines. On a new machine, agents will not have access to memory files created on the original machine.
- **Codebase conventions**: As of the Option A debranding decision, FLEET-specific codebase conventions (IPC patterns, Zustand rules, testing standards) are no longer injected as memory modules. Agents pick them up from `CLAUDE.md` when it is present in the repo.

### Agent Manager

Orchestrates pipeline agent lifecycle. Core module: `src/main/agent-manager/`.

- **Drain loop**: Continuously watches for `queued` tasks, claims them (sets `claimed_by`), spawns agents in git worktrees via SDK
- **WIP limit**: `MAX_ACTIVE_TASKS` concurrent agents, enforced at agent manager drain loop
- **Watchdog**: Monitors agent health with configurable timeout. Default 1 hour, overridable per-task via `max_runtime_ms` field
- **Completion flow**: Agent exits normally → classify exit → mark task `review` → preserve worktree for human review. On failure: retry up to 3x, then mark `failed`. Human actions in Code Review Station (merge locally, create PR, revise, discard) determine final task status
- **Fast-fail detection**: 3 failures within 30s of starting = exhausted. Task marked `error` with diagnostic notes pointing to `~/.fleet/fleet.log`
- **Worktree isolation**: Each pipeline agent gets `~/.fleet/worktrees/<repo-slug>/<task-id>/`. Worktree cleaned up after completion (success or failure). Stale worktrees from previous runs should be cleaned with `git worktree prune`
- **Config**: Max concurrent agents, worktree base path, and max runtime are read once at startup. Changes via Settings UI take effect on next app restart
- Related: Sprint Pipeline, Task Dependencies

### Dev Playground

Inline HTML rendering for visual prototyping, UI exploration, and interactive tools. Renders natively inside FLEET — agents should never open a browser.

- **How it works**: When an agent writes an `.html` file (via the Write tool), FLEET detects the `tool_result` message, reads the file, sanitizes it with DOMPurify, and broadcasts an `agent:playground` event to the renderer
- **User experience**: A PlaygroundCard appears in the agent's chat stream showing filename and size. Click it to open PlaygroundModal — a full-screen overlay with a sandboxed iframe. Three view modes: split (source + preview), preview only, source only
- **Security**: HTML sanitized via DOMPurify (strips `<script>` tags, event handlers like `onclick`/`onerror`, and `javascript:` URLs). Iframe uses `sandbox="allow-scripts"`. Maximum file size: 5MB
- **Pipeline agents**: Playground detection gated by `playground_enabled` flag on the task. File path must be within the agent's worktree (path traversal prevention)
- **Adhoc/assistant agents**: Playground always enabled. No path restriction since the user directly controls the session
- **When to use**: CSS theme builders, component playgrounds, data visualizations, architecture diagrams, interactive configuration tools, mockups — anything that benefits from visual output rendered in-app
- **How agents should use it**: Write a self-contained `.html` file using the Write tool. Include all CSS and JS inline. FLEET handles detection, sanitization, and rendering automatically. Do NOT use shell `open` commands to launch a browser — the playground renders natively in the app
- Related: Agent Types, Task Workbench (playground toggle)

## Code Review

### Code Review Station

Human-in-the-loop review interface for agent work before integration. Agents complete tasks by transitioning to `review` status instead of automatically opening PRs.

- **Review queue**: List of tasks in `review` status awaiting human inspection. Shows task title, branch name, and last commit message
- **Header**: Shows branch name, cost + duration (`$0.97 · 5m 50s`), and retry count for the selected task. "View Prompt" button opens the exact rendered prompt passed to the SDK on the last run — primary debugging tool for prompt-related issues
- **Diff inspection**: ChangesTab displays git diff of all modified files with syntax highlighting. Side-by-side view showing additions (green), deletions (red), and context. "Since last review" toggle (visible on revision passes) diffs only the changes made since the prior review snapshot
- **Commit history**: CommitsTab shows all commits in the agent's branch with messages, timestamps, and file change counts
- **Conversation**: ConversationTab displays the full agent chat log for context on decisions made during execution
- **Review actions**:
  - **Approve** — Transitions the task to `approved` status. Signals that the code is accepted and ready to ship. Approved tasks can be grouped into a stacked PR via the PR Builder. Downstream hard-dependent tasks unblock immediately without waiting for the PR to merge
  - **Merge Locally** — Fast-forward merge the agent's branch into the current branch and mark task `done`. Worktree cleaned up automatically
  - **Create PR** — Push the branch and open a GitHub pull request. Task remains `review` until PR is merged (tracked by Sprint PR Poller)
  - **Request Revision** — Return task to `queued` status for the agent to retry. Worktree preserved for incremental work
  - **Discard** — Mark task `cancelled` and clean up the worktree. Used when the work is no longer needed
- **Worktree preservation**: Agent worktrees stay intact at `review` and `approved` status, allowing humans to inspect the full working directory before integration decisions
- Related: Sprint PR Poller, Sprint Pipeline, Agent Manager (completion flow), PR Builder

### PR Builder

Stacked-PR group composer for shipping multiple approved tasks as a single pull request. Accessible via the "Build PR" button in the Code Review queue's Approved section.

- **PR Groups**: Named collections of approved tasks combined into one PR. Each group has a title, branch name, description, and status (`composing | building | open | merged`)
- **Two-panel layout**: Left pool shows unassigned approved tasks (drag to add); right shows `PrGroup` cards each with title/branch/description editors and a "Build PR" trigger
- **Single-task group**: Pushes the task's existing branch directly and opens a PR — no squash needed
- **Multi-task group**: Squash-merges each task's branch onto a rollup branch in dependency order (`topoSort`), then pushes and opens one PR covering all tasks
- **Conflict detection**: `checkConflicts` dry-runs the merge before committing — surfaces conflicting tasks before the build starts
- **Fork-on-approve**: When a downstream task claims work after its upstream is `approved`, the agent's worktree is forked from the parent's branch (`stacked_on_task_id` written to the task). The auto-rebase phase in the success pipeline keeps the stacked branch current with `origin/main`
- Related: Code Review Station, Sprint PR Poller, Task Dependencies

### Sprint PR Poller

Background process that automatically tracks PR outcomes for sprint tasks.

- **Runs every 60s** in main process (independent of renderer — works even if no window is focused)
- **Watches**: Tasks with `pr_status=open` — polls their GitHub PR for merge/close events
- **Auto-transitions**: Merged PR → task marked `done`. Closed PR → task marked `cancelled`. Both trigger dependency resolution via `TaskTerminalService`
- **PR fields** (`pr_url`, `pr_number`, `pr_status`): Set internally by completion handler and poller — not directly editable via IPC
- Related: Code Review Station, Agent Manager (completion flow)

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
- Related: IDE, Code Review Station

### Local MCP Server

Opt-in HTTP server that exposes FLEET's task and epic CRUD to local MCP-speaking agents (Claude Code, Claude Desktop, Cursor). Runs inside the Electron main process; all mutations go through the same services the UI uses, so validation, dependency auto-blocking, status-transition checks, audit trail, and renderer broadcast are preserved.

- **Transport**: MCP Streamable HTTP at `http://127.0.0.1:<port>/mcp`. Default port `18792`.
- **Auth**: bearer token stored in `~/.fleet/mcp-token` (mode `0600`). Set `Authorization: Bearer <token>` on every request.
- **Enable**: Settings → Connections → Local MCP Server → toggle "Enable MCP server".
- **Tools**:
  - `tasks.list` / `tasks.get` / `tasks.create` / `tasks.update` / `tasks.cancel` / `tasks.history` / `tasks.requestRevision` / `tasks.lastPrompt`
  - `epics.list` / `epics.get` / `epics.create` / `epics.update` / `epics.delete` / `epics.addTask` / `epics.removeTask` / `epics.setDependencies` / `epics.bulkQueueTasks`
  - `meta.repos` / `meta.taskStatuses` / `meta.dependencyConditions` / `meta.reloadSettings`
- **Out of scope**: agent orchestration (claim/cancel/retry) and review-station actions. Local-only — binds to `127.0.0.1`.
- **Example Claude Code config**:

  ```json
  {
    "mcpServers": {
      "fleet": {
        "url": "http://127.0.0.1:18792/mcp",
        "headers": { "Authorization": "Bearer <paste-from-settings>" }
      }
    }
  }
  ```

Related: Task Workbench, Sprint Pipeline, Task Dependencies.

## App Shell

### Design System (V2)

FLEET's V2 visual language: **calm, alive, spacious**. Tokens in `src/renderer/src/assets/tokens.css`.

- **Token vocabulary**: `--bg` (page), `--surf-1/2/3` (elevation tiers), `--line/line-2` (hairlines), `--fg/fg-2/fg-3/fg-4` (text scale, AA+ contrast), `--st-running/queued/review/done/blocked/failed` (the only sanctioned colors — always pair with text/shape, not color alone), `--s-1…9` (4px grid spacing), `--r-sm/md/lg/xl` (radii), `--dur-fast/base/slow` (motion)
- **Themes**: Applied via `data-theme` attribute (`quiet-graphite` default, `refined-pro-dark`, `warm-console`). Old `--fleet-*` names are aliased for backwards compat.
- **Primitives**: `.fleet-eyebrow` (mono uppercase label), `.fleet-card`, `.fleet-dot--<status>`, `.fleet-pulse` (running-only animated ring — never use for idle/selected states)
- **Rules**: No raw hex, no `rgba()` outside tokens, no raw `px` for layout spacing. Use `--s-*`. `--fg-3` on `--surf-1` is the hardest contrast pair — verify it when editing.

### Shell (Header + Sidebar)

The app shell is feature-flagged for V2 rollout. Default: V1. Enable V2 in DevTools: `localStorage.setItem('fleet:ff', JSON.stringify({v2Shell:true})); location.reload()`.

- **Header**: `UnifiedHeader.tsx` dispatches to `UnifiedHeaderV1` (44px, B logo, NeonBadge) or `UnifiedHeaderV2` (38px, F mark + FLEET wordmark, CommandPill + HealthChip + TokenChip). Tab strip is always present — shows the focused panel's open views.
- **Sidebar**: `Sidebar.tsx` dispatches to `SidebarV1` (52px icon-only) or `SidebarV2` (200px, labeled nav with 2px accent rail on active item, live agents block showing up to 3 active pipeline tasks with animated progress, footer with model + version). Collapses to 52px icon-only at <1024px via container query.
- **V2 primitives** (all in `src/renderer/src/components/layout/`): `CommandPill` (opens command palette, collapses to icon at <1280px), `HealthChip` (pill with fleet-pulse when running, failure count in `--st-failed`), `TokenChip` (total token count), `LiveAgentRow` (sidebar agent row, click navigates to Sprint + selects task)
- **Cleanup**: When V2 ships as default, delete `UnifiedHeaderV1`, `SidebarV1`, the dispatchers, and `featureFlags.ts`

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
- **View shortcuts**: Dashboard (Cmd+1), Agents (Cmd+2), IDE (Cmd+3), Task Pipeline (Cmd+4), Code Review (Cmd+5), Source Control (Cmd+6), Settings (Cmd+7), Task Planner (Cmd+8)
- Related: All views

### Settings

Application configuration organized into 8 tabs. Most settings persisted to SQLite `settings` table.

- **Connections**: GitHub token, Claude auth status, Local MCP Server toggle + token reveal
- **Repositories**: Add/remove repos with `name`, `localPath`, `githubOwner`, `githubRepo`
- **Templates**: Task templates for common patterns
- **Agents**: Agent Manager config (max concurrent agents, worktree base path, max runtime per task — changes require app restart)
- **Models**: Per-agent-type model selection (pipeline, synthesizer, copilot, assistant, adhoc, reviewer). Resolved at spawn via `resolveAgentRuntime()` in `src/main/agent-manager/backend-selector.ts`
- **Memory**: Local memory stats and configuration
- **Appearance & Shortcuts**: Theme toggle (dark/light), motion preferences, keyboard shortcut customization
- **About & Usage**: Version info, log file locations, API usage summary, GitHub link
- **Keyboard navigation**: Arrow Left/Right, Home/End to cycle tabs
- Related: Agent Manager, Local MCP Server

## Packaging

Notes for users running the packaged `FLEET.app` bundle on macOS.

- **Node auto-detection**: The agent manager probes well-known install locations for `node` (fnm default alias, highest nvm version, Homebrew at `/opt/homebrew/bin` or `/usr/local/bin`) and prepends the matching directory to the PATH passed to the Claude Agent SDK. This fixes "Claude Code executable not found" errors when the `.app` is launched from Finder/Spotlight, which inherits only `/etc/paths` and excludes fnm/nvm locations
- **PATH fallback**: If no node is found at the probed locations, FLEET falls back to the ambient PATH lookup — the SDK's own `spawn('node', …)` resolution still applies
- **Shell-launched workaround**: Users hitting SDK spawn errors can bypass the issue by launching via `npm run dev` from a terminal, which inherits the full shell PATH
- Related: Agent Manager
