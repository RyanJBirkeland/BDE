# BDE Self-Contained Packaging Design

**Date:** 2026-03-20
**Status:** Draft
**Scope:** Package BDE as a self-contained macOS desktop app with built-in agent orchestration

## Problem

BDE currently depends on an external `claude-task-runner` daemon to execute sprint tasks. This creates a multi-service setup that's impractical to share with other users. The goal is to make BDE a single installable app where users bring their own Claude Code subscription and get the full sprint planning + autonomous agent workflow.

## Decisions

| Decision      | Choice                            | Rationale                                                                                                                                                                                 |
| ------------- | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Auth model    | Claude Code Keychain OAuth (BYOK) | Users install Claude Code CLI, run `claude login`. BDE reads the token from macOS Keychain. Avoids per-token API billing — runs on the user's subscription.                               |
| Agent runtime | Agent SDK in-process              | Agents spawn directly from BDE's Electron main process via `SdkProvider`. No external daemon.                                                                                             |
| Task runner   | Replaced by AgentManager module   | The external task runner's complexity (queue polling, executor IDs, orphan recovery, SSE, HTTP API) exists because it's a remote service. An in-process manager is fundamentally simpler. |
| Platform      | macOS arm64 only                  | Simplifies native module builds, Keychain auth is consistent, matches target audience.                                                                                                    |
| Distribution  | Unsigned DMG                      | Friends & family right-click → Open to bypass Gatekeeper. No Apple Developer certificate needed.                                                                                          |
| Chat service  | Not included                      | `claude-chat-service` is personal Life OS infrastructure, not part of the BDE product.                                                                                                    |

## Architecture

```
┌─────────────────────────────────────────────────────┐
│  Electron Renderer                                  │
│  ┌─────────┐ ┌────────┐ ┌──────────┐ ┌──────────┐  │
│  │ Sprint  │ │ Agents │ │PR Station│ │ Settings │  │
│  └────┬────┘ └───┬────┘ └────┬─────┘ └────┬─────┘  │
│       └──────────┴───────────┴─────────────┘        │
│                      IPC                            │
├─────────────────────────────────────────────────────┤
│  Electron Main Process                              │
│                                                     │
│  ┌──────────────────────────────────────────────┐   │
│  │  AgentManager (NEW)                          │   │
│  │  - Task lifecycle: queued → active → done    │   │
│  │  - Concurrency pool (configurable slots)     │   │
│  │  - Watchdog timer per agent                  │   │
│  │  - Auto-drain: picks up queued tasks         │   │
│  └──────┬───────────────────────────────────────┘   │
│         │                                           │
│  ┌──────▼──────┐  ┌────────────┐  ┌──────────────┐  │
│  │ SdkProvider │  │ WorktreeOps│  │  GitOps      │  │
│  │ (existing)  │  │ (NEW)      │  │  (existing)  │  │
│  │ spawn agent │  │ create/rm  │  │  push/PR     │  │
│  └──────┬──────┘  └────────────┘  └──────────────┘  │
│         │                                           │
│  ┌──────▼──────┐  ┌────────────┐  ┌──────────────┐  │
│  │  EventBus   │  │ EventStore │  │  SQLite DB   │  │
│  │ (existing)  │  │ (existing) │  │  (existing)  │  │
│  └─────────────┘  └────────────┘  └──────────────┘  │
│                                                     │
│  ┌──────────────────────────────────────────────┐   │
│  │  AuthGuard (NEW)                             │   │
│  │  - Keychain token validation                 │   │
│  │  - First-run onboarding flow                 │   │
│  └──────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────┤
│  Claude Agent SDK ← Keychain OAuth token            │
└─────────────────────────────────────────────────────┘
```

## Component Design

### 1. AgentManager

**Location:** `src/main/agent-manager/`

**Files:**

- `agent-manager.ts` — drain loop, concurrency pool, spawn/completion orchestration
- `worktree-ops.ts` — create/remove git worktrees, file-based locking
- `completion-handler.ts` — branch push, PR creation, task status transitions
- `watchdog.ts` — per-agent timeout and idle detection

**Responsibilities:**

**Drain loop:** Watches `sprint_tasks` table for `status = 'queued'` tasks, ordered by priority. When a concurrency slot is available, picks the next task and starts the spawn pipeline.

**Spawn pipeline (per task):**

1. Set task status → `active`
2. Create git worktree from repo's default branch
3. Build agent prompt (task spec + template prefix + repo context)
4. Spawn via `SdkProvider` with `cwd` set to the worktree path
5. Pipe events through existing EventBus → SQLite + IPC to renderer
6. Start watchdog timer

**Completion handler (when agent stream ends):**

- Success: detect the _actual_ branch in worktree via `git rev-parse --abbrev-ref HEAD` (agents often create their own branch instead of using the worktree branch — check both), push to remote, open PR via `gh` CLI, update task with `pr_url`/`pr_number`/`pr_status`, set status → `done`
- Failure: increment `retry_count`, requeue if under max retries (3), otherwise set status → `error`
- Always: clean up worktree

**Concurrency pool:** Configurable max slots (default 3). Simple counter — decrement on spawn, increment on completion.

**Watchdog:** Two modes per agent:

- Max runtime: kill after 60 minutes (configurable)
- Idle detection: kill if no events received for 15 minutes

**Fast-fail detection:** Agent completing in under 30 seconds doesn't burn a retry. 3 consecutive fast-fails → `error` status.

**What is deliberately NOT ported from the task runner:**

| Task runner feature                              | Why it's not needed                                                                                                                                                                                                                                                                           |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Queue polling over HTTP                          | BDE owns the DB directly                                                                                                                                                                                                                                                                      |
| Executor IDs / claim semantics                   | Single process, no contention                                                                                                                                                                                                                                                                 |
| Orphan recovery                                  | Agents are tied to BDE's process lifecycle                                                                                                                                                                                                                                                    |
| Supabase sync                                    | Personal Life OS integration, not part of BDE                                                                                                                                                                                                                                                 |
| SSE event streaming                              | IPC to renderer replaces this                                                                                                                                                                                                                                                                 |
| HTTP API / bearer auth                           | No external consumers                                                                                                                                                                                                                                                                         |
| Rate-limit backpressure (dynamic slot reduction) | Accepted tradeoff: without pool-wide backpressure, multiple agents may stall simultaneously during API-wide rate limits. The watchdog kills individual stalled agents, but the drain loop will continue filling slots. For friends & family scale (1-3 concurrent agents) this is acceptable. |

**Estimated size:** ~400-600 LOC total.

### 2. WorktreeOps

**Location:** `src/main/agent-manager/worktree-ops.ts`

**Functions:**

- `createWorktree(repoPath, taskId, baseBranch?)` → `{ worktreePath, branch }` — Creates a new git worktree at `<worktreeBase>/<taskId>` branched from `baseBranch` (defaults to repo's default branch). Branch name: `agent/<task-slug>`.
- `removeWorktree(repoPath, worktreePath)` → `void` — Removes worktree and prunes.
- `acquireRepoLock(repoPath)` / `releaseRepoLock(repoPath)` — File-based lock to prevent concurrent worktree setup races on the same repo.

**Config:**

- `worktreeBase` setting (default: `/tmp/worktrees/bde`) — configurable in Settings view.

### 3. AuthGuard

**Location:** `src/main/auth-guard.ts`

**Token validation** (ported from task runner's `auth.ts`):

- Read from macOS Keychain: `security find-generic-password -s "Claude Code-credentials" -w`
- Parse JSON, extract `claudeAiOauth.accessToken`
- Check expiry against `claudeAiOauth.expiresAt` — **note:** this value is a stringified epoch millisecond, not an ISO date. Must parse with `parseInt(oauth.expiresAt, 10)` then compare `new Date(parsed)` against `Date.now()`
- Clear `ANTHROPIC_API_KEY` from process env to force subscription billing

**Functions:**

- `checkAuthStatus()` → `{ cliFound: boolean; tokenFound: boolean; tokenExpired: boolean; expiresAt?: Date }` — Run all checks, return status object. Exposed via IPC.
- `ensureSubscriptionAuth()` → `void` — Called before every agent spawn. Throws if token missing/expired with user-facing error message.

**First-run onboarding flow (renderer component):**

Three checks displayed in sequence:

1. Claude Code CLI exists — looks for `claude` binary in PATH + `/usr/local/bin`, `/opt/homebrew/bin`, `~/.local/bin`
2. Keychain token exists — `security find-generic-password` succeeds
3. Token not expired — parsed expiry is in the future

If any check fails, shows instructions and a "Check Again" button.

**Runtime behavior:**

- Runs on app startup, exposes status via IPC
- If token expires mid-session, next agent spawn fails with notification: "Claude session expired — run `claude login` in your terminal"
- Settings view shows current auth status
- No persistent storage of tokens — always reads from Keychain at spawn time

### 4. Packaging

**Build target:** macOS arm64 DMG (already configured in `electron-builder.yml`).

**Native modules:** `better-sqlite3` and `node-pty` require native compilation. The existing `postinstall` script handles rebuilding for Electron. electron-builder bundles the correct native binaries.

**Agent SDK runtime:** `@anthropic-ai/claude-agent-sdk` spawns a subprocess using the Claude Code runtime. It expects the `claude` CLI binary to be available on the system. BDE must set `PATH` correctly when spawning (same `ELECTRON_PATH` pattern from the existing `CliProvider`).

**Code signing:** `identity: null`, `hardenedRuntime: false`. Users right-click → Open to bypass Gatekeeper. Acceptable for friends & family.

**DMG contents:**

- BDE.app
- Drag-to-Applications shortcut (already configured)

**User prerequisites:**

- Claude Code CLI installed (provides `claude` binary + Agent SDK runtime)
- `claude login` completed (stores OAuth token in Keychain)
- `git` installed
- `gh` CLI installed (for PR creation)

## Changes to Existing Codebase

### Removed

| Path                                                                                      | Reason                                                                                                    |
| ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `src/main/queue-api/` (all files: server, router, event-store, sse)                       | No external task runner to serve                                                                          |
| `src/main/handlers/queue-handlers.ts`                                                     | Imports from queue-api — must be deleted alongside it                                                     |
| `src/main/sprint-sse.ts`                                                                  | Connects to external task runner's `/events` SSE endpoint — no remote stream to consume                   |
| `src/main/agents/cli-provider.ts`                                                         | SDK-only going forward                                                                                    |
| `src/main/handlers/gateway-handlers.ts`                                                   | OpenClaw gateway IPC handlers — BDE is standalone                                                         |
| `getTaskRunnerConfig()` in `src/main/config.ts`                                           | No remote runner                                                                                          |
| `getGatewayConfig()` in `src/main/config.ts`                                              | No OpenClaw gateway                                                                                       |
| `buildConnectSrc()` in `src/main/index.ts`                                                | References `getGatewayConfig()` for CSP — must be rewritten or removed                                    |
| `steerViaTaskRunner()` in `src/main/local-agents.ts`                                      | HTTP fallback to external task runner — must be removed (steer goes through AgentManager handles instead) |
| Task runner URL / API key settings UI                                                     | No remote runner                                                                                          |
| Gateway WebSocket RPC code in renderer (`src/renderer/src/lib/gateway.ts`, gateway store) | BDE is standalone                                                                                         |

### Modified

| Path                       | Change                                                                                                                                                                     |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/main/agents/index.ts` | Remove provider factory, export `SdkProvider` directly                                                                                                                     |
| `src/main/local-agents.ts` | Refactor to delegate orchestration to AgentManager                                                                                                                         |
| `src/main/settings.ts`     | Add: auth status, max concurrent agents, worktree base path. Remove: agent provider toggle                                                                                 |
| `src/main/index.ts`        | Register AgentManager IPC handlers, remove queue API startup, remove sprint-sse startup, remove gateway handler registration, remove/rewrite `buildConnectSrc()` CSP logic |
| Sprint view (renderer)     | "Run" button triggers AgentManager directly                                                                                                                                |
| Settings view (renderer)   | Add onboarding status section, remove task runner config                                                                                                                   |

### Added

| Path                                           | Purpose                                    |
| ---------------------------------------------- | ------------------------------------------ |
| `src/main/agent-manager/agent-manager.ts`      | Core orchestration module                  |
| `src/main/agent-manager/worktree-ops.ts`       | Git worktree management                    |
| `src/main/agent-manager/completion-handler.ts` | Post-agent branch push, PR, status updates |
| `src/main/agent-manager/watchdog.ts`           | Timeout and idle detection                 |
| `src/main/auth-guard.ts`                       | Keychain token validation                  |
| `src/renderer/src/components/Onboarding.tsx`   | First-run setup screen                     |

### Unchanged

- SQLite DB schema, EventBus, EventStore
- `SdkProvider` (`src/main/agents/sdk-provider.ts`)
- Git operations (`src/main/git.ts`)
- `src/main/sprint-pr-poller.ts` — remains as-is. It polls PR statuses for tasks with `pr_status='open'` and auto-marks tasks done/cancelled on merge/close. This is complementary to the AgentManager's completion handler (which sets the initial PR status) and continues to run on its existing 60s interval.
- Agents view, PR Station view, Terminal view, Memory view, Cost view
- All existing tests for unchanged modules

## Testing Strategy

- Unit tests for AgentManager (mock SdkProvider, mock DB)
- Unit tests for WorktreeOps (mock `execFile` calls)
- Unit tests for CompletionHandler (mock git/gh operations)
- Unit tests for AuthGuard (mock Keychain access)
- Integration: manual test of full flow (queue task → agent runs in worktree → PR opened)
- Existing test suite must continue passing

## Out of Scope

- Auto-updater (requires code signing + update server)
- Homebrew cask distribution
- Windows/Linux builds
- Apple notarization
- Supabase sync
- Chat service integration
- API key authentication mode
- Token auto-refresh
