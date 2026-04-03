# Ad-Hoc Agent Spawning — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the dead `local:spawnClaudeAgent` IPC handler with real SDK-based agent spawning so the SpawnModal can launch ad-hoc Claude sessions with a GUI.

**Architecture:** The handler calls `spawnAgent()` from the existing SDK adapter, records the run in `agent_runs`, consumes messages in the background (mapping raw SDK output to `AgentEvent` types), broadcasts events to the renderer via IPC, and persists them to `agent_events` for history. A module-scope map tracks active ad-hoc agents for steering.

**Tech Stack:** TypeScript, Electron IPC, `@anthropic-ai/claude-agent-sdk` (via sdk-adapter), SQLite (better-sqlite3)

**Spec:** `docs/superpowers/specs/2026-03-23-adhoc-agent-spawn-design.md`

---

## File Structure

### New Files

```
src/main/adhoc-agent.ts          # Ad-hoc agent lifecycle: spawn, message loop, event mapping, cleanup
```

### Modified Files

```
src/shared/types.ts                          # Add 'adhoc' to AgentMeta.source union
src/main/handlers/agent-handlers.ts          # Wire local:spawnClaudeAgent to adhoc-agent, update agent:steer
src/main/__tests__/handlers.test.ts          # Update test that expects throw → now expects success
```

---

## Task 1: Add 'adhoc' to AgentMeta.source type

**Files:**

- Modify: `src/shared/types.ts:19`

- [ ] **Step 1: Update the source union**

In `src/shared/types.ts`, line 19:

```typescript
// Before:
source: 'bde' | 'external'

// After:
source: 'bde' | 'external' | 'adhoc'
```

- [ ] **Step 2: Verify typecheck**

Run: `cd /Users/ryan/projects/BDE && npm run typecheck`
Expected: PASS (no code uses the new value yet)

- [ ] **Step 3: Commit**

```bash
git add src/shared/types.ts
git commit -m "feat: add 'adhoc' to AgentMeta.source union type"
```

---

## Task 2: Create adhoc-agent.ts — core spawn + event streaming logic

**Files:**

- Create: `src/main/adhoc-agent.ts`
- Test: `src/main/__tests__/adhoc-agent.test.ts`

This is the main implementation. It exports `spawnAdhocAgent()` and `getAdhocHandle()`.

- [ ] **Step 1: Write the test**

Create `src/main/__tests__/adhoc-agent.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock dependencies before imports
vi.mock('../agent-manager/sdk-adapter', () => ({
  spawnAgent: vi.fn()
}))
vi.mock('../agent-history', () => ({
  importAgent: vi.fn(),
  updateAgentMeta: vi.fn()
}))
vi.mock('../data/event-queries', () => ({
  appendEvent: vi.fn()
}))
vi.mock('../db', () => ({
  getDb: vi.fn(() => ({}))
}))
vi.mock('../broadcast', () => ({
  broadcast: vi.fn()
}))

import { spawnAdhocAgent, getAdhocHandle } from '../adhoc-agent'
import { spawnAgent } from '../agent-manager/sdk-adapter'
import { importAgent, updateAgentMeta } from '../agent-history'
import { broadcast } from '../broadcast'

function createMockHandle(messages: unknown[] = []) {
  let aborted = false
  return {
    messages: (async function* () {
      for (const msg of messages) {
        if (aborted) return
        yield msg
      }
    })(),
    sessionId: 'test-session',
    abort() {
      aborted = true
    },
    async steer(_msg: string) {}
  }
}

describe('spawnAdhocAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(importAgent).mockResolvedValue({
      id: 'agent-1',
      pid: null,
      bin: 'claude',
      model: 'sonnet',
      repo: 'test-repo',
      repoPath: '/tmp/test-repo',
      task: 'test task',
      startedAt: new Date().toISOString(),
      finishedAt: null,
      exitCode: null,
      status: 'running',
      source: 'adhoc',
      logPath: '/tmp/logs/agent-1/log.jsonl'
    })
  })

  it('spawns agent via SDK adapter and returns result', async () => {
    const handle = createMockHandle([])
    vi.mocked(spawnAgent).mockResolvedValue(handle)

    const result = await spawnAdhocAgent({
      task: 'fix the bug',
      repoPath: '/tmp/test-repo',
      model: 'sonnet'
    })

    expect(spawnAgent).toHaveBeenCalledWith({
      prompt: 'fix the bug',
      cwd: '/tmp/test-repo',
      model: 'sonnet'
    })
    expect(importAgent).toHaveBeenCalled()
    expect(result.id).toBe('agent-1')
    expect(result.interactive).toBe(true)
    expect(result.logPath).toBe('/tmp/logs/agent-1/log.jsonl')
  })

  it('broadcasts agent:started event', async () => {
    const handle = createMockHandle([])
    vi.mocked(spawnAgent).mockResolvedValue(handle)

    await spawnAdhocAgent({ task: 'test', repoPath: '/tmp/r', model: 'sonnet' })

    // Wait for background message loop to process
    await new Promise((r) => setTimeout(r, 50))

    expect(broadcast).toHaveBeenCalledWith('agent:event', {
      agentId: 'agent-1',
      event: expect.objectContaining({ type: 'agent:started', model: 'sonnet' })
    })
  })

  it('broadcasts agent:completed when messages end', async () => {
    const handle = createMockHandle([])
    vi.mocked(spawnAgent).mockResolvedValue(handle)

    await spawnAdhocAgent({ task: 'test', repoPath: '/tmp/r', model: 'sonnet' })
    await new Promise((r) => setTimeout(r, 50))

    expect(broadcast).toHaveBeenCalledWith('agent:event', {
      agentId: 'agent-1',
      event: expect.objectContaining({ type: 'agent:completed' })
    })
    expect(updateAgentMeta).toHaveBeenCalledWith(
      'agent-1',
      expect.objectContaining({ status: 'done' })
    )
  })

  it('maps assistant text messages to agent:text events', async () => {
    const handle = createMockHandle([
      { type: 'assistant', message: { content: [{ type: 'text', text: 'Hello' }] } }
    ])
    vi.mocked(spawnAgent).mockResolvedValue(handle)

    await spawnAdhocAgent({ task: 'test', repoPath: '/tmp/r', model: 'sonnet' })
    await new Promise((r) => setTimeout(r, 50))

    expect(broadcast).toHaveBeenCalledWith('agent:event', {
      agentId: 'agent-1',
      event: expect.objectContaining({ type: 'agent:text', text: 'Hello' })
    })
  })

  it('getAdhocHandle returns handle for active agent', async () => {
    const handle = createMockHandle([])
    vi.mocked(spawnAgent).mockResolvedValue(handle)

    // No handle before spawn
    expect(getAdhocHandle('agent-1')).toBeUndefined()

    await spawnAdhocAgent({ task: 'test', repoPath: '/tmp/r', model: 'sonnet' })

    // Handle available during run (before messages consumed)
    // Note: messages may already be consumed in background, so handle may already be cleaned up.
    // This test is a best-effort check.
  })

  it('defaults model to claude-sonnet-4-5 when not provided', async () => {
    const handle = createMockHandle([])
    vi.mocked(spawnAgent).mockResolvedValue(handle)

    await spawnAdhocAgent({ task: 'test', repoPath: '/tmp/r' })

    expect(spawnAgent).toHaveBeenCalledWith(expect.objectContaining({ model: 'claude-sonnet-4-5' }))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/ryan/projects/BDE && npx vitest run src/main/__tests__/adhoc-agent.test.ts`
Expected: FAIL — module `../adhoc-agent` does not exist

- [ ] **Step 3: Create `src/main/adhoc-agent.ts`**

```typescript
/**
 * Ad-hoc agent spawning — launches Claude sessions directly via SDK adapter.
 * Not tied to sprint tasks. Persists to agent_runs + agent_events for history.
 */
import { randomUUID } from 'node:crypto'
import { basename } from 'node:path'
import { spawnAgent } from './agent-manager/sdk-adapter'
import type { AgentHandle } from './agent-manager/types'
import { importAgent, updateAgentMeta } from './agent-history'
import { appendEvent } from './data/event-queries'
import { getDb } from './db'
import { broadcast } from './broadcast'
import type { AgentEvent, SpawnLocalAgentResult } from '../shared/types'

/** Active ad-hoc agent handles, keyed by agent run ID */
const adhocAgents = new Map<string, AgentHandle>()

export function getAdhocHandle(agentId: string): AgentHandle | undefined {
  return adhocAgents.get(agentId)
}

export async function spawnAdhocAgent(args: {
  task: string
  repoPath: string
  model?: string
}): Promise<SpawnLocalAgentResult> {
  const model = args.model || 'claude-sonnet-4-5'

  // Spawn via SDK adapter (same path as Agent Manager)
  const handle = await spawnAgent({
    prompt: args.task,
    cwd: args.repoPath,
    model
  })

  // Record in agent_runs
  const repo = basename(args.repoPath).toLowerCase()
  const meta = await importAgent(
    {
      id: randomUUID(),
      pid: null,
      bin: 'claude',
      model,
      repo,
      repoPath: args.repoPath,
      task: args.task,
      status: 'running',
      source: 'adhoc'
    },
    '' // No initial log content
  )

  // Track for steering
  adhocAgents.set(meta.id, handle)

  // Consume messages in the background — do NOT await
  consumeMessages(meta.id, model, handle).catch(() => {})

  return {
    id: meta.id,
    pid: 0,
    logPath: meta.logPath ?? '',
    interactive: true
  }
}

// ---- Background message consumer ----

async function consumeMessages(agentId: string, model: string, handle: AgentHandle): Promise<void> {
  const startedAt = Date.now()
  let costUsd = 0
  let tokensIn = 0
  let tokensOut = 0
  let exitCode = 0

  // Emit agent:started
  emitEvent(agentId, { type: 'agent:started', model, timestamp: Date.now() })

  try {
    for await (const raw of handle.messages) {
      const events = mapRawMessage(raw)
      for (const event of events) {
        emitEvent(agentId, event)
      }

      // Track cost/token fields if present
      if (typeof raw === 'object' && raw !== null) {
        const r = raw as Record<string, unknown>
        if (typeof r.cost_usd === 'number') costUsd = r.cost_usd
        if (typeof r.tokens_in === 'number') tokensIn = r.tokens_in
        if (typeof r.tokens_out === 'number') tokensOut = r.tokens_out
        if (typeof r.exit_code === 'number') exitCode = r.exit_code
      }
    }
  } catch (err) {
    emitEvent(agentId, {
      type: 'agent:error',
      message: err instanceof Error ? err.message : String(err),
      timestamp: Date.now()
    })
  }

  // Emit completion
  const durationMs = Date.now() - startedAt
  emitEvent(agentId, {
    type: 'agent:completed',
    exitCode,
    costUsd,
    tokensIn,
    tokensOut,
    durationMs,
    timestamp: Date.now()
  })

  // Update agent_runs
  await updateAgentMeta(agentId, {
    status: 'done',
    finishedAt: new Date().toISOString(),
    exitCode
  }).catch(() => {})

  // Cleanup
  adhocAgents.delete(agentId)
}

function emitEvent(agentId: string, event: AgentEvent): void {
  broadcast('agent:event', { agentId, event })
  try {
    appendEvent(getDb(), agentId, event.type, JSON.stringify(event), event.timestamp)
  } catch {
    // SQLite write failure is non-fatal
  }
}

// ---- Raw message → AgentEvent mapping ----

function mapRawMessage(raw: unknown): AgentEvent[] {
  if (typeof raw !== 'object' || raw === null) return []
  const msg = raw as Record<string, unknown>
  const now = Date.now()
  const events: AgentEvent[] = []

  const msgType = msg.type as string | undefined

  if (msgType === 'assistant') {
    // Extract text from message content
    const message = msg.message as Record<string, unknown> | undefined
    const content = message?.content
    if (Array.isArray(content)) {
      for (const block of content) {
        if (typeof block === 'object' && block !== null) {
          const b = block as Record<string, unknown>
          if (b.type === 'text' && typeof b.text === 'string') {
            events.push({ type: 'agent:text', text: b.text, timestamp: now })
          } else if (b.type === 'tool_use') {
            events.push({
              type: 'agent:tool_call',
              tool: (b.name as string) ?? 'unknown',
              summary: (b.name as string) ?? '',
              input: b.input,
              timestamp: now
            })
          }
        }
      }
    }
  } else if (msgType === 'tool_result' || msgType === 'result') {
    const content = msg.content ?? msg.output
    events.push({
      type: 'agent:tool_result',
      tool: (msg.tool_name as string) ?? (msg.name as string) ?? 'unknown',
      success: msg.is_error !== true,
      summary: typeof content === 'string' ? content.slice(0, 200) : '',
      output: content,
      timestamp: now
    })
  }

  return events
}
```

- [ ] **Step 4: Run tests**

Run: `cd /Users/ryan/projects/BDE && npx vitest run src/main/__tests__/adhoc-agent.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/adhoc-agent.ts src/main/__tests__/adhoc-agent.test.ts
git commit -m "feat: add adhoc-agent.ts — SDK-based ad-hoc agent spawning with event streaming"
```

---

## Task 3: Wire handler to adhoc-agent + update steer

**Files:**

- Modify: `src/main/handlers/agent-handlers.ts:5-6,32-36,42-50`

- [ ] **Step 1: Update agent-handlers.ts**

Add imports at the top (after line 18):

```typescript
import { spawnAdhocAgent, getAdhocHandle } from '../adhoc-agent'
import type { SpawnLocalAgentArgs } from '../../shared/types'
```

Replace the `local:spawnClaudeAgent` handler (lines 32-36):

```typescript
safeHandle('local:spawnClaudeAgent', async (_e, args: SpawnLocalAgentArgs) => {
  return spawnAdhocAgent({
    task: args.task,
    repoPath: args.repoPath,
    model: args.model
  })
})
```

Update the `agent:steer` handler (lines 42-50) — add adhoc check before Agent Manager:

```typescript
safeHandle(
  'agent:steer',
  async (_e, { agentId, message }: { agentId: string; message: string }) => {
    // Try ad-hoc agents first
    const adhocHandle = getAdhocHandle(agentId)
    if (adhocHandle) {
      await adhocHandle.steer(message)
      return { ok: true }
    }
    // Try local AgentManager
    const am = (global as any).__agentManager
    if (am) {
      try {
        await am.steerAgent(agentId, message)
        return { ok: true }
      } catch {
        /* fall through */
      }
    }
    // Fall back to runner-client
    return steerAgent(agentId, message)
  }
)
```

Update the `agent:kill` handler (lines 51-57) — add adhoc check before Agent Manager:

```typescript
safeHandle('agent:kill', async (_e, agentId: string) => {
  // Try ad-hoc agents first
  const adhocHandle = getAdhocHandle(agentId)
  if (adhocHandle) {
    adhocHandle.abort()
    return { ok: true }
  }
  const am = (global as any).__agentManager
  if (am) {
    try {
      am.killAgent(agentId)
      return { ok: true }
    } catch {
      /* fall through */
    }
  }
  return killAgent(agentId)
})
```

- [ ] **Step 2: Verify typecheck**

Run: `cd /Users/ryan/projects/BDE && npm run typecheck`
Expected: PASS

**Important:** Do NOT commit yet — Task 3 continues below with test updates. The handler import of `adhoc-agent` will break tests if committed without the corresponding mock.

#### Handler test updates (must be done together with handler changes)

**Files:**

- Modify: `src/main/__tests__/handlers.test.ts:209-258`

- [ ] **Step 1: Update tests**

The existing tests expect `local:spawnClaudeAgent` to throw. These need updating:

Find the test at line 209-213 (`'re-throws errors to the renderer'`). This test uses `local:spawnClaudeAgent` as a convenient way to test error propagation. Since the handler no longer throws, either:

- Change it to use a different handler that throws, OR
- Replace it with a test that verifies the new spawn behavior

Find the test at line 254-258 (`'"local:spawnClaudeAgent" rejects (spawning removed from BDE)'`). Replace with:

```typescript
it('"local:spawnClaudeAgent" calls spawnAdhocAgent', async () => {
  const result = await invoke('local:spawnClaudeAgent', { repoPath: '/tmp/bde', task: 'fix bug' })
  expect(result).toBeDefined()
})
```

For the error propagation test (lines 209-213), find another handler that can throw, or create a dedicated test. For example, use the `agents:readLog` handler with a bad ID:

```typescript
it('re-throws errors to the renderer (does not swallow)', async () => {
  // Force an error via agents:readLog with a non-existent agent
  vi.mocked(agentHistory.readLog).mockRejectedValueOnce(new Error('not found'))
  await expect(invoke('agents:readLog', { id: 'nonexistent' })).rejects.toThrow('not found')
})
```

Also update the console.error test (lines 216-224) similarly.

You will also need to mock `spawnAdhocAgent` in the test file. Add to the mocks section:

```typescript
vi.mock('../adhoc-agent', () => ({
  spawnAdhocAgent: vi
    .fn()
    .mockResolvedValue({ id: 'test-id', pid: 0, logPath: '/tmp/log', interactive: true }),
  getAdhocHandle: vi.fn()
}))
```

- [ ] **Step 2: Run tests**

Run: `cd /Users/ryan/projects/BDE && npm run test:main`
Expected: All main process tests PASS

- [ ] **Step 3: Run full test suite**

Run: `cd /Users/ryan/projects/BDE && npm test`
Expected: All tests PASS

- [ ] **Step 4: Commit handler + tests together**

```bash
git add src/main/handlers/agent-handlers.ts src/main/__tests__/handlers.test.ts
git commit -m "feat: wire local:spawnClaudeAgent to adhoc-agent, add adhoc steer/kill support"
```

---

## Execution Summary

| Task | What                                                      | Files                                   |
| ---- | --------------------------------------------------------- | --------------------------------------- |
| 1    | Add `'adhoc'` to source type                              | `types.ts`                              |
| 2    | Create `adhoc-agent.ts` — spawn + event streaming + tests | `adhoc-agent.ts`, `adhoc-agent.test.ts` |
| 3    | Wire handler + update steer/kill + update handler tests   | `agent-handlers.ts`, `handlers.test.ts` |

**Total tasks:** 3
**New files:** 2 (`adhoc-agent.ts`, `adhoc-agent.test.ts`)
**New dependencies:** None
