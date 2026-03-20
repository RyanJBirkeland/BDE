# CLAUDE.md — BDE

Electron desktop app (electron-vite + React + TypeScript) — the Birkeland Development Environment.

## Build & Test

```bash
npm install          # Install dependencies
npm run dev          # Dev server with HMR
npm run build        # Type-check + production build (must pass before PR)
npm run typecheck    # TypeScript type checking (also runs in CI)
npm test             # Unit tests via vitest (must pass before PR)
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

- **Data layer**: SQLite database at `~/.bde/bde.db` (WAL mode). Schema in `src/main/db.ts`. Tables: `sprint_tasks`, `agent_runs`, `settings`, `cost_events`, `agent_events`.
- **Queue API**: `src/main/queue-api/` exposes sprint tasks to the task runner on port 18790 (localhost). Enriches responses with `repo_path`/`gh_repo` from repo settings. Endpoints: `/queue/tasks`, `/queue/tasks/:id/claim`, `/queue/tasks/:id/release`, `/queue/tasks/:id/status`, `/queue/tasks/:id/output`.
- **Sprint PR poller**: `src/main/sprint-pr-poller.ts` — runs every 60s in main process (not renderer-dependent), polls PR status for tasks with `pr_status='open'`.
- **State**: Zustand stores in `src/renderer/src/stores/`
- **IPC**: Main process handlers in `src/main/handlers/`, registered in `src/main/index.ts`, preload bridge in `src/preload/index.ts`
- **RPC**: Renderer talks to OpenClaw gateway via WebSocket (`src/renderer/src/lib/gateway.ts`)
- **PR polling**: `pollPrStatuses` in `src/main/git.ts` — GitHub REST API, 60s interval, auto-marks tasks done on merge or cancelled on close
- **Agent spawning**: `src/main/local-agents.ts` delegates to `src/main/agents/` provider factory (SDK or CLI). Event bus persists `AgentEvent` stream to SQLite and broadcasts via IPC.
- **DB sync**: File watcher on `bde.db` pushes `sprint:external-change` IPC events to renderer (500ms debounce)
- **Design tokens**: `src/renderer/src/design-system/tokens.ts` — use these instead of hardcoded values
- **Views**: 7 views in `src/renderer/src/views/` — Agents, Terminal, Sprint, PR Station, Memory, Cost, Settings
- **Full architecture**: See `docs/architecture.md`

## Gotchas

- **FK constraints**: `sprint_tasks.agent_run_id` has NO foreign key constraint (migration v10 dropped it) — agent runs live in the task runner's own DB, not BDE's.
- **Queue API auth**: No authentication on queue API (localhost-only security model). Task runner authenticates to its OWN API via `SPRINT_API_KEY`, not to BDE's queue API.
- **Pre-push hook**: Husky runs `npm run typecheck && npm test` before every push. Fix failures before retrying.
- **Native modules**: `better-sqlite3` is rebuilt for Electron in `postinstall`. If `npm install` fails, check native build tools. `test:main` has pre/post scripts to swap between Node/Electron builds.
- **DB migrations**: Schema changes go through `src/main/db.ts` — add a new entry to the `migrations` array. Never modify existing migrations.

## Key Conventions

- TypeScript strict mode
- Zustand for all client state
- `lucide-react` for icons
- `react-resizable-panels` for panel layouts
- Max one Zustand store per domain concern
- Polling intervals centralized in `src/renderer/src/lib/constants.ts`
