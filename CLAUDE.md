# CLAUDE.md — BDE

@../../ARCHITECTURE.md

Electron desktop app (electron-vite + React + TypeScript) — the Birkeland Development Environment.

## Build & Test

```bash
npm install          # Install dependencies
npm run dev          # Dev server with HMR
npm run build        # Type-check + production build (must pass before PR)
npm run typecheck    # TypeScript type checking (also runs in CI)
npm test             # Unit tests via vitest (must pass before PR)
npm run test:main    # Main process tests (separate vitest config)
npm run test:coverage # Unit tests + coverage threshold enforcement (used in CI)
npm run test:e2e     # E2E tests via Playwright (requires built app)
npm run lint         # ESLint
npm run format       # Prettier
```

## CI

GitHub Actions runs on every push to `main` and every PR targeting `main`:

- `npm run lint` — must pass
- `npm run typecheck` — must pass
- `npm run test:coverage` — must pass (enforces coverage thresholds: 72% stmts, 66% branches, 70% functions, 74% lines)
- `npm run test:main` — must pass (main process integration tests)

All checks are required before merge.

## Branch Conventions

- `feat/` — New features (e.g. `feat/git-client`)
- `fix/` — Bug fixes (e.g. `fix/rpc-layer`)
- `chore/` — Maintenance, docs, refactors (e.g. `chore/audit`)

## Commit Messages

Format: `{type}: {description}`

- `feat:` new feature
- `fix:` bug fix
- `chore:` maintenance / docs

## Key File Locations
- Task terminal resolution service: `src/main/services/task-terminal-service.ts` (unified `onStatusTerminal` — all terminal paths converge here)
- Sprint task dependency management: `src/main/handlers/sprint-local.ts` (auto-blocking on create/transition)
- Dependency resolution after completion: `src/main/agent-manager/resolve-dependents.ts`
- Shared sanitization: `src/shared/sanitize-depends-on.ts`
- Agent auto-commit: `src/main/agent-manager/completion.ts` (uses `git add -A` to capture new files; `.gitignore` excludes node_modules etc.)
- Agent event mapping/emission: `src/main/agent-event-mapper.ts` (shared by adhoc + pipeline agents)
- Worktree management: `src/main/agent-manager/worktree.ts`
- Shutdown/lifecycle: `src/main/agent-manager/index.ts`
- Repository interface: `src/main/data/sprint-task-repository.ts` (ISprintTaskRepository + factory)
- Audit trail: `src/main/data/task-changes.ts` (field-level change tracking in SQLite)
- Shared logger: `src/main/logger.ts` (createLogger → `~/.bde/bde.log`)
- Polling hook: `src/renderer/src/hooks/useBackoffInterval.ts` (backoff + jitter)
- Prompt composer: `src/main/agent-manager/prompt-composer.ts` — `buildAgentPrompt()` builds prompts for all agent types (pipeline, assistant, adhoc, copilot, synthesizer). All spawn paths must use this instead of inline prompt assembly.
- Shared SDK streaming: `src/main/sdk-streaming.ts` — extracted `runSdkStreaming()` utility used by workbench and synthesizer. Don't duplicate this inline.

## PR Rules

1. Branch from `main`, PR back to `main` — no direct pushes to `main`
2. **Self-heal**: `npm run build` and `npm test` must both pass before opening a PR
3. Keep PRs focused — one feature or fix per PR
4. **UX PRs must include screenshots or ASCII art** of every changed UI surface in the PR body. Use ASCII art as fallback if the app can't be rendered. This is required — no exceptions.

## Dependency Policy

- **No new npm packages without explicit approval.** Evaluate whether the functionality can be achieved with existing dependencies or standard Node.js APIs before proposing a new package.
- When a new dependency is justified, prefer packages that are: small, well-maintained, tree-shakeable, and have no transitive dependencies.

## Code Quality

- **Clean Code principles**: functions do one thing, meaningful names, no magic numbers, small files.
- **Clean Architecture**: respect process boundaries (main/preload/renderer), keep IPC surface minimal, shared types in `src/shared/`.
- All IPC handlers must use the `safeHandle()` wrapper for error logging.
- Prefer `execFile`/`execFileAsync` (argument arrays) over `execSync` (string interpolation) to prevent shell injection.

## Conflict-Prone Files

These files are edited frequently across branches. Take extra care when modifying:

- `src/renderer/src/App.tsx` — main app shell, keyboard shortcuts, view routing
- `src/main/index.ts` — all IPC handler registrations
- `src/preload/index.ts` — preload bridge API surface

## Architecture Notes

- **Data layer**: SQLite at `~/.bde/bde.db` (WAL mode, schema in `src/main/db.ts`). Backup via `VACUUM INTO` to `bde.db.backup` runs on startup + every 24h. for all local tables: `agent_runs`, `settings`, `cost_events`, `agent_events`, `task_changes`, `sprint_tasks`. Sprint tasks live in local SQLite (migration v15 recreated the table) — accessed via `src/main/data/sprint-queries.ts`. On first launch, `importSprintTasksFromSupabase()` runs as a one-time fire-and-forget migration if credentials are present; it is a no-op once the table has rows. Audit trail stored in `task_changes` table (migration v14) — field-level diffs logged on every `updateTask()` call.
- **Repository pattern**: `src/main/data/sprint-task-repository.ts` defines `ISprintTaskRepository` interface. Agent manager receives the repository via constructor injection (`createAgentManager(config, repo, logger)`). Concrete implementation delegates to sprint-queries. IPC handlers (sprint-local.ts) and Queue API (task-handlers.ts) still import sprint-queries directly — they're thin enough not to need the abstraction.
- **AgentManager**: `src/main/agent-manager/` — in-process task orchestration. Drain loop watches for queued tasks, spawns agents in git worktrees via SDK, monitors with watchdogs, handles completion (push branch, open PR, retry logic). All data access goes through `ISprintTaskRepository` (injected). Core agent lifecycle in `run-agent.ts` with explicit `RunAgentDeps` interface. Per-task `max_runtime_ms` overrides the global 1-hour watchdog limit.
- **AuthGuard**: `src/main/auth-guard.ts` — validates Claude Code subscription token. NOT called in the drain loop (Keychain access hangs in Electron). Auth is validated by the SDK at spawn time instead. Users must run `claude login` to authenticate.
- **Task dependencies**: `src/main/agent-manager/dependency-index.ts` (in-memory reverse index, cycle detection), `src/main/agent-manager/resolve-dependents.ts` (blocked→queued transitions). Tasks can declare `depends_on: TaskDependency[]` with `hard` (block on failure) or `soft` (unblock regardless) edges. `blocked` status = unsatisfied hard deps. Resolution triggered from all terminal status paths.
- **PR poller**: `src/main/pr-poller.ts` — polls open PRs from all configured repos every 60s, fetches check runs, broadcasts `pr:listUpdated` to renderer. Separate from sprint PR poller.
- **Sprint PR poller**: `src/main/sprint-pr-poller.ts` — runs every 60s in main process (not renderer-dependent), polls PR status for tasks with `pr_status='open'`. Auto-marks tasks done (merged) or cancelled (closed).
- **State**: Zustand stores in `src/renderer/src/stores/`
- **IPC**: 17 handler modules in `src/main/handlers/`, registered in `src/main/index.ts`, preload bridge in `src/preload/index.ts`. 86 typed channels in `src/shared/ipc-channels.ts`.
- **Agent spawning**: `src/main/agent-manager/sdk-adapter.ts` spawns agents via `@anthropic-ai/claude-agent-sdk` (with CLI fallback). OAuth token read from `~/.bde/oauth-token` at startup — Keychain access hangs in Electron's main process, so the file-based approach is required.
- **Queue API**: `src/main/queue-api/` — local task queue HTTP server on port 18790 (not a Supabase proxy). Split into `helpers.ts` (auth, parsing), `task-handlers.ts` (CRUD), `agent-handlers.ts` (logs), `event-handlers.ts` (SSE, output). Router is thin dispatch (~116 lines). Task CRUD with camelCase field mapping, SSE broadcaster, auth via Bearer header or `?token=` query param. General PATCH restricted to safe fields via `GENERAL_PATCH_FIELDS`; status changes must use `/status` endpoint. Claim endpoint enforces WIP limit (`MAX_ACTIVE_TASKS=5`). Dependency validation runs BEFORE task creation (no rollback needed).
- **DB sync**: File watcher on `bde.db` pushes `sprint:externalChange` IPC events to renderer (500ms debounce)
- **Design tokens**: `src/renderer/src/design-system/tokens.ts` — use these instead of hardcoded values. Neon theme tokens in CSS custom properties (`neon.css`, `neon-shell.css`, `agents-neon.css`).
- **Neon components**: `src/renderer/src/components/neon/` (13 primitives: NeonCard, StatCounter, NeonBadge, GlassPanel, ActivityFeed, NeonProgress, PipelineFlow, MiniChart, StatusBar, ScanlineOverlay, ParticleField, NeonTooltip, CircuitPipeline). Used by Dashboard + Agents views. Glass morphism, glow effects, terminal aesthetic.
- **MiniChart accent**: `MiniChart` uses `data[0].accent` for the entire line color. Per-point `accent` values on `ChartBar[]` are ignored — don't cycle colors thinking they'll render differently.
- **Dead code — AgentTimeline**: `AgentTimeline.tsx` and `TimelineBar.tsx` in `src/renderer/src/components/agents/` are unused (replaced by MiniChart in AgentsView). Their CSS (`.agent-timeline`, `.timeline-bar` rules in `agents-neon.css`) is also dead. Safe to delete in a cleanup pass.
- **Agent events**: `src/main/agent-event-mapper.ts` — shared `mapRawMessage()` (SDK wire protocol → `AgentEvent[]`) + `emitAgentEvent()` (broadcast + SQLite persist). Used by both `adhoc-agent.ts` (user-spawned) and `run-agent.ts` (pipeline agents).
- **Agent events cap**: `src/renderer/src/stores/agentEvents.ts` caps at 2000 events per agent (oldest evicted). Both `init()` subscriber and `loadHistory()` enforce the cap.
- **Panel system**: `src/renderer/src/stores/panelLayout.ts` — recursive PanelNode tree (leaf/split), `src/renderer/src/components/panels/` — PanelRenderer, PanelLeaf, PanelTabBar, PanelDropOverlay. Layout persists to `panel.layout` setting. Views rendered inside panels; drag-and-drop docking with 5-zone hit testing.
- **Views**: 8 views in `src/renderer/src/views/` — Dashboard (⌘1), Agents (⌘2), IDE (⌘3, default), Task Pipeline (⌘4), PR Station (⌘5), Source Control (⌘6), Settings (⌘7), Task Workbench. Task Pipeline = execution monitoring (vertical pipeline flow); Task Workbench = planning/creation (form + AI copilot). View type union and `VIEW_LABELS` live in `panelLayout.ts`. Keyboard shortcuts mapped in `App.tsx` via `VIEW_SHORTCUT_MAP`.
- **IDE**: `src/renderer/src/views/IDEView.tsx` + `src/renderer/src/components/ide/` (9 components). Monaco editor + file explorer sidebar + integrated terminal. `ideStore` in `src/renderer/src/stores/ide.ts`. File I/O via `ide-fs-handlers.ts` (path-scoped to opened root, atomic writes, binary detection). State persisted to `ide.state` setting with 2s debounce.
- **PR Station**: Full code review tool in `src/renderer/src/components/pr-station/` (11 components) + `src/renderer/src/components/diff/` (DiffViewer, DiffCommentWidget, DiffCommentComposer). Features: PR list with filter bar (repo chips, sort), CI badges, detail panel with MergeButton (squash/merge/rebase), reviews, conversation timeline, changed files, conflict detection, diff viewer with inline comments, batch review submission. `pendingReview` Zustand store tracks pending comments per PR (persisted to localStorage, restored on app init). All GitHub API calls in `src/renderer/src/lib/github-api.ts` proxied through `github:fetch` IPC.
- **Source Control**: `src/renderer/src/views/GitTreeView.tsx` + `src/renderer/src/components/git-tree/` (5 components: GitFileRow, FileTreeSection, CommitBox, BranchSelector, InlineDiffDrawer). `gitTree` Zustand store in `src/renderer/src/stores/gitTree.ts`. Uses existing git IPC channels (`git:status`, `git:diff`, `git:stage`, `git:unstage`, `git:commit`, `git:push`, `git:branches`). Polls at `POLL_GIT_STATUS_INTERVAL` (30s). Store tracks `commitLoading`/`pushLoading`/`lastError` for operation feedback; CommitBox shows loading spinners, GitTreeView renders persistent error banner with Retry/Dismiss.
- **Dashboard**: `src/renderer/src/views/DashboardView.tsx` + `src/renderer/src/components/dashboard/` (5 components: DashboardCard, ActiveTasksCard, RecentCompletionsCard, CostSummaryCard, OpenPRsCard). Aggregates data from `sprintTasks`, `costData` stores and PR list IPC. Default landing view. Polls every 60s via `useBackoffInterval` (with jitter + exponential backoff on errors).
- **Logging**: `src/main/logger.ts` — `createLogger(name)` writes to `~/.bde/bde.log` with `[LEVEL] [module]` format + ISO timestamps. Rotates at 10MB (renames to `.old`, keeps 1 generation). Checks rotation on creation + every 1000 writes. Agent-manager has its own `~/.bde/agent-manager.log` with similar rotation. Sprint-queries uses injectable logger via `setSprintQueriesLogger()`.
- **Optimistic updates**: `src/renderer/src/stores/sprintTasks.ts` — field-level tracking via `pendingUpdates: Record<string, { ts: number; fields: string[] }>`. On poll merge, only pending fields are preserved from local state; all other fields come from server. 2-second TTL. Full reload on failure (safest revert).
- **Task Pipeline**: `src/renderer/src/components/sprint/SprintPipeline.tsx` — three-zone layout (PipelineBacklog | PipelineStage×5 | TaskDetailDrawer). Uses `partitionSprintTasks()` for stage mapping. Neon CSS in `sprint-pipeline-neon.css`. Task creation removed from pipeline (lives in Task Workbench only).
- **Task Workbench**: `src/renderer/src/components/task-workbench/` — form + AI copilot + readiness checks. Neon CSS in `task-workbench-neon.css` (`.wb-*` BEM classes). Copilot uses Agent SDK streaming via `workbench:chatStream` IPC.
- **Full architecture**: See `docs/architecture.md`

## Gotchas

- **Queue API auth**: API key is auto-generated on first access if not configured (`randomBytes(32).toString('hex')`, persisted to `taskRunner.apiKey` setting). Auth is always enforced — no open-by-default mode.
- **Queue API endpoints**: All task endpoints use `/queue/tasks` prefix (not `/tasks`). Dependency endpoint: `PATCH /queue/tasks/:id/dependencies`. Task creation with `status=queued` requires a `spec` field (or `?skipValidation=true`). Specs require at least 2 `## heading` sections.
- **Queue API `depends_on` format**: Uses `{id, type}` (not `taskId`) — see `TaskDependency` in `src/shared/types.ts`. Include `depends_on` at creation time; PATCHing deps onto `backlog` tasks may not trigger auto-blocking. Use Python for complex JSON payloads — backticks in shell heredocs cause parse errors.
- **View type sync**: When adding/removing views from the `View` union in `panelLayout.ts`, you MUST update ALL maps in `NeonSidebar.tsx` (`VIEW_ICONS`, `VIEW_LABELS`, `VIEW_SHORTCUTS`), `CommandPalette.tsx`, `OverflowMenu.tsx`, and `App.tsx` (`VIEW_SHORTCUT_MAP`). Missing entries cause runtime crashes (undefined component render), not build errors.
- **Preload type declarations**: When adding new methods to `src/preload/index.ts`, you MUST also update `src/preload/index.d.ts` — the renderer's `window.api` types come from the `.d.ts` file, not the `.ts` implementation. Typecheck will fail with "Property does not exist on type" if you forget.
- **Handler count tests**: `src/main/handlers/__tests__/workbench.test.ts` (and similar per-module tests) assert the exact number of `safeHandle()` calls. Adding new IPC handlers to a module requires updating the corresponding handler count test.
- **Monaco teardown in pre-push**: The husky pre-push hook may fail with `EnvironmentTeardownError` from Monaco editor even when all tests pass. This is a pre-existing flaky teardown issue, not a code problem. Use `--no-verify` if all tests pass individually via `npm test` and `npm run test:main`.
- **Worktree file disappearance**: macOS worktrees frequently lose `.git` file and tracked files between operations (npm install, vitest runs, even rapid Edit tool calls). If `fatal: not a git repository` appears, recreate the worktree. For sessions with many file edits, work directly on a branch in the main repo instead — worktrees are most reliable for single-commit subagent tasks.
- **Worktrees**: Git worktrees don't include `node_modules` — always run `npm install` first. Use `~/worktrees/` paths, not `/tmp/worktrees/` (macOS `/tmp` → `/private/tmp` symlink causes tracked files to vanish). `DEFAULT_CONFIG.worktreeBase` defaults to `~/worktrees/bde` (changed in PR #419). Pre-push hooks and `test:main` often fail in worktrees due to `better-sqlite3` rebuild issues — use `--no-verify` when pushing from worktrees, or cherry-pick changes into the main repo to test there.
- **GitHub Actions billing**: CI failures may be billing-related, not code issues. Check `gh api repos/OWNER/REPO/check-runs/<id>/annotations` before debugging — annotation message will say "recent account payments have failed" if billing is the cause.
- **Subagent worktree prep**: When dispatching subagents to work in a worktree, always instruct them to run `npm install` first AND `git checkout -- .` if files appear missing. Worktrees frequently need both after creation.
- **Handler naming collisions**: `src/main/fs.ts` already exports `registerFsHandlers()`. New handler modules must use unique function names (e.g., `registerIdeFsHandlers`). Check `src/main/index.ts` imports before naming.
- **Zustand Map anti-pattern**: Never use `Map` as Zustand state — `new Map(old)` creates a new reference on every mutation, defeating shallow equality and causing all subscribers to re-render. Use `Record<string, T[]>` instead.
- **Shared env utilities**: PATH augmentation and OAuth token loading are in `src/main/env-utils.ts`. Use `buildAgentEnv()` or `buildAgentEnvWithAuth()` — do NOT duplicate PATH logic in new files. `buildAgentEnv()` returns a defensive copy each call (safe to mutate).
- **Monaco Editor in Electron**: `@monaco-editor/react`'s CDN loader fails in Electron. Use dynamic ESM import: `import('monaco-editor').then(m => loader.config({ monaco: m }))`. CSP must include `worker-src 'self' blob:` for Monaco web workers. Never use `loader.config({ paths: { vs: ... } })` — Vite pre-bundles Monaco so AMD loader paths won't resolve.
- **IDE watchDir race**: In `IDEView.tsx`, `watchDir` must complete BEFORE restoring tabs. If tabs trigger `readFile` before `ideRootPath` is set in the main process, the handler throws silently and file content never loads. Always `await watchDir()` first.
- **Plan docs lag behind code**: Roadmap statuses and plan doc checkboxes are often stale. Always verify against the actual codebase (`ls`, `grep`) before assuming work is incomplete. The code is the source of truth.
- **CSS theming rule**: Never use hardcoded `rgba()` for overlays or `box-shadow`. Use `var(--bde-overlay)` for backgrounds and `var(--bde-shadow-sm/md/lg)` for shadows. Header gradients use `var(--bde-header-gradient)`. All defined in `base.css` with light theme variants.
- **FK constraints**: `sprint_tasks.agent_run_id` has NO foreign key constraint (migration v10 dropped it).
- **Keychain token format**: `claudeAiOauth.expiresAt` is a stringified epoch millisecond, NOT an ISO date. Parse with `parseInt(val, 10)`.
- **electron-builder afterSign**: Cannot use `.sh` files as `afterSign` hooks — electron-builder `require()`s them as JavaScript. Use `.js`/`.cjs` files, or omit for unsigned builds (`identity: null`).
- **Subagent branch safety**: When dispatching subagents, explicitly tell them which branch to commit to. Subagents may default to `main` if not told otherwise.
- **Native modules**: `better-sqlite3` is rebuilt for Electron via `electron-rebuild` in `postinstall`. The main test config (`vitest.main.config.ts`) has a `globalSetup` that auto-detects and rebuilds for Node.js if needed — so `npx vitest run --config src/main/vitest.main.config.ts` works without `npm run test:main`. npm 11+ silently ignores `--runtime=electron` flags on `npm rebuild`.
- **Native module rebuild after tests**: `npm test` rebuilds `better-sqlite3` for Node.js via vitest globalSetup. After running tests, run `npx electron-rebuild -f -w better-sqlite3` before `npm run dev`, or the Electron app will crash with `NODE_MODULE_VERSION` mismatch.
- **Zustand selector gotcha**: Never call a function that returns a new array/object inside a Zustand selector (e.g., `useSomeStore(s => s.getList())`). This creates a new reference every render → infinite loop. Derive with `useMemo` from stable state instead.
- **DB migrations**: Schema changes go through `src/main/db.ts` — add a new entry to the `migrations` array. Never modify existing migrations. NEVER use `SELECT *` when copying data between tables — always use explicit column lists. When recreating a table to change constraints, include ALL columns from the current schema (check previous migrations for columns added after the original CREATE TABLE).
- **sprint_tasks full column list (v17)**: id, title, prompt, repo, status, priority, depends_on, spec, notes, pr_url, pr_number, pr_status, pr_mergeable_state, agent_run_id, retry_count, fast_fail_count, started_at, completed_at, claimed_by, template_name, playground_enabled, needs_review, max_runtime_ms, spec_type, created_at, updated_at. Verify against `db.ts` migrations before writing new ones.
- **Test noise from `release/`**: `vitest.config.ts` excludes `**/release/**`, but if a new exclude pattern is needed, add it there. Delete `release/` if the directory causes other issues.
- **AgentManager config requires restart**: Settings for max concurrent agents, worktree base, and max runtime are read once at startup. Changes via Settings UI take effect on next app launch.
- **Integration tests**: `src/main/__tests__/integration/` — covers AgentManager pipeline, AuthGuard, IPC handlers, Queue API, CompletionHandler, IPC registration completeness, Sprint CRUD, Queue API auth + SSE, IDE path traversal, DB CRUD. Run with `npm run test:main`. 3-layer defense: unit (1886 renderer), integration (main process), E2E (12 spec files).
- **Coverage thresholds (ratcheted 2026-03-25)**: 72% stmts, 66% branches, 70% functions, 74% lines. Configured in `vitest.config.ts`. Enforced by `npm run test:coverage` in CI. Ratchet up after adding tests — never lower.
- **Branch coverage is tightest**: Always test conditional branches (if/else, ternaries, empty arrays, error states, loading states) — not just happy-path renders. Branch coverage is consistently the closest to failing the CI gate.
- **Electron PATH**: Electron's main process has a minimal PATH. Use `buildAgentEnv()` from `src/main/env-utils.ts` which prepends `/usr/local/bin`, `/opt/homebrew/bin`, `~/.local/bin` to PATH (cached after first call).
- **OAuth token file**: Agent manager reads `~/.bde/oauth-token` (plain text, one line). Keychain access via `security` CLI hangs in Electron — never use `execFileSync('security', ...)` in the main process.
- **Supabase setup (optional)**: BDE can optionally have `supabase.url` and `supabase.serviceKey` in the SQLite `settings` table for the one-time import. These are no longer required for normal operation — sprint tasks are stored locally in SQLite. Also needs `repos` JSON setting with `name`, `localPath`, `githubOwner`, `githubRepo` per configured repo.
- **Agent branch stale cleanup**: Before re-running a task, delete stale `agent/*` branches with `git branch -D agent/<slug>` and run `git worktree prune`. Otherwise `git worktree add` fails.
- **Push before queuing tasks**: Always `git push origin main` before queuing tasks. AgentManager branches from local repo — unpushed commits or untracked files (like spec docs) end up in the agent's worktree or are missing entirely.
- **SDK settingSources required**: All `sdk.query()` calls MUST include `settingSources: ['user', 'project', 'local']` to load the full CLAUDE.md hierarchy. Without this, agents run in SDK isolation mode with zero project knowledge.
- **Agent prompt augmentation**: `run-agent.ts` uses `buildAgentPrompt()` from `prompt-composer.ts` which auto-appends `## Setup` (npm install reminder) and `## Git Branch` (explicit branch name + "do not push to main") to every agent prompt. When testing prompt content in tests, use `expect.stringContaining()` not exact match.
- **Dependency resolution trigger**: All terminal-status paths route through `TaskTerminalService` (`src/main/services/task-terminal-service.ts`), wired in `src/main/index.ts`. Covers: agent manager, `sprint:update` IPC, Queue API status patch, sprint PR poller, and `pr:pollStatuses` IPC. Direct SQLite writes that bypass these handlers still do NOT trigger dependent unblocking.
- **Task creation must use IPC**: Always create sprint tasks via `sprint:create` IPC handler (or Sprint Center UI), not direct SQLite writes. Direct writes skip the auto-blocking logic in `sprint-local.ts`, and the drain loop doesn't check `depends_on` before claiming tasks.
- **Sprint partition buckets**: UI components must use the 7 buckets from `partitionSprintTasks()` (`backlog`, `todo`, `blocked`, `inProgress`, `awaitingReview`, `done`, `failed`) — NOT raw task statuses. `awaitingReview` = active/done with `pr_status=open`. `failed` = failed + error + cancelled. `done` is sorted by `completed_at` descending (most recent first).
- **Rebasing conflicting agent PRs**: Agents branching from the same main commit frequently conflict. Fix: create worktree, `git rebase origin/main`, resolve. For modify/delete conflicts (file deleted on main, modified in branch), accept the deletion with `git rm`. Always `--force-with-lease` when pushing.
- **Neon styling convention**: All views use CSS classes in dedicated `*-neon.css` files that layer on top of base CSS (don't modify base files). Import neon file AFTER base in `main.css`. Neon CSS files: `agents-neon.css`, `sprint-pipeline-neon.css`, `task-workbench-neon.css`, `ide-neon.css`, `pr-station-neon.css`, `diff-neon.css`, `sprint-neon.css` (legacy). Do NOT use inline `tokens.*` styles for neon views — use CSS classes. BEM-like naming per view: `.console-*` (agents), `.pipeline-*`/`.task-pill` (pipeline), `.wb-*` (workbench). Shared `.bde-btn` classes need scoped overrides inside neon views (e.g., `.pr-station .bde-btn--ghost`). Remaining views without neon: Source Control (`.git-*` classes in `diff.css`), Dashboard, Settings.
- **Agent PR merge strategy**: When agent PRs fail CI and fix tasks generate new PRs on separate branches, merge the originals first (with `--admin` if needed), then apply fixes on top. Fix PRs branching from main will conflict with the originals since they both add the same files.
- **Coverage artifacts**: The `coverage/` directory is generated by `npm run test:coverage` and is gitignored. If it somehow gets committed, `git rm -r --cached coverage/`.
- **Workbench AI uses Agent SDK**: `src/main/handlers/workbench.ts` uses `runSdkStreaming()` / `runSdkPrint()` via `@anthropic-ai/claude-agent-sdk` query(). Do NOT use `claude -p` — it returns empty output in recent CLI versions. Spec semantic checks in `spec-semantic-check.ts` also use the SDK (haiku model for speed).
- **Zustand aggregate selectors**: When a component needs 5+ fields from one store, use `useShallow` from `zustand/react/shallow`: `const { a, b, c } = useStore(useShallow(s => ({ a: s.a, b: s.b, c: s.c })))`. Single-field selectors for stable function refs are fine.
- **GitHub API cache**: `src/renderer/src/lib/github-cache.ts` — TTL cache wrapping `github-api.ts` functions (30s TTL). Use `cachedGetPRDetail`, `cachedGetPRFiles`, etc. in components. Call `invalidateCache()` after mutations.
- **react-resizable-panels exports**: Exports are `Group`, `Panel`, `Separator` — NOT `PanelGroup`/`PanelResizeHandle`. Use `orientation` prop on `Group` (not `direction`).
- **useConfirm API**: `useConfirm()` from `components/ui/ConfirmModal` returns `{ confirm, confirmProps }`. Render as `<ConfirmModal {...confirmProps} />` — NOT `<ConfirmDialog />`.
- **Settings key authority**: The main process (`src/main/index.ts` lines 155-163) is the source of truth for setting key names, types, and serialization format. When adding/editing settings UI, verify the key name, `.get()`/`.getJson()` usage, and units match what the main process reads.
- **CSS class name mismatches**: Components using BEM class names (e.g., `--selected`) must exactly match the CSS selectors (e.g., `--active`). No build error — styling silently breaks. After editing neon CSS classes, grep both the component and the CSS file to confirm they agree.
- **PR fields not API-patchable**: `pr_url`, `pr_number`, `pr_status` are NOT in `GENERAL_PATCH_FIELDS`. They are set internally by the completion handler and sprint PR poller. To manually fix orphaned task PR status, use SQLite directly: `sqlite3 ~/.bde/bde.db "UPDATE sprint_tasks SET pr_url='...', pr_number=N, pr_status='open' WHERE id='...'"`.
- **Cancelling completed tasks orphans PR data**: If a task has already opened a PR and you cancel it, sibling/duplicate tasks doing the same work won't inherit the PR info. The orphaned task stays `active` with no PR data. Fix by manually setting `pr_url`/`pr_status` on the surviving task via SQLite.
- **Pre-push hook runs full test suite**: Includes both `npm test` (renderer) and `npm run test:main` (integration). Known pre-existing failures: `queue-api-sse.test.ts` (missing `setSetting` mock), `workbench.test.ts` (SDK stub timeouts). If renderer tests and typecheck pass, use `--no-verify` to push.
- **Cherry-picking agent work to main**: Agent branches often contain the same changes as uncommitted modifications in the main working tree (agents apply changes directly). To cherry-pick: check `git diff` for matching changes, commit them directly, then `git push`. Remaining agent PRs with the same content will show "patch contents already upstream" during rebase — this is expected.
- **Subagent concurrency limit**: Dispatching 15+ background subagents simultaneously causes API rate limits. Practical limit is ~9 concurrent agents. Dispatch in batches of 6-8, retry rate-limited agents after others complete.
- **Audit reports**: `docs/superpowers/audits/` contains 15 audit reports + synthesis from March 2026 full-app audit (3 personas × 5 domain groups). Findings are being remediated through the task pipeline. Check `synthesis-final-report.md` for prioritized issues. Reports may reference files that have since been refactored.
- **Queue API auth bootstrapping**: If `taskRunner.apiKey` setting doesn't exist, the API accepts unauthenticated requests. The key is auto-generated on first access via the `getOrCreateApiKey()` helper. Scripts creating tasks before BDE has generated a key can skip auth headers.
- **Queue API task creation requires `repo`**: `POST /queue/tasks` requires a `repo` field (e.g., `"repo": "bde"`). Omitting it returns 400.
- **PATCH allowlist in git-handlers**: `validatePatchBody()` in `git-handlers.ts` restricts PATCH fields to `title`, `body`, `state`. When adding new GitHub API callers, verify the fields they send are in the allowlist.
- **Parallel agent PRs carry shared commits**: When multiple agents branch from the same base, their PRs include shared ancestor commits. Rebase with `git rebase --onto origin/main <shared-base-commit> HEAD` to keep only the fix commits.
- **Bulk task creation causes duplicates**: Queue API scripts that retry on failure produce duplicate tasks. After bulk creation, deduplicate: group by title, cancel all but the most-advanced copy (done > active > queued).
- **Post-merge artifact check**: After merging multiple PRs touching the same files, run `npm run typecheck` immediately. Common artifacts: duplicate imports, duplicate object properties, missing return types from conflict resolution.
- **Audit reports v2**: `docs/superpowers/audits/prod-audit-v2/` contains 18 follow-up audit reports from 2026-03-29 re-audit. All critical/high issues resolved. Remaining items are medium/low. Two regressions found and fixed (migration v17, PATCH allowlist).
- **UI text changes break tests**: WorkbenchActions and ReadinessChecks tests assert on `screen.getByText()` for button labels. When changing button text (e.g., "Launch" → "Queue & Run") or replacing emoji icons with Lucide components, update corresponding test files. Emoji tests check `.textContent`; Lucide tests should query `[aria-label]`.
- **Copilot localStorage persistence**: Copilot messages persist to `localStorage` under `bde:copilot-messages` (capped at 100). The store subscribes and writes after each non-streaming message change. `resetForm()` clears and re-persists.
- **gitTree operation states**: `commitLoading`, `pushLoading`, `lastError`, `clearError` in `gitTree.ts` store. CommitBox accepts these as props. GitTreeView renders an error banner when `lastError` is set.
- **IDE shortcuts overlay**: `Cmd+/` toggles a keyboard shortcuts help panel in IDEView. The `IDE_SHORTCUTS` array and overlay JSX live in `IDEView.tsx`.
- **Settings tab keyboard nav**: SettingsView tabs support Left/Right/Home/End arrow keys with `tabIndex` roving (active tab = 0, others = -1).
- **Electron ASAR interception on fs**: Node's `rmSync`/`readdirSync` fail on paths containing `.asar` files (e.g., `node_modules/electron/dist/*.asar`) because Electron patches `fs` to treat `.asar` as directories. Use shell `rm -rf` via `execFileAsync` for recursive deletion of directories that may contain `.asar` files (e.g., worktree cleanup).
- **Auth rate limit returns cache**: `MacOSCredentialStore.readToken()` returns cached `KeychainPayload` when rate-limited (1s cooldown) instead of throwing. Multiple renderer components call `auth:status` on mount — throwing causes error spam in logs.
- **Test event system mixing**: Never combine async `userEvent.type()` with sync `fireEvent.keyDown()` — the async state updates from `userEvent` may not have settled when the sync event fires, causing stale closure reads. Use either all-sync (`fireEvent.change` + `fireEvent.keyDown`) or all-async (`userEvent.type` + `userEvent.keyboard`).
- **Light mode CSS tokens**: All `*-neon.css` files use `var(--neon-*)` and `var(--bde-*)` tokens instead of hardcoded `rgba()`. Light theme works via `html.theme-light` class (toggled in Settings > Appearance) which overrides tokens in `base.css` and `neon.css`. No view-specific `html.theme-light` blocks needed.
- **Dashboard uses CSS classes**: `DashboardView.tsx` uses `dashboard-neon.css` classes (`.dashboard-*` prefix) — no inline styles. Don't reintroduce `style={{}}` props; add CSS classes instead.
- **Adhoc agent user messages**: `adhocHandle.send()` in `adhoc-agent.ts` must emit `agent:user_message` event BEFORE sending to SDK — otherwise user messages don't appear in the Agents console. The SDK stream only emits bot responses.
- **SDK query() is single-turn**: `sdk.query()` iterator ends when model emits a `result` message. For multi-turn adhoc agents, use `query()` per turn with `resume: sessionId` to continue the conversation. The session ID comes from the `system/init` message. `maxTurns`, `streamInput()`, and v2 `session.stream()` all terminate per-turn — they don't keep the session alive.
- **Clear `out/` after main process changes**: Vite HMR only hot-reloads the renderer. Main process changes (adhoc-agent, tearoff-manager, handlers) require `rm -rf out/` and restart `npm run dev` to take effect. The `predev` script rebuilds better-sqlite3 but doesn't clear the build cache.
- **Pipeline agents must use `canUseTool`**: Pipeline agents are non-interactive (no human at stdin). Without `canUseTool: async () => ({ behavior: 'allow' })`, any unapproved tool hangs forever waiting for stdin permission. Safety comes from worktree isolation + PR review, not permission prompts.
- **Agent permissions in `~/.claude/settings.json`**: Agent tool permissions (allow/deny) live in the Claude Code CLI config file, NOT in BDE's SQLite settings table. Read/write via `claude:getConfig`/`claude:setPermissions` IPC (registered in `claude-config-handlers.ts`). `claude-settings-bootstrap.ts` applies BDE defaults on first launch if no permissions configured.
- **Tear-off windows**: `src/main/tearoff-manager.ts` manages lifecycle. Query-param routing (`?view=X&windowId=Y`) in `App.tsx` → `TearoffShell`. Cross-window drag via IPC relay through main process (32ms cursor polling). Multi-tab tear-offs use `PanelRenderer` with independent `panelLayout` store per window. State persists to `tearoff.windows` setting and restores on startup.
- **Tear-off `persistable` flag**: `panelLayout.ts` has `persistable: boolean` — tear-off windows set it to `false` on mount to prevent their store mutations from overwriting the main window's saved layout in `panel.layout` setting.
- **Tearoff `window.api` guards**: All `window.api.tearoff.*` calls in `TearoffShell.tsx` MUST use optional chaining (`window.api?.tearoff?.method()`). The preload script can fail to load in tearoff windows, making `window.api` undefined. Missing guards crash the component and render a blank white screen.
- **Hardcoded `#fff` in agents CSS**: `agents-neon.css` has hardcoded `#fff` in `.agent-pill__name`, `.command-bar__input`, and `.command-autocomplete__item--active`. These are invisible in light/warm themes — replace with `var(--neon-text)` when fixing light mode styling.
- **Shared view resolver**: `src/renderer/src/lib/view-resolver.tsx` has lazy view imports and `resolveView()`. Both `PanelLeaf.tsx` and `TearoffShell.tsx` import from here — don't duplicate lazy imports.

## Packaging

```bash
npm run build:mac    # Build unsigned macOS arm64 DMG → release/BDE-*.dmg
npm run package      # Alias for build:mac
```

- **Prerequisites for users**: Claude Code CLI installed + `claude login`, `git`, `gh` CLI
- **Unsigned**: `identity: null` in electron-builder.yml — users right-click → Open to bypass Gatekeeper
- **Onboarding**: App shows auth check screen on first launch with checks for CLI, token, git, repos (optional). Optional checks warn but don't block. Auto-skips for returning users with valid token.

## Key Conventions

- TypeScript strict mode
- Zustand for all client state
- `lucide-react` for icons
- `react-resizable-panels` for panel layouts (`orientation` prop, not `direction`)
- ARIA accessibility: landmarks (`<main>`, `<nav>`), dialog semantics (`role="dialog"`, `aria-modal`), tab patterns (`role="tablist"`/`role="tab"`), live regions on ToastContainer. Maintain these when adding new UI.
- Max one Zustand store per domain concern
- Polling intervals centralized in `src/renderer/src/lib/constants.ts`
- Use `useBackoffInterval` (not raw `setInterval`) for new polling — provides jitter + backoff
- New main-process modules: use `createLogger(name)` from `src/main/logger.ts` — not raw `console.*`
- Agent manager data access: always through `ISprintTaskRepository`, never direct sprint-queries imports
- WIP limit (`MAX_ACTIVE_TASKS`) enforced at API layer — don't rely on UI-only enforcement
- Task dependency validation runs before creation — no create-then-rollback patterns
- Audit trail is automatic — `updateTask()` records field-level diffs to `task_changes` table
- Optimistic updates track fields, not just task IDs — only pending fields preserved on poll merge
