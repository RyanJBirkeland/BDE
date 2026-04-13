# Token Instrumentation — Phase 1 Design

**Date:** 2026-04-08  
**Status:** Approved  
**Goal:** Fix broken `tokens_in`/`tokens_out` accumulation and add per-turn token breakdown to understand where input tokens go.

---

## Background

`tokens_in` in `agent_runs` is currently broken: it overwrites on each SDK message instead of accumulating. For a $9.47 run, the stored value was 408 — only the last turn's count. `cost_usd` is accurate because the SDK reports it as a running total. BDE therefore knows how much things cost but not why.

This is Phase 1 of a two-phase token audit:

- **Phase 1 (this spec):** Instrument — fix accumulation, add per-turn breakdown
- **Phase 2 (future):** Optimize — with real data, cut the biggest bloat per agent type

---

## Architecture

### New: `TurnTracker` utility

**File:** `src/main/agent-manager/turn-tracker.ts`

A small class with one job: observe each raw SDK message, accumulate token totals, increment turn counter on assistant messages, and write a turn record to SQLite.

Both pipeline (`run-agent.ts`) and adhoc (`adhoc-agent.ts`) construct a `TurnTracker` and call `tracker.observe(msg)` in their message loops. On completion, `tracker.totals()` returns the accumulated `{ tokensIn, tokensOut }` to replace the current broken reads.

```ts
interface TurnRecord {
  runId: string
  turn: number
  tokensIn: number // running total accumulated up to and including this turn
  tokensOut: number // running total accumulated up to and including this turn
  toolCalls: number // tool_use blocks in this turn only (reset per turn)
}

class TurnTracker {
  constructor(runId: string) {}
  observe(msg: unknown): void // call for every SDK message
  totals(): { tokensIn: number; tokensOut: number }
}
```

**Token field sources:** The tracker extracts token counts from two SDK message shapes, both using `+=` to accumulate:

- `msg.usage.input_tokens` / `msg.usage.output_tokens` (nested usage object, present on assistant messages)
- Top-level `msg.tokens_in` / `msg.tokens_out` (present on some result/system messages)

Both paths can be active on the same message — the tracker adds whatever it finds. The stored `tokensIn` on each turn record is the running total at the moment the turn is written, not a per-turn delta.

**Turn boundary:** An assistant-type message (`msg.type === 'assistant'`) marks the end of a turn. The tracker increments its turn counter, snapshots the current running totals, writes a `agent_run_turns` row, then resets the per-turn `toolCalls` counter to 0.

**Tool call counting:** The tracker counts `tool_use` blocks within each assistant message's content array. This counter is reset to 0 after each turn record is written (so each row reflects only that turn's tool calls). The cumulative token fields are never reset — they grow monotonically across all turns.

**Accumulation fix:** The tracker uses `+=` (not `=`) when extracting tokens — fixing the core bug in both `run-agent.ts` and `adhoc-agent.ts`.

**Completion:** At agent exit, `tracker.totals()` returns the final accumulated `{ tokensIn, tokensOut }`. These values replace the broken per-message reads and are passed to both `agent.tokensIn` / `agent.tokensOut` (used in `emitAgentEvent` for the `agent:completed` event) and to the `updateAgentMeta` call that persists final totals to `agent_runs`.

**Zero-turn runs:** If the agent exits before emitting any assistant message (e.g. auth failure, spawn error), the tracker's turn counter stays at 0 and no `agent_run_turns` rows are written. This is valid — the parent `agent_runs` row will still be written with whatever token data arrived before exit.

**Adhoc session lifetime:** For adhoc/assistant agents, one `TurnTracker` instance is created per session (not per `runTurn()` call). It must be held in the session closure so accumulation survives across turns. `tracker.totals()` is called in `completeSession()` when the user closes the panel — not inside `runTurn()`.

**Dead code note:** `agent_runs` has existing columns `cache_read`, `cache_create`, `num_turns` and a dead `updateAgentRunCost()` function in `agent-queries.ts` that is never called in production. Do not wire these up — they are out of scope for Phase 1.

---

## Database Changes

### New table: `agent_run_turns`

New migration in `src/main/db.ts` (version: current max + 1):

```sql
CREATE TABLE agent_run_turns (
  id          INTEGER PRIMARY KEY,
  run_id      TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  turn        INTEGER NOT NULL,
  tokens_in   INTEGER,   -- cumulative at this turn
  tokens_out  INTEGER,   -- cumulative at this turn
  tool_calls  INTEGER,   -- tool invocations in this turn
  recorded_at TEXT NOT NULL
);
CREATE INDEX idx_agent_run_turns_run ON agent_run_turns(run_id);
```

`tokens_in` is stored as cumulative (not delta) so a partial run is still readable without all turns.

### No changes to `agent_runs` columns

`tokens_in` / `tokens_out` on `agent_runs` keep the same column names — semantics change from "last seen" to "accumulated total." The fix is in the code, not the schema.

### New query functions in `src/main/data/agent-queries.ts`

- `insertAgentRunTurn(db, record: TurnRecord): void` — writes one row
- `listAgentRunTurns(db, runId: string): TurnRecord[]` — returns all turns for a run

---

## Files to Change

| File                                     | Change                                        |
| ---------------------------------------- | --------------------------------------------- |
| `src/main/db.ts`                         | Add migration for `agent_run_turns` table     |
| `src/main/data/agent-queries.ts`         | Add `insertAgentRunTurn`, `listAgentRunTurns` |
| `src/main/agent-manager/turn-tracker.ts` | **New file** — `TurnTracker` class            |
| `src/main/agent-manager/run-agent.ts`    | Replace broken token reads with `TurnTracker` |
| `src/main/adhoc-agent.ts`                | Replace broken token reads with `TurnTracker` |

---

## How to Test

1. Run a pipeline agent task through to completion
2. Query `agent_runs` — `tokens_in` should now be a large number (proportional to cost), not ~400
3. Query `agent_run_turns` for the same `run_id` — should have one row per turn with monotonically increasing `tokens_in` (0-row result is valid for fast-fail/error runs)
4. Verify `tokens_in` on the last turn row is approximately equal to `agent_runs.tokens_in` (minor variance is acceptable if result/system messages contribute tokens after the final assistant message)
5. Unit tests: `TurnTracker` — accumulation across multiple messages, turn boundary detection, tool call counting, zero-turn run produces empty totals without error

---

## Out of Scope

- Phase 2 optimization (prompt trimming, CLAUDE.md audit, context window management)
- UI display of per-turn data (no renderer changes)
- Workbench/copilot/synthesizer/semantic-check token tracking (separate call sites, lower priority)
