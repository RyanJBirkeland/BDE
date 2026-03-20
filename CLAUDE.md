# CLAUDE.md — BDE

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

- **Data layer**: SQLite database at `~/.bde/bde.db` (WAL mode). Schema in `src/main/db.ts`. Tables: `sprint_tasks`, `agent_runs`, `settings`, `cost_events`.
- **State**: Zustand stores in `src/renderer/src/stores/`
- **IPC**: Main process handlers in `src/main/handlers/`, registered in `src/main/index.ts`, preload bridge in `src/preload/index.ts`
- **RPC**: Renderer talks to OpenClaw gateway via WebSocket (`src/renderer/src/lib/gateway.ts`)
- **PR polling**: `pollPrStatuses` in `src/main/git.ts` — GitHub REST API, 60s interval, auto-marks tasks done on merge or cancelled on close
- **Agent spawning**: `src/main/local-agents.ts` — spawns Claude CLI agents with stream-json I/O
- **DB sync**: File watcher on `bde.db` pushes `sprint:external-change` IPC events to renderer (500ms debounce)
- **Design tokens**: `src/renderer/src/design-system/tokens.ts` — use these instead of hardcoded values
- **Views**: 7 views in `src/renderer/src/views/` — Sessions, Terminal, Sprint, PR Station, Memory, Cost, Settings
- **Full architecture**: See `docs/architecture.md`

## Key Conventions

- TypeScript strict mode
- Zustand for all client state
- `lucide-react` for icons
- `react-resizable-panels` for panel layouts
- Max one Zustand store per domain concern
- Polling intervals centralized in `src/renderer/src/lib/constants.ts`
