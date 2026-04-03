# Phase 2: Agent Workflow Hub — Design Spec

**Date:** 2026-03-20
**Status:** Approved
**Approach:** Vertical slices (4 slices, sequentially dependent — each builds on the previous)

## Context

Phase 1 (Modular Monolith) is complete. BDE owns its config, data, and agent lifecycle locally. Phase 2 transforms BDE into an **Agent Workflow Hub** — the place where you monitor, steer, and review all agent work across local and remote runners.

### Key Decisions

- **Agent SDK migration:** Local agents move from CLI process spawning to the Claude Agent SDK. The external task-runner (`bde-task-runner`) is already on the SDK.
- **Unified event model:** Both local and remote agents produce the same `AgentEvent` stream. One renderer, one persistence layer, one data model.
- **Sessions → Agents:** The Sessions view evolves into a unified Agents dashboard. Gateway agents are being phased out; this view becomes the home for all agent visibility.
- **Hybrid chat renderer:** Agent output rendered as a conversation thread with collapsible detail (thinking, tool calls). Full back-and-forth — both user steering messages and agent responses.

### What Exists Today

| Feature                    | Status  | Notes                                                                                                                                |
| -------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Local agent spawning (CLI) | Working | `spawnClaudeAgent()` in `local-agents.ts`, stdout → log file                                                                         |
| Log file polling           | Working | 1s interval, byte-offset tracking in `src/renderer/src/stores/localAgents.ts` and `agentHistory.ts`                                  |
| Agent steering (local)     | Working | stdin-based via `sendToAgent(pid, message)`                                                                                          |
| Agent steering (remote)    | Working | HTTP POST to task-runner `/agents/:id/steer`                                                                                         |
| Task Queue API             | Working | HTTP + SSE on port 18790, full CRUD                                                                                                  |
| Task output events         | Working | `POST /queue/tasks/:id/output`, in-memory store (max 500)                                                                            |
| Sprint SSE client          | Working | Connects to task-runner `/events`, relays to renderer                                                                                |
| Unified agent store        | Working | `unifiedAgents.ts` merges sessions + local + history                                                                                 |
| Agent templates            | Working | 4 built-in (`bugfix`, `feature`, `refactor`, `test`), auto-detection heuristics, settings JSON only                                  |
| Sessions view              | Working | Already shows unified agents (local + sessions + history), search/filter, split modes, SpawnModal — will be evolved into Agents view |

---

## Slice 1: SDK Integration Layer

### Goal

Abstract agent spawning behind an interface so both CLI and SDK adapters coexist, then implement the SDK adapter.

### New Files

```
src/main/agents/
├── types.ts              # AgentProvider interface + AgentEvent union type
├── sdk-provider.ts       # Agent SDK implementation
├── cli-provider.ts       # Extracts current spawnClaudeAgent logic
└── index.ts              # Factory: picks provider based on config
```

### AgentProvider Interface

```typescript
interface AgentProvider {
  spawn(opts: AgentSpawnOptions): Promise<AgentHandle>
}

interface AgentSpawnOptions {
  prompt: string
  workingDirectory: string
  model?: string
  maxTokens?: number
  templatePrefix?: string
  agentId?: string
}

interface AgentHandle {
  id: string
  logPath?: string // CLI provider sets this for backup log persistence
  events: AsyncIterable<AgentEvent> // unified event stream — consumers derive status from events
  steer(message: string): Promise<void>
  stop(): Promise<void>
}
```

### AgentEvent Union Type

```typescript
type AgentEvent =
  | { type: 'agent:started'; model: string; timestamp: number }
  | { type: 'agent:text'; text: string; timestamp: number }
  | { type: 'agent:user_message'; text: string; timestamp: number }
  | { type: 'agent:thinking'; tokenCount: number; text?: string; timestamp: number }
  | { type: 'agent:tool_call'; tool: string; summary: string; input?: unknown; timestamp: number }
  | {
      type: 'agent:tool_result'
      tool: string
      success: boolean
      summary: string
      output?: unknown
      timestamp: number
    }
  | { type: 'agent:rate_limited'; retryDelayMs: number; attempt: number; timestamp: number }
  | { type: 'agent:error'; message: string; timestamp: number }
  | {
      type: 'agent:completed'
      exitCode: number
      costUsd: number
      tokensIn: number
      tokensOut: number
      durationMs: number
      timestamp: number
    }
```

Extends the existing `TaskOutputEvent` types in `queue-api-contract.ts` with `agent:text` and `agent:user_message` for full conversation capture.

**Timestamp normalization:** Existing `TaskOutputEvent` uses `timestamp: string` (ISO 8601). `AgentEvent` uses `timestamp: number` (Unix ms). When ingesting remote `TaskOutputEvent`s from the task-runner, the event bus converts ISO 8601 strings to Unix ms integers via `new Date(ts).getTime()`. All internal storage and rendering uses the numeric format.

### Adapters

**`sdk-provider.ts`:**

- Uses `claude_agent_sdk` to spawn agents
- Maps SDK callbacks/events to `AgentEvent` async iterable
- `steer()` sends user message through SDK conversation API
- `stop()` cancels the SDK agent run

**`cli-provider.ts`:**

- Extracts current `spawnClaudeAgent()` logic from `local-agents.ts`
- Parses stdout JSON stream into `AgentEvent`s
- `steer()` writes to stdin
- `stop()` kills the child process
- Fallback adapter — used if SDK is unavailable or for legacy compatibility

**`index.ts` factory:**

- Reads `agent.provider` from settings (`'sdk' | 'cli'`, default `'sdk'`)
- Returns the appropriate provider
- `local-agents.ts` delegates to this factory instead of spawning directly

### Migration Path

- `local-agents.ts` becomes a thin orchestrator that delegates to the provider
- Public API of `local-agents.ts` does not change in this slice
- The event stream is new but nothing consumes it until Slice 2
- Setting: `agent.provider: 'sdk' | 'cli'` — defaults to `sdk`, fallback to `cli`

### Tests

- Unit tests for both providers against the `AgentProvider` interface
- Integration test: spawn agent via SDK, verify event stream produces expected types
- CLI provider tests: extract from existing `local-agents.test.ts`

---

## Slice 2: Event Streaming Infrastructure

### Goal

Get `AgentEvent`s from main process to renderer in real-time. Unify local + remote events into one stream. Persist events for history replay.

### New IPC Channels

```
agent:event     — single AgentEvent pushed as it happens (main → renderer)
agent:history   — request full event history for an agent (renderer → main, returns AgentEvent[])
```

Added to `src/shared/ipc-channels.ts`.

### Event Bus

```
src/main/agents/
├── event-bus.ts          # Central EventEmitter for AgentEvents
└── event-store.ts        # SQLite persistence for events
```

**`event-bus.ts`:**

- Single funnel for all agent events from both sources
- Local agents (SDK/CLI provider) emit events into it
- Task-runner output events (`POST /queue/tasks/:id/output`) emit into it
- Bus broadcasts each event via `agent:event` IPC to all renderer windows
- Bus writes each event to `event-store` for persistence

**`event-store.ts` — SQLite persistence:**

```sql
CREATE TABLE agent_events (
  id INTEGER PRIMARY KEY,
  agent_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload TEXT NOT NULL,
  timestamp INTEGER NOT NULL
);
CREATE INDEX idx_agent_events_agent ON agent_events(agent_id, timestamp);
```

- Replaces the in-memory event-store in `queue-api/event-store.ts`
- Full conversation replay from history
- Survives app restart
- Pruning: events older than 30 days deleted on app startup
- `getHistory(agentId)` returns `AgentEvent[]` ordered by timestamp

### Renderer Store

```
src/renderer/src/stores/agentEvents.ts
```

New Zustand store:

- Subscribes to `agent:event` IPC on mount
- Buffers events per agent in memory (for the active view)
- `getHistory(agentId)` fetches from main process via `agent:history` IPC for past runs
- Replaces `taskEvents` / `latestEvents` fields in sprint store

### Compatibility Shim

Slice 2 is not independently shippable — `LogDrawer.tsx` and the sprint store still depend on `taskEvents`/`latestEvents` until Slice 3 replaces them. During the Slice 2 → 3 transition:

- The new `agentEvents` store subscribes to `agent:event` IPC (the new path)
- The sprint store's `taskEvents`/`latestEvents` fields are kept alive but populated from the event bus (adapter that writes to both the new store and the legacy fields)
- `LogDrawer.tsx` continues to work against `taskEvents` until Slice 3 replaces it
- The shim is removed when Slice 3 lands

### What Dies

**Log tailing infrastructure (all three IPC channels):**

- `local:tailAgentLog` IPC handler — local agent log file tailing
- `agents:readLog` IPC handler — unified agent log reading
- `sprint:readLog` IPC handler — sprint task log reading
- Log polling logic in `src/renderer/src/stores/localAgents.ts` and `agentHistory.ts`

**Task-runner SSE log events:**

- `log:chunk` SSE event subscription in `LogDrawer.tsx` and `taskRunnerSSE.ts` — replaced by `agent:event` IPC
- `log:done` SSE event subscription — replaced by `agent:completed` event through event bus

**Event storage:**

- In-memory event-store in `queue-api/event-store.ts` — replaced by SQLite store
- `initEventStoreCleanup()` mutation hook — replaced by time-based pruning (see note below)

**Constants:**

- `POLL_LOG_INTERVAL` constant

**Behavioral change — event cleanup:** The in-memory store auto-clears events when a task reaches terminal status via `onSprintMutation` hook. The SQLite store intentionally does NOT do this — events are retained for full history replay and pruned on a time basis (30 days, configurable via `agent.eventRetentionDays`). This is a deliberate change: history is a feature.

### What Stays

- Log files on disk (`/tmp/bde-agents/`) — still written by CLI provider as backup
- `sprint-sse.ts` — still receives task-runner SSE events, but routes them through the event bus instead of directly to renderer
- `task:getEvents` IPC channel — temporarily kept for compatibility, removed in Slice 3

### Data Flow

```
LOCAL AGENT (SDK/CLI)          MAIN PROCESS                RENDERER
──────────────────────────────────────────────────────────────────────
AgentHandle.events ──────→ event-bus.ts ──────→ IPC: agent:event
                               │                      ↓
                               ↓               agentEvents store
                          event-store.ts        (live buffer)
                          (SQLite persist)
                               ↑
TASK RUNNER ──────────→ POST /queue/tasks/:id/output
                          (parsed → AgentEvents → event bus)
```

### Tests

- Event bus: verify events from both sources broadcast correctly
- Event store: write/read/prune lifecycle
- IPC integration: event reaches renderer store

---

## Slice 3: Agents View + Hybrid Chat Renderer

### Goal

Evolve Sessions view into unified Agents dashboard with hybrid chat renderer showing full conversations.

### New Files

```
src/renderer/src/views/AgentsView.tsx
src/renderer/src/components/agents/
├── AgentList.tsx
├── AgentCard.tsx
├── AgentDetail.tsx
├── ChatRenderer.tsx
├── ChatBubble.tsx
├── ToolCallBlock.tsx
├── ThinkingBlock.tsx
└── SteerInput.tsx
```

### AgentsView Layout

Two-panel layout (using `react-resizable-panels`):

- **Left panel:** `AgentList` — all agents grouped by status
- **Right panel:** `AgentDetail` — selected agent's full view

### AgentList (Left Panel)

Three groups, always visible:

- **Running** — active agents with live pulse indicator, token counter ticking up
- **Recent** — completed in last 24h, sorted by recency
- **History** — older runs, lazy-loaded on scroll

Each `AgentCard` displays:

- Agent name / task title
- Status badge (running, done, failed, cancelled)
- Duration (live-updating for running agents)
- Running cost
- Source icon (local vs task-runner)

Clicking a card selects it and loads the agent into `AgentDetail`.

### AgentDetail (Right Panel)

- **Header:** agent name, status, start time, model, cost summary
- **Body:** `ChatRenderer` consuming `AgentEvent[]` from `agentEvents` store
- **Footer:** `SteerInput` (visible only when agent is running — derived from event stream: present after `agent:started`, hidden after `agent:completed`/`agent:error`)

### ChatRenderer — Hybrid Rendering

Each `AgentEvent` maps to a component:

| Event Type           | Component                             | Behavior                                                                |
| -------------------- | ------------------------------------- | ----------------------------------------------------------------------- |
| `agent:text`         | `ChatBubble`                          | Markdown rendered, left-aligned                                         |
| `agent:user_message` | `ChatBubble`                          | Right-aligned, distinct style (user steering)                           |
| `agent:thinking`     | `ThinkingBlock`                       | Collapsed by default, shows token count. Expands to full reasoning text |
| `agent:tool_call`    | `ToolCallBlock`                       | Tool name + summary line, collapsed. Expands to show input args         |
| `agent:tool_result`  | Merged into preceding `ToolCallBlock` | Shows success/fail badge + summary. Expands to show full output         |
| `agent:error`        | Red-bordered `ChatBubble`             | Error message                                                           |
| `agent:rate_limited` | Yellow info bar                       | Retry countdown                                                         |
| `agent:started`      | Subtle header                         | "Agent started — model: opus-4"                                         |
| `agent:completed`    | Summary card                          | Exit code, total cost, tokens in/out, duration                          |

**Auto-scroll:** Follows tail when user is at bottom of scroll, pauses when user scrolls up. Same pattern as current LogDrawer.

**Virtualization:** For long conversations (500+ events), use `@tanstack/react-virtual` for windowed rendering. (New dependency — requires approval per dependency policy.)

**Tool call/result pairing:** Before rendering, the event stream is pre-processed into a `ChatBlock[]` array. A `ChatBlock` is either a single event or a paired `{ toolCall: AgentEvent, toolResult: AgentEvent }` compound block. This pre-pairing step means the renderer is a pure `ChatBlock[] → ReactNode[]` map with no mutable state, and works cleanly with virtualization (no reaching back to mutate a prior rendered item).

### SteerInput

Extracted from current `LogDrawer.tsx` steering UI:

- Textarea + send button
- Calls `agentProvider.steer(agentId, message)` via IPC
- Agent receives message, `agent:user_message` event emitted into event stream
- Message appears in `ChatRenderer` immediately (right-aligned bubble)

### Navigation Changes

The `'sessions'` view key is renamed to `'agents'` throughout. Affected files:

- `src/renderer/src/App.tsx` — `VIEW_TITLES` record, `SessionsView` import → `AgentsView`, `bde:navigate` handler
- `src/renderer/src/components/layout/ActivityBar.tsx` — `NAV_ITEMS` array entry: label, icon, key
- `src/renderer/src/stores/ui.ts` (or wherever `useUIStore` is) — default view key if it references `'sessions'`
- `src/renderer/src/components/layout/CommandPalette.tsx` — references `bde:open-spawn-modal` event
- Any `bde:navigate` custom event dispatches that target `'sessions'` (grep for `'sessions'`)
- Keyboard shortcut: `Cmd+1` → **Agents** (was Sessions)
- `POLL_SESSIONS_INTERVAL` constant renamed to `POLL_AGENTS_INTERVAL` if still needed

### Sprint View Integration

Sprint board task cards retain status badges. Clicking a running or completed task navigates to Agents view filtered to that agent. Sprint no longer needs its own log renderer.

### Refactoring SessionsView, Not Rebuilding

`SessionsView.tsx` already has significant working functionality: unified agent list (local + sessions + history), search/filter, split modes (1/2-pane/grid), `SpawnModal` integration, and keyboard shortcuts. The Agents view should **evolve** this, not rewrite from scratch.

Concrete approach:

- Rename `SessionsView.tsx` → `AgentsView.tsx`, update imports
- Refactor agent list components from `components/sessions/` → `components/agents/`
- Replace the log/chat rendering path with the new `ChatRenderer`
- Keep `SpawnModal` (move to `components/agents/SpawnModal.tsx`)
- Keep search/filter/split mode logic

### What Dies

- `src/renderer/src/components/sprint/LogDrawer.tsx` — functionality absorbed into `AgentDetail` + `ChatRenderer`
- `src/renderer/src/components/sprint/__tests__/LogDrawer.test.tsx` — replaced by ChatRenderer tests
- Gateway-specific session components (as gateway agents phase out)
- `ChatThread.tsx` — used by `LogDrawer.tsx`, `SessionMainContent.tsx`, `LocalAgentLogViewer.tsx`, `ChatPane.tsx`, and `AgentOutputTab.tsx`. Each import site must be migrated to `ChatRenderer` before deletion. Migrate in order: LogDrawer (Slice 3) → remaining session components (during SessionsView refactor) → terminal AgentOutputTab (last)
- Sprint store `taskEvents`/`latestEvents` fields — compatibility shim from Slice 2 removed
- `task:getEvents` IPC channel — no longer needed
- `log:chunk`/`log:done` SSE subscriptions in renderer

### Tests

- ChatRenderer: snapshot tests for each event type rendering
- AgentList: grouping logic (running/recent/history)
- SteerInput: message send flow
- Smoke test for AgentsView

---

## Slice 4: Health, Metrics & Template UI

### Goal

Polish layer — task runner observability in Agents view and template management in Settings.

### Task Runner Health Bar

Top bar of Agents view, always visible:

```
[● Connected]  Queued: 3  Active: 2  Done today: 14  Failed: 0
```

- Green/red dot derived from SSE connection state (already tracked in `sprint-sse.ts`)
- Stats from `/queue/health` endpoint (already polled via `fetchQueueHealth()`)
- Surfaces existing `QueueDashboard` data in the new Agents view header
- If task-runner not configured: `[Task Runner: Not configured]` with link to Settings

No new endpoints needed. Moves existing data to new location.

### Agent-Level Metrics

Displayed in `AgentCard` and `AgentDetail` header:

**Running agents (live-updating):**

- Duration — elapsed since `agent:started` event
- Tokens — accumulated in/out count from events
- Cost — running total derived from token counts
- Rate limit indicator — if `agent:rate_limited` event received, show cooldown

**Completed agents:**

- Final values from `agent:completed` event summary card

All data derived from the `AgentEvent` stream. No new endpoints or data sources.

### Template Customization UI

New section in `SettingsView.tsx`:

```
Agent Templates (4 built-in)
─────────────────────────────────────────────────────────
[bugfix]    Be surgical — change only...     [Edit] [Reset]
[feature]   Follow the spec exactly...       [Edit] [Reset]
[refactor]  Do not change behavior...        [Edit] [Reset]
[test]      Cover edge cases and error...    [Edit] [Reset]

Custom Templates
─────────────────────────────────────────────────────────
[custom]    My custom template...            [Edit] [Delete]
                                       [+ Add Template]
```

**Behavior:**

- Edit opens inline form: name (text input), prompt prefix (textarea)
- Add creates a new custom template
- Delete removes custom templates; built-in templates can be reset to defaults but not permanently deleted
- Templates stored in `settings` table (already the case for defaults)
- Auto-detection heuristics in `template-heuristics.ts` updated to include custom template keywords

**New IPC handlers:**

- `templates:list` — returns all templates (built-in + custom)
- `templates:save` — create or update a template
- `templates:delete` — remove a custom template
- `templates:reset` — reset a built-in template to default

### What's New

- Health status bar component in Agents view
- Template CRUD handlers (new file: `src/main/handlers/template-handlers.ts`)
- Template management section in SettingsView

### What's Reused

- `QueueDashboard` data fetching logic → moves to Agents view health bar
- Existing template storage in settings
- Existing `/queue/health` endpoint

### Tests

- Template CRUD: create, update, delete, reset flows
- Health bar: connected/disconnected states, stat rendering
- Metric derivation: token/cost accumulation from event stream

---

## Dependency Graph

```
Slice 1 (SDK Integration)
    ↓
Slice 2 (Event Streaming)
    ↓
Slice 3 (Agents View + Renderer)
    ↓
Slice 4 (Health + Templates)
```

Slices are sequential — each builds on the previous. Slice 2 includes a compatibility shim so the app remains functional during the transition (LogDrawer + sprint store work against legacy fields until Slice 3 replaces them). Within each slice, work can be parallelized (e.g., in Slice 3, `AgentList` and `ChatRenderer` can be built concurrently).

## Files Deleted or Renamed After All Slices

| File                                                                 | Action                         | Reason                                         |
| -------------------------------------------------------------------- | ------------------------------ | ---------------------------------------------- |
| `src/renderer/src/views/SessionsView.tsx`                            | Renamed → `AgentsView.tsx`     | Evolved, not rebuilt                           |
| `src/renderer/src/components/sprint/LogDrawer.tsx`                   | Deleted                        | Replaced by AgentDetail + ChatRenderer         |
| `src/renderer/src/components/sprint/__tests__/LogDrawer.test.tsx`    | Deleted                        | Replaced by ChatRenderer tests                 |
| `src/renderer/src/components/sessions/ChatThread.tsx`                | Deleted                        | All 5 import sites migrated to ChatRenderer    |
| `src/renderer/src/components/sessions/__tests__/ChatThread.test.tsx` | Deleted                        | Replaced by ChatRenderer tests                 |
| `src/main/queue-api/event-store.ts`                                  | Deleted                        | In-memory store replaced by SQLite persistence |
| `src/renderer/src/components/sessions/`                              | Renamed → `components/agents/` | View rename                                    |
| Log polling in `localAgents.ts`, `agentHistory.ts`                   | Removed                        | Event streaming replaces polling               |

## New Dependencies

| Package                          | Purpose                                   | Slice   |
| -------------------------------- | ----------------------------------------- | ------- |
| `@anthropic-ai/claude-agent-sdk` | Agent SDK for spawning agents             | Slice 1 |
| `@tanstack/react-virtual`        | Windowed rendering for long conversations | Slice 3 |

## Settings Changes

| Key                        | Type             | Default | Purpose                                 |
| -------------------------- | ---------------- | ------- | --------------------------------------- |
| `agent.provider`           | `'sdk' \| 'cli'` | `'sdk'` | Which agent spawning backend to use     |
| `agent.eventRetentionDays` | `number`         | `30`    | How long to keep agent events in SQLite |

## Out of Scope

- Phase 3 pluggable panel architecture (panels, docking, splitting)
- Multi-provider LLM layer (Claude/OpenAI/local models)
- Code-aware workbench features (file explorer, code viewer)
- Gateway agent features (being phased out)
