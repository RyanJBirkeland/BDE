# Ad-Hoc Agent Spawning via SpawnModal

**Date:** 2026-03-23
**Goal:** Fix the SpawnModal to spawn ad-hoc agent sessions (like running `claude` in a terminal with a GUI), independent of the sprint task queue.

---

## Problem

When the Embedded Agent Manager was built, the `local:spawnClaudeAgent` IPC handler was replaced with a throw: `"Use the Sprint board to queue tasks."` But the SpawnModal's purpose is ad-hoc agent sessions — not sprint tasks. The renderer-side code (SpawnModal → localAgents store → preload bridge) is intact and correct; only the main-process handler needs real implementation.

## Design

### Concept

The Agents view serves two purposes:
1. **Monitor sprint agents** — view, steer, and check on agents the Agent Manager spawned from the queue
2. **Ad-hoc agent sessions** — spawn a one-off agent directly via SpawnModal, like running `claude` in a terminal but with a GUI

Ad-hoc agents are not sprint tasks. They run on the repo's working directory (not a worktree), use the model selected in the SpawnModal, and persist to `agent_runs` + `agent_events` so they're visible in the Agents list and survive app restarts.

### Architecture

```
SpawnModal → localAgents.spawnAgent() → window.api.spawnLocalAgent()
  → preload: typedInvoke('local:spawnClaudeAgent', args)
    → agent-handlers.ts: spawnClaudeAgent handler
      → sdk-adapter.ts: spawnAgent({ prompt, cwd, model })
        (returns AgentHandle from agent-manager/types.ts — messages: AsyncIterable<unknown>)
      → agent-history.ts: importAgent(meta, '') → agent_runs table
      → consume handle.messages in background:
        → map raw messages to AgentEvent types
        → broadcast('agent:event', { agentId, event }) → renderer
        → appendEvent(db, ...) → agent_events table
      → return { id, pid: null, logPath, interactive: true }
```

### Type changes

#### `src/shared/types.ts` — `AgentMeta.source`

Add `'adhoc'` to the source union:

```typescript
source: 'bde' | 'external' | 'adhoc'
```

### Changes

#### `src/main/handlers/agent-handlers.ts` — `local:spawnClaudeAgent` handler

Replace the throw (lines 32-36) with:

1. **Spawn the agent** via `spawnAgent()` from `src/main/agent-manager/sdk-adapter.ts`:
   - `prompt`: `args.task`
   - `cwd`: `args.repoPath` (the repo working directory — no worktree)
   - `model`: `args.model ?? 'claude-sonnet-4-5'`
   - Returns `AgentHandle` from `agent-manager/types.ts` (with `messages: AsyncIterable<unknown>`, `abort()`, `steer()`)

2. **Record the run** via `importAgent(meta, '')` from `agent-history.ts`:
   - `id`: new UUID
   - `pid`: null (SDK doesn't expose PID)
   - `task`: `args.task`
   - `repo`: derive from `repoPath` (basename or lookup)
   - `repoPath`: `args.repoPath`
   - `model`: selected model
   - `status`: `'running'`
   - `source`: `'adhoc'`
   - Second argument is `''` (empty string — no initial log content)

3. **Stream events** — consume `handle.messages` in the background (fire-and-forget async, do NOT await):
   - For each raw message, map to an `AgentEvent` (see mapping below)
   - Broadcast to renderer: `broadcast('agent:event', { agentId, event })`
   - Persist: `appendEvent(db, agentId, event.type, JSON.stringify(event), event.timestamp)`
   - Emit `agent:started` as first event before the message loop
   - Handle all event types in the `AgentEvent` union (see mapping below)

4. **Track completion** — when the message iterator ends:
   - Emit `agent:completed` with `exitCode`, `costUsd`, `tokensIn`, `tokensOut`, `durationMs`
   - Update `agent_runs`: set `status` to `'done'`, `finishedAt`, `exitCode`
   - Remove from adhoc agents map
   - On exception: emit `agent:error`, set status to `'error'`

5. **Return immediately** with `SpawnLocalAgentResult`:
   - `id`: the agent run ID
   - `pid`: 0 (type requires `number`; use 0 as sentinel since SDK doesn't expose PID)
   - `logPath`: path from `importAgent()` return value (`AgentMeta.logPath`)
   - `interactive`: true (ad-hoc sessions support steering)

6. **Track active adhoc agents** — keep a `Map<string, AgentHandle>` in module scope so the existing `agent:steer` handler can route steer messages to ad-hoc agents.

#### Message → AgentEvent mapping

The SDK adapter (`agent-manager/types.ts`) yields `AsyncIterable<unknown>`. Raw messages are objects with varying shapes from SDK/CLI. Map them to the full `AgentEvent` union:

```typescript
// Full AgentEvent union from shared/types.ts:
{ type: 'agent:started'; model: string; timestamp: number }
{ type: 'agent:text'; text: string; timestamp: number }
{ type: 'agent:user_message'; text: string; timestamp: number }
{ type: 'agent:thinking'; tokenCount: number; text?: string; timestamp: number }
{ type: 'agent:tool_call'; tool: string; summary: string; input?: unknown; timestamp: number }
{ type: 'agent:tool_result'; tool: string; success: boolean; summary: string; output?: unknown; timestamp: number }
{ type: 'agent:rate_limited'; retryDelayMs: number; attempt: number; timestamp: number }
{ type: 'agent:error'; message: string; timestamp: number }
{ type: 'agent:completed'; exitCode: number; costUsd: number; tokensIn: number; tokensOut: number; durationMs: number; timestamp: number }
```

Best-effort mapping from raw SDK/CLI messages:
- Messages with `type: 'assistant'` and text content → `agent:text`
- Messages with `type: 'tool_use'` or `tool_name` field → `agent:tool_call` (with `tool`, `summary`, `input`)
- Messages with `type: 'tool_result'` or `content` after tool_use → `agent:tool_result` (with `tool`, `success`, `summary`, `output`)
- Messages with rate-limit indicators → `agent:rate_limited`
- First message → also emit `agent:started` with model
- Iterator end → emit `agent:completed` with accumulated cost/token/duration stats (track via fields on the raw messages, default to 0 for unavailable values)
- Errors → `agent:error`
- Unrecognized messages → skip (log at debug level)

#### `agent:steer` handler update

The existing `agent:steer` handler (line 42) tries the Agent Manager first, then falls back to runner-client. Insert an adhoc check first: if `agentId` is in the adhoc agents map, call `handle.steer(message)` and return.

### No changes needed

- **SpawnModal.tsx** — already collects task, repo, model; calls `localAgents.spawnAgent()`
- **localAgents.ts store** — `spawnAgent()` already calls `window.api.spawnLocalAgent()` and handles the response
- **Preload bridge** — `spawnLocalAgent` already bridges to `local:spawnClaudeAgent`
- **IPC channel types** — `SpawnLocalAgentArgs` and `SpawnLocalAgentResult` already match
- **agentEvents store** — already listens for `agent:event` broadcasts and renders them
- **AgentsView / AgentDetail** — already renders agent events from the store
- **Agent Manager** — unaffected, continues handling sprint task queue independently

### Persistence

- `agent_runs` table: recorded on spawn via `importAgent()`, updated on completion
- `agent_events` table: each event persisted via `appendEvent()`, retrievable via `agent:history` IPC for viewing historical sessions
- `source: 'adhoc'` distinguishes from Agent Manager runs (`source: 'bde'`)

## Out of Scope

- Worktree creation for ad-hoc agents (agent can create its own if needed, like CLI)
- Changes to the sprint task flow
- Changes to the Agent Manager
- New IPC channels (reuses existing `local:spawnClaudeAgent`)
