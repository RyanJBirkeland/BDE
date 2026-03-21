# CLAUDE.md — BDE

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

- **Data layer**: SQLite database at `~/.bde/bde.db` (WAL mode). Schema in `src/main/db.ts`. Tables: `sprint_tasks`, `agent_runs`, `settings`, `cost_events`, `agent_events`.
- **AgentManager**: `src/main/agent-manager/` — in-process task orchestration (replaces external task runner). Drain loop watches for queued tasks, spawns agents in git worktrees via SDK, monitors with watchdogs, handles completion (push branch, open PR, retry logic). Fully dependency-injected.
- **AuthGuard**: `src/main/auth-guard.ts` — validates Claude Code subscription token from macOS Keychain (`Claude Code-credentials`). Called before every agent spawn. Users must run `claude login` to authenticate.
- **Sprint PR poller**: `src/main/sprint-pr-poller.ts` — runs every 60s in main process (not renderer-dependent), polls PR status for tasks with `pr_status='open'`.
- **State**: Zustand stores in `src/renderer/src/stores/`
- **IPC**: Main process handlers in `src/main/handlers/`, registered in `src/main/index.ts`, preload bridge in `src/preload/index.ts`
- **PR polling**: `pollPrStatuses` in `src/main/git.ts` — GitHub REST API, 60s interval, auto-marks tasks done on merge or cancelled on close
- **Agent spawning**: `src/main/local-agents.ts` delegates to `SdkProvider` (`src/main/agents/sdk-provider.ts`). Event bus persists `AgentEvent` stream to SQLite and broadcasts via IPC.
- **Agent event pipeline**: `local-agents.ts` → `consumeEvents()` → event bus (`getEventBus().emit()`) → SQLite `agent_events` table + IPC broadcast to renderer. If events don't appear in the Agents view, check that `bus.emit('agent:event', id, event)` is called in the consume loop.
- **DB sync**: File watcher on `bde.db` pushes `sprint:external-change` IPC events to renderer (500ms debounce)
- **Design tokens**: `src/renderer/src/design-system/tokens.ts` — use these instead of hardcoded values
- **Panel system**: `src/renderer/src/stores/panelLayout.ts` — recursive PanelNode tree (leaf/split), `src/renderer/src/components/panels/` — PanelRenderer, PanelLeaf, PanelTabBar, PanelDropOverlay. Layout persists to `panel.layout` setting. Views rendered inside panels; drag-and-drop docking with 5-zone hit testing.
- **Views**: 7 views in `src/renderer/src/views/` — Agents, Terminal, Sprint, PR Station, Memory, Cost, Settings. Rendered inside panels (no longer single-view-at-a-time).
- **Full architecture**: See `docs/architecture.md`

## Gotchas

- **FK constraints**: `sprint_tasks.agent_run_id` has NO foreign key constraint (migration v10 dropped it) — agent runs live in the task runner's own DB, not BDE's.
- **Keychain token format**: `claudeAiOauth.expiresAt` is a stringified epoch millisecond, NOT an ISO date. Parse with `parseInt(val, 10)`.
- **electron-builder afterSign**: Cannot use `.sh` files as `afterSign` hooks — electron-builder `require()`s them as JavaScript. Use `.js`/`.cjs` files, or omit for unsigned builds (`identity: null`).
- **Subagent branch safety**: When dispatching subagents, explicitly tell them which branch to commit to. Subagents may default to `main` if not told otherwise.
- **Pre-push hook**: Husky runs `npm run typecheck && npm test` before every push. Fix failures before retrying.
- **Native modules**: `better-sqlite3` is rebuilt for Electron in `postinstall`. If `npm install` fails, check native build tools. `test:main` has pre/post scripts to swap between Node/Electron builds.
- **Native module rebuild**: After `npm install`, run `npm run postinstall` to rebuild `better-sqlite3` for Electron. Without this, the app crashes with `NODE_MODULE_VERSION` mismatch.
- **Zustand selector gotcha**: Never call a function that returns a new array/object inside a Zustand selector (e.g., `useSomeStore(s => s.getList())`). This creates a new reference every render → infinite loop. Derive with `useMemo` from stable state instead.
- **DB migrations**: Schema changes go through `src/main/db.ts` — add a new entry to the `migrations` array. Never modify existing migrations.
- **Test noise from `release/`**: If a DMG has been built, `npm test` picks up `node-pty` tests inside `release/mac-arm64/BDE.app/` — these always fail and are not project tests. Ignore them or delete `release/` before running tests.
- **AgentManager config requires restart**: Settings for max concurrent agents, worktree base, and max runtime are read once at startup. Changes via Settings UI take effect on next app launch.
- **Integration tests**: `src/main/__tests__/integration/` — 50 tests covering AgentManager pipeline, AuthGuard, IPC handlers, and CompletionHandler. Run with `npm run test:main`.
- **Pre-existing test failures**: `fs.test.ts` (2) and `git.test.ts` (3) have 5 known failures unrelated to recent work. Don't chase these.

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
