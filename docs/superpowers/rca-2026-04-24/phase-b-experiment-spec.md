# Phase B Experiment — Does the 75-turn cap matter?

**Status:** awaiting approval. **Will not run without explicit go-ahead** (real $ spend).

## Hypothesis

Multi-file refactor tasks routinely hit the 75-turn cap as the binding constraint. If we raise the cap, pass rate on the same specs goes up materially. If we don't, the cap is well-sized and prompt-quality / scope is the bottleneck.

This is the **highest-leverage** experiment because the audit (see `rca-report.md`) showed:
- 37 successful runs in the recent window hit ≥71 turns (right at the cap)
- 24 of 31 specs ran on the 30-turn default budget because the auto-detection heuristic (literal `src/` substring match) missed them
- The 23 specs without the header that *should* have had it would, in the experiment's Arm B, get the elevated cap regardless

## Tasks to use

Pick from existing `backlog` (96 candidates available). Selection criteria, in order:

1. **Refactor or test-coverage tasks** (the painful class — narrow features tend to fit in 30 turns naturally)
2. **Spec already written** (avoid confounding "spec quality" with "cap raise")
3. **Touches ≥3 files** (the regime where the cap matters)
4. **No outstanding dependencies** (cleaner execution)

Three concrete candidates from the current backlog (to be confirmed by user, since priorities shift):

| Slot | Search | Why |
|---|---|---|
| Task X | small refactor (3-5 files, 1 source layer) | tests the lower bound — does this even need >75 turns? |
| Task Y | medium refactor (5-8 files, 2+ layers) | the typical T-* / PR-* shape from the dogfood |
| Task Z | test-coverage backfill across a module | distinct profile — lots of similar files, repetitive work |

I'd let you pick the actual three so the experiment uses tasks you actually want done; the result is *also* real merged work, not throwaway.

## Arms

For each of the 3 tasks, queue **two** runs in the same session (interleaved, so any time-of-day variance averages out):

### Arm A — Status quo
- Spec exactly as written
- `computeMaxTurns()` resolves normally (30 / 50 / 75 based on existing heuristics)
- No code changes

### Arm B — Cap raised + header injected
- Same spec, **but** prepend `## Multi-File: true` to the spec text *for this run only* (so it gets the 75-turn budget without modifying the canonical task)
- **Plus** a temporary patch raising `MULTI_FILE_MAX_TURNS` from 75 to 100 in `src/main/agent-manager/turn-budget.ts`. Patch lives only in this RCA worktree; never merged.

To avoid mutating the canonical task row, Arm B will use a **disposable clone** of each task: insert a duplicate row with a `[B-arm]` title prefix and the modified spec, queue that, leave the original alone.

## Measure

Per run, record from `agent_runs` and `agent_events`:
- Final status (`done` / `failed` / `error`)
- `num_turns`
- `cost_usd`
- `duration_ms`
- Whether the run hit `max_turns_exceeded` even at the higher cap

Per task pair, compare:
- Did Arm A pass? Did Arm B pass?
- If both passed: did Arm B use materially fewer or more turns? (Did the higher cap *help*, or just buy headroom that wasn't used?)
- If only Arm B passed: how many turns did it take? (If 76-90, the old cap was the problem. If 91-100, the spec was just hard.)

## Decision criterion

After 3 task pairs (6 total runs):

| Outcome | What it means | Action |
|---|---|---|
| Arm B passes ≥1 task that Arm A failed, AND uses ≥80 turns | **Cap is too low** | Raise default `MULTI_FILE_MAX_TURNS` to 100, or add per-task override UI |
| Both arms pass, similar turn counts | **Cap is fine** | Move on to spec-linter work; cap isn't the bottleneck |
| Both arms fail | **Spec quality is the issue, not the cap** | Build the linter first; revisit cap later with better specs |
| Arm B passes Arm A fails, BUT uses <76 turns | **Header alone is the win, not the cap** | Build the linter (header detector); don't raise the cap |

The fourth row is interesting and likely — it would mean the *header injection* is doing the work, not the +25-turn cap raise. If we see that, the action is unambiguously "ship the linter."

## Cost / time budget

- 6 runs × ~$2 typical = **~$12 expected, $20 ceiling**
- ~30 min wall per run (sequential due to WIP=2 and pre-push hook serialization) → **~3 hours wall**
- Worst case (all 6 hit max): ~5 hours, ~$25

## What I will NOT do without further approval

- Run experiment B2 (linter + queue 5 flagged specs)
- Push the temporary cap-raise patch
- Modify the actual task specs (only disposable clones)
- Run more than 6 runs (3 task pairs)
- Touch the state machine or any production code

## Cleanup after the experiment

- Revert the temporary `turn-budget.ts` patch
- Delete the `[B-arm]` clone task rows
- If any Arm A or Arm B completed real work the user wants to keep, the corresponding worktree stays at `review` status for normal Code Review Station handling

## Why not "good spec vs bad spec"?

Considered and rejected. The audit shows spec quality variance in the recent window is small (29/31 specs scored "good" on the rubric). A "bad spec" arm would be a strawman — we'd have to fabricate badness to create the contrast, and the result would only confirm what's already obvious. The cap-raise experiment, by contrast, manipulates a variable that is *currently a confound* in the data: every multi-file success also hit the cap, so we can't tell from observation alone whether 75 was sufficient or merely "what they had."

## When you approve

Tell me which 3 tasks to use (or "pick for me, I trust the criteria"), and I'll:
1. Apply the temp cap patch in this worktree (no commit to main)
2. Create the 3 [B-arm] clones via direct SQL
3. Queue all 6 runs (3 originals + 3 clones)
4. Babysit the queue and write up results in `phase-b-results.md`
5. Revert the patch and clean up clones

Estimated turnaround once approved: ~4 hours wall, mostly waiting.
