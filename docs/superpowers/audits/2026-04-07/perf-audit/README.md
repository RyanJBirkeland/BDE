# BDE Performance Audit — 2026-04-07

**Spec:** `docs/superpowers/specs/2026-04-07-perf-audit-design.md`
**Plan:** `docs/superpowers/plans/2026-04-07-perf-audit.md`
**Started:** 2026-04-08T01:18:59Z
**Source repo SHA:** `b4b99d4801777dd44dce1491a2c71ea305b0efa7`
**Branch read by Teams 1-3:** `main` (live working tree at `/Users/ryan/projects/BDE`)
**Audit branch (deliverables):** `chore/perf-audit-2026-04-07` at `~/worktrees/bde/perf-audit`
**Working tree clean at start:** Only one untracked file (`docs/superpowers/specs/2026-04-06-copilot-identity-fix.md`) — irrelevant to audit scope.

## Snapshot

Database snapshotted from `~/.bde/bde.db` (38 MB) to `.snapshot/bde.db` via SQLite online backup API. Integrity check: `ok`. Row counts at snapshot time:

| Table          | Rows  |
|----------------|-------|
| sprint_tasks   | 525   |
| agent_runs     | 500   |
| agent_events   | 31490 |
| cost_events    | 0     |
| task_changes   | 20044 |

All Team 4 (Token Economy) lens agents read from this snapshot, not the live db, so their numbers are mutually comparable.

## In-Flight Plan Correction (Schema Discovery)

The plan's Lens 4.2 (Cost Analyst) was written assuming `cost_events` was the source of truth for per-task token data. Schema discovery during snapshot revealed:

- **`cost_events` is empty (0 rows)** and has a thin schema: `source, session_key, model, total_tokens, cost_usd, recorded_at` — no input/output split, no cache columns. Whatever subsystem was meant to populate it is not running.
- **`agent_runs` is the actual source of truth.** It has `tokens_in`, `tokens_out`, `cache_read`, `cache_create`, `cost_usd`, `duration_ms`, `num_turns`, `sprint_task_id`, `model`, `source`, `status`, `started_at`, `finished_at`. 430 of 500 rows have populated `tokens_in`/`tokens_out`.
- **Agent type discriminator:** `agent_runs.source` is `'bde'` (pipeline agents) or `'adhoc'` (user-spawned). There is no granular discriminator for pipeline vs assistant vs synthesizer — all live under `'bde'`.
- **`cache_read` and `cache_create` are NULL** in recent rows. BDE either does not use prompt caching or does not record it. Lens agents should treat cache savings as unmeasurable from this data.
- **`num_turns` is NULL.** Turn count must be derived from `agent_events` (count `agent:tool_call` + `agent:text` events per `agent_id`) if needed.
- **`agent_events.payload` (TEXT, 31k rows)** is where per-turn content lives. Event types: `agent:tool_call` (24931), `agent:text` (5198), `agent:started` (500), `agent:completed` (464), `agent:tool_result` (175), `agent:error` (160), `agent:user_message` (62).

The Lens 4.x prompts dispatched by the orchestrator have been patched to use `agent_runs` queries with the actual column names. The original plan file is left as-is for historical fidelity — read this README's correction over it.

## Finding F-zero (counts as a finding for Team 3 / Team 4)

The fact that `cost_events` exists, has schema, but is **empty in production after 31k agent events have been recorded** is itself a finding. Some subsystem was wired to populate it and either never ran or was disconnected. Worth investigating during triage.

## How to Read This Audit

The audit produced 10 lens files across 4 teams plus a synthesis. Start with `SYNTHESIS.md`. Drill into lens files for evidence.

### Reading order

1. `SYNTHESIS.md` — top-level prioritized roadmap
2. Lens files referenced by the synthesis (drill in for evidence)
3. Other lens files only if you want to verify the synthesis

### Teams and lenses

| Team | Domain | Lenses |
|------|--------|--------|
| 1 | Pipeline Hot Path | Systems Profiler, Concurrency Auditor, SRE/Ops |
| 2 | Renderer Performance | React Perf, Bundle/Asset |
| 3 | Data Layer | DB Performance, Data Modeling Critic |
| 4 | Token Economy | Prompt Engineer, Cost Analyst, Context Strategist |

### Finding ID format

`F-{team}-{lens-id}-{n}` — globally unique. Example: `F-t1-concur-3`.

## Baseline

Commit `00e32951` (earlier on 2026-04-07) capped vitest worker parallelism inside agent worktrees to `Math.max(1, Math.floor(cpuCount / activeTasks))`. That fix is treated as baseline; this audit hunts for what *else* drives CPU load during a Pipeline run. Team 1 lens agents are explicitly told not to re-report the vitest issue.
