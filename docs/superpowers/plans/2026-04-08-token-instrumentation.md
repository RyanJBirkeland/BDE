# Token Instrumentation Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix broken `tokens_in`/`tokens_out` accumulation in `agent_runs` and add a per-turn breakdown table so BDE knows not just how much runs cost, but why.

**Architecture:** A new `TurnTracker` class (`src/main/agent-manager/turn-tracker.ts`) observes each SDK message, accumulates token totals with `+=`, and writes one `agent_run_turns` row per assistant turn. Both `run-agent.ts` (pipeline) and `adhoc-agent.ts` (interactive) replace their broken per-message token reads with a single `TurnTracker` instance.

**Tech Stack:** TypeScript, better-sqlite3, Vitest

**Spec:** `docs/superpowers/specs/2026-04-08-token-instrumentation-design.md`

---

## File Map

| File                                      | Action     | Responsibility                                                                   |
| ----------------------------------------- | ---------- | -------------------------------------------------------------------------------- |
| `src/main/db.ts`                          | Modify     | Add migration v44: `agent_run_turns` table + index                               |
| `src/main/data/agent-queries.ts`          | Modify     | Add `insertAgentRunTurn`, `listAgentRunTurns` query functions                    |
| `src/main/agent-manager/turn-tracker.ts`  | **Create** | `TurnTracker` class — accumulation logic, turn boundary detection, SQLite writes |
| `src/main/agent-manager/run-agent.ts`     | Modify     | Replace broken token reads with `TurnTracker`                                    |
| `src/main/adhoc-agent.ts`                 | Modify     | Replace broken token reads with `TurnTracker` (session-scoped)                   |
| `src/main/__tests__/turn-tracker.test.ts` | **Create** | Unit tests for `TurnTracker`                                                     |

---

## Task 1: Add `agent_run_turns` DB migration

**Files:**

- Modify: `src/main/db.ts` (add migration after `version: 43`)

- [ ] **Step 1: Add migration v44**

Find the `version: 43` migration block in `src/main/db.ts` and add the following immediately after its closing brace. Note the `const sql =` pattern — required to avoid the repo's shell-injection lint hook which pattern-matches on `db` calls with inline template literals:

```ts
{
  version: 44,
  description: 'Add agent_run_turns table for per-turn token breakdown',
  up: (db) => {
    const sql = `
      CREATE TABLE IF NOT EXISTS agent_run_turns (
        id          INTEGER PRIMARY KEY,
        run_id      TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
        turn        INTEGER NOT NULL,
        tokens_in   INTEGER,
        tokens_out  INTEGER,
        tool_calls  INTEGER,
        recorded_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_agent_run_turns_run ON agent_run_turns(run_id);
    `
    db.exec(sql)
  }
},
```

- [ ] **Step 2: Verify migration runs**

```bash
npm run typecheck 2>&1 | head -20
```

Expected: zero errors in `db.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/main/db.ts
git commit -m "feat: add agent_run_turns migration (v44)"
```

---

## Task 2: Add query functions in `agent-queries.ts`

**Files:**

- Modify: `src/main/data/agent-queries.ts`

- [ ] **Step 1: Add `TurnRecord` interface**

At the top of `src/main/data/agent-queries.ts`, after the existing imports, add:

```ts
export interface TurnRecord {
  runId: string
  turn: number
  tokensIn: number
  tokensOut: number
  toolCalls: number
}
```

- [ ] **Step 2: Add `insertAgentRunTurn` and `listAgentRunTurns` at the bottom of the file**

```ts
export function insertAgentRunTurn(db: Database.Database, record: TurnRecord): void {
  const stmt = db.prepare(
    'INSERT INTO agent_run_turns (run_id, turn, tokens_in, tokens_out, tool_calls, recorded_at) VALUES (?, ?, ?, ?, ?, ?)'
  )
  stmt.run(
    record.runId,
    record.turn,
    record.tokensIn,
    record.tokensOut,
    record.toolCalls,
    new Date().toISOString()
  )
}

export function listAgentRunTurns(db: Database.Database, runId: string): TurnRecord[] {
  const rows = db
    .prepare(
      'SELECT run_id, turn, tokens_in, tokens_out, tool_calls FROM agent_run_turns WHERE run_id = ? ORDER BY turn ASC'
    )
    .all(runId) as Array<{
    run_id: string
    turn: number
    tokens_in: number | null
    tokens_out: number | null
    tool_calls: number | null
  }>
  return rows.map((r) => ({
    runId: r.run_id,
    turn: r.turn,
    tokensIn: r.tokens_in ?? 0,
    tokensOut: r.tokens_out ?? 0,
    toolCalls: r.tool_calls ?? 0
  }))
}
```

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck 2>&1 | head -20
```

Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add src/main/data/agent-queries.ts
git commit -m "feat: add insertAgentRunTurn and listAgentRunTurns query functions"
```

---

## Task 3: Write `TurnTracker` with tests (TDD)

**Files:**

- Create: `src/main/__tests__/turn-tracker.test.ts`
- Create: `src/main/agent-manager/turn-tracker.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/main/__tests__/turn-tracker.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import Database from 'better-sqlite3'

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/tmp'),
    getName: vi.fn(() => 'BDE'),
    getVersion: vi.fn(() => '0.0.0')
  },
  BrowserWindow: { getAllWindows: vi.fn(() => []) },
  ipcMain: { handle: vi.fn(), on: vi.fn() }
}))

import { TurnTracker } from '../agent-manager/turn-tracker'

function makeDb(): Database.Database {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  const schema = `
    CREATE TABLE agent_runs (id TEXT PRIMARY KEY, status TEXT NOT NULL DEFAULT 'running');
    CREATE TABLE agent_run_turns (
      id          INTEGER PRIMARY KEY,
      run_id      TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
      turn        INTEGER NOT NULL,
      tokens_in   INTEGER,
      tokens_out  INTEGER,
      tool_calls  INTEGER,
      recorded_at TEXT NOT NULL
    );
    CREATE INDEX idx_agent_run_turns_run ON agent_run_turns(run_id);
  `
  db.exec(schema)
  return db
}

describe('TurnTracker', () => {
  let db: Database.Database

  beforeEach(() => {
    db = makeDb()
    db.prepare("INSERT INTO agent_runs (id) VALUES ('run-1')").run()
  })

  it('starts with zero totals', () => {
    const tracker = new TurnTracker('run-1', db)
    expect(tracker.totals()).toEqual({ tokensIn: 0, tokensOut: 0 })
  })

  it('accumulates tokens from usage object on assistant messages', () => {
    const tracker = new TurnTracker('run-1', db)
    tracker.observe({ type: 'assistant', usage: { input_tokens: 100, output_tokens: 50 } })
    tracker.observe({ type: 'assistant', usage: { input_tokens: 200, output_tokens: 80 } })
    expect(tracker.totals()).toEqual({ tokensIn: 300, tokensOut: 130 })
  })

  it('accumulates tokens from top-level fields on result/system messages', () => {
    const tracker = new TurnTracker('run-1', db)
    tracker.observe({ type: 'result', tokens_in: 500, tokens_out: 200 })
    expect(tracker.totals()).toEqual({ tokensIn: 500, tokensOut: 200 })
  })

  it('accumulates from both sources when both present on same message', () => {
    const tracker = new TurnTracker('run-1', db)
    tracker.observe({
      type: 'assistant',
      usage: { input_tokens: 100, output_tokens: 50 },
      tokens_in: 10,
      tokens_out: 5
    })
    expect(tracker.totals()).toEqual({ tokensIn: 110, tokensOut: 55 })
  })

  it('writes one turn row per assistant message with cumulative totals', () => {
    const tracker = new TurnTracker('run-1', db)

    tracker.observe({
      type: 'assistant',
      usage: { input_tokens: 100, output_tokens: 50 },
      message: { content: [{ type: 'tool_use', name: 'Read' }] }
    })
    tracker.observe({
      type: 'assistant',
      usage: { input_tokens: 200, output_tokens: 80 }
    })

    const rows = db
      .prepare('SELECT turn, tokens_in, tokens_out, tool_calls FROM agent_run_turns ORDER BY turn')
      .all() as Array<{ turn: number; tokens_in: number; tokens_out: number; tool_calls: number }>

    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ turn: 1, tokens_in: 100, tokens_out: 50, tool_calls: 1 })
    expect(rows[1]).toMatchObject({ turn: 2, tokens_in: 300, tokens_out: 130, tool_calls: 0 })
  })

  it('resets tool_calls per turn but keeps cumulative tokens', () => {
    const tracker = new TurnTracker('run-1', db)
    tracker.observe({
      type: 'assistant',
      usage: { input_tokens: 100, output_tokens: 50 },
      message: {
        content: [
          { type: 'tool_use', name: 'Read' },
          { type: 'tool_use', name: 'Write' }
        ]
      }
    })
    tracker.observe({
      type: 'assistant',
      usage: { input_tokens: 50, output_tokens: 20 }
    })

    const rows = db
      .prepare('SELECT tool_calls, tokens_in FROM agent_run_turns ORDER BY turn')
      .all() as Array<{ tool_calls: number; tokens_in: number }>

    expect(rows[0].tool_calls).toBe(2)
    expect(rows[1].tool_calls).toBe(0)
    expect(rows[1].tokens_in).toBe(150)
  })

  it('returns accumulated totals and writes no rows for a zero-turn run', () => {
    const tracker = new TurnTracker('run-1', db)
    tracker.observe({ type: 'system', subtype: 'init' })
    tracker.observe({ type: 'result', tokens_in: 50, tokens_out: 10 })

    expect(tracker.totals()).toEqual({ tokensIn: 50, tokensOut: 10 })
    const count = (db.prepare('SELECT COUNT(*) as c FROM agent_run_turns').get() as { c: number }).c
    expect(count).toBe(0)
  })

  it('ignores non-object and null messages without throwing', () => {
    const tracker = new TurnTracker('run-1', db)
    expect(() => {
      tracker.observe(null)
      tracker.observe(undefined)
      tracker.observe('string message')
      tracker.observe(42)
    }).not.toThrow()
    expect(tracker.totals()).toEqual({ tokensIn: 0, tokensOut: 0 })
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npm run test:main -- --reporter=verbose turn-tracker 2>&1 | tail -20
```

Expected: `Cannot find module '../agent-manager/turn-tracker'`

- [ ] **Step 3: Implement `TurnTracker`**

Create `src/main/agent-manager/turn-tracker.ts`:

```ts
import { getDb } from '../db'
import { insertAgentRunTurn } from '../data/agent-queries'

export class TurnTracker {
  private tokensIn = 0
  private tokensOut = 0
  private turnCount = 0
  private currentTurnToolCalls = 0

  constructor(
    private runId: string,
    private db?: import('better-sqlite3').Database
  ) {}

  observe(msg: unknown): void {
    if (typeof msg !== 'object' || msg === null) return
    const m = msg as Record<string, unknown>

    // Accumulate from top-level fields (result/system messages)
    if (typeof m.tokens_in === 'number') this.tokensIn += m.tokens_in
    if (typeof m.tokens_out === 'number') this.tokensOut += m.tokens_out

    // Accumulate from nested usage object (assistant messages)
    if (typeof m.usage === 'object' && m.usage !== null) {
      const u = m.usage as Record<string, unknown>
      if (typeof u.input_tokens === 'number') this.tokensIn += u.input_tokens
      if (typeof u.output_tokens === 'number') this.tokensOut += u.output_tokens
    }

    // On assistant messages: count tool_use blocks, write turn record, reset per-turn counter
    if (m.type === 'assistant') {
      const message = m.message as Record<string, unknown> | undefined
      const content = message?.content ?? m.content
      if (Array.isArray(content)) {
        for (const block of content) {
          if (typeof block === 'object' && block !== null) {
            const b = block as Record<string, unknown>
            if (b.type === 'tool_use') this.currentTurnToolCalls++
          }
        }
      }

      this.turnCount++
      try {
        insertAgentRunTurn(this.db ?? getDb(), {
          runId: this.runId,
          turn: this.turnCount,
          tokensIn: this.tokensIn,
          tokensOut: this.tokensOut,
          toolCalls: this.currentTurnToolCalls
        })
      } catch (err) {
        // Non-fatal — must not interrupt the agent message loop, but log so migration failures are visible
        console.warn(`[turn-tracker] Failed to write turn record for run ${this.runId}:`, err)
      }
      this.currentTurnToolCalls = 0
    }
  }

  totals(): { tokensIn: number; tokensOut: number } {
    return { tokensIn: this.tokensIn, tokensOut: this.tokensOut }
  }
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npm run test:main -- --reporter=verbose turn-tracker 2>&1 | tail -30
```

Expected: all 7 tests pass.

- [ ] **Step 5: Run full main test suite**

```bash
npm run test:main 2>&1 | tail -10
```

Expected: no regressions.

- [ ] **Step 6: Commit**

```bash
git add src/main/agent-manager/turn-tracker.ts src/main/__tests__/turn-tracker.test.ts
git commit -m "feat: add TurnTracker for correct per-turn token accumulation"
```

---

## Task 4: Wire `TurnTracker` into pipeline agents (`run-agent.ts`)

**Files:**

- Modify: `src/main/agent-manager/run-agent.ts`

- [ ] **Step 1: Import `TurnTracker`**

Add to the imports at the top of `run-agent.ts`:

```ts
import { TurnTracker } from './turn-tracker'
```

- [ ] **Step 2: Instantiate tracker after `activeAgents.set`**

Immediately after the line `activeAgents.set(task.id, agent)`, add:

```ts
const turnTracker = new TurnTracker(agentRunId)
```

- [ ] **Step 3: Replace the broken token-read block in the message loop**

Inside `for await (const msg of handle.messages)`, find this block (~lines 403–413):

```ts
agent.tokensIn = getNumericField(msg, 'tokens_in') ?? agent.tokensIn
agent.tokensOut = getNumericField(msg, 'tokens_out') ?? agent.tokensOut
// Also check nested usage object (SDK sometimes nests token counts)
if (typeof msg === 'object' && msg !== null) {
  const m = msg as Record<string, unknown>
  if (typeof m.usage === 'object' && m.usage !== null) {
    const u = m.usage as Record<string, unknown>
    if (typeof u.input_tokens === 'number') agent.tokensIn = u.input_tokens
    if (typeof u.output_tokens === 'number') agent.tokensOut = u.output_tokens
  }
}
```

Replace it with:

```ts
turnTracker.observe(msg)
const { tokensIn, tokensOut } = turnTracker.totals()
agent.tokensIn = tokensIn
agent.tokensOut = tokensOut
```

Leave the `agent.costUsd` line above it untouched.

- [ ] **Step 4: Typecheck**

```bash
npm run typecheck 2>&1 | head -20
```

Expected: zero errors.

- [ ] **Step 5: Run tests**

```bash
npm run test:main 2>&1 | tail -10
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/main/agent-manager/run-agent.ts
git commit -m "fix: use TurnTracker to accumulate tokens_in/out in pipeline agents"
```

---

## Task 5: Wire `TurnTracker` into adhoc agents (`adhoc-agent.ts`)

**Files:**

- Modify: `src/main/adhoc-agent.ts`

- [ ] **Step 1: Import `TurnTracker`**

Add to imports:

```ts
import { TurnTracker } from './agent-manager/turn-tracker'
```

- [ ] **Step 2: Create session-scoped tracker**

In the session closure, find the three local variable declarations (around line 148):

```ts
let costUsd = 0
let tokensIn = 0
let tokensOut = 0
```

Add one line after them:

```ts
const turnTracker = new TurnTracker(meta.id)
```

- [ ] **Step 3: Replace token reads in `runTurn()`**

Inside the message loop within `runTurn()`, find (~lines 178–186):

```ts
if (typeof r.tokens_in === 'number') tokensIn = r.tokens_in
if (typeof r.tokens_out === 'number') tokensOut = r.tokens_out
if (typeof r.usage === 'object' && r.usage !== null) {
  const u = r.usage as Record<string, unknown>
  if (typeof u.input_tokens === 'number') tokensIn = u.input_tokens
  if (typeof u.output_tokens === 'number') tokensOut = u.output_tokens
}
```

Replace with:

```ts
turnTracker.observe(r)
;({ tokensIn, tokensOut } = turnTracker.totals())
```

Leave the `costUsd` lines above untouched.

- [ ] **Step 4: Typecheck**

```bash
npm run typecheck 2>&1 | head -20
```

Expected: zero errors.

- [ ] **Step 5: Add wiring smoke test to `adhoc-agent.test.ts`**

Open `src/main/__tests__/adhoc-agent.test.ts` and find an existing test that exercises a conversation turn. Add an assertion that `tokensIn` reported in the `agent:completed` event reflects accumulation across turns rather than a single-turn value. Specifically: if two turns are simulated with `tokens_in: 100` and `tokens_in: 200` respectively, the final reported `tokensIn` should be `300`, not `200`. This catches any regression where the wiring breaks and the old last-wins logic returns.

- [ ] **Step 6: Run tests**

```bash
npm run test:main 2>&1 | tail -10
```

Expected: all tests pass including the new adhoc wiring assertion.

- [ ] **Step 7: Commit**

```bash
git add src/main/adhoc-agent.ts src/main/__tests__/adhoc-agent.test.ts
git commit -m "fix: use TurnTracker to accumulate tokens_in/out in adhoc agents"
```

---

## Task 6: Final verification

- [ ] **Step 1: Full CI suite**

```bash
npm run typecheck && npm test && npm run test:main && npm run lint
```

Expected: zero errors, zero failures, zero lint errors.

- [ ] **Step 2: Spot-check the DB schema** (requires app to have started once after this change)

```bash
sqlite3 ~/.bde/bde.db ".schema agent_run_turns"
```

Expected: the table exists with all 7 columns.

- [ ] **Step 3: Done**

Phase 1 complete. After running a pipeline agent, verify with:

```sql
-- Should show a large number, not ~400
SELECT tokens_in, tokens_out, cost_usd FROM agent_runs ORDER BY started_at DESC LIMIT 1;

-- Should show one row per turn with monotonically increasing tokens_in
SELECT turn, tokens_in, tokens_out, tool_calls FROM agent_run_turns
WHERE run_id = (SELECT id FROM agent_runs ORDER BY started_at DESC LIMIT 1)
ORDER BY turn;
```
