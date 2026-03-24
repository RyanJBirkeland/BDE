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
npm run lint         # ESLint
npm run format       # Prettier
```

## CI

GitHub Actions runs on every push to `main` and every PR targeting `main`:

- `npm run typecheck` — must pass
- `npm test` — must pass

Both checks are required before merge.

## Branch Conventions

- `feat/` — New features (e.g. `feat/git-client`)
- `fix/` — Bug fixes (e.g. `fix/rpc-layer`)
- `chore/` — Maintenance, docs, refactors (e.g. `chore/audit`)

## Commit Messages

Format: `{type}: {description}`

- `feat:` new feature
- `fix:` bug fix
- `chore:` maintenance / docs

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

- **Data layer**: SQLite at `~/.bde/bde.db` (WAL mode, schema in `src/main/db.ts`) for local tables: `agent_runs`, `settings`, `cost_events`, `agent_events`. Sprint tasks live in **Supabase** (`sprint_tasks` table) — accessed via `src/main/data/sprint-queries.ts`. Local `sprint_tasks` was dropped in migration v12.
- **AgentManager**: `src/main/agent-manager/` — in-process task orchestration (replaces external task runner). Drain loop watches for queued tasks, spawns agents in git worktrees via SDK, monitors with watchdogs, handles completion (push branch, open PR, retry logic). Fully dependency-injected.
- **AuthGuard**: `src/main/auth-guard.ts` — validates Claude Code subscription token. NOT called in the drain loop (Keychain access hangs in Electron). Auth is validated by the SDK at spawn time instead. Users must run `claude login` to authenticate.
- **Task dependencies**: `src/main/agent-manager/dependency-index.ts` (in-memory reverse index, cycle detection), `src/main/agent-manager/resolve-dependents.ts` (blocked→queued transitions). Tasks can declare `depends_on: TaskDependency[]` with `hard` (block on failure) or `soft` (unblock regardless) edges. `blocked` status = unsatisfied hard deps. Resolution triggered from all terminal status paths.
- **PR poller**: `src/main/pr-poller.ts` — polls open PRs from all configured repos every 60s, fetches check runs, broadcasts `pr:listUpdated` to renderer. Separate from sprint PR poller.
- **Sprint PR poller**: `src/main/sprint-pr-poller.ts` — runs every 60s in main process (not renderer-dependent), polls PR status for tasks with `pr_status='open'`. Auto-marks tasks done (merged) or cancelled (closed).
- **State**: Zustand stores in `src/renderer/src/stores/`
- **IPC**: 13 handler modules in `src/main/handlers/`, registered in `src/main/index.ts`, preload bridge in `src/preload/index.ts`. 69 typed channels in `src/shared/ipc-channels.ts`.
- **Agent spawning**: `src/main/agent-manager/sdk-adapter.ts` spawns agents via `@anthropic-ai/claude-agent-sdk` (with CLI fallback). OAuth token read from `~/.bde/oauth-token` at startup — Keychain access hangs in Electron's main process, so the file-based approach is required.
- **Queue API**: `src/main/queue-api/` — HTTP server on port 18790. Task CRUD with camelCase field mapping, SSE broadcaster (`task:queued`/`task:updated`/`task:output`), auth via Bearer header or `?token=` query param. Accepts agent visibility events at `POST /queue/tasks/:id/output`.
- **DB sync**: File watcher on `bde.db` pushes `sprint:externalChange` IPC events to renderer (500ms debounce)
- **Design tokens**: `src/renderer/src/design-system/tokens.ts` — use these instead of hardcoded values
- **Panel system**: `src/renderer/src/stores/panelLayout.ts` — recursive PanelNode tree (leaf/split), `src/renderer/src/components/panels/` — PanelRenderer, PanelLeaf, PanelTabBar, PanelDropOverlay. Layout persists to `panel.layout` setting. Views rendered inside panels; drag-and-drop docking with 5-zone hit testing.
- **Views**: 7 views in `src/renderer/src/views/` — Agents, Terminal, Sprint, PR Station, Memory, Cost, Settings. Rendered inside panels (no longer single-view-at-a-time).
- **PR Station**: Full code review tool in `src/renderer/src/components/pr-station/` (9 components) + `src/renderer/src/components/diff/` (DiffViewer, DiffCommentWidget, DiffCommentComposer). Features: PR list with CI badges, detail panel (reviews, conversation timeline, changed files, conflict detection), diff viewer with line selection and inline comments, batch review submission (approve/request changes/comment). `pendingReview` Zustand store tracks pending comments per PR. All GitHub API calls in `src/renderer/src/lib/github-api.ts` proxied through `github:fetch` IPC.
- **Full architecture**: See `docs/architecture.md`

## Gotchas

- **FK constraints**: `sprint_tasks.agent_run_id` has NO foreign key constraint (migration v10 dropped it).
- **Keychain token format**: `claudeAiOauth.expiresAt` is a stringified epoch millisecond, NOT an ISO date. Parse with `parseInt(val, 10)`.
- **electron-builder afterSign**: Cannot use `.sh` files as `afterSign` hooks — electron-builder `require()`s them as JavaScript. Use `.js`/`.cjs` files, or omit for unsigned builds (`identity: null`).
- **Subagent branch safety**: When dispatching subagents, explicitly tell them which branch to commit to. Subagents may default to `main` if not told otherwise.
- **Pre-push hook**: Husky runs `npm run typecheck && npm test` before every push. Fix failures before retrying.
- **Native modules**: `better-sqlite3` is rebuilt for Electron in `postinstall`. If `npm install` fails, check native build tools. Run `npm run postinstall` after install to avoid `NODE_MODULE_VERSION` mismatch crashes. `test:main` has pre/post scripts to swap between Node/Electron builds.
- **Zustand selector gotcha**: Never call a function that returns a new array/object inside a Zustand selector (e.g., `useSomeStore(s => s.getList())`). This creates a new reference every render → infinite loop. Derive with `useMemo` from stable state instead.
- **DB migrations**: Schema changes go through `src/main/db.ts` — add a new entry to the `migrations` array. Never modify existing migrations.
- **Test noise from `release/`**: If a DMG has been built, `npm test` picks up `node-pty` tests inside `release/mac-arm64/BDE.app/` — these always fail and are not project tests. Ignore them or delete `release/` before running tests.
- **AgentManager config requires restart**: Settings for max concurrent agents, worktree base, and max runtime are read once at startup. Changes via Settings UI take effect on next app launch.
- **Integration tests**: `src/main/__tests__/integration/` — covers AgentManager pipeline, AuthGuard, IPC handlers, and CompletionHandler. Run with `npm run test:main`. All tests passing (436 main, 398 renderer).
- **Electron PATH**: Electron's main process has a minimal PATH. Agent manager uses absolute paths (`/opt/homebrew/bin/git`, `/opt/homebrew/bin/gh`) for CLI tools. The SDK adapter adds `/usr/local/bin`, `/opt/homebrew/bin` to spawned agent env.
- **OAuth token file**: Agent manager reads `~/.bde/oauth-token` (plain text, one line). Keychain access via `security` CLI hangs in Electron — never use `execFileSync('security', ...)` in the main process.
- **Supabase setup**: BDE needs `supabase.url` and `supabase.serviceKey` in the SQLite `settings` table. Also needs `repos` JSON setting with `name`, `localPath`, `githubOwner`, `githubRepo` per configured repo.
- **Agent branch stale cleanup**: Before re-running a task, delete stale `agent/*` branches with `git branch -D agent/<slug>` and run `git worktree prune`. Otherwise `git worktree add` fails.

## Packaging

```bash
npm run build:mac    # Build unsigned macOS arm64 DMG → release/BDE-*.dmg
npm run package      # Alias for build:mac
```

- **Prerequisites for users**: Claude Code CLI installed + `claude login`, `git`, `gh` CLI
- **Unsigned**: `identity: null` in electron-builder.yml — users right-click → Open to bypass Gatekeeper
- **Onboarding**: App shows auth check screen on first launch; auto-skips for returning users with valid token

## Key Conventions

- TypeScript strict mode
- Zustand for all client state
- `lucide-react` for icons
- `react-resizable-panels` for panel layouts
- Max one Zustand store per domain concern
- Polling intervals centralized in `src/renderer/src/lib/constants.ts`
