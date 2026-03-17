# BDE Architecture

**Last updated:** 2026-03-16

---

## System Overview

BDE is an Electron desktop app with three process layers:

```
┌─────────────────────────────────────────────────────────────────────┐
│                          ELECTRON APP                               │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────┐     │
│  │  MAIN PROCESS (Node.js)                                   │     │
│  │                                                           │     │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐│     │
│  │  │ db.ts    │  │ git.ts   │  │ local-   │  │ handlers/││     │
│  │  │ SQLite   │  │ Git CLI  │  │ agents.ts│  │ 8 modules││     │
│  │  │ WAL mode │  │ ops      │  │ spawn +  │  │ IPC      ││     │
│  │  └──────────┘  └──────────┘  │ detect   │  └──────────┘│     │
│  │                               └──────────┘               │     │
│  │  fs.watch(bde.db) ──push──▶ 'sprint:external-change'    │     │
│  └────────────────────────────┬──────────────────────────────┘     │
│                               │ IPC (invoke/handle)                 │
│  ┌────────────────────────────┼──────────────────────────────┐     │
│  │  PRELOAD BRIDGE            │                               │     │
│  │  window.api.*              ▼   contextBridge               │     │
│  └────────────────────────────┬──────────────────────────────┘     │
│                               │                                     │
│  ┌────────────────────────────┼──────────────────────────────┐     │
│  │  RENDERER (React + Zustand)│                               │     │
│  │                            ▼                               │     │
│  │  ┌────────┐ ┌──────────┐ ┌──────────┐ ┌────────────────┐│     │
│  │  │ Views  │ │ Stores   │ │ gateway  │ │ design-system  ││     │
│  │  │ (6)    │ │ (Zustand)│ │ WebSocket│ │ tokens + CSS   ││     │
│  │  └────────┘ └──────────┘ └──────────┘ └────────────────┘│     │
│  └───────────────────────────────────────────────────────────┘     │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
        │                                           │
        │ WebSocket (port 18789)                    │ GitHub REST API
        ▼                                           ▼
   OpenClaw Gateway                          api.github.com
```

---

## Electron IPC Layer

### Handler Modules (Main Process)

All handlers use the `safeHandle()` wrapper (`src/main/ipc-utils.ts`) for centralized error logging.

| Module | File | Channels |
|--------|------|----------|
| Config | `handlers/config-handlers.ts` | `get-gateway-config`, `get-github-token`, `save-gateway-config`, `get-supabase-config` |
| Agent | `handlers/agent-handlers.ts` | `local:getAgentProcesses`, `local:spawnClaudeAgent`, `local:tailAgentLog`, `local:sendToAgent`, `local:isInteractive`, `agent:steer`, `agents:list`, `agents:readLog`, `agents:import` |
| Git | `handlers/git-handlers.ts` | `get-repo-paths`, `git:status`, `git:diff`, `git:stage`, `git:unstage`, `git:commit`, `git:push`, `git:branches`, `git:checkout`, `poll-pr-statuses` |
| Sprint | `handlers/sprint.ts` | `sprint:list`, `sprint:create`, `sprint:update`, `sprint:read-spec-file`, `sprint:readLog` |
| Gateway | `handlers/gateway-handlers.ts` | `gateway:invoke`, `gateway:getSessionHistory` |
| Terminal | `handlers/terminal-handlers.ts` | `terminal:create`, `terminal:resize`, `terminal:kill`, `terminal:write` (fire-and-forget) |
| Window | `handlers/window-handlers.ts` | `open-external`, `kill-local-agent`, `set-title` (fire-and-forget) |
| Filesystem | `fs.ts` | `list-memory-files`, `read-memory-file`, `write-memory-file`, `open-file-dialog`, `read-file-as-base64`, `read-file-as-text` |

### Preload Bridge

`src/preload/index.ts` exposes `window.api` via `contextBridge`. The typed IPC channel map at `src/shared/ipc-channels.ts` provides compile-time type safety for a subset of channels (expansion tracked as AX-S1).

### Push Events (Main → Renderer)

| Event | Trigger | Purpose |
|-------|---------|---------|
| `sprint:external-change` | `fs.watch()` on `~/.bde/bde.db` + WAL (500ms debounce) | Notify renderer of external DB writes |
| `terminal:data:{id}` | PTY stdout | Stream terminal output to renderer |
| `terminal:exit:{id}` | PTY process exit | Notify terminal tab of process end |

---

## SQLite Database

**Path:** `~/.bde/bde.db`
**Engine:** better-sqlite3 (synchronous, WAL mode)
**Module:** `src/main/db.ts`

### Schema

```sql
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE sprint_tasks (
  id           TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  title        TEXT NOT NULL,
  prompt       TEXT NOT NULL DEFAULT '',
  repo         TEXT NOT NULL DEFAULT 'bde',
  status       TEXT NOT NULL DEFAULT 'backlog'
                 CHECK(status IN ('backlog','queued','active','done','cancelled')),
  priority     INTEGER NOT NULL DEFAULT 1,
  spec         TEXT,
  notes        TEXT,
  pr_url       TEXT,
  pr_number    INTEGER,
  pr_status    TEXT,
  agent_run_id TEXT REFERENCES agent_runs(id),
  started_at   TEXT,
  completed_at TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE agent_runs (
  id           TEXT PRIMARY KEY,
  pid          INTEGER,
  bin          TEXT NOT NULL DEFAULT 'claude',
  task         TEXT,
  repo         TEXT,
  repo_path    TEXT,
  model        TEXT,
  status       TEXT NOT NULL DEFAULT 'running'
                 CHECK(status IN ('running','done','failed','unknown')),
  log_path     TEXT,
  started_at   TEXT NOT NULL,
  finished_at  TEXT,
  exit_code    INTEGER
);

CREATE TABLE settings (
  key          TEXT PRIMARY KEY,
  value        TEXT NOT NULL,
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
```

### Indexes

- `idx_sprint_tasks_status` on `sprint_tasks(status, priority, created_at)` — efficient column filtering
- `idx_agent_runs_pid` on `agent_runs(pid)` — process lookup
- `idx_agent_runs_status` on `agent_runs(status)` — status filtering

### Triggers

- `sprint_tasks_updated_at` — auto-updates `updated_at` on every `sprint_tasks` row change

---

## Agent Spawning Flow

```
User clicks "Launch" on a queued task
  │
  ├─ SprintCenter sets task status → 'active'
  │
  ├─ Calls window.api.spawnLocalAgent({ repoPath, task, model })
  │     │
  │     └─ IPC → main process → local-agents.ts:spawnClaudeAgent()
  │           │
  │           ├─ Creates agent_runs record in SQLite (status: 'running')
  │           │
  │           ├─ spawn('claude', [
  │           │    '--output-format', 'stream-json',
  │           │    '--input-format', 'stream-json',
  │           │    '--model', modelFlag,
  │           │    '--permission-mode', 'bypassPermissions'
  │           │  ], { cwd: repoPath, detached: true })
  │           │
  │           ├─ Writes initial task as user message via stdin
  │           │
  │           ├─ Streams stdout/stderr → appendAgentLog() → disk
  │           │
  │           └─ On exit:
  │                 ├─ exit 0 → agent_runs.status = 'done'
  │                 └─ exit N → agent_runs.status = 'failed'
  │
  └─ Renderer polls log via tailAgentLog(logPath, fromByte)
       └─ Incremental byte-offset reads (1s interval)
```

Agent logs stored at: `/tmp/bde-agents/{agentId}/output.log` (7-day auto-cleanup)

### Agent Steering

Running agents accept follow-up messages via stdin (stream-json protocol):
- `sendToAgent(pid, message)` — by PID (for process-list agents)
- `steerAgent(agentId, message)` — by UUID (for sprint LogDrawer)

### Agent Process Detection

`getAgentProcesses()` scans for known AI CLI binaries (`claude`, `codex`, `opencode`, `pi`, `aider`, `cursor`) via `ps -eo` and resolves CWDs via `lsof`. Polled every 5s from the renderer.

Stale agent reconciliation runs every 30s: if a `running` agent_run has no matching live PID, it's marked `unknown`.

---

## PR Status Polling (pollPrStatuses)

**Module:** `src/main/git.ts`
**Interval:** 60s (`POLL_PR_STATUS_MS`)
**Protocol:** GitHub REST API (`GET /repos/{owner}/{repo}/pulls/{number}`)
**Auth:** Bearer token from `~/.openclaw/openclaw.json`

### Flow

```
SprintCenter (renderer)
  │
  ├─ Every 60s: collect tasks with pr_url where not yet merged
  │
  ├─ IPC → poll-pr-statuses → git.ts:pollPrStatuses()
  │     │
  │     ├─ For each PR: fetch GitHub REST API
  │     │
  │     ├─ If merged → markTaskDoneOnMerge(prNumber)
  │     │     └─ UPDATE sprint_tasks SET status='done' WHERE pr_number=? AND status='active'
  │     │
  │     └─ If closed (not merged) → markTaskCancelled(prNumber)
  │           └─ UPDATE sprint_tasks SET status='cancelled' WHERE pr_number=? AND status='active'
  │
  └─ Returns results to renderer for UI update
```

---

## Task Lifecycle

```
backlog ──→ queued ──→ active ──→ done
                            └──→ cancelled
```

| State | Meaning | Entered By |
|-------|---------|------------|
| `backlog` | Draft idea, spec in progress | User creates ticket via New Ticket modal |
| `queued` | Ready for agent pickup | User drags to Sprint column or clicks "Push to Sprint" |
| `active` | Agent working on task | User clicks "Launch" (spawns Claude agent) |
| `done` | PR merged | `pollPrStatuses` detects merge via GitHub API |
| `cancelled` | PR closed without merge | `pollPrStatuses` detects close via GitHub API |

---

## SSE Client

BDE does not currently run an SSE server or client. Real-time sync between BDE and external processes uses:

1. **File watcher** — `fs.watch()` on `~/.bde/bde.db` and WAL file, debounced at 500ms, pushes `sprint:external-change` IPC event
2. **Adaptive polling** — sprint data refreshes every 5s (active tasks) or 30s (idle)

SSE was evaluated as a future optimization (see `docs/eval-realtime-sprint-architecture.md`) but the file watcher + polling combination is sufficient for current scale.

---

## Polling Intervals

All intervals defined in `src/renderer/src/lib/constants.ts`:

| Constant | Interval | Purpose |
|----------|----------|---------|
| `POLL_LOG_INTERVAL` | 1s | Agent log tailing |
| `POLL_PROCESSES_INTERVAL` | 5s | Agent process scan (ps + lsof) |
| `POLL_AGENTS_INTERVAL` | 10s | Agent history list refresh |
| `POLL_SESSIONS_INTERVAL` | 10s | Gateway session list |
| `POLL_GIT_STATUS_INTERVAL` | 30s | Git status in Diff view |
| `POLL_SPRINT_INTERVAL` | 30s | Sprint task list (idle) |
| `POLL_SPRINT_ACTIVE_MS` | 5s | Sprint task list (active tasks) |
| `POLL_PR_STATUS_MS` | 60s | PR merge/close status via GitHub REST |
| `POLL_PR_LIST_INTERVAL` | 60s | PR list from GitHub |
| `POLL_CHAT_STREAMING_MS` | 1s | Chat history (streaming) |
| `POLL_CHAT_IDLE_MS` | 5s | Chat history (idle) |

---

## External Dependencies

| Dependency | Purpose | Where Used |
|-----------|---------|------------|
| OpenClaw Gateway | AI agent sessions, tool invocation, RPC | WebSocket on port 18789 |
| GitHub REST API | PR status polling, PR list | `git.ts:fetchPrStatusRest()` |
| Claude CLI | Agent execution | `local-agents.ts:spawnClaudeAgent()` |
| better-sqlite3 | Local database | `db.ts`, `agent-history.ts`, `handlers/sprint.ts` |
| node-pty | Terminal PTY management | `handlers/terminal-handlers.ts` |

---

## Repository Map

| Repo | Owner | Local Path | Description |
|------|-------|-----------|-------------|
| BDE | RyanJBirkeland | `~/Documents/Repositories/BDE` | This app |
| life-os | RyanJBirkeland | `~/Documents/Repositories/life-os` | Personal automation |
| feast | RyanJBirkeland | `~/Documents/Repositories/feast` | Recipe app |

Paths are hardcoded in `src/main/git.ts:REPO_PATHS`.
