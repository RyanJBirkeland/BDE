# Phase 2: Agent Workflow Hub — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform BDE into a unified Agent Workflow Hub with SDK-powered agents, real-time event streaming, a hybrid chat renderer, and full agent observability.

**Architecture:** Four vertical slices delivered sequentially. Slice 1 abstracts agent spawning behind an interface with SDK + CLI adapters. Slice 2 builds the event streaming pipeline (event bus, SQLite, IPC, Zustand). Slice 3 evolves Sessions into the Agents view with a hybrid chat renderer. Slice 4 adds health monitoring and template management UI.

**Tech Stack:** TypeScript, Electron (main/preload/renderer), Zustand, `@anthropic-ai/claude-agent-sdk`, `@tanstack/react-virtual`, SQLite (better-sqlite3), React, `react-resizable-panels`, `lucide-react`

**Spec:** `docs/superpowers/specs/2026-03-20-phase2-agent-workflow-hub-design.md`

---

## File Structure

### New Files

```
src/main/agents/
├── types.ts              # AgentProvider interface, AgentSpawnOptions, AgentHandle, AgentEvent union
├── sdk-provider.ts       # SdkProvider implements AgentProvider
├── cli-provider.ts       # CliProvider implements AgentProvider (extracted from local-agents.ts)
├── index.ts              # createAgentProvider() factory
├── event-bus.ts          # Central EventEmitter, broadcasts via IPC, writes to event-store
├── event-store.ts        # SQLite persistence for agent_events table
└── __tests__/
    ├── cli-provider.test.ts
    ├── sdk-provider.test.ts
    ├── event-bus.test.ts
    └── event-store.test.ts

src/renderer/src/
├── stores/agentEvents.ts                   # Zustand store for agent event streams
├── views/AgentsView.tsx                    # Evolved from SessionsView
└── components/agents/
    ├── AgentList.tsx                        # Left panel, grouped by status
    ├── AgentCard.tsx                        # Individual agent card
    ├── AgentDetail.tsx                      # Right panel, header + chat + steer
    ├── ChatRenderer.tsx                     # Hybrid event renderer with pairing logic
    ├── ChatBubble.tsx                       # Markdown message bubble
    ├── ToolCallBlock.tsx                    # Collapsible tool call + result
    ├── ThinkingBlock.tsx                    # Collapsible thinking block
    ├── SteerInput.tsx                       # Textarea + send for agent steering
    ├── HealthBar.tsx                        # Task runner connection + queue stats
    ├── SpawnModal.tsx                       # Moved from components/sessions/
    └── __tests__/
        ├── ChatRenderer.test.tsx
        ├── AgentList.test.tsx
        ├── SteerInput.test.tsx
        └── HealthBar.test.tsx

src/main/handlers/
└── template-handlers.ts                    # Template CRUD IPC handlers
```

### Files Deleted (after all slices)

```
src/renderer/src/views/SessionsView.tsx                          # Replaced by AgentsView
src/renderer/src/components/sprint/LogDrawer.tsx                 # Replaced by AgentDetail + ChatRenderer
src/renderer/src/components/sprint/__tests__/LogDrawer.test.tsx  # Replaced by ChatRenderer tests
src/renderer/src/components/sessions/ChatThread.tsx              # All import sites migrated
src/renderer/src/components/sessions/__tests__/ChatThread.test.tsx
src/main/queue-api/event-store.ts                                # Replaced by agents/event-store.ts
```

### Key Modified Files

| File | Slice | Change |
|------|-------|--------|
| `src/main/local-agents.ts` | 1 | Thin orchestrator delegating to provider factory |
| `src/main/config.ts` | 1 | Add `getAgentProvider()` setting getter |
| `src/main/db.ts` | 2 | Migration v10: `agent_events` table |
| `src/shared/ipc-channels.ts` | 2,4 | Add `agent:event`, `agent:history`, `templates:*` channels |
| `src/preload/index.ts` | 2,4 | Add agent event + template API bridges |
| `src/main/queue-api/router.ts` | 2 | Route output events through event bus |
| `src/main/sprint-sse.ts` | 2 | Route SSE events through event bus |
| `src/renderer/src/stores/sprint.ts` | 2,3 | Compatibility shim (Slice 2), remove legacy fields (Slice 3) |
| `src/renderer/src/App.tsx` | 3 | `sessions` to `agents` view key, import AgentsView |
| `src/renderer/src/stores/ui.ts` | 3 | `View` type: `sessions` to `agents` |
| `src/renderer/src/components/layout/ActivityBar.tsx` | 3 | NAV_ITEMS: sessions to agents |
| `src/renderer/src/components/layout/CommandPalette.tsx` | 3 | Navigation command label |
| `src/renderer/src/views/SettingsView.tsx` | 4 | Add template management section |
| `src/shared/template-heuristics.ts` | 4 | Support custom template keywords |

---

## Slice 1: SDK Integration Layer

### Task 1: AgentEvent Type + AgentProvider Interface

**Files:**
- Create: `src/main/agents/types.ts`

- [ ] **Step 1: Create the types file with AgentEvent union and interfaces**

```typescript
// src/main/agents/types.ts

// --- Agent Events (unified event stream for local + remote agents) ---

export type AgentEventType =
  | 'agent:started'
  | 'agent:text'
  | 'agent:user_message'
  | 'agent:thinking'
  | 'agent:tool_call'
  | 'agent:tool_result'
  | 'agent:rate_limited'
  | 'agent:error'
  | 'agent:completed'

export type AgentEvent =
  | { type: 'agent:started'; model: string; timestamp: number }
  | { type: 'agent:text'; text: string; timestamp: number }
  | { type: 'agent:user_message'; text: string; timestamp: number }
  | { type: 'agent:thinking'; tokenCount: number; text?: string; timestamp: number }
  | { type: 'agent:tool_call'; tool: string; summary: string; input?: unknown; timestamp: number }
  | { type: 'agent:tool_result'; tool: string; success: boolean; summary: string; output?: unknown; timestamp: number }
  | { type: 'agent:rate_limited'; retryDelayMs: number; attempt: number; timestamp: number }
  | { type: 'agent:error'; message: string; timestamp: number }
  | { type: 'agent:completed'; exitCode: number; costUsd: number; tokensIn: number; tokensOut: number; durationMs: number; timestamp: number }

// --- Agent Provider Interface ---

export interface AgentSpawnOptions {
  prompt: string
  workingDirectory: string
  model?: string
  maxTokens?: number
  templatePrefix?: string
  agentId?: string
}

export interface AgentHandle {
  id: string
  logPath?: string
  events: AsyncIterable<AgentEvent>
  steer(message: string): Promise<void>
  stop(): Promise<void>
}

export interface AgentProvider {
  spawn(opts: AgentSpawnOptions): Promise<AgentHandle>
}
```

- [ ] **Step 2: Verify typecheck passes**

Run: `npm run typecheck`
Expected: PASS — new file, no consumers yet

- [ ] **Step 3: Commit**

```bash
git add src/main/agents/types.ts
git commit -m "feat(agents): add AgentEvent type and AgentProvider interface"
```

---

### Task 2: CLI Provider (Extract from local-agents.ts)

**Files:**
- Create: `src/main/agents/cli-provider.ts`
- Create: `src/main/agents/__tests__/cli-provider.test.ts`
- Modify: `src/main/local-agents.ts` (lines 150-287 — extract spawn logic)

- [ ] **Step 1: Write failing test for CLI provider**

```typescript
// src/main/agents/__tests__/cli-provider.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AgentHandle, AgentEvent } from '../types'

// Test that CliProvider implements AgentProvider interface
describe('CliProvider', () => {
  it('spawn() returns an AgentHandle with expected shape', async () => {
    // Mock child_process.spawn to return a fake process
    const { CliProvider } = await import('../cli-provider')
    const provider = new CliProvider()

    const handle = await provider.spawn({
      prompt: 'test prompt',
      workingDirectory: '/tmp/test',
    })

    expect(handle.id).toBeDefined()
    expect(handle.events).toBeDefined()
    expect(typeof handle.steer).toBe('function')
    expect(typeof handle.stop).toBe('function')
  })

  it('events iterable emits agent:started as first event', async () => {
    const { CliProvider } = await import('../cli-provider')
    const provider = new CliProvider()

    const handle = await provider.spawn({
      prompt: 'test prompt',
      workingDirectory: '/tmp/test',
    })

    const events: AgentEvent[] = []
    for await (const event of handle.events) {
      events.push(event)
      if (event.type === 'agent:started') break
    }

    expect(events[0].type).toBe('agent:started')
  })

  it('stop() terminates the process', async () => {
    const { CliProvider } = await import('../cli-provider')
    const provider = new CliProvider()

    const handle = await provider.spawn({
      prompt: 'test prompt',
      workingDirectory: '/tmp/test',
    })

    await handle.stop()
    // Process should be terminated — no more events
  })
})
```

Adjust mocks based on actual `child_process.spawn` usage in `local-agents.ts`. Read the existing test patterns in `src/main/__tests__/local-agents.test.ts` (lines 8-85) for mock setup.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --reporter=verbose src/main/agents/__tests__/cli-provider.test.ts`
Expected: FAIL — `cli-provider.ts` does not exist yet

- [ ] **Step 3: Implement CliProvider**

Create `src/main/agents/cli-provider.ts`:
- Extract the `spawnClaudeAgent()` function body from `src/main/local-agents.ts` (lines 150-241)
- Wrap in a `class CliProvider implements AgentProvider`
- The `spawn()` method does what `spawnClaudeAgent` does today: uses `execFile`-style spawning with argument arrays (NOT string interpolation — prevent shell injection per CLAUDE.md)
- Convert stdout JSON stream into `AgentEvent` async iterable using an `AsyncGenerator`
- `steer()` writes to stdin (extract from `sendToAgent` at line 260)
- `stop()` sends SIGTERM (extract from `killAgent`)
- Set `logPath` on the handle for backup log persistence
- Parse the stream-json output format into `AgentEvent` types:
  - `init` message to `agent:started`
  - `assistant` text blocks to `agent:text`
  - `tool_use` blocks to `agent:tool_call`
  - `tool_result` blocks to `agent:tool_result`
  - Process exit to `agent:completed`
  - Errors to `agent:error`

Reference: Read `src/main/local-agents.ts` lines 150-287 for the exact process spawn args, JSON protocol, and stdin/stdout handling.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --reporter=verbose src/main/agents/__tests__/cli-provider.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/agents/cli-provider.ts src/main/agents/__tests__/cli-provider.test.ts
git commit -m "feat(agents): extract CLI provider from local-agents.ts"
```

---

### Task 3: SDK Provider

**Files:**
- Create: `src/main/agents/sdk-provider.ts`
- Create: `src/main/agents/__tests__/sdk-provider.test.ts`

**Prerequisite:** `@anthropic-ai/claude-agent-sdk` required — must get explicit user approval per CLAUDE.md dependency policy.

- [ ] **Step 1: CHECKPOINT — Get user approval for Agent SDK dependency**

**STOP:** Do not proceed until the user explicitly approves adding `@anthropic-ai/claude-agent-sdk`. Explain: this is the Claude Agent SDK for spawning agents programmatically instead of CLI processes.

After approval: `npm install @anthropic-ai/claude-agent-sdk`

- [ ] **Step 2: Write failing test for SDK provider**

```typescript
// src/main/agents/__tests__/sdk-provider.test.ts
import { describe, it, expect, vi } from 'vitest'
import type { AgentHandle, AgentEvent } from '../types'

describe('SdkProvider', () => {
  it('spawn() returns an AgentHandle with expected shape', async () => {
    const { SdkProvider } = await import('../sdk-provider')
    const provider = new SdkProvider()

    const handle = await provider.spawn({
      prompt: 'test prompt',
      workingDirectory: '/tmp/test',
    })

    expect(handle.id).toBeDefined()
    expect(handle.events).toBeDefined()
    expect(typeof handle.steer).toBe('function')
    expect(typeof handle.stop).toBe('function')
    // SDK provider does not set logPath
    expect(handle.logPath).toBeUndefined()
  })

  it('events iterable maps SDK callbacks to AgentEvent types', async () => {
    const { SdkProvider } = await import('../sdk-provider')
    const provider = new SdkProvider()

    const handle = await provider.spawn({
      prompt: 'test prompt',
      workingDirectory: '/tmp/test',
      model: 'claude-sonnet-4-6',
    })

    const events: AgentEvent[] = []
    for await (const event of handle.events) {
      events.push(event)
      if (event.type === 'agent:completed') break
    }

    // Should have at least started and completed
    expect(events[0].type).toBe('agent:started')
    expect(events[events.length - 1].type).toBe('agent:completed')
  })
})
```

Mock the SDK client to simulate callbacks. Read the Agent SDK docs/types to understand the callback interface.

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- --reporter=verbose src/main/agents/__tests__/sdk-provider.test.ts`
Expected: FAIL — `sdk-provider.ts` does not exist yet

- [ ] **Step 4: Implement SdkProvider**

Create `src/main/agents/sdk-provider.ts`:
- Import from `@anthropic-ai/claude-agent-sdk`
- `class SdkProvider implements AgentProvider`
- `spawn()` creates an SDK agent session:
  - Pass `prompt`, `model`, `maxTokens` from `AgentSpawnOptions`
  - Set working directory
  - If `templatePrefix`, prepend to prompt
- Map SDK event callbacks to `AgentEvent` async iterable:
  - SDK text output to `agent:text`
  - SDK tool use to `agent:tool_call`
  - SDK tool result to `agent:tool_result`
  - SDK thinking to `agent:thinking`
  - SDK completion to `agent:completed` (with cost, tokens, duration)
  - SDK errors to `agent:error`
- `steer()` sends a message through the SDK conversation API
- `stop()` cancels/aborts the SDK run
- No `logPath` — SDK does not write to disk

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- --reporter=verbose src/main/agents/__tests__/sdk-provider.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/main/agents/sdk-provider.ts src/main/agents/__tests__/sdk-provider.test.ts package.json package-lock.json
git commit -m "feat(agents): add SDK provider using claude-agent-sdk"
```

---

### Task 4: Provider Factory + Config

**Files:**
- Create: `src/main/agents/index.ts`
- Modify: `src/main/config.ts` (add `getAgentProvider()`)

- [ ] **Step 1: Add config getter**

In `src/main/config.ts`, add:

```typescript
export function getAgentProvider(): 'sdk' | 'cli' {
  return (getSetting('agent.provider') as 'sdk' | 'cli') ?? 'sdk'
}

export function getEventRetentionDays(): number {
  return parseInt(getSetting('agent.eventRetentionDays') ?? '30', 10)
}
```

Find the existing `getSetting` pattern in `config.ts` and follow it.

- [ ] **Step 2: Create factory**

```typescript
// src/main/agents/index.ts
export { type AgentProvider, type AgentHandle, type AgentEvent, type AgentSpawnOptions } from './types'
import type { AgentProvider } from './types'
import { getAgentProvider } from '../config'
import { CliProvider } from './cli-provider'
import { SdkProvider } from './sdk-provider'

export function createAgentProvider(): AgentProvider {
  return getAgentProvider() === 'cli' ? new CliProvider() : new SdkProvider()
}
```

- [ ] **Step 3: Verify typecheck passes**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/main/agents/index.ts src/main/config.ts
git commit -m "feat(agents): add provider factory with config-driven selection"
```

---

### Task 5: Wire local-agents.ts to Provider Factory

**Files:**
- Modify: `src/main/local-agents.ts`

- [ ] **Step 1: Refactor local-agents.ts to delegate to provider**

In `src/main/local-agents.ts`:
- Import `createAgentProvider` from `./agents`
- Replace the body of `spawnClaudeAgent()` with:
  1. Create provider via `createAgentProvider()`
  2. Call `provider.spawn()` with mapped options
  3. Return `SpawnLocalAgentResult` from `AgentHandle` (map `handle.id`, `handle.logPath`, etc.)
- Keep: `extractAgentCost`, `updateAgentRunCost`, any DB metadata writing
- Keep: The process tracking map and `listLocalAgents()` — update to track `AgentHandle` instead of raw PID
- The `sendToAgent` function should delegate to `handle.steer()`
- The `killAgent` function should delegate to `handle.stop()`

- [ ] **Step 2: Run existing tests to verify nothing breaks**

Run: `npm test -- --reporter=verbose src/main/__tests__/local-agents.test.ts`
Expected: PASS — public API unchanged, implementation swapped underneath

- [ ] **Step 3: Run full test suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 4: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/local-agents.ts
git commit -m "refactor(agents): wire local-agents.ts to provider factory"
```

---

## Slice 2: Event Streaming Infrastructure

### Task 6: SQLite Migration for agent_events Table

**Files:**
- Modify: `src/main/db.ts` (add migration v11 after v10 — v10 already exists and drops FK constraint on agent_run_id)

- [ ] **Step 1: Write failing test for migration**

Add to `src/main/agents/__tests__/event-store.test.ts`:

```typescript
it('migration v11 creates agent_events table', () => {
  const db = getDb()
  const table = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='agent_events'"
  ).get()
  expect(table).toBeDefined()
})

it('agent_events has expected columns', () => {
  const db = getDb()
  const columns = db.prepare('PRAGMA table_info(agent_events)').all()
  const names = columns.map((c: any) => c.name)
  expect(names).toContain('id')
  expect(names).toContain('agent_id')
  expect(names).toContain('event_type')
  expect(names).toContain('payload')
  expect(names).toContain('timestamp')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --reporter=verbose src/main/agents/__tests__/event-store.test.ts`
Expected: FAIL — table does not exist

- [ ] **Step 3: Add migration v11 to db.ts**

In `src/main/db.ts`, find the migrations array. Add AFTER the existing v10 migration (which drops FK on agent_run_id, around line 296):

```typescript
{
  version: 11,
  description: 'Create agent_events table for unified event streaming',
  up: (db) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS agent_events (
        id INTEGER PRIMARY KEY,
        agent_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        payload TEXT NOT NULL,
        timestamp INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_agent_events_agent
        ON agent_events(agent_id, timestamp);
    `)
  },
},
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --reporter=verbose src/main/agents/__tests__/event-store.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/db.ts src/main/agents/__tests__/event-store.test.ts
git commit -m "feat(agents): add migration v11 for agent_events table"
```

---

### Task 7: Event Store (SQLite Persistence)

**Files:**
- Create: `src/main/agents/event-store.ts`
- Modify: `src/main/agents/__tests__/event-store.test.ts` (add CRUD tests)

- [ ] **Step 1: Write failing tests for event store**

```typescript
// Add to src/main/agents/__tests__/event-store.test.ts

describe('AgentEventStore', () => {
  it('appendEvent stores an event and getHistory retrieves it', () => {
    const { appendEvent, getHistory } = require('../event-store')

    const event = {
      type: 'agent:started' as const,
      model: 'claude-opus-4-6',
      timestamp: Date.now(),
    }

    appendEvent('agent-1', event)
    const history = getHistory('agent-1')

    expect(history).toHaveLength(1)
    expect(history[0].type).toBe('agent:started')
  })

  it('getHistory returns events ordered by timestamp', () => {
    const { appendEvent, getHistory } = require('../event-store')

    appendEvent('agent-2', { type: 'agent:started', model: 'opus', timestamp: 100 })
    appendEvent('agent-2', { type: 'agent:text', text: 'hello', timestamp: 200 })
    appendEvent('agent-2', { type: 'agent:completed', exitCode: 0, costUsd: 0.5, tokensIn: 100, tokensOut: 200, durationMs: 5000, timestamp: 300 })

    const history = getHistory('agent-2')
    expect(history).toHaveLength(3)
    expect(history[0].timestamp).toBe(100)
    expect(history[2].timestamp).toBe(300)
  })

  it('pruneOldEvents removes events older than retention period', () => {
    const { appendEvent, getHistory, pruneOldEvents } = require('../event-store')

    const oldTimestamp = Date.now() - (31 * 24 * 60 * 60 * 1000)
    appendEvent('agent-3', { type: 'agent:started', model: 'opus', timestamp: oldTimestamp })
    appendEvent('agent-3', { type: 'agent:text', text: 'recent', timestamp: Date.now() })

    pruneOldEvents(30)

    const history = getHistory('agent-3')
    expect(history).toHaveLength(1)
    expect(history[0].type).toBe('agent:text')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --reporter=verbose src/main/agents/__tests__/event-store.test.ts`
Expected: FAIL — module does not exist

- [ ] **Step 3: Implement event store**

```typescript
// src/main/agents/event-store.ts
import { getDb } from '../db'
import type { AgentEvent } from './types'

export function appendEvent(agentId: string, event: AgentEvent): void {
  getDb()
    .prepare(
      'INSERT INTO agent_events (agent_id, event_type, payload, timestamp) VALUES (?, ?, ?, ?)'
    )
    .run(agentId, event.type, JSON.stringify(event), event.timestamp)
}

export function getHistory(agentId: string): AgentEvent[] {
  const rows = getDb()
    .prepare('SELECT payload FROM agent_events WHERE agent_id = ? ORDER BY timestamp ASC')
    .all(agentId) as { payload: string }[]
  return rows.map((r) => JSON.parse(r.payload) as AgentEvent)
}

export function pruneOldEvents(retentionDays: number): void {
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000
  getDb()
    .prepare('DELETE FROM agent_events WHERE timestamp < ?')
    .run(cutoff)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --reporter=verbose src/main/agents/__tests__/event-store.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/agents/event-store.ts src/main/agents/__tests__/event-store.test.ts
git commit -m "feat(agents): add SQLite event store for agent event persistence"
```

---

### Task 8: Event Bus

**Files:**
- Create: `src/main/agents/event-bus.ts`
- Create: `src/main/agents/__tests__/event-bus.test.ts`

- [ ] **Step 1: Write failing test for event bus**

```typescript
// src/main/agents/__tests__/event-bus.test.ts
import { describe, it, expect, vi } from 'vitest'

describe('EventBus', () => {
  it('emitting an event calls all subscribers', () => {
    const { createEventBus } = require('../event-bus')
    const bus = createEventBus({ persist: false })

    const handler = vi.fn()
    bus.on('agent:event', handler)

    const event = { type: 'agent:started' as const, model: 'opus', timestamp: Date.now() }
    bus.emit('agent:event', 'agent-1', event)

    expect(handler).toHaveBeenCalledWith('agent-1', event)
  })

  it('persists events to event store when persist=true', () => {
    // NOTE: This test requires a working SQLite database. Use the same
    // in-memory DB setup pattern as src/main/__tests__/db.test.ts
    // (beforeAll/beforeEach that initializes getDb() with :memory:)
    const { createEventBus } = require('../event-bus')
    const { getHistory } = require('../event-store')
    const bus = createEventBus({ persist: true })

    const event = { type: 'agent:text' as const, text: 'hello', timestamp: Date.now() }
    bus.emit('agent:event', 'agent-persist', event)

    const history = getHistory('agent-persist')
    expect(history).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --reporter=verbose src/main/agents/__tests__/event-bus.test.ts`
Expected: FAIL — module does not exist

- [ ] **Step 3: Implement event bus**

```typescript
// src/main/agents/event-bus.ts
import { EventEmitter } from 'node:events'
import { appendEvent } from './event-store'
import { broadcast } from '../broadcast'
import type { AgentEvent } from './types'

export interface AgentEventBus {
  emit(channel: 'agent:event', agentId: string, event: AgentEvent): void
  on(channel: 'agent:event', handler: (agentId: string, event: AgentEvent) => void): void
  off(channel: 'agent:event', handler: (agentId: string, event: AgentEvent) => void): void
}

export function createEventBus(opts?: { persist?: boolean }): AgentEventBus {
  const emitter = new EventEmitter()
  const persist = opts?.persist ?? true

  const bus: AgentEventBus = {
    emit(channel, agentId, event) {
      if (persist) {
        appendEvent(agentId, event)
      }
      broadcast('agent:event', { agentId, event })
      emitter.emit(channel, agentId, event)
    },
    on(channel, handler) {
      emitter.on(channel, handler)
    },
    off(channel, handler) {
      emitter.off(channel, handler)
    },
  }

  return bus
}

// Singleton — created once at app startup
let _bus: AgentEventBus | null = null

export function getEventBus(): AgentEventBus {
  if (!_bus) {
    _bus = createEventBus({ persist: true })
  }
  return _bus
}
```

Note: `broadcast` is the existing function in `src/main/broadcast.ts`. Read it to verify the signature.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --reporter=verbose src/main/agents/__tests__/event-bus.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/agents/event-bus.ts src/main/agents/__tests__/event-bus.test.ts
git commit -m "feat(agents): add event bus for unified agent event broadcasting"
```

---

### Task 9: IPC Channels + Preload Bridge

**Files:**
- Modify: `src/shared/ipc-channels.ts` (add `agent:event`, `agent:history`)
- Modify: `src/preload/index.ts` (add agent event listeners)
- Modify: `src/main/index.ts` (register `agent:history` handler)

- [ ] **Step 1: Add IPC channel definitions**

In `src/shared/ipc-channels.ts`, add after the existing agent channels (around line 212):

```typescript
// --- Agent Event Streaming (Phase 2) ---
'agent:event': {
  args: [payload: { agentId: string; event: AgentEvent }]
  result: void
},
'agent:history': {
  args: [agentId: string]
  result: AgentEvent[]
},
```

Follow the existing pattern in the channel map for typing.

- [ ] **Step 2: Add preload bridge**

In `src/preload/index.ts`, add the agent event API surface:

```typescript
agentEvents: {
  onEvent: (handler: (payload: { agentId: string; event: AgentEvent }) => void) =>
    ipcRenderer.on('agent:event', (_, payload) => handler(payload)),
  getHistory: (agentId: string) => typedInvoke('agent:history', agentId),
},
```

Follow the existing pattern for `onTaskOutput` and other push event listeners.

- [ ] **Step 3: Register agent:history handler in main process**

In `src/main/index.ts`, register:

```typescript
safeHandle('agent:history', (_, agentId: string) => {
  return getHistory(agentId)
})
```

Import `getHistory` from `./agents/event-store`.

- [ ] **Step 4: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/shared/ipc-channels.ts src/preload/index.ts src/main/index.ts
git commit -m "feat(agents): add agent event IPC channels and preload bridge"
```

---

### Task 10: agentEvents Zustand Store

**Files:**
- Create: `src/renderer/src/stores/agentEvents.ts`

- [ ] **Step 1: Create the store**

```typescript
// src/renderer/src/stores/agentEvents.ts
import { create } from 'zustand'
import type { AgentEvent } from '../../../main/agents/types'

interface AgentEventsState {
  events: Record<string, AgentEvent[]>
  init: () => void
  loadHistory: (agentId: string) => Promise<void>
  clear: (agentId: string) => void
}

export const useAgentEventsStore = create<AgentEventsState>((set) => ({
  events: {},

  init() {
    window.api.agentEvents.onEvent(({ agentId, event }) => {
      set((state) => ({
        events: {
          ...state.events,
          [agentId]: [...(state.events[agentId] ?? []), event],
        },
      }))
    })
  },

  async loadHistory(agentId: string) {
    const history = await window.api.agentEvents.getHistory(agentId)
    set((state) => ({
      events: { ...state.events, [agentId]: history },
    }))
  },

  clear(agentId: string) {
    set((state) => {
      const next = { ...state.events }
      delete next[agentId]
      return { events: next }
    })
  },
}))
```

Note: Adjust the import path for `AgentEvent` to match project path aliasing. Check existing stores for the pattern.

- [ ] **Step 2: Verify typecheck passes**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/stores/agentEvents.ts
git commit -m "feat(agents): add agentEvents Zustand store for live event streaming"
```

---

### Task 11: Wire Event Bus into Queue API + Sprint SSE

**Files:**
- Modify: `src/main/queue-api/router.ts` (output handler emits to event bus)
- Modify: `src/main/sprint-sse.ts` (relay through event bus)
- Modify: `src/main/index.ts` (run pruning on startup)

- [ ] **Step 1: Wire queue API output handler**

In `src/main/queue-api/router.ts`, find the `POST /queue/tasks/:id/output` handler. Add event bus integration:

```typescript
import { getEventBus } from '../agents/event-bus'
import type { AgentEvent } from '../agents/types'

// Timestamp conversion: ISO 8601 string to Unix ms
function convertTimestamp(raw: { timestamp: string }): number {
  return new Date(raw.timestamp).getTime()
}

// Inside the output POST handler, after parsing body:
const events = body.events as TaskOutputEvent[]
for (const raw of events) {
  const agentEvent: AgentEvent = {
    ...raw,
    timestamp: convertTimestamp(raw),
  } as AgentEvent
  getEventBus().emit('agent:event', taskId, agentEvent)
}
```

Keep existing response behavior intact.

- [ ] **Step 2: Wire sprint SSE relay**

In `src/main/sprint-sse.ts`, route agent output events through the event bus:
- `task:queued` and `task:updated` continue broadcasting directly (task-level, not agent-level)
- Any `log:chunk` or agent output events convert and emit into event bus

- [ ] **Step 3: Run startup pruning**

In `src/main/index.ts`, add at app startup:

```typescript
import { pruneOldEvents } from './agents/event-store'
import { getEventRetentionDays } from './config'

// In the app ready handler:
pruneOldEvents(getEventRetentionDays())
```

- [ ] **Step 4: Run full test suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/queue-api/router.ts src/main/sprint-sse.ts src/main/index.ts
git commit -m "feat(agents): wire event bus into queue API and sprint SSE relay"
```

---

### Task 12: Compatibility Shim (Dual-Write to Sprint Store)

**Files:**
- Modify: `src/renderer/src/stores/sprint.ts` (dual-write to legacy fields)

- [ ] **Step 1: Update sprint store to dual-write**

In `src/renderer/src/stores/sprint.ts`, find `initTaskOutputListener()` (around line 163). Add a parallel subscription to the new `agent:event` IPC that populates the legacy `taskEvents`/`latestEvents`:

```typescript
// Keep existing listener AND add new one for dual-write:
window.api.agentEvents.onEvent(({ agentId, event }) => {
  set((state) => ({
    taskEvents: {
      ...state.taskEvents,
      [agentId]: [...(state.taskEvents[agentId] ?? []), event as any],
    },
    latestEvents: {
      ...state.latestEvents,
      [agentId]: event as any,
    },
  }))
})
```

- [ ] **Step 2: Verify LogDrawer still works**

Run: `npm test -- --reporter=verbose src/renderer/src/components/sprint/__tests__/LogDrawer.test.tsx`
Expected: PASS

- [ ] **Step 3: Run full test suite + build**

Run: `npm test && npm run build`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/stores/sprint.ts
git commit -m "feat(agents): add compatibility shim for dual-write during Slice 2-3 transition"
```

---

## Slice 3: Agents View + Hybrid Chat Renderer

### Task 13: ChatBubble Component

**Files:**
- Create: `src/renderer/src/components/agents/ChatBubble.tsx`

- [ ] **Step 1: Create ChatBubble**

Markdown-rendered message bubble with three variants:
- `agent` — left-aligned, surface background
- `user` — right-aligned, accent-tinted background
- `error` — red border, error background

Use design tokens from `src/renderer/src/design-system/tokens.ts`. Optional timestamp display.

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/agents/ChatBubble.tsx
git commit -m "feat(agents): add ChatBubble component for agent/user messages"
```

---

### Task 14: ThinkingBlock Component

**Files:**
- Create: `src/renderer/src/components/agents/ThinkingBlock.tsx`

- [ ] **Step 1: Create ThinkingBlock**

Collapsible block: collapsed shows "THINKING" label + token count, expanded shows full thinking text. Purple accent. `useState` for toggle.

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/agents/ThinkingBlock.tsx
git commit -m "feat(agents): add ThinkingBlock component for collapsible thinking display"
```

---

### Task 15: ToolCallBlock Component

**Files:**
- Create: `src/renderer/src/components/agents/ToolCallBlock.tsx`

- [ ] **Step 1: Create ToolCallBlock**

Props accept both unpaired (tool call only) and paired (tool call + result):
```typescript
interface ToolCallBlockProps {
  tool: string
  summary: string
  input?: unknown
  result?: { success: boolean; summary: string; output?: unknown }
  timestamp: number
}
```
Collapsed: tool name + summary + success/fail badge. Expanded: input JSON + output. Blue accent.

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/agents/ToolCallBlock.tsx
git commit -m "feat(agents): add ToolCallBlock component with collapsible detail"
```

---

### Task 16: ChatRenderer (Orchestrator + Pairing Logic)

**Files:**
- Create: `src/renderer/src/components/agents/ChatRenderer.tsx`
- Create: `src/renderer/src/components/agents/__tests__/ChatRenderer.test.tsx`

**Prerequisite:** `@tanstack/react-virtual` required — must get explicit user approval per CLAUDE.md dependency policy.

- [ ] **Step 1: CHECKPOINT — Get user approval for react-virtual dependency**

**STOP:** Do not proceed until the user explicitly approves adding `@tanstack/react-virtual`. Explain: this is for windowed/virtualized rendering of long agent conversation threads (500+ events).

After approval: `npm install @tanstack/react-virtual`

- [ ] **Step 2: Write failing test for pairing logic**

```typescript
// src/renderer/src/components/agents/__tests__/ChatRenderer.test.tsx
import { describe, it, expect } from 'vitest'
import { pairEvents } from '../ChatRenderer'
import type { AgentEvent } from '../../../../main/agents/types'

describe('pairEvents', () => {
  it('pairs tool_call with following tool_result', () => {
    const events: AgentEvent[] = [
      { type: 'agent:tool_call', tool: 'Read', summary: 'src/foo.ts', timestamp: 100 },
      { type: 'agent:tool_result', tool: 'Read', success: true, summary: '50 lines', timestamp: 101 },
    ]
    const blocks = pairEvents(events)
    expect(blocks).toHaveLength(1)
    expect(blocks[0].type).toBe('tool_pair')
  })

  it('leaves unpaired tool_call as standalone', () => {
    const events: AgentEvent[] = [
      { type: 'agent:tool_call', tool: 'Read', summary: 'src/foo.ts', timestamp: 100 },
      { type: 'agent:text', text: 'hello', timestamp: 102 },
    ]
    const blocks = pairEvents(events)
    expect(blocks).toHaveLength(2)
    expect(blocks[0].type).toBe('tool_call')
  })

  it('maps text events to text blocks', () => {
    const events: AgentEvent[] = [
      { type: 'agent:text', text: 'hello', timestamp: 100 },
    ]
    const blocks = pairEvents(events)
    expect(blocks).toHaveLength(1)
    expect(blocks[0].type).toBe('text')
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- --reporter=verbose src/renderer/src/components/agents/__tests__/ChatRenderer.test.tsx`
Expected: FAIL

- [ ] **Step 4: Implement ChatRenderer**

Create `src/renderer/src/components/agents/ChatRenderer.tsx`:
- Export `pairEvents()` function: pre-processes `AgentEvent[]` into `ChatBlock[]`
  - `ChatBlock` is a discriminated union: `text | user_message | thinking | tool_call | tool_pair | error | rate_limited | started | completed`
  - Pairs `agent:tool_call` + immediately following `agent:tool_result` (matching `tool` name) into `tool_pair`
  - Unpaired tool calls stay as `tool_call`
- Export `ChatRenderer` component:
  - Takes `events: AgentEvent[]` prop
  - Calls `pairEvents(events)` to get `ChatBlock[]`
  - Uses `@tanstack/react-virtual` `useVirtualizer` for windowed rendering (500+ events)
  - Maps each `ChatBlock` to the appropriate component (ChatBubble, ThinkingBlock, ToolCallBlock, etc.)
  - Auto-scroll: follows tail when at bottom, pauses on user scroll-up

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- --reporter=verbose src/renderer/src/components/agents/__tests__/ChatRenderer.test.tsx`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/agents/ChatRenderer.tsx src/renderer/src/components/agents/__tests__/ChatRenderer.test.tsx package.json package-lock.json
git commit -m "feat(agents): add ChatRenderer with event pairing and virtualization"
```

---

### Task 17: SteerInput Component

**Files:**
- Create: `src/renderer/src/components/agents/SteerInput.tsx`

- [ ] **Step 1: Create SteerInput**

Extract from `src/renderer/src/components/sprint/LogDrawer.tsx` (steering textarea). Props:

```typescript
interface SteerInputProps {
  agentId: string
  onSend: (message: string) => void
}
```

- Textarea with Enter to send (Shift+Enter for newline)
- Send button with icon (`lucide-react`)
- `onSend` triggers IPC to steer agent AND emits `agent:user_message` event into event bus

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/agents/SteerInput.tsx
git commit -m "feat(agents): add SteerInput component extracted from LogDrawer"
```

---

### Task 18: AgentCard + AgentDetail Components

**Files:**
- Create: `src/renderer/src/components/agents/AgentCard.tsx`
- Create: `src/renderer/src/components/agents/AgentDetail.tsx`

- [ ] **Step 1: Create AgentCard**

Shows: agent name/task title, status badge, duration, running cost, source icon (local vs task-runner). Use `lucide-react` icons. Reference existing card patterns (e.g., `TaskCard.tsx`).

- [ ] **Step 2: Create AgentDetail**

Layout:
- **Header:** agent name, status badge, start time, model, cost summary
- **Body:** `<ChatRenderer events={events} />`
- **Footer:** `<SteerInput />` visible only when agent is running (derived from events: shown after `agent:started`, hidden after `agent:completed`/`agent:error`)

Wire to `useAgentEventsStore` to get events for selected agent.

- [ ] **Step 3: Verify typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/agents/AgentCard.tsx src/renderer/src/components/agents/AgentDetail.tsx
git commit -m "feat(agents): add AgentCard and AgentDetail components"
```

---

### Task 19: AgentList Component

**Files:**
- Create: `src/renderer/src/components/agents/AgentList.tsx`
- Create: `src/renderer/src/components/agents/__tests__/AgentList.test.tsx`

- [ ] **Step 1: Write failing test for grouping logic**

```typescript
describe('groupAgents', () => {
  it('groups agents into running, recent, and history', () => {
    const now = Date.now()
    const agents = [
      { id: '1', status: 'running', startedAt: now },
      { id: '2', status: 'completed', completedAt: now - 3600_000 },
      { id: '3', status: 'completed', completedAt: now - 48 * 3600_000 },
    ]
    const groups = groupAgents(agents as any)
    expect(groups.running).toHaveLength(1)
    expect(groups.recent).toHaveLength(1)
    expect(groups.history).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --reporter=verbose src/renderer/src/components/agents/__tests__/AgentList.test.tsx`
Expected: FAIL

- [ ] **Step 3: Implement AgentList**

Refactor from existing `src/renderer/src/components/sessions/AgentList.tsx`. Keep search/filter logic. Add three-group rendering: Running (live pulse), Recent (24h), History (lazy-loaded).

- [ ] **Step 4: Run test to verify it passes**

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/agents/AgentList.tsx src/renderer/src/components/agents/__tests__/AgentList.test.tsx
git commit -m "feat(agents): add AgentList with running/recent/history grouping"
```

---

### Task 20: AgentsView (Evolve SessionsView)

**Files:**
- Create: `src/renderer/src/views/AgentsView.tsx` (evolved from SessionsView)
- Move: `src/renderer/src/components/sessions/SpawnModal.tsx` to `src/renderer/src/components/agents/SpawnModal.tsx`

- [ ] **Step 1: Copy SessionsView as starting point**

Copy `SessionsView.tsx` to `AgentsView.tsx`. Then:
- Rename component `SessionsView` to `AgentsView`
- Update all `components/sessions/` imports to `components/agents/`
- Replace log/chat rendering with `AgentDetail` + `ChatRenderer`
- Keep SpawnModal, search/filter, split mode logic
- Wire to `useAgentEventsStore`

- [ ] **Step 2: Move SpawnModal**

Move `components/sessions/SpawnModal.tsx` to `components/agents/SpawnModal.tsx`. Update internal imports.

- [ ] **Step 3: Verify typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/views/AgentsView.tsx src/renderer/src/components/agents/SpawnModal.tsx
git commit -m "feat(agents): evolve SessionsView into AgentsView with ChatRenderer"
```

---

### Task 21: Navigation Updates

**Files:**
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/stores/ui.ts`
- Modify: `src/renderer/src/components/layout/ActivityBar.tsx`
- Modify: `src/renderer/src/components/layout/CommandPalette.tsx`

- [ ] **Step 1: Update View type in ui.ts**

Change `'sessions'` to `'agents'` in View type union and default value.

- [ ] **Step 2: Update App.tsx**

- `VIEW_ORDER`: `'sessions'` to `'agents'`
- `VIEW_TITLES`: `sessions: 'Sessions'` to `agents: 'Agents'`
- Import: `SessionsView` to `AgentsView`
- Render: `activeView === 'sessions'` to `activeView === 'agents'`

- [ ] **Step 3: Update ActivityBar**

NAV_ITEMS: `{ view: 'sessions', ... }` to `{ view: 'agents', label: 'Agents', ... }`

- [ ] **Step 4: Update CommandPalette**

`'Go to Sessions'` to `'Go to Agents'`, navigation target `'sessions'` to `'agents'`

- [ ] **Step 5: Grep for remaining 'sessions' references**

Search `src/renderer/` for any missed `'sessions'` string references and update.

- [ ] **Step 6: Run typecheck + full test suite**

Run: `npm run typecheck && npm test`
Expected: PASS — update test fixtures referencing `'sessions'` view

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/App.tsx src/renderer/src/stores/ui.ts src/renderer/src/components/layout/ActivityBar.tsx src/renderer/src/components/layout/CommandPalette.tsx
git commit -m "refactor(agents): rename sessions to agents across navigation"
```

---

### Task 22: Delete Legacy Files + Remove Compatibility Shim

**Files:**
- Delete: `src/renderer/src/views/SessionsView.tsx`
- Delete: `src/renderer/src/components/sprint/LogDrawer.tsx`
- Delete: `src/renderer/src/components/sprint/__tests__/LogDrawer.test.tsx`
- Delete: `src/renderer/src/components/sessions/ChatThread.tsx`
- Delete: `src/renderer/src/components/sessions/__tests__/ChatThread.test.tsx`
- Delete: `src/main/queue-api/event-store.ts`
- Migrate or delete: remaining files in `src/renderer/src/components/sessions/`
- Modify: `src/renderer/src/stores/sprint.ts`

- [ ] **Step 1: Audit the full sessions/ directory**

List all files in `src/renderer/src/components/sessions/`. For each file, determine:
- Is it already moved to `components/agents/` (SpawnModal, AgentList)? Delete the old copy.
- Is it used by the new AgentsView? Move to `components/agents/` and update imports.
- Is it only used by deleted components (LogDrawer, SessionsView)? Delete it.
- Is it used by other views (Terminal's AgentOutputTab)? Move to `components/agents/` and update the import in the consumer.

Common files that may remain: `SessionHeader.tsx`, `AgentRow.tsx`, `LocalAgentRow.tsx`, `MiniChatPane.tsx`, `TicketEditor.tsx`, `MessageInput.tsx`, `LocalAgentLogViewer.tsx`, `SessionMainContent.tsx`, `ChatPane.tsx`. Each must be explicitly accounted for.

- [ ] **Step 2: Migrate all ChatThread import sites**

Before deleting `ChatThread.tsx`, update each import site to `ChatRenderer`:
1. `SessionMainContent.tsx` — update import (or delete if orphaned)
2. `LocalAgentLogViewer.tsx` — update import (or delete if orphaned)
3. `ChatPane.tsx` — update import (or delete if orphaned)
4. `AgentOutputTab.tsx` — update import to `components/agents/ChatRenderer`
(LogDrawer already replaced by AgentDetail)

- [ ] **Step 3: Audit sprint:readLog usage before deletion**

Grep all call sites for `sprint:readLog` and `sprint.readLog` across the renderer and main process. Verify that every consumer has been replaced by the event bus path. Only delete the channel after confirming zero live callers remain outside of already-deleted files.

- [ ] **Step 4: Delete legacy files**

```bash
rm src/renderer/src/views/SessionsView.tsx
rm src/renderer/src/components/sprint/LogDrawer.tsx
rm src/renderer/src/components/sprint/__tests__/LogDrawer.test.tsx
rm src/renderer/src/components/sessions/ChatThread.tsx
rm src/renderer/src/components/sessions/__tests__/ChatThread.test.tsx
rm src/main/queue-api/event-store.ts
```

Delete the entire `src/renderer/src/components/sessions/` directory if all files have been migrated or confirmed dead. If any files remain live, move them to `components/agents/` first.

- [ ] **Step 5: Remove compatibility shim from sprint store**

In `src/renderer/src/stores/sprint.ts`: remove `taskEvents`, `latestEvents`, `initTaskOutputListener`, `clearTaskEvents`, and the dual-write logic from Task 12.

- [ ] **Step 6: Remove dead IPC channels**

In `src/shared/ipc-channels.ts`, remove (only after Step 3 confirms no live callers):
- `local:tailAgentLog`
- `agents:readLog`
- `sprint:readLog`
- `task:getEvents`

Remove corresponding preload bridge entries and main-process handlers.

Also remove `POLL_SESSIONS_INTERVAL` from `src/renderer/src/lib/constants.ts` if it exists (dead after Sessions rename).

- [ ] **Step 7: Run typecheck + full test suite + build**

Run: `npm run typecheck && npm test && npm run build`
Expected: PASS — no dangling references

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "chore(agents): remove legacy LogDrawer, ChatThread, sessions/, event-store, and compatibility shim"
```

---

## Slice 4: Health, Metrics & Template UI

### Task 23: HealthBar Component

**Files:**
- Create: `src/renderer/src/components/agents/HealthBar.tsx`
- Create: `src/renderer/src/components/agents/__tests__/HealthBar.test.tsx`

- [ ] **Step 1: Write failing test**

```typescript
describe('HealthBar', () => {
  it('shows connected status when SSE is connected', () => {
    render(<HealthBar connected={true} stats={{ queued: 3, active: 2, doneToday: 14, failed: 0 }} />)
    expect(screen.getByText('Connected')).toBeDefined()
  })

  it('shows not-configured when task runner is absent', () => {
    render(<HealthBar connected={false} stats={null} />)
    expect(screen.getByText(/not configured/i)).toBeDefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails, then implement**

Display: `[dot] Connected | Queued: N Active: N Done today: N Failed: N`
Green/red dot from SSE state. Stats from `fetchQueueHealth()`. Reuse QueueDashboard data.

- [ ] **Step 3: Wire into AgentsView**

Add `<HealthBar />` at top of `AgentsView.tsx`.

- [ ] **Step 4: Run tests, commit**

```bash
git add src/renderer/src/components/agents/HealthBar.tsx src/renderer/src/components/agents/__tests__/HealthBar.test.tsx src/renderer/src/views/AgentsView.tsx
git commit -m "feat(agents): add HealthBar with task runner connection status"
```

---

### Task 24: Template CRUD Handlers

**Files:**
- Create: `src/main/handlers/template-handlers.ts`
- Modify: `src/shared/ipc-channels.ts` (add template channels)
- Modify: `src/preload/index.ts` (add template API bridge)
- Modify: `src/main/index.ts` (register handlers)
- Modify: `src/shared/types.ts` (add `TaskTemplate` type if needed)

- [ ] **Step 1: Extend existing TaskTemplate type**

`TaskTemplate` already exists in `src/shared/types.ts`. Add the `isBuiltIn` field:

```typescript
export interface TaskTemplate {
  name: string
  promptPrefix: string
  isBuiltIn: boolean  // NEW — true for the 4 built-in templates, false for custom
}
```

Update all existing consumers of `TaskTemplate` to handle the new field:
- `src/main/handlers/sprint-local.ts` — `ClaimedTask` interface, template resolution
- `src/renderer/src/views/SettingsView.tsx` — if it references templates
- `src/renderer/src/components/sprint/NewTicketModal.tsx` — template dropdown
- `src/main/__tests__/task-templates.test.ts` — test fixtures

- [ ] **Step 2: Add IPC channels for templates**

In `src/shared/ipc-channels.ts`:
```typescript
'templates:list': { args: []; result: TaskTemplate[] },
'templates:save': { args: [template: TaskTemplate]; result: void },
'templates:delete': { args: [name: string]; result: void },
'templates:reset': { args: [name: string]; result: void },
```

- [ ] **Step 3: Implement template handlers**

Create `src/main/handlers/template-handlers.ts`:
- `templates:list` — merge DEFAULT_TASK_TEMPLATES with custom templates from settings, apply overrides
- `templates:save` — for built-in: store override in `templates.overrides`; for custom: store in `templates.custom`
- `templates:delete` — remove from `templates.custom`
- `templates:reset` — remove override from `templates.overrides`

- [ ] **Step 4: Add preload bridge + register handlers**

Preload: `templates: { list, save, delete, reset }` API surface.
Main: `registerTemplateHandlers()` called in app ready handler.

- [ ] **Step 5: Run typecheck, commit**

```bash
git add src/main/handlers/template-handlers.ts src/shared/ipc-channels.ts src/preload/index.ts src/main/index.ts src/shared/types.ts
git commit -m "feat(agents): add template CRUD IPC handlers"
```

---

### Task 25: Template Management UI in Settings

**Files:**
- Modify: `src/renderer/src/views/SettingsView.tsx`
- Modify: `src/shared/template-heuristics.ts`

- [ ] **Step 1: Add template section to SettingsView**

New section showing:
- 4 built-in templates with Edit/Reset buttons
- Custom templates section with Edit/Delete buttons
- "+ Add Template" button
- Edit opens inline form: name + prompt prefix textarea

Follow existing SettingsView section patterns.

- [ ] **Step 2: Update template-heuristics.ts**

Modify `detectTemplate()` to check custom template keywords in addition to built-in ones.

- [ ] **Step 3: Run typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/views/SettingsView.tsx src/shared/template-heuristics.ts
git commit -m "feat(agents): add template management UI in Settings"
```

---

### Task 26: Agent Metrics in AgentCard + AgentDetail

**Files:**
- Modify: `src/renderer/src/components/agents/AgentCard.tsx`
- Modify: `src/renderer/src/components/agents/AgentDetail.tsx`

- [ ] **Step 1: Create metrics derivation utility**

```typescript
function deriveMetrics(events: AgentEvent[]) {
  const started = events.find((e) => e.type === 'agent:started')
  const completed = events.find((e) => e.type === 'agent:completed')
  return {
    isRunning: !!started && !completed,
    duration: completed?.durationMs ?? (started ? Date.now() - started.timestamp : 0),
    tokensIn: completed?.tokensIn ?? 0,
    tokensOut: completed?.tokensOut ?? 0,
    costUsd: completed?.costUsd ?? 0,
    model: started?.model,
  }
}
```

- [ ] **Step 2: Wire into AgentCard**

Show duration, cost, token count. For running agents, 1-second interval to update duration.

- [ ] **Step 3: Wire into AgentDetail header**

Show model, live duration, total tokens, running cost.

- [ ] **Step 4: Run typecheck + tests + build**

Run: `npm run typecheck && npm test && npm run build`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/agents/AgentCard.tsx src/renderer/src/components/agents/AgentDetail.tsx
git commit -m "feat(agents): add live agent metrics to AgentCard and AgentDetail"
```

---

### Task 27: Final Cleanup + README Update

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update README**

- Remove references to "Diff" view
- Update keyboard shortcuts: `Cmd+1` to Agents
- Update view list to match current state
- Update architecture section if it references Sessions

- [ ] **Step 2: Run lint + format**

Run: `npm run lint && npm run format`

- [ ] **Step 3: Run full CI checks**

Run: `npm run build && npm test && npm run typecheck`
Expected: ALL PASS

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: update README for Phase 2 view changes"
```

---

## Summary

| Slice | Tasks | Key Deliverable |
|-------|-------|-----------------|
| **1** | Tasks 1-5 | `AgentProvider` interface, SDK + CLI adapters, factory |
| **2** | Tasks 6-12 | Event bus, SQLite persistence, IPC streaming, compatibility shim |
| **3** | Tasks 13-22 | Agents view, hybrid chat renderer, navigation rename, legacy cleanup |
| **4** | Tasks 23-27 | HealthBar, template CRUD, agent metrics, README update |

**Total tasks:** 27
**New dependencies:** `@anthropic-ai/claude-agent-sdk` (Slice 1), `@tanstack/react-virtual` (Slice 3)
**New DB migration:** v11 (agent_events table — v10 already exists)
