# BDE — Birkeland Development Environment

A desktop Electron app for managing OpenClaw AI agent sessions, sprint task queues, git workflows, cost tracking, and agent memory. Built with React, TypeScript, Zustand, and SQLite.

## Prerequisites

- **Node.js** v22+ (managed via nvm)
- **npm** for dependency management
- **OpenClaw gateway** running locally — BDE reads config from `~/.openclaw/openclaw.json` to connect on port 18789

## Installation

### Development (recommended)

```bash
npm install
npm run dev
```

### Production Install (BDE.app + auto-start)

Builds a .dmg, installs to /Applications, and registers a launchd service that auto-starts BDE on login and restarts it on crash.

```bash
chmod +x scripts/install-bde.sh
./scripts/install-bde.sh
```

Requirements: macOS arm64, Xcode command line tools.

To uninstall:

```bash
launchctl unload ~/Library/LaunchAgents/com.rbtechbot.bde.plist
rm -rf /Applications/BDE.app
rm ~/Library/LaunchAgents/com.rbtechbot.bde.plist
```

## Data Layer

All persistent state lives in a local SQLite database at `~/.bde/bde.db` (WAL mode, foreign keys enforced). Three tables:

| Table          | Purpose                                                                        |
| -------------- | ------------------------------------------------------------------------------ |
| `sprint_tasks` | Kanban board tasks — title, prompt, repo, status, PR link, agent run reference |
| `agent_runs`   | Audit trail for spawned agents — PID, binary, model, status, log path          |
| `settings`     | Key-value app configuration                                                    |

The main process watches the DB file for external writes (e.g. from the task runner) and pushes `sprint:external-change` events to the renderer via IPC, so the UI stays in sync without polling the database.

## Views

| View             | Shortcut | Description                                                                                                                                                      |
| ---------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Sessions**     | `Cmd+1`  | Multi-panel workspace — session list, task composer, live feed, agent director, log viewer. Polls gateway every 10s.                                             |
| **Sprint / PRs** | `Cmd+2`  | Kanban board (backlog → queued → active → done) and GitHub PR list. Polls PRs via GitHub REST API every 60s. Auto-marks tasks done on merge, cancelled on close. |
| **Diff**         | `Cmd+3`  | Full git client — file staging/unstaging, diff viewer, commit composer, push. Multi-repo support (BDE, life-os, feast).                                          |
| **Memory**       | `Cmd+4`  | File browser + editor for OpenClaw agent memory at `~/.openclaw/workspace/memory/`.                                                                              |
| **Cost Tracker** | `Cmd+5`  | Token cost analytics — daily spend chart, model breakdown, per-session table, CSV export. Polls every 30s.                                                       |
| **Settings**     | `Cmd+6`  | Gateway URL/token config, theme switcher (dark/light), accent color presets.                                                                                     |

## Agent Spawning

BDE spawns Claude CLI agents directly from the Electron main process:

1. User creates a sprint task (backlog) and pushes it to the sprint queue (queued)
2. User clicks "Launch" — BDE spawns `claude --output-format stream-json --input-format stream-json` in the target repo directory
3. Agent runs with `--dangerously-skip-permissions` as a detached child process
4. stdout/stderr stream to a persistent log file; the renderer polls the log via incremental byte-offset reads
5. Users can steer running agents via stdin messaging from the Sprint LogDrawer
6. On exit, the agent record in `agent_runs` is marked `done` (exit 0) or `failed`

Agent logs are stored under `/tmp/bde-agents/` with 7-day automatic cleanup.

## Task Lifecycle

```
backlog → queued → active → done
                         ↘ cancelled
```

| Transition         | Trigger                                                      |
| ------------------ | ------------------------------------------------------------ |
| backlog → queued   | User drags card or clicks "Push to Sprint"                   |
| queued → active    | User clicks "Launch" (spawns agent)                          |
| active → done      | PR merged (detected by `pollPrStatuses` via GitHub REST API) |
| active → cancelled | PR closed without merge                                      |

PR polling runs every 60s (`POLL_PR_STATUS_MS`). On merge, `markTaskDoneOnMerge` updates the SQLite row. On close without merge, `markTaskCancelled` fires.

## Gateway Config

BDE requires `~/.openclaw/openclaw.json` to exist with at minimum:

```json
{
  "gateway": {
    "url": "ws://127.0.0.1:18789",
    "token": "your-gateway-token"
  }
}
```

GitHub token is also read from this config for PR status polling.

## Scripts

| Script                | Purpose                                    |
| --------------------- | ------------------------------------------ |
| `npm run dev`         | Electron-vite dev server with HMR          |
| `npm run build`       | Type-check + build for production          |
| `npm start`           | Preview the built app                      |
| `npm test`            | Run unit tests once (vitest)               |
| `npm run test:watch`  | Vitest in watch mode                       |
| `npm run typecheck`   | TypeScript type checking (also runs in CI) |
| `npm run lint`        | ESLint with cache                          |
| `npm run format`      | Prettier                                   |
| `npm run build:mac`   | macOS app bundle                           |
| `npm run build:win`   | Windows executable                         |
| `npm run build:linux` | Linux AppImage                             |

## Architecture

```
~/.bde/
  bde.db              # SQLite database (WAL mode)

src/
  main/               # Electron main process
    index.ts           #   App entry — DB init, file watcher, IPC handler registration
    db.ts              #   SQLite schema, migrations, WAL config
    git.ts             #   Git operations, PR status polling via GitHub REST API
    local-agents.ts    #   Agent process scanning, spawning, stdin steering, log tailing
    config.ts          #   Gateway/GitHub token config from ~/.openclaw/openclaw.json
    handlers/          #   IPC handler modules (agent, config, gateway, git, sprint, terminal, window)
    fs.ts              #   Memory file I/O, file system handlers
  preload/             # Preload bridge — type-safe window.api surface
    index.ts           #   contextBridge exposing all IPC channels to renderer
  renderer/src/
    views/             # 6 top-level views (Sessions, Sprint, Diff, Memory, Cost, Settings)
    stores/            # Zustand stores (chat, gateway, sessions, toasts, ui, theme)
    components/        # UI components (layout, sessions, sprint, diff, ui primitives)
    design-system/     # Design tokens (colors, spacing, typography, etc.)
    lib/               # RPC client, diff parser, constants, utilities
  shared/              # Types and IPC channel definitions shared between main/renderer
```

## Polling Intervals

| What                    | Interval | Constant                   |
| ----------------------- | -------- | -------------------------- |
| Agent process scan      | 5s       | `POLL_PROCESSES_INTERVAL`  |
| Gateway sessions        | 10s      | `POLL_SESSIONS_INTERVAL`   |
| Sprint tasks (idle)     | 30s      | `POLL_SPRINT_INTERVAL`     |
| Sprint tasks (active)   | 5s       | `POLL_SPRINT_ACTIVE_MS`    |
| PR status (GitHub REST) | 60s      | `POLL_PR_STATUS_MS`        |
| Git status              | 30s      | `POLL_GIT_STATUS_INTERVAL` |
| Agent log tail          | 1s       | `POLL_LOG_INTERVAL`        |

## CI

GitHub Actions runs on every push to `main` and every PR:

- **Typecheck**: `npm run typecheck`
- **Unit tests**: `npm test`

Both must pass before merging.

## Keyboard Shortcuts

| Key       | Action            |
| --------- | ----------------- |
| `Cmd+1–6` | Switch views      |
| `Cmd+K`   | Command palette   |
| `Cmd+R`   | Refresh sessions  |
| `?`       | Shortcuts overlay |
| `Esc`     | Close overlays    |
