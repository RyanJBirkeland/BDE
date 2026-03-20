# BDE Architecture

**Last updated:** 2026-03-19

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
│  │  │ SQLite   │  │ Git CLI  │  │ agents.ts│  │ 10 mods  ││     │
│  │  │ WAL mode │  │ ops      │  │ spawn +  │  │ IPC      ││     │
│  │  └──────────┘  └──────────┘  │ detect   │  └──────────┘│     │
│  │                               └──────────┘               │     │
│  │  ┌──────────────┐                                        │     │
│  │  │ queue-api/   │  TaskQueueAPI (HTTP on port 18790)     │     │
│  │  │ server.ts    │  SSE broadcaster for task runners      │     │
│  │  └──────────────┘                                        │     │
│  │                                                           │     │
│  │  fs.watch(bde.db) ──push──▶ 'sprint:externalChange'     │     │
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
│  │  │ (7)    │ │ (Zustand)│ │ WebSocket│ │ tokens + CSS   ││     │
│  │  └────────┘ └──────────┘ └──────────┘ └────────────────┘│     │
│  └───────────────────────────────────────────────────────────┘     │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
        │                            │                      │
        │ WebSocket (port 18789)     │ HTTP (port 18790)    │ GitHub REST API
        ▼                            ▼                      ▼
   OpenClaw Gateway          TaskQueueAPI             api.github.com
   (optional)                (localhost)
```

---

## Electron IPC Layer

### Handler Modules (Main Process)

All handlers use the `safeHandle()` wrapper (`src/main/ipc-utils.ts`) for centralized error logging.

| Module | File | Channels |
|--------|------|----------|
| Config | `handlers/config-handlers.ts` | `config:getGatewayUrl`, `config:saveGateway`, `settings:get`, `settings:set`, `settings:getJson`, `settings:setJson`, `settings:delete` |
| Agent | `handlers/agent-handlers.ts` | `local:getAgentProcesses`, `local:spawnClaudeAgent`, `local:tailAgentLog`, `local:sendToAgent`, `local:isInteractive`, `agent:steer`, `agent:kill`, `config:getAgentConfig`, `config:saveAgentConfig`, `agents:list`, `agents:readLog`, `agents:import` |
| Git | `handlers/git-handlers.ts` | `github:fetch`, `git:getRepoPaths`, `git:status`, `git:diff`, `git:stage`, `git:unstage`, `git:commit`, `git:push`, `git:branches`, `git:checkout`, `pr:pollStatuses`, `pr:checkConflictFiles`, `pr:getList`, `pr:refreshList` |
| Sprint | `handlers/sprint-local.ts` | `sprint:list`, `sprint:create`, `sprint:update`, `sprint:delete`, `sprint:readSpecFile`, `sprint:generatePrompt`, `sprint:claimTask`, `sprint:healthCheck`, `sprint:readLog` |
| Gateway | `handlers/gateway-handlers.ts` | `gateway:invoke`, `gateway:getSessionHistory`, `gateway:test-connection`, `gateway:sign-challenge` |
| Terminal | `handlers/terminal-handlers.ts` | `terminal:create`, `terminal:resize`, `terminal:kill`, `terminal:write` (fire-and-forget) |
| Window | `handlers/window-handlers.ts` | `window:openExternal`, `agent:killLocal`, `window:setTitle` (fire-and-forget) |
| Cost | `handlers/cost-handlers.ts` | `cost:summary`, `cost:agentRuns`, `cost:getAgentHistory` |
| Queue | `handlers/queue-handlers.ts` | `queue:health`, `task:getEvents` |
| Filesystem | `fs.ts` | `memory:listFiles`, `memory:readFile`, `memory:writeFile`, `fs:openFileDialog`, `fs:readFileAsBase64`, `fs:readFileAsText`, `fs:openDirectoryDialog` |

### Preload Bridge

`src/preload/index.ts` exposes `window.api` via `contextBridge`. The typed IPC channel map at `src/shared/ipc-channels.ts` provides compile-time type safety for a subset of channels (expansion tracked as AX-S1).

### Push Events (Main → Renderer)

| Event | Trigger | Purpose |
|-------|---------|---------|
| `sprint:externalChange` | `fs.watch()` on `~/.bde/bde.db` + WAL (500ms debounce) | Notify renderer of external DB writes |
| `terminal:data:{id}` | PTY stdout | Stream terminal output to renderer |
| `terminal:exit:{id}` | PTY process exit | Notify terminal tab of process end |
| `task:output` | `POST /queue/tasks/:id/output` via TaskQueueAPI | Forward task runner output events to renderer |
| `pr:listUpdated` | PR poller (60s interval) | Push updated PR list to renderer |
| `sprint:sseEvent` | External SSE connection (`sprint-sse.ts`) | Relay external task runner SSE events to renderer |

---

## TaskQueueAPI

**Module:** `src/main/queue-api/`
**Port:** 18790 (default, configurable via `taskRunner.queuePort` setting)
**Bind:** `127.0.0.1` only (localhost)

The TaskQueueAPI is an HTTP server that allows external task runners to claim and execute sprint tasks. It starts automatically when BDE launches.

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/queue/health` | Health check with queue stats and API version |
| `GET` | `/queue/tasks` | List tasks (optional `?status=` filter) |
| `GET` | `/queue/tasks/:id` | Get a single task by ID |
| `POST` | `/queue/tasks/:id/claim` | Claim a queued task (body: `{ executorId }`) |
| `PATCH` | `/queue/tasks/:id/status` | Update task status and fields |
| `POST` | `/queue/tasks/:id/output` | Post output events for a task (body: `{ events }`) |
| `GET` | `/queue/events` | SSE stream of task mutations (`task:queued`, `task:updated`, `heartbeat`) |

### SSE Events

The `/queue/events` endpoint streams real-time task mutations to connected runners:

- `task:queued` — a task entered the `queued` status (fields: `id`, `title`, `priority`)
- `task:updated` — a task status changed (fields: `id`, `status`, `claimed_by`)
- `heartbeat` — keepalive every 30s

### Event Store

`queue-api/event-store.ts` provides in-memory storage for task output events (max 500 per task). Events are auto-cleared when tasks reach terminal status (`done`, `failed`, `cancelled`).

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
  id                TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  title             TEXT NOT NULL,
  prompt            TEXT NOT NULL DEFAULT '',
  repo              TEXT NOT NULL DEFAULT 'bde',
  status            TEXT NOT NULL DEFAULT 'backlog'
                      CHECK(status IN ('backlog','queued','active','done','cancelled','failed')),
  priority          INTEGER NOT NULL DEFAULT 1,
  spec              TEXT,
  notes             TEXT,
  pr_url            TEXT,
  pr_number         INTEGER,
  pr_status         TEXT CHECK(pr_status IS NULL OR pr_status IN ('open','merged','closed','draft')),
  pr_mergeable_state TEXT,
  agent_run_id      TEXT REFERENCES agent_runs(id),
  claimed_by        TEXT,
  template_name     TEXT,
  started_at        TEXT,
  completed_at      TEXT,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
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
  exit_code    INTEGER,
  cost_usd     REAL,
  tokens_in    INTEGER,
  tokens_out   INTEGER,
  cache_read   INTEGER,
  cache_create INTEGER,
  duration_ms  INTEGER,
  num_turns    INTEGER,
  source       TEXT NOT NULL DEFAULT 'bde'
);

CREATE TABLE cost_events (
  id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  source        TEXT NOT NULL,
  session_key   TEXT,
  model         TEXT NOT NULL,
  total_tokens  INTEGER NOT NULL DEFAULT 0,
  cost_usd      REAL,
  recorded_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE settings (
  key          TEXT PRIMARY KEY,
  value        TEXT NOT NULL,
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
```

### Indexes

- `idx_sprint_tasks_status` on `sprint_tasks(status)` — status filtering
- `idx_agent_runs_pid` on `agent_runs(pid)` — process lookup
- `idx_agent_runs_status` on `agent_runs(status)` — status filtering
- `idx_agent_runs_finished` on `agent_runs(finished_at, started_at DESC)` — history queries

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
**Auth:** Bearer token from settings (`github.token`)

### Flow

```
PR Station (renderer)
  │
  ├─ Every 60s: collect tasks with pr_url where not yet merged
  │
  ├─ IPC → pr:pollStatuses → git.ts:pollPrStatuses()
  │     │
  │     ├─ For each PR: fetch GitHub REST API
  │     │
  │     ├─ If merged → markTaskDoneByPrNumber(prNumber)
  │     │     └─ UPDATE sprint_tasks SET status='done' WHERE pr_number=? AND status='active'
  │     │
  │     └─ If closed (not merged) → markTaskCancelledByPrNumber(prNumber)
  │           └─ UPDATE sprint_tasks SET status='cancelled' WHERE pr_number=? AND status='active'
  │
  └─ Returns results to renderer for UI update
```

---

## Task Lifecycle

```
backlog ──→ queued ──→ active ──→ done
                           ├──→ cancelled
                           └──→ failed
```

| State | Meaning | Entered By |
|-------|---------|------------|
| `backlog` | Draft idea, spec in progress | User creates ticket via New Ticket modal |
| `queued` | Ready for agent pickup | User drags to Sprint column or clicks "Push to Sprint" |
| `active` | Agent working on task | User clicks "Launch" (spawns Claude agent) or task runner claims via API |
| `done` | PR merged | `pollPrStatuses` detects merge via GitHub API |
| `cancelled` | PR closed without merge | `pollPrStatuses` detects close via GitHub API |
| `failed` | Agent exited with error | Agent process exits non-zero or task runner reports failure |

---

## SSE

BDE uses SSE in two directions:

1. **SSE Server** — The TaskQueueAPI (`queue-api/sse.ts`) broadcasts task mutations to connected external task runners via `GET /queue/events`.
2. **SSE Client** — `sprint-sse.ts` connects to an external task runner's `/events` endpoint (if configured) and relays events to the renderer via `sprint:sseEvent` push events. Reconnects with exponential backoff (1s base, 30s max).
3. **File watcher** — `fs.watch()` on `~/.bde/bde.db` and WAL file, debounced at 500ms, pushes `sprint:externalChange` IPC event for external DB writes.
4. **Adaptive polling** — sprint data refreshes every 120s (idle) or 30s (active tasks).

---

## Polling Intervals

All intervals defined in `src/renderer/src/lib/constants.ts`:

| Constant | Interval | Purpose |
|----------|----------|---------|
| `POLL_LOG_INTERVAL` | 1s | Agent log tailing |
| `POLL_PROCESSES_INTERVAL` | 5s | Agent process scan (ps + lsof) |
| `POLL_AGENTS_INTERVAL` | 10s | Agent history list refresh |
| `POLL_SESSIONS_INTERVAL` | 10s | Gateway session list |
| `POLL_GIT_STATUS_INTERVAL` | 30s | Git status in PR Station |
| `POLL_SPRINT_INTERVAL` | 120s | Sprint task list (idle) |
| `POLL_SPRINT_ACTIVE_MS` | 30s | Sprint task list (active tasks) |
| `POLL_PR_STATUS_MS` | 60s | PR merge/close status via GitHub REST |
| `POLL_COST_INTERVAL` | 30s | Cost view data refresh |
| `POLL_HEALTH_CHECK_MS` | 600s | Sprint health check |
| `POLL_CHAT_STREAMING_MS` | 1s | Chat history (streaming) |
| `POLL_CHAT_IDLE_MS` | 5s | Chat history (idle) |

PR list polling runs at 60s from `src/main/pr-poller.ts` (main-process poller, not renderer-driven).

---

## External Dependencies

| Dependency | Purpose | Where Used |
|-----------|---------|------------|
| OpenClaw Gateway (optional) | AI agent sessions, tool invocation, RPC | WebSocket on port 18789 |
| TaskQueueAPI | Task queue for external runners | HTTP on port 18790 (localhost) |
| GitHub REST API | PR status polling, PR list | `git.ts`, `pr-poller.ts`, `git-handlers.ts` |
| Claude CLI | Agent execution | `local-agents.ts:spawnClaudeAgent()` |
| better-sqlite3 | Local database | `db.ts`, `agent-history.ts`, `handlers/sprint-local.ts` |
| node-pty | Terminal PTY management | `handlers/terminal-handlers.ts` |

---

## Repository Map

| Repo | Owner | Local Path | Description |
|------|-------|-----------|-------------|
| BDE | RyanJBirkeland | `~/Documents/Repositories/BDE` | This app |
| life-os | RyanJBirkeland | `~/Documents/Repositories/life-os` | Personal automation |
| feast | RyanJBirkeland | `~/Documents/Repositories/feast` | Recipe app |

Paths are hardcoded in `src/main/git.ts:REPO_PATHS`.
