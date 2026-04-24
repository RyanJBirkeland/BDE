# Pipeline Painpoints — RCA on the 2026-04-22 → 2026-04-24 dogfood window

**Audit data:** 31 terminal-state tasks, 170 agent runs, all from `~/.bde/bde.db`.
**Method:** static spec scoring + agent-event-based failure classification.
**Companion artifacts:** [`audit.json`](./audit.json), [`audit-raw.txt`](./audit-raw.txt), [`rca_audit.py`](./rca_audit.py).

> **Headline:** the dominant cost driver in this window was **system instability**, not prompt quality. The packaged-app PATH bug killed 22+ runs across 8 distinct tasks. Of the remaining "real" failures, the strongest signal is that **the 75-turn cap is the binding constraint for any non-trivial task** — and 23 of 31 specs would arguably qualify for the higher budget but lacked the `## Multi-File: true` header. So the prompting *gap* is real, but the *cost* of that gap is amplified by the system having no UI surface to flag it.

---

## 1. The original 6 painpoints, scored against data

| # | Painpoint | Verdict | Evidence |
|---|-----------|---------|----------|
| 1 | Turn budget starvation — missing Multi-File header | **Confirmed, but smaller than claimed** | Only 7/31 specs had the header. 23 lacked it but had ≥3 file paths or `## Files to Change` (qualifies as "obviously multi-file"). T-12 hit max_turns once cleanly; the other "5 max-turn exhaustions" were mostly env-bug failures, not turn starvation. **Real impact: 1 confirmed out_of_turns death; many more "almost-deaths" where tasks succeeded only by hitting exactly 76 turns.** |
| 2 | T-9 god class genuinely too large | **Disconfirmed at the head, but real risk in the tail** | T-9 succeeded on 6 of 7 runs (16, 76, [failed], 50, 47, 76, 45 turns). The "4 consecutive failures" claim isn't visible in `agent_runs` — what's visible is many `active→queued` cycles, suggesting watchdog resets or revision requests rather than fast-fails. The spec was 956 words, 10 sections, had the Multi-File header — it was within bounds. **However, the recovery pattern (multiple re-spawns, 6 of 7 hitting >=45 turns) means it was operating right at the edge.** |
| 3 | `cancelled → done` is a state machine dead-end | **Confirmed — by design** | `src/shared/task-state-machine.ts:80-90` makes `cancelled` a true sink (empty allowed-set). `done → cancelled` is the only transition into that sink. There is no "I implemented this manually" recovery path. Only 1 task (T-9 manual SQL) hit this in the dogfood, but the *design* is the issue. |
| 4 | Test expectations encode old behavior tightly | **Out of scope for data audit** | Code-review-pattern issue, not measurable in `bde.db`. Recent commits show this is real (T-12 broke tests on adding parseArgs). Worth a separate review, not an experiment. |
| 5 | `_-prefixed` fields as de facto test API | **Out of scope for data audit** | Same as #4 — design observation, not measurable from runs. |
| 6 | exactOptionalPropertyTypes friction | **Out of scope for data audit** | Same. |

So #1, #2, and #3 are testable from data; #4-#6 are design observations that don't need an experiment.

---

## 2. What the data actually says

### 2.1 Failure mode distribution (n=170 runs, 31 tasks)

```
Successes by run:                ~94 (20 distinct tasks marked done)
env_cli_not_found:               22 runs across 8 tasks  ← biggest cost
silent failures (started+died):   2 tasks, ~10min each   ← also env-shaped
out_of_turns (real):              1 task confirmed
user_cancelled_no_run:            8 tasks (queue cleanup; not a failure)
user_cancelled_after_success:     7 tasks (review-stage discard; not a failure)
```

The dominant "failure" class is **environmental**, not prompt-related: the packaged `BDE.app` couldn't find its bundled `node`, so the SDK threw `Stream interrupted: Claude Code executable not found at .../BDE.app/Contents/Resources/app.asar.unpacked/node...` before the agent ever read the prompt. CLAUDE.md already documents this in the Packaging section (the node-auto-detection mitigation), but the dogfood window apparently had ~22 runs that hit it before the mitigation took effect or while running an older build.

### 2.2 Turn distribution of *successful* runs

```
≤20 turns:   5
21-30 turns: 56  ← natural completion point for small tasks (PR-5 noted 21-turn cluster)
31-50 turns: 3
51-70 turns: 3
71-76 turns: 37  ← multi-file tasks bumping the 75-turn cap
```

The bimodal distribution is the story. Small tasks finish in ~21 turns. Multi-file tasks finish in ~76. **There is no middle ground**, and the 75-turn cap is not a safety net — it's the operating point.

### 2.3 Header gap (the actionable finding)

| Spec class | Count |
|---|---|
| Has `## Multi-File: true` | 7 |
| No header but obviously multi-file (≥3 file paths or `## Files to Change`) | 23 |
| No header and truly small (1-2 files) | 1 |

23 of 31 tasks lacked the header but probably needed it. The auto-detection in `computeMaxTurns` (`.tsx`+`.css` OR ≥3 `src/` substrings) caught **zero** of them — because most BDE specs use bare paths like `agent-manager/foo.ts` rather than `src/main/agent-manager/foo.ts`. **The heuristic is too literal**.

### 2.4 Cost

| Bucket | Spend |
|---|---|
| All runs in window | $73.83 |
| Successful runs | $70.91 |
| Confirmed out_of_turns | $2.91 |
| env_cli_not_found | $0 (failed before billing) |

Cost-wise, the env bug was free; the turn-budget bug was small. The real cost is **wall time and developer trust** — the 22 env-failed runs each consumed a watchdog cycle and looked like agent failures in the UI.

---

## 3. The system-vs-prompting question

Re-framed against data:

**System gaps (high cost, system-fixable):**
- **Packaged-app `node` PATH bug**: 22 lost runs, 8 affected tasks. Already partially mitigated per CLAUDE.md's "Node auto-detection" note, but the dogfood window suggests the mitigation isn't covering all cases.
- **75-turn cap is binding for almost every multi-file task**: 37 successful runs hit ≥71 turns. Tasks that need 80 turns die silently.
- **Auto-detection of multi-file specs is too literal**: 23 specs that listed multiple files explicitly didn't trigger the 50-turn budget because they didn't use the literal string `src/`.
- **No spec linter / pre-queue warning**: zero feedback to the user when a spec lacks the header it needs.
- **`cancelled` is an absolute sink**: no escape hatch when the user manually fixes a task that the pipeline gave up on.

**Prompting gaps (smaller cost, author-fixable):**
- T-12 specifically lacked the header and would have benefited.
- A few specs use exploration verbs ("Investigate") — minor.
- T-15 [P2]'s notes column was cryptic ("Pipeline reset") — but that's a UX note, not the spec itself.

**Verdict:** The 6 painpoints are **70% system, 30% prompting** in this dataset. Fixing the spec linter (your suggested most-actionable change) would close a real gap, but it's nowhere near the top-cost issue. The top cost is the env bug; #2 is the 75-turn cap being the operating point rather than the safety margin.

---

## 4. Recommended Phase B experiment design (requires your sign-off)

Based on the audit, the highest-leverage controlled experiment is **not** "good spec vs bad spec." That comparison would just confirm what the audit already shows. Instead, the right experiment isolates the **system-level constraint** that the audit flagged as the dominant operating-point pressure: the 75-turn cap.

### Experiment B1 — "Does the cap matter?" (1.5h wall, ~$10 spend)

**Hypothesis:** Multi-file refactor tasks are routinely held back by the 75-turn cap, not by spec quality.

**Setup:** Pick 3 representative refactor tasks from the existing backlog (96 backlog items available). Queue each *twice*:
- **Arm A:** spec as written, default turn budget logic
- **Arm B:** same spec with `## Multi-File: true` AND a one-line `max_runtime_ms` bump in the row (or temporary code patch raising the 75-turn ceiling to 100)

**Measure:** completion rate, `num_turns` distribution, retry count, total cost.

**Decision criterion:**
- If Arm B materially improves completion (e.g., +20% pass rate or -1 average retry), the cap is too low → ship a higher cap or a per-task override UI.
- If Arm B looks identical to Arm A, the cap is well-sized and the problem is elsewhere.

### Experiment B2 — "Does the linter help?" (deferred, dependency on B1)

**Hypothesis:** Specs that the linter would warn about are the ones that fail.

**Setup:** Build the linter as a pure function (no UI yet), run it across the 96 backlog specs, then queue 5 specs the linter flagged as risky. Re-run after applying the linter's suggestions.

**Measure:** Same as B1, plus linter precision/recall.

I'd **start with B1** because B2 only matters if the cap isn't the root cause.

### What I am NOT proposing

- Burning budget on a "good spec vs bad spec" race. Not informative — the audit already shows the spec quality variance is small (29/31 are "good" by the rubric).
- Changing any production code in this RCA branch. The audit is read-only.
- Touching the state machine for painpoint #3 — that's a single low-volume issue, separate fix.

---

## 5. Files in this RCA bundle

- `rca-report.md` — this file
- `audit-raw.txt` — full stdout of the analyzer
- `audit.json` — structured findings, suitable for re-querying
- `rca_audit.py` — the analyzer script (read-only against `~/.bde/bde.db`); rerun with `python3 docs/superpowers/rca-2026-04-24/rca_audit.py /tmp/audit.json`
- `phase-b-experiment-spec.md` — detailed B1 setup (next file)

---

## 6. What I want your decision on (when you're back)

1. **Approve B1** as designed, or change the parameters (different tasks, different cap value, more/fewer arms)?
2. **Skip B1** entirely if you trust the audit's framing — go straight to building the spec linter (low-risk shippable fix)?
3. **Anything else** in the audit that contradicts your read of the dogfood session — I'd especially like to know if the T-9 "4 consecutive failures" recollection points to a time window I missed.
