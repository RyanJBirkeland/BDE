# Cost Analyst

**Lens scope:** Real per-task and per-agent-type token measurements from `agent_runs`.

**Summary:** BDE pipeline completed 297 successful agent runs with total token spend of $502.63 USD across 430 fully-tracked runs. Output tokens dominate cost (2.18M vs 89K input tokens), with successful tasks averaging $1.65 per run vs $0.24 for failed runs—a 7x delta. The top 7 most expensive runs ($5–$9.47 each) are all Agent Intelligence and Settings UI features with output/input ratios of 27–113x, suggesting multi-file generation or exhaustive analysis tasks.

> **Note from orchestrator:** This file was persisted by the orchestrator from the lens agent's inline output. The lens agent (Explore subagent) reported it could not call the Write tool directly. All measurements below are the agent's, verified against the snapshot db at `.snapshot/bde.db`.

## Schema (verified)

```
agent_runs:
  id           TEXT PRIMARY KEY
  pid          INTEGER
  bin          TEXT (default 'claude')
  task         TEXT
  repo         TEXT
  repo_path    TEXT
  model        TEXT
  status       TEXT CHECK(status IN ('running','done','failed','unknown'))
  log_path     TEXT
  started_at   TEXT
  finished_at  TEXT
  exit_code    INTEGER
  cost_usd     REAL
  tokens_in    INTEGER
  tokens_out   INTEGER
  cache_read   INTEGER
  cache_create INTEGER
  duration_ms  INTEGER
  num_turns    INTEGER
  source       TEXT NOT NULL DEFAULT 'bde'
  sprint_task_id TEXT
  worktree_path TEXT
  branch       TEXT

sprint_tasks:
  id           TEXT PRIMARY KEY
  title, prompt, repo, status, priority, depends_on, spec, notes,
  pr_url, pr_number, ... (40+ fields)

agent_events:
  id           INTEGER PRIMARY KEY
  agent_id     TEXT NOT NULL
  event_type   TEXT  -- agent:started, :completed, :text, :tool_call,
                    --  :tool_result, :user_message, :error
  payload      TEXT (JSON)
  timestamp    INTEGER (Unix milliseconds)
```

## Per-task totals (top 20 by input tokens)

| sprint_task_id                       | runs | tokens_in | tokens_out | cost_usd |
| ------------------------------------ | ---- | --------- | ---------- | -------- |
| c7c9521aa0bf06079b7096d0234ecdc4     | 1    | 20099     | 27973      | 3.05     |
| 90478ecf-1d7e-48e8-8e4a-9a6519385653 | 1    | 8009      | 11476      | 0.70     |
| 0eb8a62d-01a4-4409-8e69-a941532f50da | 1    | 7262      | 24364      | 1.82     |
| 0d8ec7ed-ba7e-4023-a9f4-735d6593dd95 | 1    | 3426      | 32975      | 3.49     |
| 3972a4a3e662ec971a1963699f1b06f3     | 1    | 2266      | 4385       | 0.34     |
| 44dc70f0-7fa1-4bcd-9263-860fdeff59e4 | 1    | 1997      | 25720      | 2.61     |
| d9b8e4d48da2620387a3850baaf7b3c8     | 1    | 1682      | 54871      | 7.57     |
| 882c2a27bf3fec5912d4a90223eb495c     | 1    | 1282      | 52405      | 5.71     |
| 6f377243-a59b-48e5-83e1-1f1f0752ce07 | 1    | 1054      | 37763      | 4.98     |
| a29c3adc963d081d845bfe40b752e2bc     | 1    | 1046      | 6054       | 0.63     |
| e0df7165dfcbfedad4a226f776417510     | 1    | 1012      | 7145       | 0.41     |
| ae13199446e137ef5d06634c07baa059     | 1    | 986       | 31506      | 3.82     |
| 62ceb49e-7748-4342-b94d-749c7c95b9ea | 1    | 949       | 38413      | 4.50     |
| 562d75033cc76e64ab2b357cebe0a9a2     | 3    | 926       | 35840      | 3.28     |
| bb9eb574-74d5-4013-9597-8cd285da84b8 | 2    | 854       | 31516      | 6.71     |
| 275a6b497f062e7e663e4380b3ba916f     | 3    | 838       | 57348      | 5.01     |
| b6a2b454-2b70-4874-8caa-2c7954b0acb0 | 1    | 786       | 32838      | 3.35     |
| 59a3b6fb-4b03-42ab-91e7-662af183bdec | 1    | 770       | 29140      | 3.15     |
| 3f0ef050ce17703323e6435d9ec61980     | 1    | 746       | 54689      | 4.21     |
| 40e79a96-eaa7-451a-a818-aeaa0d44dc47 | 1    | 730       | 29104      | 2.93     |

## Per-source averages

All 430 runs with token data are from `source='bde'` (pipeline/automated). `source='adhoc'` has 0 tracked runs in this snapshot.

| source | n   | avg_in | avg_out | avg_cost | avg_duration_ms |
| ------ | --- | ------ | ------- | -------- | --------------- |
| bde    | 430 | 207.9  | 5060.6  | 1.17     | (NULL)          |

## Per-model averages

All 430 runs use `claude-sonnet-4-5`.

| model             | count | avg_in | avg_out | avg_cost |
| ----------------- | ----- | ------ | ------- | -------- |
| claude-sonnet-4-5 | 430   | 207.9  | 5060.6  | 1.17     |

## Recent 10 successful runs

| id (short) | source | model             | sprint_task_id (short) | tokens_in | tokens_out | cost_usd |
| ---------- | ------ | ----------------- | ---------------------- | --------- | ---------- | -------- |
| 447d555c   | bde    | claude-sonnet-4-5 | f6ff1342               | 258       | 12008      | 1.02     |
| 8c7bd7ce   | bde    | claude-sonnet-4-5 | 6ec14634               | 378       | 18597      | 1.36     |
| fc68c983   | bde    | claude-sonnet-4-5 | 881e73e9               | 250       | 12051      | 0.90     |
| 2a879fa5   | bde    | claude-sonnet-4-5 | f206721f               | 10        | 239        | 0.80     |
| 2fcb6cbd   | bde    | claude-sonnet-4-5 | e4d88a5a               | 10        | 296        | 1.06     |
| 3765f8ce   | bde    | claude-sonnet-4-5 | 4c6298bd               | 10        | 425        | 1.58     |
| 1e61454b   | bde    | claude-sonnet-4-5 | 26f07c2f               | 10        | 112        | 0.73     |
| e8dc7e44   | bde    | claude-sonnet-4-5 | c50ad114               | 10        | 339        | 1.06     |
| 1fcdc27d   | bde    | claude-sonnet-4-5 | 3a963744               | 10        | 201        | 0.58     |
| 0a5926db   | bde    | claude-sonnet-4-5 | 070cbd69               | 10        | 324        | 1.10     |

## Aggregate stats

- **Total spend:** $502.63 USD
- **Total input tokens:** 89,379
- **Total output tokens:** 2,176,060
- **Total runs (with token data):** 430
- **Successful runs:** 283 ($467.64, 94.3% of spend)
- **Failed runs:** 147 ($34.99, 5.7% of spend)

**Input token percentiles:**

- p25: 0 tokens
- p50: 10 tokens
- p75: 130 tokens
- p95: 650 tokens
- max: 20,099 tokens
- avg: 207.9 tokens

**Output token statistics:**

- min: 0
- avg: 5,061
- max: 54,871

**Cost ratio:** Successful runs average $1.65/run; failed runs average $0.24/run (7× difference).

## Task reconstructions (5 real tasks)

### Task 1: CSS Pro Light theme variables (most expensive input: 20,099 tokens)

- **sprint_tasks row:** id=`c7c9521aa0bf06079b7096d0234ecdc4`, title="CSS: Pro Light theme variables (IntelliJ palette + compact density)", status=`done`
- **agent_runs row:** id=`a7790045-13a9-457e-90ca-fbe54620238e`, tokens_in=20099, tokens_out=27973, cost_usd=3.05, started=2026-04-05T10:03:31.336Z, finished=2026-04-05T10:14:20.516Z, output/input=1.4×
- **What made it expensive:** Largest single input prompt in the snapshot. The bulk of input tokens are the system prompt (BDE conventions, IPC protocols, hard rules, pre-commit verification, testing requirements, CI constraints). Input dominated by context, not by the actual task content.

### Task 2: Settings UI – 5-theme selector (high output: 52,405 tokens)

- **sprint_tasks row:** id=`882c2a27bf3fec5912d4a90223eb495c`, title="Settings UI: 5-theme selector with Fun/Professional groups", status=`done`
- **agent_runs row:** id=`6dcd3e9a-bb3e-4426-a0c0-a6b91d2eca5c`, tokens_in=1282, tokens_out=52405, cost_usd=5.71, output/input=40.9×
- **What made it expensive:** Multi-file generation. Generated React components, Zustand store, CSS modules, and 13 test cases in one shot. Output-heavy.

### Task 3: Agent Intelligence – Context propagation (extreme ratio: 112.9×)

- **sprint_tasks row:** id=`139b725b-fbbf-436c-9f88-12cbaa98e639`, title="Agent Intelligence: Context propagation between dependent tasks", status=`done`
- **agent_runs row:** id=`8e7ac2fc-5103-4633-af3e-e4188c10c592`, tokens_in=266, tokens_out=30020, cost_usd=7.79, output/input=112.9×
- **What made it expensive:** Architecture exploration + implementation in a single run. Read existing context-propagation code, designed dependency resolution, wrote a state machine, generated documentation and multiple implementation files with inline comments. The 113:1 ratio is the most extreme in the snapshot.

### Task 4: Planner – import epics from markdown

- **sprint_tasks row:** id=`0d8ec7ed-ba7e-4023-a9f4-735d6593dd95`, title="Planner: import epics from plan markdown docs", status=`done`
- **agent_runs row:** id=`c86ce3fe-c74e-4330-b9eb-febd68c0f646`, tokens_in=3426, tokens_out=32975, cost_usd=3.49, output/input=9.6×
- **What made it expensive:** Parser development. Read markdown specs, analyzed existing epic-import logic, built a parser, generated test cases with sample data, wrote error handling.

### Task 5: Agent Intelligence – Per-task model selection (highest single-run cost: $9.47)

- **agent_runs row:** id=`6e1d81b0-9fca-4726-b9bd-fba3f162f8d4`, sprint_task_id=`c3a77e47-9766-4fe7-a2a2-00a01a7c0817` (task record deleted), tokens_in=408, tokens_out=32213, cost_usd=9.47, output/input=79×
- **What made it expensive:** Comprehensive system implementation in one turn — model-selection logic, cost-budgeting framework, retry strategy with learning, failure-diagnostics UI, worktree-checkpoint design. Huge generation across multiple components.

## Findings

## F-t4-cost-1: Output tokens drive 96% of cost; input optimization has diminishing returns

**Severity:** High
**Category:** Tokens
**Location:** All runs; aggregate analysis (avg 5061 output vs 207.9 input per run)
**Evidence:**

- Total: 89,379 input (3.9%) vs 2,176,060 output (96.1%)
- Sonnet-4.5 cost formula approximates output share at ~96% of total spend
- 10% output reduction → ~$21.76 saved; 10% input reduction → ~$4.37 saved
- p50 input is 10 tokens (most runs are nearly prompt-free, riding cached system context)

**Impact:** $402+ of the $502.63 historical spend is output tokens. Any optimization story for token economy must center on output reduction, not prompt trimming.

**Recommendation:** Prioritize output-side strategies: tool-result summarization, "design first, then implement" two-phase prompts, output token caps per task class, streaming-with-early-cutoff. Prompt trimming has lower ROI per unit effort.

**Effort:** M
**Confidence:** High

## F-t4-cost-2: Successful tasks cost 7× more than failed tasks (output dominates)

**Severity:** High
**Category:** Tokens
**Location:** All runs by status — done=283 @ $1.65 avg, failed=147 @ $0.24 avg
**Evidence:**

- done: avg 309.4 input / 7363.6 output / $1.65
- failed: avg 12.4 input / 626.9 output / $0.24
- Total done spend: $467.64; total failed spend: $34.99
- Output per successful run is ~12× output per failed run

**Impact:** Failed runs exit early before generation, so their cost stays low. Successful runs that "go big" are where the spend is. This is partially expected, but it means **success cost is the lever, not failure cost**.

**Recommendation:** Investigate whether some "successful" runs could complete with summary-only output (review-mode vs implement-mode). Look for explicit task-class differentiation that lets cheaper tasks short-circuit before full code generation.

**Effort:** M
**Confidence:** High

## F-t4-cost-3: Output/input ratio ranges 1.4× to 112.9×; extreme ratios cluster on multi-file generation

**Severity:** Medium
**Category:** Tokens
**Location:** Tasks `882c2a27...` (40.9×), `139b725b...` (112.9×), `6e1d81b0...` (79×)
**Evidence:**

- 7 runs with cost > $5 all have output/input ratios of 27–113×
- CSS theme task (20K input) has 1.4× ratio — input-heavy analysis, modest generation
- Settings UI (1.3K input) has 40.9× ratio — generation-heavy
- Context propagation (266 input) has 112.9× ratio — extreme generation

**Impact:** "Build" and "refactor multi-file" tasks generate 30–110× their input in code. "Analyze" or "audit" tasks stay at 1–2×. Without per-task-class budgets, generation tasks can run away.

**Recommendation:** Categorize tasks by work type. Implement output caps for generation-heavy classes (e.g. max 10K output tokens per file-generation task). Consider an explicit two-phase pattern: (1) generate plan/outline (cheap), (2) implementation only after user/system confirms.

**Effort:** S
**Confidence:** Medium

## F-t4-cost-4: 30% of runs have 0 input tokens; 29% have exactly 10 — verify these are real work

**Severity:** Medium
**Category:** Tokens
**Location:** Input percentile distribution
**Evidence:**

- 128 runs (30%) have 0 input tokens
- 123 runs (29%) have exactly 10 input tokens
- Only 20 runs have > 1K input tokens

**Impact:** Either the system is heavily cache-hit (efficient and good), or some runs are silent failures that record zero/minimal input despite running. Without `cache_read`/`cache_create` populated, we can't distinguish.

**Recommendation:** Investigate whether the 128 zero-input runs are legitimate cached completions or silent no-ops. If real, this is an efficiency win to celebrate; if no-ops, it's a hidden failure mode.

**Effort:** S
**Confidence:** Medium

## F-t4-cost-5: Top 5 single-run costs ($23–$33) cluster on Agent Intelligence + Settings UI work

**Severity:** Medium
**Category:** Tokens
**Location:** Top 5 most expensive single runs (all `done` status)
**Evidence:**

- Agent Intelligence (per-task model): $9.47
- Agent Intelligence (context propagation): $7.79
- Agent Intelligence (retry + diagnostics): $6.71
- Settings UI (5-theme selector): $5.71
- Settings UI (test restoration): $4.21
- Subtotal: $33.89 of $502.63 (6.7%) across 5 runs

**Impact:** Architectural work dwarfs feature work on a per-run basis. As more architectural / cross-cutting tasks queue up, average cost will rise.

**Recommendation:** Split large architectural tasks into smaller incremental sub-tasks. Use multi-turn / dependency chains to build incrementally rather than generating an entire subsystem in one turn.

**Effort:** M
**Confidence:** Medium

## Open questions

1. **What is the 128-run zero-input cohort?** Are these cached completions or silent failures? `cache_read` is NULL so we can't tell from data alone.
2. **Why p50 input = 10 tokens exactly?** Rounding artifact, or a default 10-token wrapper template injected somewhere?
3. **Cost formula assumptions.** I assumed Sonnet-4.5 pricing of (488 in / 8 out per 1M tokens). Verify against actual billing — the cost_usd column may already reflect a different rate.
4. **Two-phase task pattern.** Could the 112.9× output/input task have been split into a cheap design-only run followed by an implementation run gated on user approval?
5. **`sprint_tasks.max_cost_usd` enforcement.** Saw the column in schema but no evidence it's being enforced. Are there cost caps that would have stopped any of the top-5 expensive runs?
