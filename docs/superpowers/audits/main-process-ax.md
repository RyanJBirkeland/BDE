# Main Process Architectural Audit

**Author:** AX (Architectural Engineer)
**Date:** 2026-03-27
**Scope:** Agent Manager, Queue API, Data Layer, Services, IPC Handlers, Core Modules

---

## 1. Executive Summary

The BDE main process is well-structured for its complexity. The repository pattern (`ISprintTaskRepository`) provides clean testability for the agent manager, the typed IPC channel map (`IpcChannelMap`) gives end-to-end compile-time safety, and the Queue API is properly decoupled as a standalone HTTP service. However, the repository abstraction is inconsistently applied -- the IPC handlers and Queue API bypass it entirely, importing `sprint-queries` directly. There is significant code duplication between the workbench handler's `runSdkStreaming` and the spec synthesizer's identical implementation. The dependency resolution system has a subtle architectural gap: the `TaskTerminalService` and the agent manager's internal `resolveDependents` codepath duplicate the same logic with separate `DependencyIndex` instances, and the `setOnStatusTerminal` injection pattern across four modules creates fragile wiring.

---

## 2. Critical Issues

### 2.1 Duplicate `runSdkStreaming` implementations

**Files:**

- `src/main/handlers/workbench.ts` lines 24-78
- `src/main/services/spec-synthesizer.ts` lines 243-297

These are identical 55-line functions with the same SDK query setup, timeout handling, active stream tracking, and message parsing. Both maintain separate `activeStreams` maps. A bug fix in one will not be applied to the other.

**Recommendation:** Extract to a shared `src/main/services/sdk-streaming.ts` module. Both consumers pass a prompt and receive chunks -- the abstraction is clean.

### 2.2 Repository pattern inconsistently applied

**The contract says:** Agent manager data access goes through `ISprintTaskRepository` (injected).

**What actually happens:**

- Agent manager (`src/main/agent-manager/`) -- uses `ISprintTaskRepository` (correct)
- IPC handlers (`src/main/handlers/sprint-local.ts`) -- imports from `sprint-queries` directly at lines 22-26 and from `sprint-service` at lines 28-41
- Queue API task handlers (`src/main/queue-api/task-handlers.ts`) -- imports from `sprint-queries` directly at lines 6-17
- Sprint service (`src/main/services/sprint-service.ts`) -- wraps `sprint-queries` but does not implement `ISprintTaskRepository`

This means:

1. Queue API writes bypass the notification layer (`notifySprintMutation`) for some operations
2. There are three different codepaths for updating tasks, each with slightly different side effects
3. Unit testing the Queue API requires mocking module-level imports rather than injecting a repository

**Recommendation:** Make `sprint-service.ts` the canonical write path. Queue API and IPC handlers should go through it. The repository interface should be extended to cover the service layer's notification-aware operations.

### 2.3 `onStatusTerminal` wiring is fragile and manual

**File:** `src/main/index.ts` lines 115-124

Four separate setter functions must be called in the correct order at startup:

```
setOnStatusTerminal(terminalService.onStatusTerminal)
setQueueApiOnStatusTerminal(terminalService.onStatusTerminal)
setGitHandlersOnStatusTerminal(terminalService.onStatusTerminal)
setOnTaskTerminal(terminalService.onStatusTerminal)
```

Each module stores the callback in a module-level `let _onStatusTerminal`. Adding a new module that transitions tasks to terminal status requires adding another setter -- which is easy to forget, creating a silent bug where dependency resolution never triggers.

Meanwhile, the agent manager has its OWN `onTaskTerminal` method (line 278 of `src/main/agent-manager/index.ts`) with a fallback to a local `resolveDependents` call if `config.onStatusTerminal` is not set. This is a second codepath for the same operation.

**Recommendation:** Replace the four setters with an event bus or a centralized service that is imported directly. The agent manager should not have its own fallback -- it should always use the injected terminal service.

---

## 3. Significant Issues

### 3.1 Agent manager has its own logging system parallel to `createLogger`

**Files:**

- `src/main/logger.ts` -- the shared logger used by all other modules
- `src/main/agent-manager/index.ts` lines 33-75 -- a separate file logger writing to `~/.bde/agent-manager.log`

The agent manager reimplements rotation logic (10MB, `.old` suffix), write counting (every 500 writes), and timestamp formatting. The only difference from the shared logger is the output file path.

**Recommendation:** Extend `createLogger` to accept a custom file path, or create a `createFileLogger(name, path)` variant. The duplicate rotation/append logic is a maintenance burden.

### 3.2 Queue API `task-handlers.ts` bypasses audit trail for notification

**File:** `src/main/queue-api/task-handlers.ts`

When the Queue API updates a task (lines 276, 374, 524), it calls `sprint-queries.updateTask()` directly. This records the audit trail (via `recordTaskChanges` inside `updateTask`), but does NOT call `notifySprintMutation`, so:

- SSE `task:updated` events are not broadcast for Queue API writes
- Renderer windows don't get `sprint:externalChange` pushes
- The only notification comes from the DB file watcher (500ms debounce), which is an unreliable heuristic

The `handleCreateTask` function (line 232) also calls `sprint-queries.createTask()` directly, bypassing the service layer's `notifySprintMutation('created', ...)` call.

**Recommendation:** Queue API handlers should call through `sprint-service.ts` instead of `sprint-queries` directly, so notifications are consistent.

### 3.3 `sprint-local.ts` exports create a re-export chain

**File:** `src/main/handlers/sprint-local.ts` lines 47-67

This handler file re-exports service functions, listener APIs, and spec helpers so that "existing deep imports keep working." This creates a 3-layer re-export chain:

```
sprint-queries.ts -> sprint-service.ts -> sprint-local.ts (handler)
```

Other modules import from `sprint-local.ts` (a handler) to get data access functions. For example, `git-handlers.ts` line 24 imports `markTaskDoneByPrNumber` from `./sprint-local`. A handler should not be a data access facade.

**Recommendation:** Modules that need data access should import from `sprint-service.ts` directly. The re-exports in `sprint-local.ts` should be removed once all imports are migrated.

### 3.4 `agent:killLocal` is a dead handler in the wrong module

**File:** `src/main/handlers/window-handlers.ts` lines 18-24

The `agent:killLocal` handler is registered in `window-handlers.ts` but returns a hardcoded error:

```typescript
return { ok: false, error: 'Local PID-based agent kill removed...' }
```

This handler belongs in `agent-handlers.ts` (or should be removed entirely since `local:sendToAgent` in `agent-handlers.ts` line 34 is similarly dead).

### 3.5 Batch update logic duplicated between IPC and Queue API

**Files:**

- `src/main/handlers/sprint-local.ts` lines 252-315 (`sprint:batchUpdate` handler)
- `src/main/queue-api/task-handlers.ts` lines 538-624 (`handleBatchTasks`)

Both implement the same loop-over-operations pattern with `GENERAL_PATCH_FIELDS` filtering. The IPC handler dynamically imports `GENERAL_PATCH_FIELDS` inside the handler body.

**Recommendation:** Extract batch update logic into `sprint-service.ts`.

### 3.6 `backupDatabase()` uses string interpolation in SQL

**File:** `src/main/db.ts` line 31

```typescript
db.exec(`VACUUM INTO '${backupPath}'`)
```

While `backupPath` is derived from a constant (`DB_PATH + '.backup'`), this is a SQL injection vector if the path ever contains a single quote. Use parameterized queries or escape the value.

### 3.7 `config:getAgentConfig` and `config:saveAgentConfig` are no-ops

**File:** `src/main/handlers/agent-handlers.ts` lines 97-103

Both return null / no-op. They still consume IPC channel slots and appear in the preload bridge (`src/preload/index.ts` lines 56-58). These are dead channels.

---

## 4. Minor Issues

### 4.1 Inconsistent `any` usage

- `src/main/services/spec-synthesizer.ts` lines 48, 67, 104 -- uses `err: any` instead of typed error handling
- `src/main/handlers/workbench.ts` line 318 -- `err: any`

### 4.2 `console.log`/`console.warn` leaks

Several modules use `console.*` directly instead of the structured logger:

- `src/main/db.ts` line 33: `console.error('[db] Backup failed:', err)`
- `src/main/agent-manager/worktree.ts` line 91, 252: `console.warn`
- `src/main/handlers/sprint-local.ts` line 204: `console.warn('[sprint:healthCheck]...')`
- `src/main/index.ts` line 108: `console.warn('[startup]...')`

### 4.3 Dashboard handler queries use `finished_at` as string and integer inconsistently

**File:** `src/main/handlers/dashboard-handlers.ts` line 14

`getCompletionsPerHour()` treats `finished_at` as a Unix epoch millisecond (`finished_at / 1000`), but the `agent_runs` schema (migration v1) defines `finished_at TEXT`. The `cost_queries.ts` queries treat it as an ISO string (`date('now', '-7 days')`). One of these interpretations is wrong.

### 4.4 `pruneStaleWorktrees` uses `console.warn` instead of logger

**File:** `src/main/agent-manager/worktree.ts` lines 252, 261

The function doesn't accept a logger parameter, falling back to `console.warn` in error paths.

### 4.5 `checkTaskDependencies` creates a temporary `DependencyIndex` on every call

**File:** `src/main/agent-manager/dependency-helpers.ts` lines 32-50

Each call to `checkTaskDependencies` creates a new `DependencyIndex()`, calls `listTasks()` to get all tasks, and builds a status map. This is called during task creation and queue-to-blocked transitions. The cost is O(n) per call, which is acceptable for now but could be memoized.

### 4.6 `handleRelease` body parse accepts `claimed_by` in snake_case but API convention is camelCase

**File:** `src/main/queue-api/task-handlers.ts` line 454

The release endpoint reads `claimed_by` from the body (snake_case), but the Queue API convention elsewhere is camelCase (`executorId` in claim, `dependsOn` in deps update). This is an inconsistency in the API surface.

### 4.7 Terminal `onData` uses per-ID dynamic channel names

**File:** `src/main/handlers/terminal-handlers.ts` lines 37, 44

Channels like `terminal:data:${id}` and `terminal:exit:${id}` are dynamically created and not in `IpcChannelMap`. They bypass the typed channel system entirely. Similarly, `terminal:write` (line 52) uses `ipcMain.on()` instead of `safeHandle()`.

### 4.8 `server.ts` JSDoc says "lightweight Supabase proxy" (stale)

**File:** `src/main/queue-api/server.ts` line 5

The comment says "lightweight Supabase proxy on port 18790" but the Queue API no longer proxies Supabase -- it's a local SQLite-backed task queue.

---

## 5. IPC Channel Inventory

86 typed channels across 18 domain interfaces, plus ~10 untyped push channels.

### Settings (5 channels) -- `SettingsChannels`

| Channel            | Handler Module     | Notes |
| ------------------ | ------------------ | ----- |
| `settings:get`     | config-handlers.ts |       |
| `settings:set`     | config-handlers.ts |       |
| `settings:getJson` | config-handlers.ts |       |
| `settings:setJson` | config-handlers.ts |       |
| `settings:delete`  | config-handlers.ts |       |

**Assessment:** Clean, minimal. No merge candidates.

### Git (9 channels) -- `GitChannels`

| Channel            | Handler Module  | Notes |
| ------------------ | --------------- | ----- |
| `git:status`       | git-handlers.ts |       |
| `git:diff`         | git-handlers.ts |       |
| `git:getRepoPaths` | git-handlers.ts |       |
| `git:stage`        | git-handlers.ts |       |
| `git:unstage`      | git-handlers.ts |       |
| `git:commit`       | git-handlers.ts |       |
| `git:push`         | git-handlers.ts |       |
| `git:branches`     | git-handlers.ts |       |
| `git:checkout`     | git-handlers.ts |       |

**Assessment:** One-to-one with git operations. Minimal.

### PR (4 channels) -- `PrChannels`

| Channel                 | Handler Module  | Notes                                    |
| ----------------------- | --------------- | ---------------------------------------- |
| `pr:pollStatuses`       | git-handlers.ts | Side-effects: marks tasks done/cancelled |
| `pr:checkConflictFiles` | git-handlers.ts |                                          |
| `pr:getList`            | git-handlers.ts |                                          |
| `pr:refreshList`        | git-handlers.ts |                                          |

**Assessment:** `pr:pollStatuses` does too much -- it polls AND updates task state AND triggers terminal resolution. Consider splitting the side effects.

### Agent Config (2 channels) -- `AgentConfigChannels`

| Channel                  | Handler Module    | Notes                    |
| ------------------------ | ----------------- | ------------------------ |
| `config:getAgentConfig`  | agent-handlers.ts | **DEAD** -- returns null |
| `config:saveAgentConfig` | agent-handlers.ts | **DEAD** -- no-op        |

**REMOVE CANDIDATE:** Both channels are dead code. Remove from `IpcChannelMap`, handlers, and preload.

### Agent Lifecycle (10 channels) -- `AgentChannels`

| Channel                   | Handler Module     | Notes                                |
| ------------------------- | ------------------ | ------------------------------------ |
| `local:spawnClaudeAgent`  | agent-handlers.ts  |                                      |
| `local:getAgentProcesses` | agent-handlers.ts  | Returns runner agents, not processes |
| `local:sendToAgent`       | agent-handlers.ts  | **DEAD** -- returns error            |
| `local:isInteractive`     | agent-handlers.ts  | **DEAD** -- returns false            |
| `local:tailAgentLog`      | agent-handlers.ts  |                                      |
| `agent:steer`             | agent-handlers.ts  |                                      |
| `agent:kill`              | agent-handlers.ts  |                                      |
| `agent:killLocal`         | window-handlers.ts | **DEAD** -- returns error; misplaced |
| `agents:list`             | agent-handlers.ts  |                                      |
| `agents:readLog`          | agent-handlers.ts  |                                      |
| `agents:import`           | agent-handlers.ts  |                                      |

**REMOVE CANDIDATES:** `local:sendToAgent`, `local:isInteractive`, `agent:killLocal` are all dead. `local:getAgentProcesses` is misleadingly named (returns runner agents, not OS processes).

### GitHub API (1 channel) -- `GitHubApiChannels`

| Channel        | Handler Module  | Notes                     |
| -------------- | --------------- | ------------------------- |
| `github:fetch` | git-handlers.ts | Proxy with auth injection |

**Assessment:** Clean. Single responsibility.

### Cost (3 channels) -- `CostChannels`

| Channel                | Handler Module   | Notes |
| ---------------------- | ---------------- | ----- |
| `cost:summary`         | cost-handlers.ts |       |
| `cost:agentRuns`       | cost-handlers.ts |       |
| `cost:getAgentHistory` | cost-handlers.ts |       |

**MERGE CANDIDATE:** `cost:agentRuns` and `cost:getAgentHistory` serve similar purposes (list agent runs with cost). Consider unifying with query parameters.

### Sprint Tasks (13 channels) -- `SprintChannels`

| Channel                       | Handler Module  | Notes |
| ----------------------------- | --------------- | ----- |
| `sprint:list`                 | sprint-local.ts |       |
| `sprint:create`               | sprint-local.ts |       |
| `sprint:update`               | sprint-local.ts |       |
| `sprint:delete`               | sprint-local.ts |       |
| `sprint:readSpecFile`         | sprint-local.ts |       |
| `sprint:generatePrompt`       | sprint-local.ts |       |
| `sprint:healthCheck`          | sprint-local.ts |       |
| `sprint:claimTask`            | sprint-local.ts |       |
| `sprint:readLog`              | sprint-local.ts |       |
| `sprint:validateDependencies` | sprint-local.ts |       |
| `sprint:unblockTask`          | sprint-local.ts |       |
| `sprint:getChanges`           | sprint-local.ts |       |
| `sprint:batchUpdate`          | sprint-local.ts |       |

**Assessment:** 13 channels in one handler module is dense. `sprint:readLog` could move to agent-handlers since it reads agent logs. `sprint:generatePrompt` and `sprint:readSpecFile` are spec-focused -- could be their own module. `sprint:healthCheck` has side effects (flags stuck tasks) -- misleading name for a "check."

### Window (1 channel) -- `WindowChannels`

| Channel               | Handler Module     | Notes |
| --------------------- | ------------------ | ----- |
| `window:openExternal` | window-handlers.ts |       |

**Assessment:** Clean.

### Memory (4 channels) -- `MemoryChannels`

| Channel            | Handler Module   | Notes |
| ------------------ | ---------------- | ----- |
| `memory:listFiles` | fs.ts            |       |
| `memory:readFile`  | fs.ts            |       |
| `memory:writeFile` | fs.ts            |       |
| `memory:search`    | memory-search.ts |       |

**Assessment:** Clean. `memory:search` could merge into the `fs.ts` handler module for coherence.

### File System / IDE (14 channels) -- `FsChannels`

| Channel                  | Handler Module     | Notes                        |
| ------------------------ | ------------------ | ---------------------------- |
| `fs:openFileDialog`      | fs.ts              |                              |
| `fs:readFileAsBase64`    | fs.ts              |                              |
| `fs:readFileAsText`      | fs.ts              |                              |
| `fs:openDirectoryDialog` | fs.ts              |                              |
| `fs:readDir`             | ide-fs-handlers.ts | Requires `fs:watchDir` first |
| `fs:readFile`            | ide-fs-handlers.ts | Requires `fs:watchDir` first |
| `fs:writeFile`           | ide-fs-handlers.ts | Requires `fs:watchDir` first |
| `fs:watchDir`            | ide-fs-handlers.ts |                              |
| `fs:unwatchDir`          | ide-fs-handlers.ts |                              |
| `fs:createFile`          | ide-fs-handlers.ts |                              |
| `fs:createDir`           | ide-fs-handlers.ts |                              |
| `fs:rename`              | ide-fs-handlers.ts |                              |
| `fs:delete`              | ide-fs-handlers.ts |                              |
| `fs:stat`                | ide-fs-handlers.ts |                              |

**Assessment:** The `fs:` namespace is shared between two handler modules (`fs.ts` and `ide-fs-handlers.ts`). This is confusing. The IDE fs handlers require path scoping via `watchDir` while the original `fs:` handlers do not. Consider renaming the IDE channels to `ide:readDir`, `ide:readFile`, etc. to avoid confusion.

### Agent Events (2 channels) -- `AgentEventChannels`

| Channel         | Handler Module           | Notes               |
| --------------- | ------------------------ | ------------------- |
| `agent:event`   | (push only, not handled) | Renderer subscribes |
| `agent:history` | agent-handlers.ts        |                     |

**Assessment:** Clean.

### Templates (4 channels) -- `TemplateChannels`

| Channel            | Handler Module       | Notes |
| ------------------ | -------------------- | ----- |
| `templates:list`   | template-handlers.ts |       |
| `templates:save`   | template-handlers.ts |       |
| `templates:delete` | template-handlers.ts |       |
| `templates:reset`  | template-handlers.ts |       |

**Assessment:** Clean.

### Auth (1 channel) -- `AuthChannels`

| Channel       | Handler Module   | Notes |
| ------------- | ---------------- | ----- |
| `auth:status` | auth-handlers.ts |       |

**Assessment:** Clean.

### Agent Manager (2 channels) -- `AgentManagerChannels`

| Channel                | Handler Module            | Notes |
| ---------------------- | ------------------------- | ----- |
| `agent-manager:status` | agent-manager-handlers.ts |       |
| `agent-manager:kill`   | agent-manager-handlers.ts |       |

**Assessment:** Clean.

### Terminal (3 channels) -- `TerminalChannels`

| Channel           | Handler Module       | Notes |
| ----------------- | -------------------- | ----- |
| `terminal:create` | terminal-handlers.ts |       |
| `terminal:resize` | terminal-handlers.ts |       |
| `terminal:kill`   | terminal-handlers.ts |       |

**Plus untyped:** `terminal:write` (ipcMain.on), `terminal:data:${id}` (push), `terminal:exit:${id}` (push)

**Assessment:** The dynamic channel names bypass the typed system. Consider using a single `terminal:data` channel with an `{id, data}` payload.

### Workbench (7 channels) -- `WorkbenchChannels`

| Channel                      | Handler Module | Notes         |
| ---------------------------- | -------------- | ------------- |
| `workbench:chat`             | workbench.ts   | Non-streaming |
| `workbench:generateSpec`     | workbench.ts   |               |
| `workbench:checkSpec`        | workbench.ts   |               |
| `workbench:checkOperational` | workbench.ts   |               |
| `workbench:researchRepo`     | workbench.ts   |               |
| `workbench:chatStream`       | workbench.ts   |               |
| `workbench:cancelStream`     | workbench.ts   |               |

**MERGE CANDIDATE:** `workbench:chat` (non-streaming) is now superseded by `workbench:chatStream`. Check if any caller still uses the sync version. If not, remove it.

### Playground (1 channel) -- `PlaygroundChannels`

| Channel           | Handler Module         | Notes |
| ----------------- | ---------------------- | ----- |
| `playground:show` | playground-handlers.ts |       |

**Assessment:** Clean.

### Dashboard (2 channels) -- `DashboardChannels`

| Channel                    | Handler Module        | Notes                                  |
| -------------------------- | --------------------- | -------------------------------------- |
| `agent:completionsPerHour` | dashboard-handlers.ts | Namespace conflict with agent channels |
| `agent:recentEvents`       | dashboard-handlers.ts | Namespace conflict with agent channels |

**Assessment:** These use the `agent:` prefix but are dashboard analytics, not agent lifecycle operations. Should be `dashboard:completionsPerHour` and `dashboard:recentEvents` for clarity.

### Synthesizer (3 channels) -- `SynthesizerChannels`

| Channel                | Handler Module          | Notes |
| ---------------------- | ----------------------- | ----- |
| `synthesizer:generate` | synthesizer-handlers.ts |       |
| `synthesizer:revise`   | synthesizer-handlers.ts |       |
| `synthesizer:cancel`   | synthesizer-handlers.ts |       |

**Assessment:** Clean.

### Untyped Push Channels (not in `IpcChannelMap`)

| Channel                   | Source                            | Notes   |
| ------------------------- | --------------------------------- | ------- |
| `fs:dirChanged`           | ide-fs-handlers.ts                |         |
| `github:rateLimitWarning` | github-fetch.ts                   |         |
| `github:tokenExpired`     | github-fetch.ts                   |         |
| `pr:listUpdated`          | pr-poller.ts                      |         |
| `sprint:externalChange`   | sprint-listeners.ts, bootstrap.ts |         |
| `workbench:chatChunk`     | workbench.ts                      |         |
| `synthesizer:chunk`       | synthesizer-handlers.ts           |         |
| `terminal:data:${id}`     | terminal-handlers.ts              | Dynamic |
| `terminal:exit:${id}`     | terminal-handlers.ts              | Dynamic |
| `window:setTitle`         | window-handlers.ts (ipcMain.on)   |         |

**Assessment:** 10 untyped push channels. These should be added to `IpcChannelMap` as push-only types (even if they don't follow the invoke/handle pattern) to maintain the "single source of truth" contract.

### Summary of removal/merge candidates

| Action            | Channels                                                                                                         | Savings           |
| ----------------- | ---------------------------------------------------------------------------------------------------------------- | ----------------- |
| **Remove (dead)** | `config:getAgentConfig`, `config:saveAgentConfig`, `local:sendToAgent`, `local:isInteractive`, `agent:killLocal` | 5 channels        |
| **Merge**         | `cost:agentRuns` into `cost:getAgentHistory`                                                                     | 1 channel         |
| **Merge**         | `workbench:chat` into `workbench:chatStream` (if unused)                                                         | 1 channel         |
| **Rename**        | `agent:completionsPerHour` -> `dashboard:*`, `agent:recentEvents` -> `dashboard:*`                               | 0 (namespace fix) |

Net reduction: 6-7 channels, bringing the total to ~79-80.
