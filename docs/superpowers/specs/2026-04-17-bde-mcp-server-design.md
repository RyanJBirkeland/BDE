# FLEET MCP Server — Design

**Date:** 2026-04-17
**Status:** Approved scope + architecture + auth posture; pending user spec review.
**Scope:** Expose FLEET's task and epic domain to local MCP-speaking agents (Claude Code, Claude Desktop, Cursor) as a Streamable-HTTP MCP server running inside the Electron main process.
**Non-goals:**
- Agent orchestration controls (claim/cancel/retry) — deferred.
- Review-station actions (merge, create-PR, discard) — deferred.
- Spec synthesis / copilot endpoints — deferred.
- Remote access, multi-user auth, cross-machine sync — out of scope forever.

## Problem

FLEET stores the authoritative model of the user's dev workflow — tasks, epics, dependencies, status transitions, audit trail — in `~/.fleet/fleet.db`. Today that model is only reachable from inside the Electron app. An agent running elsewhere on the same machine (e.g., a Claude Code session in another repo) has no way to add a task, change priorities, or check what's in flight. The user has to alt-tab into FLEET and click.

Writing to SQLite directly from outside FLEET is not an option. CLAUDE.md calls it out: direct writes bypass validation, dependency auto-blocking, the audit trail, and renderer broadcasts. Any external access must funnel through the same service layer the UI uses.

## Design

### 1. Architecture

A new module `src/main/mcp-server/` runs inside the Electron main process, started from `index.ts` alongside `createStatusServer`. It speaks the [MCP Streamable HTTP](https://modelcontextprotocol.io/specification/) transport at `http://127.0.0.1:<port>/mcp`, using the official `@modelcontextprotocol/sdk` TypeScript SDK.

```
src/main/mcp-server/
  index.ts              — createMcpServer(deps, config) → { start, stop }
  transport.ts          — HTTP request handler (POST for JSON-RPC, GET for SSE stream)
  auth.ts               — bearer-token middleware, constant-time compare
  token-store.ts        — read/generate ~/.fleet/mcp-token (mode 0600)
  tools/
    tasks.ts            — tasks.list / get / create / update / cancel / history
    epics.ts            — epics.list / get / create / update / delete
                          + epics.addTask / removeTask / setDependencies
    meta.ts             — repos.list, task-statuses.list, dependency-conditions.list
  schemas.ts            — zod schemas shared by tools
  errors.ts             — map service errors → JSON-RPC error codes
```

**Dependency rule (non-negotiable).** Tool handlers call existing services only — never SQLite. Specifically:

| Domain | Source of truth (must route through this) |
|---|---|
| Tasks | `src/main/services/sprint-service.ts` (`createTask`, `updateTask`, `getTask`, `listTasks`, `deleteTask`) |
| Task history | `src/main/data/task-changes.ts` (read-only) |
| Epics | `src/main/data/task-group-queries.ts` + `src/main/services/epic-dependency-service.ts` |
| Validation | `src/main/services/task-validation.ts`, `src/shared/task-transitions.ts` |
| Repos | `src/main/handlers/config-handlers.ts` reader (extracted to service — see §7) |

`sprint-service` already wraps mutations with `notifySprintMutation(...)`, which broadcasts to the renderer. That means MCP-driven creates/updates show up live in the Sprint Pipeline UI with zero extra wiring.

### 2. Tool surface

All tools return JSON content only; no binary payloads. Inputs validated by zod before reaching service code. Error codes per §5.

**Tasks (`tasks.*`)**

| Tool | Input (summary) | Output |
|---|---|---|
| `tasks.list` | `{ status?, repo?, epicId?, tag?, search?, limit?, offset? }` — all optional | `SprintTaskCore[]` (11 universal fields; clients fetch `get` for full body) |
| `tasks.get` | `{ id }` | `SprintTask` (full row) |
| `tasks.create` | `{ title, repo, status?, spec?, specType?, priority?, dependsOn?, epicId?, playgroundEnabled?, maxRuntimeMs? }` | `SprintTask` |
| `tasks.update` | `{ id, patch: Partial<SprintTask allowed fields> }` | `SprintTask` |
| `tasks.cancel` | `{ id, reason? }` | `SprintTask` (routes through `TaskTerminalService` so dependents resolve) |
| `tasks.history` | `{ id, limit?, offset? }` | `TaskChange[]` (from `task_changes` audit table) |

**Epics (`epics.*`)**

| Tool | Input (summary) | Output |
|---|---|---|
| `epics.list` | `{ status?, search? }` | `TaskGroup[]` |
| `epics.get` | `{ id, includeTasks? }` | `TaskGroup` (+ `tasks: SprintTaskCore[]` if requested) |
| `epics.create` | `{ name, description?, goal?, icon?, accentColor? }` | `TaskGroup` |
| `epics.update` | `{ id, patch }` | `TaskGroup` |
| `epics.delete` | `{ id }` | `{ deleted: true }` |
| `epics.addTask` | `{ epicId, taskId, position? }` | `TaskGroup` |
| `epics.removeTask` | `{ epicId, taskId }` | `TaskGroup` |
| `epics.setDependencies` | `{ id, dependencies: EpicDependency[] }` | `TaskGroup` (cycle-rejected by `epic-dependency-service`) |

**Meta (`meta.*`)** — read-only helpers so clients don't hard-code enums:

| Tool | Output |
|---|---|
| `meta.repos` | `RepoConfig[]` from settings |
| `meta.taskStatuses` | `{ statuses: TaskStatus[], transitions: Record<TaskStatus, TaskStatus[]> }` |
| `meta.dependencyConditions` | `{ task: ['hard','soft'], epic: ['on_success','always','manual'] }` |

**Write field allow-list on `tasks.update.patch` and `tasks.create`:** `title`, `status`, `repo`, `spec`, `spec_type`, `priority`, `tags`, `depends_on`, `playground_enabled`, `max_runtime_ms`, `group_id`. Fields set by the system (`claimed_by`, `pr_url`, `pr_number`, `pr_status`, `completed_at`, `agent_run_id`, etc.) are rejected. Enforced in `schemas.ts` — MCP never touches them.

### 3. Data flow

```
external agent
  │ HTTP POST /mcp { jsonrpc: "2.0", method: "tools/call", params: { name: "tasks.create", arguments: {...} } }
  ▼
transport.ts ── 401 if Authorization header missing / wrong token
  │
  ▼
MCP SDK server → tool handler (tools/tasks.ts)
  │ zod.parse(arguments)            — reject → -32602 Invalid params
  │ service.createTask(input)       — throws → map via errors.ts
  │   └─ sprint-service.createTask  — validates transition, writes SQLite,
  │                                   records task_changes audit row,
  │                                   notifies sprint-mutation-broadcaster
  │      └─ broadcaster → renderer  — Sprint Pipeline UI updates live
  ▼
{ content: [{ type: "text", text: JSON.stringify(sprintTask) }] }
```

Because every mutation goes through `sprint-service` / `task-group-queries`, the existing guarantees survive untouched:
- Status-transition validation (`isValidTransition`)
- Task-dependency auto-blocking on create (via `sprint-local.ts` path — see §7)
- Epic-dependency cycle detection (`epic-dependency-service`)
- Field-level audit trail in `task_changes`
- Renderer broadcast via `notifySprintMutation`
- `TaskTerminalService` dependent-resolution on cancel / completion

### 4. Auth & transport

**Auth:** Bearer token. On first server start, `token-store.ts` generates a 32-byte random token (`crypto.randomBytes(32).toString('hex')`) and writes it to `~/.fleet/mcp-token` with mode `0600`. Middleware in `auth.ts` compares the inbound `Authorization: Bearer <token>` header against the stored token using `crypto.timingSafeEqual`. Missing/malformed/mismatched → HTTP 401 with a JSON-RPC error body.

**Transport:** MCP Streamable HTTP (`POST /mcp` for client→server requests, `GET /mcp` with `Accept: text/event-stream` for server→client streaming). The SDK provides the handler; we wrap it in auth middleware and bind with Node's `http.createServer`.

**Binding:** `127.0.0.1` only. Port defaults to `18792` (one above `status-server`'s 18791); configurable via `mcp.port` setting. `EADDRINUSE` surfaces as a startup warning, same pattern as `status-server`.

**Regenerate token:** Settings UI button overwrites the file, restarts the server, invalidates any in-flight session.

### 5. Error handling

All service exceptions funnel through `errors.ts → toJsonRpcError(err)`. Mapping:

| Service error | JSON-RPC code | HTTP |
|---|---|---|
| Zod validation failure | `-32602` Invalid params | 200 (JSON-RPC body) |
| Not found (task/epic ID) | `-32001` | 200 |
| Invalid status transition | `-32002` | 200 |
| Dependency cycle | `-32003` | 200 |
| Field not writable via MCP | `-32004` | 200 |
| Any other thrown error | `-32603` Internal error | 200 (stack logged via `createLogger('mcp-server')`, not returned) |
| Missing/invalid bearer token | (none — 401 before JSON-RPC) | 401 |

Per MCP convention, JSON-RPC errors carry `code`, `message`, and an `data` envelope with the task/epic ID when relevant. No stack traces leak to the client; they go to `~/.fleet/fleet.log` only.

### 6. Settings & lifecycle

**New settings rows** (SQLite `settings` table, consumed via existing `getSettingJson` reader):

| Key | Type | Default |
|---|---|---|
| `mcp.enabled` | boolean | `false` (opt-in) |
| `mcp.port` | number | `18792` |

**Lifecycle in `src/main/index.ts`:** after `createStatusServer` starts, read `mcp.enabled`; if true, construct `createMcpServer({ sprintService, groupService, taskHistory, configService, logger }, { port })` and `start()`. On `will-quit`, stop the server (the SDK's `close()` flushes in-flight SSE streams).

**Hot-toggle** (`mcp.enabled` flipped in Settings without app restart): the `config:set` IPC handler already broadcasts `settings:updated` to the renderer. The main-process lifecycle code subscribes to the same event (via a local EventEmitter the handler writes to, added in this work) and starts/stops the server in response. If implementation cost turns out to be non-trivial, fallback is "requires app restart" — gated behind a single branch in the plan, not the design.

**Settings UI:** new card in **Settings → Connections** labeled "Local MCP Server":
- Enabled toggle
- Port field (number, with validation)
- Token display (masked by default, reveal + copy buttons)
- "Regenerate token" button (confirms, then overwrites)
- "Copy Claude Code config" button — copies a ready-to-paste MCP config snippet:
  ```json
  {
    "mcpServers": {
      "fleet": {
        "url": "http://127.0.0.1:18792/mcp",
        "headers": { "Authorization": "Bearer <token>" }
      }
    }
  }
  ```

### 7. Targeted refactors (Boy Scout, in-scope)

Doing this feature correctly surfaces two places where business logic lives in handlers instead of services. Fix them here because MCP tools need the same code path as IPC:

1. **Epic dependency index lives inside `group-handlers.ts`.** Extract `initEpicIndex`, `rebuildEpicIndex`, and the wrapping calls into an `EpicGroupService` (`src/main/services/epic-group-service.ts`) that exposes `createEpic / updateEpic / deleteEpic / addTask / removeTask / setDependencies` — each rebuilds the index internally. Handlers and MCP tools both delegate to it.
2. **Task creation auto-blocks on unsatisfied hard deps, but that logic lives in `sprint-local.ts` IPC handler.** Move it into `sprint-service.createTask` so every create path (IPC and MCP) auto-blocks identically. The handler keeps being a thin wrapper.

These are scoped to exactly what MCP needs — no drive-by refactor elsewhere.

### 8. Testing strategy

- **Unit (vitest, `src/main/mcp-server/**/*.test.ts`)** per tool module, mocking the service layer. Cover: happy path, validation rejection, not-found, forbidden-field rejection, error mapping.
- **Auth middleware unit tests:** missing header → 401, wrong token → 401 (assert `timingSafeEqual` path), correct token → pass-through.
- **Integration (`src/main/mcp-server/mcp-server.integration.test.ts`)** — start the server on port `0` (random), connect with the MCP SDK's own `Client`, run `tasks.create` → `tasks.list` → `tasks.update` → `tasks.history`, assert `task_changes` rows match the expected audit trail, assert `notifySprintMutation` was called. Same shape as existing main-process integration tests under `npm run test:main`.
- **Parity test:** create a task via the existing IPC path, create a second via MCP with identical input, assert both produce identical rows and identical audit trails.
- **Coverage:** meets existing thresholds in `vitest.config.ts`; no new threshold overrides.

### 9. Docs updates

- `docs/FLEET_FEATURES.md` — new section "Local MCP Server" under Development Tools, describing enable/disable, example agent config, and the exposed tool surface (link back to this spec for the full list).
- `docs/modules/services/index.md` — add row for `epic-group-service`, update row for `sprint-service` (new auto-block behavior).
- `docs/modules/index.md` (or wherever main-process modules are indexed) — add `mcp-server/` directory.
- CLAUDE.md — one-line pointer under "Key File Locations": `MCP server: src/main/mcp-server/ (opt-in via mcp.enabled setting)`.

### 10. Dependency policy

One new dependency: `@modelcontextprotocol/sdk` (TypeScript, MIT, no runtime deps of substance — relies on Node stdlib + `zod`, which FLEET already uses). No alternative in the existing dep set — this replaces building a Streamable-HTTP + JSON-RPC stack from scratch.

**Requires explicit user approval before adding** per the FLEET dependency policy — see User Review Gate below.

## Out of scope (explicitly)

- **Scope C operations** (agent claim/cancel/retry, review actions, spec synthesis) — revisit when there is a concrete external agent that needs them.
- **Per-tool allowlist in Settings** — YAGNI until someone actually wants to disable `tasks.delete` while keeping `tasks.create`.
- **MCP resources** (exposing tasks/epics as `@`-mentionable resources in MCP clients) — tools cover all current use cases. Revisit if agents need to reference specific tasks by URI.
- **Non-localhost binding, TLS, OAuth, multi-user** — local-only tool; wrong problem to solve.
- **Sampling / elicitation** — MCP server-to-client features not needed for CRUD.

## Rollout

1. Ship the code with `mcp.enabled = false` by default.
2. Settings UI exposes the toggle + token.
3. Docs in `FLEET_FEATURES.md` + example config snippet.
4. No migration needed — new settings rows default to `false`.

## Open questions

None at design time. Implementation plan will decompose the module-by-module build order.
