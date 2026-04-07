# Delete the fake estimateCost from the agent console header

## Problem

`ConsoleHeader.tsx` displays a live "estimated cost" in orange italics next to the real `costUsd`. The estimate is fabricated:

```ts
function estimateCost(events: AgentEvent[], model: string): number {
  const perEventCost = model.toLowerCase().includes('opus') ? 0.003 : 0.001
  return events.length * perEventCost
}
```

This is `event count × constant` — it has no relationship to tokens, model pricing, or actual cost. A 30-event run shows "$0.03" while the real cost may be $1.50. Users will reasonably trust the displayed number and make stop/continue decisions on garbage data. Three personas (Bravo PM, Bravo Marketing, Bravo Senior Dev) flagged this independently.

## Solution

Delete `estimateCost`, the `estimatedCost` constant that calls it, and the JSX block that renders it. Leave the real `costUsd` display untouched. When `costUsd` is null (running agent, no final cost yet), simply render nothing — no placeholder, no "—".

Do NOT replace the estimate with another heuristic, token-based estimate, or live SDK usage stream. The audit's recommendation is "delete entirely; show nothing until the real cost arrives." Future work to surface real interim usage is a separate task.

## Files to Change

- `src/renderer/src/components/agents/ConsoleHeader.tsx` — delete:
  - The `estimateCost` function (lines 28-31)
  - The `estimatedCost` const (lines 63-64)
  - The `{estimatedCost != null && (...)}` JSX block in the meta section (lines 155-162)

## How to Test

1. `npm run typecheck` — must pass (the only consumer of `estimateCost` is in this file)
2. `npm test` — must pass; if any test snapshots `ConsoleHeader` output and asserts on the orange "~$X.XX" text, update or remove the assertion
3. `npm run lint` — must pass
4. `grep -r "estimateCost\|estimatedCost" src/` — must return zero matches

## Out of Scope

- Replacing with a real token-usage display (separate future task)
- Changing the rendering of `costUsd` itself
- Renaming the `.dashboard-completion-cost` CSS classes (separate cleanup task)
- Touching the Dashboard token counters
