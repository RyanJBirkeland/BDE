# FLEET Architecture

**Last updated:** 2026-04-21

This doc is a **bird's-eye overview**. It describes how FLEET's pieces fit together and links into the authoritative per-module reference under [`docs/modules/`](modules/README.md). Per the pre-commit rule in `CLAUDE.md`, each source file has a matching row in its layer's `index.md` — treat those as ground truth for specifics (types, exports, conventions). If the overview here ever disagrees with `docs/modules/`, the module doc wins.

---

## System Overview

FLEET is an Electron desktop app with three process layers:

```
┌──────────────────────────────────────────────────────────────────────┐
│                             ELECTRON APP                             │
│                                                                      │
│  MAIN PROCESS (Node.js)                                              │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │ agent-manager/  data/  handlers/  services/  mcp-server/  lib/ │  │
│  │    db.ts (SQLite WAL)    migrations/    logger.ts              │  │
│  │    auth-guard.ts    fs.watch(fleet.db) → sprint:externalChange   │  │
│  │    status-server :18791 (always)    mcp-server :18792 (opt-in) │  │
│  └──────────────────────────┬─────────────────────────────────────┘  │
│                             │ IPC (safeHandle + typed channel map)   │
│  PRELOAD BRIDGE             │                                        │
│  ┌──────────────────────────▼─────────────────────────────────────┐  │
│  │ src/preload/index.ts  — contextBridge → window.api             │  │
│  └──────────────────────────┬─────────────────────────────────────┘  │
│                             │                                        │
│  RENDERER (React + Zustand) │                                        │
│  ┌──────────────────────────▼─────────────────────────────────────┐  │
│  │ views/  stores/  components/  hooks/  lib/                     │  │
│  │ Panel system (split + dockable + tear-off windows)             │  │
│  └────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────┘
        │                                                  │
        │ Anthropic API (Claude Agent SDK)                 │ GitHub API (PRs, pushes)
        ▼                                                  ▼
   api.anthropic.com                                  api.github.com
```

Every user-facing feature lives in one of the three processes and crosses boundaries only through the typed IPC channel map (`src/shared/ipc-channels/`). The main process owns all persistent state and all outbound network access. The renderer is pure UI.

---

## Where to look for detail

| You want to know about…          | Go to                                                                              |
| -------------------------------- | ---------------------------------------------------------------------------------- |
| Agent orchestration + lifecycle  | [`docs/modules/agent-manager/index.md`](modules/agent-manager/index.md)            |
| Native agent personalities/skills | [`docs/agent-system-guide.md`](agent-system-guide.md)                              |
| IPC handlers + channels          | [`docs/modules/handlers/index.md`](modules/handlers/index.md)                      |
| Repository pattern + queries     | [`docs/modules/data/index.md`](modules/data/index.md)                              |
| Business services                | [`docs/modules/services/index.md`](modules/services/index.md)                      |
| Shared types, validators, IPC    | [`docs/modules/shared/index.md`](modules/shared/index.md)                          |
| Main-process utilities           | [`docs/modules/lib/main/index.md`](modules/lib/main/index.md)                      |
| Renderer views                   | [`docs/modules/views/index.md`](modules/views/index.md)                            |
| Zustand stores                   | [`docs/modules/stores/index.md`](modules/stores/index.md)                          |
| React hooks                      | [`docs/modules/hooks/index.md`](modules/hooks/index.md)                            |
| UI components                    | [`docs/modules/components/index.md`](modules/components/index.md)                  |
| Renderer utilities               | [`docs/modules/lib/renderer/index.md`](modules/lib/renderer/index.md)              |
| Local MCP server                 | [`docs/modules/mcp-server/`](modules/mcp-server/)                                  |
| Feature reference (user-facing)  | [`docs/FLEET_FEATURES.md`](FLEET_FEATURES.md)                                          |
| Security posture + loopback surface | [`docs/security-posture.md`](security-posture.md)                               |
| Architecture decisions           | [`docs/architecture-decisions/`](architecture-decisions/)                          |

---

## Task Lifecycle

Every piece of work in FLEET flows through the same state machine (`src/shared/task-state-machine.ts`):

```
                 ┌───────────┐
                 │  backlog  │  draft spec in Task Workbench
                 └─────┬─────┘
                       │ user queues
                       ▼
        ┌────────►┌───────────┐
        │         │  queued   │  waiting for Agent Manager
        │         └─────┬─────┘
        │               │ drain loop claims
        │               ▼
 hard-dep        ┌───────────┐
 satisfied       │  active   │  Claude Code session running in worktree
        ▲         └─────┬─────┘
        │               │ completion
        │               ▼
 ┌───────────┐    ┌───────────┐
 │  blocked  │    │  review   │  worktree preserved; human decides
 └───────────┘    └─────┬─────┘
        ▲               │
        │               ├─ merge locally → ┐
        │               ├─ create PR ──────┤
        │               ├─ request revise ─┤ (→ back to queued)
        │               └─ discard ────────┤
        │                                   ▼
        │                          ┌────────────────┐
        │                          │ done│cancelled│
        │                          │  failed │ error │
        │                          └────────────────┘
        └─ auto-blocked at creation when unsatisfied hard deps present
```

The `TaskStatus` union has 9 members: `backlog`, `queued`, `blocked`, `active`, `review`, `done`, `cancelled`, `failed`, `error`. Transitions are enforced by `isValidTransition()` at the data layer inside `updateTask()`. The review gate between `active` and `done` is Code Review Station — no agent pushes directly to main. For dependency semantics (hard vs. soft, cycle detection, auto-resolution on completion) see the agent-manager and services indexes.

---

## Persistence

- **Database:** `~/.fleet/fleet.db` — better-sqlite3, WAL mode, `foreign_keys = ON`. Schema is defined in `src/main/db.ts`; migrations are individual files under `src/main/migrations/v001-*.ts` through `vNNN-*.ts` (52+ so far), loaded by `migrations/loader.ts` in order. `PRAGMA user_version` is the authoritative migration pointer — don't trust any version number in docs.
- **Backup:** `VACUUM INTO fleet.db.backup` runs on startup and every 24 hours.
- **File watcher:** `fs.watch()` on `fleet.db` and the WAL file debounces external writes and pushes `sprint:externalChange` to the renderer (500 ms). This lets external mutators (the MCP server, direct SQL, other FLEET windows) stay in sync with UI state.
- **Audit trail:** every field-level mutation on `sprint_tasks` via `updateTask()` writes a row to `task_changes` with `changed_by` attribution (IPC caller, MCP caller, etc.). `ISprintTaskRepository` is the single write path for agent-manager code.
- **Boundary validators:** raw JSON columns (`depends_on`, webhook events, agent history, task-group depends_on) all have matching sanitizers/validators that run on row-read. See [`docs/modules/shared/index.md`](modules/shared/index.md) and the T-series entries in [`docs/modules/data/index.md`](modules/data/index.md).
- **User state files:** `~/.fleet/oauth-token` (Claude), `~/.fleet/mcp-token` (MCP, when enabled), `~/.fleet/fleet.log` (authoritative log; rotated at 10 MB), `~/.fleet/worktrees/<repo-slug>/<task-id>/` (pipeline agents), `~/.fleet/worktrees-adhoc/` (user-spawned adhoc agents), `~/.fleet/agent-logs/` (per-agent output), `~/.fleet/memory/` (user memory).

---

## Main-process background services

These run without any renderer interaction:

| Service                | File                                        | Purpose                                                             |
| ---------------------- | ------------------------------------------- | ------------------------------------------------------------------- |
| Agent Manager drain loop | `src/main/agent-manager/index.ts`         | Claims queued tasks, spawns pipeline agents, enforces WIP + watchdog |
| Sprint PR poller       | `src/main/sprint-pr-poller.ts`              | Every 60 s: marks tasks `done`/`cancelled` when PRs merge/close     |
| PR poller              | `src/main/pr-poller.ts`                     | Every 60 s: fetches check runs across all configured repos; pushes `pr:listUpdated` |
| Status HTTP server     | `src/main/services/status-server.ts`        | Loopback `:18791` read-only `/status` endpoint                      |
| Local MCP server (opt-in) | `src/main/mcp-server/`                    | Loopback `:18792` MCP Streamable HTTP with bearer-token auth        |
| DB backup + watcher    | `src/main/db.ts`, watcher wired in `index.ts` | WAL-mode backup on start + every 24h; fs.watch pushes `sprint:externalChange` |
| Auth guard             | `src/main/auth-guard.ts`                    | Validates Claude token (falls back to `~/.fleet/oauth-token` if Keychain is empty) |

Every service uses `createLogger(name)` from `src/main/logger.ts` — no raw `console.*` in new main-process code.

---

## Cross-process communication

- **IPC handlers** live in `src/main/handlers/`. All handlers use `safeHandle()` for error logging; channels that accept user-controlled JSON pass an optional `parseArgs` validator so payloads are type-checked at runtime. The full handler catalogue is [`docs/modules/handlers/index.md`](modules/handlers/index.md).
- **Typed channel map** is split across domain modules in `src/shared/ipc-channels/` (agents, sprint, workbench, review, git, settings, etc.) and re-exported via an `ipc-channels.ts` compatibility shim. The preload bridge (`src/preload/index.ts`) exposes this surface as `window.api.*`.
- **Push events** (main → renderer, all via `webContents.send`):
  - `sprint:externalChange` — SQLite file watcher (500 ms debounce).
  - `pr:listUpdated` — PR poller (60 s).
  - `agent:event` — streamed SDK events (tool use, output, errors); batched via `agent-event-mapper.ts` and persisted to `agent_events`.
  - `agent:playground` — when an agent writes an HTML file in a playground-enabled task.
  - `terminal:data:{id}` / `terminal:exit:{id}` — PTY streams for terminal tabs.
  - Use `onBroadcast<T>()` in `preload/index.ts` when adding new event channels — don't roll your own subscription wiring.

---

## Agent runtime

Pipeline and adhoc agents are Claude Code sessions spawned via `@anthropic-ai/claude-agent-sdk`. The spawn path is `src/main/agent-manager/sdk-adapter.ts` (with a CLI fallback). Per-agent-type model selection lives in `src/main/agent-manager/backend-selector.ts` (`resolveAgentRuntime()`) and is configured via Settings → Models.

Prompt composition is centralised in `src/main/lib/prompt-composer.ts` — all spawn paths must call `buildAgentPrompt()` rather than assemble prompts inline. Per-agent builders and the universal preamble live alongside under `src/main/agent-manager/prompt-*.ts`. User-controlled content is wrapped in XML boundary tags (`<user_spec>`, `<upstream_spec>`, `<failure_notes>`, …) to prevent prompt injection — follow the same pattern when adding new interpolation sites.

Agent types and their behaviours (pipeline, adhoc, assistant, reviewer, copilot, synthesizer) are catalogued in [`docs/FLEET_FEATURES.md`](FLEET_FEATURES.md) and the agent-system architecture is in [`docs/agent-system-guide.md`](agent-system-guide.md).

---

## Renderer architecture

- **Panel system**: `src/renderer/src/stores/panelLayout.ts` holds a recursive `PanelNode` tree (leaf/split). Views render inside panels; drag-and-drop uses 5-zone docking. Tear-off windows have independent layouts (`persistable: false`).
- **View registry**: `src/renderer/src/lib/view-registry.ts` is the single source of truth for view metadata (label, icon, shortcut). `VIEW_LABELS`, `VIEW_ICONS`, `VIEW_SHORTCUTS`, and `VIEW_SHORTCUT_MAP` are derived re-exports — add new views in the registry, not in `panelLayout.ts` or `App.tsx`.
- **State**: Zustand, one store per domain concern. Sprint UI state is split across focused stores (`sprintUI`, `sprintSelection`, `sprintFilters`) rather than one god-store. Optimistic updates track fields (not just task IDs) with a 2 s TTL and full reload on failure.
- **Polling**: use `useBackoffInterval` in `src/renderer/src/hooks/` — jitter + exponential backoff on errors. All raw intervals live in `src/renderer/src/lib/constants.ts`; never scatter magic numbers.
- **Design tokens**: `src/renderer/src/assets/tokens.css` (unified v2 set) + neon layer (`neon.css`, `neon-shell.css`, `agents-neon.css`). No hardcoded hex; no duplicate tokens.

---

## External dependencies

| Dependency                           | Purpose                                 | Touch point                                                              |
| ------------------------------------ | --------------------------------------- | ------------------------------------------------------------------------ |
| `@anthropic-ai/claude-agent-sdk`     | Agent execution (Claude Code sessions)  | `agent-manager/sdk-adapter.ts`, `sdk-streaming.ts`                       |
| `better-sqlite3`                     | Local database                          | `db.ts`, `data/**`, `handlers/sprint-local.ts`                           |
| `node-pty`                           | Terminal PTY management                 | `handlers/terminal-handlers.ts`                                          |
| `electron`                           | Desktop app framework                   | Main/preload/renderer entry points                                       |
| `electron-vite`                      | Build pipeline                          | `electron.vite.config.ts`                                                |
| GitHub REST API (`fetch` + `gh` CLI) | PR polling, PR list, push + open-PR ops | `git.ts`, `pr-poller.ts`, `sprint-pr-poller.ts`, `git-handlers.ts`       |
| Anthropic API                        | Agent SDK backbone                      | Agent SDK internals (not called directly)                                |

See [`docs/network-requirements.md`](network-requirements.md) for the minimum egress hosts needed in restricted network environments.

---

## Historical reference

The previous long-form architecture doc (2026-03-19) has been superseded by the per-module references above. Historical snapshots of this doc live in git history — use `git log docs/architecture.md` if you need to recover an older version.
