# BDE Performance Audit — Design Spec

**Date:** 2026-04-07
**Status:** Approved for planning
**Owner:** Ryan

## Background

While running the Sprint Pipeline today, BDE drove the host machine to extremely high CPU loads. Earlier today, commit `00e32951` capped vitest worker parallelism inside agent worktrees because each pipeline agent was spawning CPU-count test workers, producing 24+ concurrent test processes at `MAX_ACTIVE_TASKS > 1` and pushing load averages to 100-141. That fix is treated as baseline for this audit — the goal is to find what _else_ is wrong.

Separately, we have no current visibility into **token economy**: how large is the prompt that goes into each spawned agent, what is the average input/output token usage per task, and where in the prompt-composition path are we wasting context.

This audit covers both dimensions in a single coordinated sweep.

## Goals

1. Identify the remaining CPU/runtime hot paths in the Pipeline beyond the vitest fix.
2. Surface concurrency, polling, and fan-out problems that scale poorly with `MAX_ACTIVE_TASKS`, task volume, or DB size.
3. Quantify token usage per agent type and per task, identify wasted context in `prompt-composer.ts` and auto-loaded files (`CLAUDE.md`, `BDE_FEATURES.md`), and recommend reductions.
4. Produce a single deduped, ranked action roadmap that the user can triage into sprint tasks.

## Non-Goals

- Fixing anything during the audit. This is read-only investigation.
- Auto-queueing sprint tasks. Roadmap items become tasks only after human triage.
- Reactive deep-dives on a specific user-reported bug. This is a structured sweep.
- UX or visual design audit. Performance only.

## Approach

### Team & Lens Structure

Four teams, each examining a domain through 2-3 independent lenses (personas). Each lens runs as one parallel agent, for a total of **10 concurrent read-only audit agents**.

Lenses are independent personas, not collaborators. Two lenses on the same team may surface overlapping findings — the synthesis pass will dedupe.

#### Team 1 — Pipeline Hot Path

**Domain:** Agent drain loop, worktree creation, SDK spawn, completion handler, file watchers, PR pollers, sprint PR poller, watchdog.

**Key files:**

- `src/main/agent-manager/` (entire module)
- `src/main/agent-manager/sdk-adapter.ts`
- `src/main/agent-manager/worktree.ts`
- `src/main/agent-manager/completion.ts`
- `src/main/agent-manager/run-agent.ts`
- `src/main/pr-poller.ts`
- `src/main/sprint-pr-poller.ts`
- `src/main/agent-event-mapper.ts`

**Lenses (scope is non-overlapping by design — see below):**

- **Systems Profiler** — _Single-agent steady-state cost only._ Assume `MAX_ACTIVE_TASKS=1`. Where do CPU cycles go inside one Pipeline run? Synchronous file I/O on hot paths, tight loops, redundant work each tick of the drain loop, blocking calls in async paths, expensive computation per tick. Do NOT analyze multi-agent interactions — that belongs to Concurrency Auditor.
- **Concurrency Auditor** — _Interactions across N concurrent agents only._ Lock contention, fan-out blowups (one event triggers N handlers, doubled by N agents), race-prone polling, watchers that double-fire across agents, shared state corruption, redundant work duplicated across agents that could be shared. Do NOT report findings that exist with one agent — those belong to Systems Profiler.
- **SRE / Ops** — _Scaling cliffs and unbounded resources only._ What happens at `MAX_ACTIVE_TASKS=3`? `=5`? `=10`? What unbounded resources exist (event listeners, cached state, in-memory indexes, log files, db tables)? Do NOT report code-level CPU findings — focus on what grows without bound and where it falls over.

**Baseline for all Team 1 lenses:** Commit `00e32951` already capped vitest worker parallelism to `Math.max(1, Math.floor(cpuCount / activeTasks))` inside agent worktrees. The vitest worker oversubscription issue is _out of scope_ — do not re-report it. The audit hunts for what _else_ drives CPU load during a Pipeline run.

#### Team 2 — Renderer Performance

**Domain:** React re-renders, Zustand subscription granularity, polling hooks, Monaco workers, panel layout, sprint pipeline view, dashboard polling.

**Key files:**

- `src/renderer/src/components/sprint/SprintPipeline.tsx`
- `src/renderer/src/components/dashboard/`
- `src/renderer/src/stores/sprintTasks.ts`
- `src/renderer/src/stores/agentEvents.ts`
- `src/renderer/src/hooks/useBackoffInterval.ts`
- `src/renderer/src/views/IDEView.tsx`
- `src/renderer/src/components/panels/`
- `electron.vite.config.ts` (renderer config + chunking only — main process build is out of scope)
- Monaco worker setup wherever it lives in the renderer
- CSP / `worker-src` configuration in the renderer entry HTML

**Lenses:**

- **React Performance Engineer** — Wasted re-renders, missing memoization, store subscription granularity (component subscribes to whole store vs. selector), expensive derivations recomputed on every render, unstable callback identities.
- **Bundle / Asset Auditor** — Bundle size by route/view, missing lazy-loading, Monaco worker loading strategy, eagerly imported modules that should be code-split, asset weight on cold start.

#### Team 3 — Data Layer

**Domain:** SQLite queries, migrations, file watcher debouncing, audit trail writes, optimistic update reconciliation, WAL contention.

**Key files:**

- `src/main/db.ts`
- `src/main/data/sprint-queries.ts`
- `src/main/data/sprint-task-repository.ts`
- `src/main/data/task-changes.ts`
- `src/main/handlers/sprint-local.ts`
- File watcher emitting `sprint:externalChange`

**Lenses:**

- **Database Performance Engineer** — Query plans, missing indexes, N+1 patterns, repeated queries that could be cached or batched, WAL contention from many concurrent writes during a Pipeline run.
- **Data Modeling Critic** — Write amplification (one user action → N table writes), hot tables, audit-trail bloat (`task_changes` row count growth), `agent_events` cap behavior, schema choices that force expensive reads.

#### Team 4 — Token Economy

**Domain:** Prompt composition, context injection, agent event capture, what every agent is "born" with.

**Key files:**

- `src/main/agent-manager/prompt-composer.ts` — `buildAgentPrompt()`
- `src/main/sdk-streaming.ts`
- `src/main/agent-event-mapper.ts`
- `CLAUDE.md` (project root, auto-loaded)
- `docs/BDE_FEATURES.md` (auto-loaded via `@` directive)
- `~/.bde/bde.db` tables: `agent_events`, `cost_events`, `agent_runs`

**Lenses:**

- **Prompt Engineer** — What is actually in each prompt for each agent type (pipeline / assistant / adhoc / copilot / synthesizer)? What is redundant, duplicated, or never used by the model? Where could we lazy-inject context instead of front-loading it?
- **Cost Analyst** — Average input tokens per task, per agent type. Average output tokens. Breakdown of where the input tokens go (CLAUDE.md, BDE_FEATURES.md, task spec, system prompt, tool definitions). Where the money is going. Must produce real numbers from `~/.bde/bde.db`.
- **Context Window Strategist** — What could be lazy-loaded vs. front-loaded? What is the token budget per task and how much headroom exists? Are we close to context-window cliffs at any agent type?

**Special handling for Team 4:** Findings must be quantitative, not qualitative. Each Token Economy lens agent must:

1. **Use the snapshotted database, not the live one.** Before dispatch, the orchestrator copies `~/.bde/bde.db` to `docs/superpowers/audits/2026-04-07/perf-audit/.snapshot/bde.db` and records the source `git rev-parse HEAD` SHA in the audit `README.md`. All Team 4 agents read the snapshot path so their numbers are mutually comparable.
2. **First, document the schema.** Run `sqlite3 <snapshot> ".schema cost_events"`, `".schema agent_runs"`, `".schema agent_events"` and include the column lists in your output file. This is the source of truth for what columns exist — do not assume.
3. **Run these canonical queries** (adapt column names to actual schema discovered in step 2):
   - **Per-task totals:** `SELECT task_id, SUM(input_tokens), SUM(output_tokens), SUM(cache_read_input_tokens), SUM(cache_creation_input_tokens) FROM cost_events GROUP BY task_id ORDER BY 2 DESC LIMIT 20;`
   - **Per-agent-type averages:** join `cost_events` to `agent_runs` on `run_id` (or whatever the FK is) and `AVG()` by `agent_type`.
   - **Recent-N sample:** the 5 most recent completed pipeline runs with their full token breakdown.
4. **Read `prompt-composer.ts`, `CLAUDE.md`, and `BDE_FEATURES.md`** and estimate their token contribution to each agent type's prompt. The chars/4 heuristic is for _sizing only_ — authoritative numbers come from `cost_events`/`agent_runs`, not from estimation.
5. **Sample 3-5 recent real tasks** from the snapshot and reconstruct what the agent received: which CLAUDE.md files were auto-loaded, which sections of `prompt-composer.ts` ran, how many tool definitions were attached.

### Execution Model

- **Agent type:** `Explore` subagents — read-only by capability, so they cannot modify code or write outside their assigned output file.
- **Isolation:** No worktrees needed (read-only). Agents run against the live repo.
- **Parallelism:** All 10 lens agents dispatched in a single message with 10 concurrent `Agent` tool calls.
- **Briefing:** Each agent receives a self-contained prompt containing:
  - Lens persona (the role they are playing and what they are listening for)
  - The team's domain and explicit file scope
  - The standardized finding format
  - Their assigned output file path
  - Instruction to favor depth over breadth (5-10 strong findings beats 30 shallow ones)
- **No cross-talk:** Lens agents do not coordinate. Overlap is desired and resolved at synthesis.

### Pre-Dispatch Snapshot

The audit runs against a moving target: the live BDE repo and the live `~/.bde/bde.db`. To make findings reproducible and Team 4's numbers mutually comparable across lens agents, the orchestrator performs these steps **before** dispatching any lens agent:

1. Create the audit directory: `docs/superpowers/audits/2026-04-07/perf-audit/.snapshot/`
2. Snapshot the database: `sqlite3 ~/.bde/bde.db ".backup docs/superpowers/audits/2026-04-07/perf-audit/.snapshot/bde.db"` (uses SQLite's online backup API — safe under WAL).
3. Record the repo state: capture `git rev-parse HEAD`, `git status --short`, and the current branch into `docs/superpowers/audits/2026-04-07/perf-audit/README.md` along with the audit start timestamp.
4. Pass the snapshot path to all Team 4 lens prompts. Teams 1-3 read code only and use the live repo (file paths in findings are stable even if code drifts before triage).

### Output Structure

```
docs/superpowers/audits/2026-04-07/perf-audit/
├── README.md                              # index + how to read the audit
├── team-1-pipeline-hot-path/
│   ├── lens-systems-profiler.md
│   ├── lens-concurrency-auditor.md
│   └── lens-sre-ops.md
├── team-2-renderer/
│   ├── lens-react-perf.md
│   └── lens-bundle-asset.md
├── team-3-data-layer/
│   ├── lens-db-perf.md
│   └── lens-data-modeling.md
├── team-4-token-economy/
│   ├── lens-prompt-engineer.md
│   ├── lens-cost-analyst.md
│   └── lens-context-strategist.md
└── SYNTHESIS.md                           # merged, deduped, ranked roadmap
```

### Standardized Finding Format

Every lens output file uses the same finding template so the synthesis agent can parse and dedupe across teams.

```markdown
## F-{team}-{lens-id}-{n}: {short title}

**Severity:** Critical | High | Medium | Low
**Category:** CPU | Memory | I/O | Tokens | Latency | Scaling
**Location:** `path/to/file.ts:123-145`
**Evidence:** What was observed (code excerpt, query, measurement, db row counts)
**Impact:** Why it matters, when it bites (e.g. "at MAX_ACTIVE_TASKS=3", "after 1000 tasks in db")
**Recommendation:** Concrete fix
**Effort:** S | M | L
**Confidence:** High | Medium | Low
```

ID parts are globally unique across the entire audit:

- `{team}` — `t1` | `t2` | `t3` | `t4`
- `{lens-id}` — short slug per lens: `sysprof`, `concur`, `sre`, `react`, `bundle`, `db`, `model`, `prompt`, `cost`, `ctx`
- `{n}` — monotonic integer within the lens file, starting at 1

Example: `F-t1-concur-3`. This guarantees the synthesis agent can reference any finding without collision.

### Synthesis Pass

After all 10 lens agents complete, dispatch **one** general-purpose agent with the full set of 10 finding files. The synthesis agent produces `SYNTHESIS.md` containing:

1. **Top 10 ranked actions** scored on `(severity × confidence) ÷ effort`, with these mappings:
   - **Severity:** Critical = 4, High = 3, Medium = 2, Low = 1
   - **Confidence:** High = 3, Medium = 2, Low = 1
   - **Effort:** S = 1, M = 2, L = 4
   - Score range: best = 12.0 (Critical / High / S), worst = 0.25 (Low / Low / L)
   - Ties broken by Severity first, then Effort (smaller wins).
2. **Cross-cutting themes** — patterns that show up in multiple lenses (e.g. "polling intervals are too aggressive across the board", "audit trail writes are on hot paths").
3. **Quick wins** — high-impact, low-effort items called out as a separate list.
4. **Deferred / out-of-scope** — real findings that are not worth fixing now, with a one-line reason.
5. **Open questions for human** — places where lenses disagreed, evidence was thin, or a measurement was missing.

The synthesis agent does not invent findings. It only merges, dedupes, and ranks what the lens agents produced.

## Risks & Mitigations

| Risk                                                     | Mitigation                                                                                                                   |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Lens agents produce shallow findings to chase coverage   | Brief explicitly says "depth over breadth, 5-10 strong findings"                                                             |
| Token Economy team produces qualitative hand-waving      | Brief mandates real numbers from `~/.bde/bde.db` and sampled tasks                                                           |
| Lens overlap creates noise                               | Synthesis pass explicitly dedupes                                                                                            |
| 10 concurrent agents exhaust user's local API quota      | Acceptable — each agent's individual context is bounded; if quota becomes an issue, fall back to sequential within each team |
| Findings reference stale code by the time triage happens | All findings include file paths + line numbers; user can re-verify before queueing                                           |

## Out of Scope

- Implementing any fixes (this audit is read-only).
- E2E user-perceived latency benchmarks (no harness; would need a separate effort).
- Startup / cold-path audit (would warrant its own team if added later).
- Memory-leak hunting via heap snapshots (requires runtime profiling tools, not static read).
- Comparison against other Electron apps or industry benchmarks.

## Success Criteria

- All 10 lens files exist under `docs/superpowers/audits/2026-04-07/perf-audit/` in the standard format. Target is 5-10 strong findings per lens; fewer is acceptable if the agent can justify it. Quality beats count — the audit is not graded on volume.
- `SYNTHESIS.md` exists with a Top 10 action list, cross-cutting themes, quick wins, and open questions.
- Token Economy lens files contain real numeric measurements pulled from `~/.bde/bde.db`, not just code-reading commentary.
- The user can read `SYNTHESIS.md` and decide which findings to convert into sprint tasks without re-reading the 10 lens files.

## Next Step

Invoke the `superpowers:writing-plans` skill to turn this design into an executable implementation plan that drives the parallel agent dispatch and the synthesis pass.
