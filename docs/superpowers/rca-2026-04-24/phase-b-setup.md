# Phase B Setup — what is currently running

**Started:** 2026-04-24, after RCA audit + user approval
**Mode:** 2-arm A/B (header injection only; no code patches; no app restart)

## What I did

1. Selected 5 backlog tasks spanning small/medium refactor scope (per Phase B spec criteria — refactor shape, no dependencies, ≥2 files mentioned in `## Files to Change`).
2. For each, inserted a `[B-arm]` clone into `sprint_tasks` via direct SQL with `## Multi-File: true` prepended to the spec. Clone preserves all other columns (priority, repo, spec_type, etc.).
3. Flipped all 5 originals from `backlog` → `queued`. Clones were inserted directly at `queued`.
4. Drain loop will pick up at WIP=2.

## Pairs

| Pair | Arm A (original) | Arm A id | Arm B (clone) | Arm B id |
|------|------------------|----------|---------------|----------|
| 1 | T-22 escapeXmlContent | `035eebc8…` | `[B-arm] T-22 …` | `c54e1645…` |
| 2 | T-23 propagate disallowedTools | `9164b71c…` | `[B-arm] T-23 …` | `76a42346…` |
| 3 | T-44 orphan recovery before clearStaleClaims | `3616a07c…` | `[B-arm] T-44 …` | `8d551ff8…` |
| 4 | T-47 reset fast_fail_count | `696a21b8…` | `[B-arm] T-47 …` | `e79e2836…` |
| 5 | T-50 redirect fast-fail log | `347fc3a1…` | `[B-arm] T-50 …` | `2badf489…` |

Full ID mapping: see [`phase_b_manifest.json`](./phase_b_manifest.json).

## What you'll see in the UI

- **5 originals** running normally — these are real backlog work. After completion they'll sit in `review` status for normal Code Review Station handling. **Treat them as real merge candidates.**
- **5 [B-arm] clones** also running. **Discard these in Code Review Station** (or wait for me to clean them up — see "Cleanup" below). They exist only for measurement; their git output should not be merged.

## Why this design (not the 3-arm I originally proposed)

The 3-arm design (status quo / header-only / header+cap-raised) needs a temp patch to `turn-budget.ts` and a BDE restart to take effect. Restarting BDE while you're AFK would interrupt your environment. So this pass isolates **header-vs-no-header at the current 75-turn cap** — answers "is the heuristic too literal?" cleanly. If results show Arm B routinely bumps the 76-turn cap, Phase C (cap-raised arm) goes back on the table when you can authorize the restart.

## Measurement plan

Per agent run, capture from `agent_runs` and `agent_events`:
- final status, num_turns, cost_usd, duration_ms
- whether `agent:error message=max_turns_exceeded` fired
- whether `Stream interrupted: ... executable not found` fired (env confound from earlier in the day)

Per pair, the comparison is:
- Arm A pass + Arm B pass + same num_turns → header doesn't matter for this task class
- Arm A fail + Arm B pass → header is the gating factor
- Arm A pass + Arm B pass + Arm B uses noticeably more turns → header buys headroom that's nice-to-have
- Both fail → spec/scope problem, not a turn-budget problem

## Cleanup (will happen in `phase-b-results.md`)

After all 10 reach a terminal state:
1. Cancel + worktree-remove the 5 [B-arm] clones (whether they completed or not)
2. Leave the 5 originals as `review` for your Code Review Station decisions
3. Write `phase-b-results.md` with the cross-tab and recommendation

## Files I have NOT touched

- No source files in `src/`
- No production turn-budget logic (`computeMaxTurns` unchanged)
- No state machine
- No app restart
