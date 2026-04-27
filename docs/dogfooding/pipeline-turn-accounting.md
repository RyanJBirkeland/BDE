# Pipeline Turn Accounting

## What `num_turns` counts

`num_turns` in the `agent_runs` table counts the number of `assistant`-type messages emitted by
the Claude Agent SDK during a pipeline run. Each assistant message — whether it contains a text
response, tool_use blocks, or both — increments the counter by one. The count is cumulative:
a run that reads three files, edits two, and writes a final summary produces one count per
assistant message regardless of how many tool blocks are inside it.

This is a good proxy for "how many thinking + acting steps the agent took," but it is **not** a
count of individual tool calls. For per-tool granularity, see the `agent_run_turns` table
(`turn`, `tool_calls` columns).

## Write path

1. `TurnTracker.processMessage(msg)` — called for every raw SDK message inside `consumeMessages()`
   via `trackAgentCosts()`. On each `type === 'assistant'` message it increments
   `this.turnCount` and writes one row to `agent_run_turns` with a running token snapshot.
   Source: `src/main/agent-manager/turn-tracker.ts`.

2. `TurnTracker.totals()` — returns `{ turnCount, tokensIn, tokensOut, … }` at run end.

3. `persistAgentRunTelemetry()` — called from `finalizeAgentRun()` in `run-agent.ts` after the
   message loop exits. Reads `turnTracker.totals().turnCount` and passes it as `numTurns` to
   `updateAgentRunCost(db, agentRunId, { numTurns })`.
   Source: `src/main/agent-manager/agent-telemetry.ts`.

4. `updateAgentRunCost()` — issues `UPDATE agent_runs SET … num_turns = ? WHERE id = ?`.
   Source: `src/main/data/agent-queries.ts`.

## Diagnostic finding

`num_turns` is consistently 21 because `consumeMessages()` hard-aborts the stream after the
21st assistant message, and that abort is counted before the stream exits.

The relevant code in `message-consumer.ts`:

```ts
if (m?.type === 'assistant') {
  turnCount++
  if (turnCount > maxTurns) {  // fires when turnCount reaches 21
    handle.abort()
    …
    return { exitCode, lastAgentOutput, streamError: turnsError, pendingPlaygroundPaths }
  }
}
```

The `maxTurns` argument passed here is `MAX_TURNS = 20` (the constant from `spawn-sdk.ts`,
imported in `run-agent.ts` line 30 and threaded into `consumeMessages()` at line 544).

Meanwhile, the SDK itself is spawned with `computeMaxTurns(spec)` (from `turn-budget.ts`), which
returns 30, 50, or 75 depending on spec complexity — never 20. The two limits are therefore
misaligned:

| Layer | Limit value | Source |
|---|---|---|
| SDK `maxTurns` at spawn | 30 / 50 / 75 | `computeMaxTurns()` in `turn-budget.ts` |
| In-process abort guard | 20 | `MAX_TURNS` constant in `spawn-sdk.ts` |

Because `> maxTurns` fires at `turnCount === 21` (after the 21st message has already been
processed by `TurnTracker`), `num_turns` is always 21 for any task that doesn't complete within
20 turns — which, for non-trivial tasks, is most of them.

This is confirmed by the `streamError: new Error('max_turns_exceeded')` path: a `streamError`
triggers `finalizeAgentRun` with `exitCode === undefined`, which `classifyExit` treats as exit
code 1. That failure path may cause unnecessary retries and incorrect task transitions.

## Root cause

**Counting bug + stale constant.** When `turn-budget.ts` was introduced to give pipeline agents
spec-aware turn ceilings (30/50/75), `run-agent.ts` was not updated to pass the computed budget
into `consumeMessages()`. Instead it still passes the old `MAX_TURNS = 20` literal, which
makes the in-process guard fire well before the SDK's own ceiling and reports 21 as the final
turn count on virtually every non-trivial run.

## Recommendation

**Fix: pass the computed `maxTurns` from `spawnAndWireAgent` through to `consumeMessages`.**

`spawnAndWireAgent` already computes `pipelineTuning.maxTurns` via `computeMaxTurns(spec)`.
That value should be returned alongside `agent`, `agentRunId`, and `turnTracker` so `runAgent`
can thread it into `consumeMessages()` instead of the stale `MAX_TURNS` constant.

Concretely:

1. Add `effectiveMaxTurns: number` to the return type of `spawnAndWireAgent`.
2. Return `pipelineTuning.maxTurns` (already computed on line 120 of `spawn-and-wire.ts`).
3. In `runAgent`, replace `MAX_TURNS` with the returned value in the `consumeMessages(…)` call.
4. Remove the `MAX_TURNS` import from `run-agent.ts` — it is only needed in `spawn-sdk.ts` as
   the no-tuning fallback.

This aligns the in-process abort guard with the SDK's actual ceiling, eliminates spurious
`max_turns_exceeded` stream errors, and makes `num_turns` report the real turn usage rather than
a constant 21.
