# BDE Performance Audit — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run a coordinated read-only performance audit of BDE by dispatching 10 parallel `Explore` subagents organized into 4 teams (Pipeline Hot Path, Renderer, Data Layer, Token Economy), then synthesize their findings into a single ranked roadmap.

**Architecture:** Orchestration plan, not a code change. Pre-dispatch snapshot freezes the live SQLite db and records the git SHA so all agents see comparable state. 10 lens agents dispatched in a single message for true parallelism. After all complete, one synthesis agent merges, dedupes, and ranks findings into `SYNTHESIS.md`.

**Tech Stack:** `Agent` tool with `subagent_type: Explore` (read-only) for lens agents, `subagent_type: general-purpose` for the synthesis agent. SQLite `.backup` for the db snapshot.

**Spec:** `docs/superpowers/specs/2026-04-07-perf-audit-design.md` (read this first if you have not).

---

## Worktree Setup

Per the BDE worktree policy, all branch work must happen in `~/worktrees/bde/`. The audit produces docs commits, so it needs its own branch.

- [ ] **Step 0.1: Create worktree**

```bash
git worktree add -b chore/perf-audit-2026-04-07 ~/worktrees/bde/perf-audit main
```

Expected: new branch created, worktree path printed.

- [ ] **Step 0.2: cd into worktree**

```bash
cd ~/worktrees/bde/perf-audit
```

All subsequent steps run from this directory.

---

## Task 1: Create audit directory scaffolding

**Files:**

- Create: `docs/superpowers/audits/2026-04-07/perf-audit/` (directory)
- Create: `docs/superpowers/audits/2026-04-07/perf-audit/.snapshot/` (directory)
- Create: `docs/superpowers/audits/2026-04-07/perf-audit/team-1-pipeline-hot-path/` (directory)
- Create: `docs/superpowers/audits/2026-04-07/perf-audit/team-2-renderer/` (directory)
- Create: `docs/superpowers/audits/2026-04-07/perf-audit/team-3-data-layer/` (directory)
- Create: `docs/superpowers/audits/2026-04-07/perf-audit/team-4-token-economy/` (directory)

- [ ] **Step 1.1: Create all directories in one shot**

```bash
mkdir -p docs/superpowers/audits/2026-04-07/perf-audit/{.snapshot,team-1-pipeline-hot-path,team-2-renderer,team-3-data-layer,team-4-token-economy}
```

Expected: no output, directories exist.

- [ ] **Step 1.2: Verify**

```bash
ls -la docs/superpowers/audits/2026-04-07/perf-audit/
```

Expected: 5 subdirs (`.snapshot`, `team-1-...`, `team-2-...`, `team-3-...`, `team-4-...`).

---

## Task 2: Snapshot the SQLite database

**Files:**

- Create: `docs/superpowers/audits/2026-04-07/perf-audit/.snapshot/bde.db`

- [ ] **Step 2.1: Verify source db exists**

```bash
ls -la ~/.bde/bde.db
```

Expected: file exists, non-zero size. If missing, STOP and report — the audit cannot proceed without it.

- [ ] **Step 2.2: Snapshot via SQLite online backup API**

```bash
sqlite3 ~/.bde/bde.db ".backup docs/superpowers/audits/2026-04-07/perf-audit/.snapshot/bde.db"
```

Expected: no output. The `.backup` command is safe under WAL mode and produces a consistent copy.

- [ ] **Step 2.3: Verify snapshot integrity**

```bash
sqlite3 docs/superpowers/audits/2026-04-07/perf-audit/.snapshot/bde.db "PRAGMA integrity_check;"
```

Expected: `ok`

- [ ] **Step 2.4: Capture row counts for the README (record output for next task)**

```bash
sqlite3 docs/superpowers/audits/2026-04-07/perf-audit/.snapshot/bde.db "SELECT 'sprint_tasks', COUNT(*) FROM sprint_tasks UNION ALL SELECT 'agent_runs', COUNT(*) FROM agent_runs UNION ALL SELECT 'agent_events', COUNT(*) FROM agent_events UNION ALL SELECT 'cost_events', COUNT(*) FROM cost_events UNION ALL SELECT 'task_changes', COUNT(*) FROM task_changes;"
```

Expected: 5 rows. Save the output — it goes into the README in the next task.

---

## Task 3: Write the audit README index

**Files:**

- Create: `docs/superpowers/audits/2026-04-07/perf-audit/README.md`

- [ ] **Step 3.1: Capture git state and timestamp**

```bash
date -u +%Y-%m-%dT%H:%M:%SZ
git -C /Users/ryan/projects/BDE rev-parse HEAD
git -C /Users/ryan/projects/BDE rev-parse --abbrev-ref HEAD
git -C /Users/ryan/projects/BDE status --short
```

Save all four outputs. Use the **main repo** path, not the worktree — the audit reads code from the live working tree (per spec: Teams 1-3 use the live repo at `/Users/ryan/projects/BDE`).

- [ ] **Step 3.2: Write README.md**

Use the Write tool to create `docs/superpowers/audits/2026-04-07/perf-audit/README.md` with this content (substitute the captured values from Step 3.1 and Step 2.4):

```markdown
# BDE Performance Audit — 2026-04-07

**Spec:** `docs/superpowers/specs/2026-04-07-perf-audit-design.md`
**Started:** <ISO timestamp>
**Repo SHA at start:** `<git rev-parse HEAD output>`
**Branch:** `<branch name>`
**Working tree dirty:** `<yes if git status had output, else no>`

## Snapshot

Database snapshotted from `~/.bde/bde.db` to `.snapshot/bde.db` via SQLite online backup API. Row counts at snapshot time:

| Table        | Rows |
| ------------ | ---- |
| sprint_tasks | <n>  |
| agent_runs   | <n>  |
| agent_events | <n>  |
| cost_events  | <n>  |
| task_changes | <n>  |

All Team 4 (Token Economy) lens agents read from the snapshot, not the live db, so their numbers are mutually comparable.

## How to Read This Audit

The audit produced 10 lens files across 4 teams, each containing severity-ranked findings in the standard format. After all 10 lenses completed, a synthesis agent merged the findings into `SYNTHESIS.md` — start there.

### Reading order

1. `SYNTHESIS.md` — top-level prioritized roadmap
2. Lens files referenced by the synthesis (drill in for evidence)
3. Other lens files only if you want to verify the synthesis

### Teams and lenses

| Team | Domain               | Lenses                                            |
| ---- | -------------------- | ------------------------------------------------- |
| 1    | Pipeline Hot Path    | Systems Profiler, Concurrency Auditor, SRE/Ops    |
| 2    | Renderer Performance | React Perf, Bundle/Asset                          |
| 3    | Data Layer           | DB Performance, Data Modeling Critic              |
| 4    | Token Economy        | Prompt Engineer, Cost Analyst, Context Strategist |

### Finding ID format

`F-{team}-{lens-id}-{n}` — globally unique. Example: `F-t1-concur-3`.

## Baseline

Commit `00e32951` (earlier on 2026-04-07) capped vitest worker parallelism inside agent worktrees. That fix is treated as baseline; the audit hunts for what _else_ drives CPU load during a Pipeline run. Team 1 lens agents are explicitly told not to re-report the vitest issue.
```

- [ ] **Step 3.3: Verify**

```bash
ls -la docs/superpowers/audits/2026-04-07/perf-audit/README.md
```

Expected: file exists, non-zero size.

---

## Task 4: Dispatch all 10 lens agents in parallel

**Critical: this is ONE message containing 10 `Agent` tool calls.** True parallelism requires a single message — sequential dispatch defeats the purpose.

Each lens agent uses `subagent_type: Explore` (read-only by capability). Each prompt is self-contained: no agent needs to read prior session context.

### Shared prompt template

Every lens prompt follows this skeleton:

````
You are auditing BDE (an Electron desktop app at /Users/ryan/projects/BDE) as part of a coordinated performance audit. You are one of 10 parallel lens agents. You will not coordinate with the other 9 — overlap is acceptable and will be deduped at synthesis.

## Your role

You are the **{LENS NAME}** lens for **Team {N} — {TEAM NAME}**.

{LENS PERSONA — what you notice, what you ignore}

## Your scope

{TEAM DOMAIN one-line summary}

Files in scope (read these; do not stray):
{FILE LIST}

{TEAM-SPECIFIC EXCLUSIONS, e.g. baseline commits, other lenses' territory}

## Your output

Write your findings to: `docs/superpowers/audits/2026-04-07/perf-audit/{TEAM DIR}/{LENS FILE}`

Use this exact format for every finding. IDs must use the `F-{TEAM-ID}-{LENS-ID}-{n}` scheme.

```markdown
## F-{team}-{lens}-{n}: <short title>
**Severity:** Critical | High | Medium | Low
**Category:** CPU | Memory | I/O | Tokens | Latency | Scaling
**Location:** `path/to/file.ts:123-145`
**Evidence:** <code excerpt, query, measurement>
**Impact:** <why it matters, when it bites>
**Recommendation:** <concrete fix>
**Effort:** S | M | L
**Confidence:** High | Medium | Low
````

## Quality bar

- **Depth over breadth.** 5-10 strong findings beats 30 shallow ones. Fewer is acceptable if justified.
- **Evidence is mandatory.** Every finding must include a file:line reference and a code excerpt or measurement. "I think this might be slow" with no evidence is not a finding.
- **Be specific about impact.** "When does this bite?" — at one agent? At three? At 1000 db rows? Quantify when you can.
- **Confidence reflects how sure you are.** Low confidence is acceptable for a real lead with thin evidence; mark it Low and move on.

## Output file structure

Begin your output file with a level-1 heading naming the lens, a one-paragraph summary of your overall conclusion, then the findings. Example:

# {Lens Name}

**Lens scope:** <one-line restatement of what you looked for>
**Summary:** <2-4 sentences on the overall health of your domain>

## Findings

<F-...-1>
<F-...-2>
...

## Open questions

<things you wanted to verify but couldn't, or where another lens or a human should follow up>

````

### Path conventions for all lens prompts

**Subagent cwd is unreliable.** Do not use relative paths in any lens prompt. Use these absolute prefixes:

- **Live source code (Teams 1-3 read this):** `/Users/ryan/projects/BDE/`
- **Snapshot db (Team 4 reads this):** `/Users/ryan/worktrees/bde/perf-audit/docs/superpowers/audits/2026-04-07/perf-audit/.snapshot/bde.db`
- **Lens output files:** `/Users/ryan/worktrees/bde/perf-audit/docs/superpowers/audits/2026-04-07/perf-audit/<team-dir>/<lens-file>.md`

Every file path you substitute into a lens prompt — file scope, snapshot reference, and output path — must use one of these absolute prefixes. The file lists below are written in shorthand for readability; **expand them to absolute paths when filling the prompt template**.

### Per-lens specializations

Below, each lens gets the **persona**, **file list**, **exclusions**, **team id**, **lens id**, and **output path** to substitute into the template above.

#### Lens 1.1 — Systems Profiler (Team 1)

- **Team id:** `t1` · **Lens id:** `sysprof`
- **Output:** `docs/superpowers/audits/2026-04-07/perf-audit/team-1-pipeline-hot-path/lens-systems-profiler.md`
- **Persona:** "You are a systems profiler. You think about where CPU cycles go inside one process at steady state. You assume `MAX_ACTIVE_TASKS=1` — a single agent running. You hunt for: synchronous file I/O on hot paths, tight loops, redundant work each tick of the drain loop, blocking calls in async paths, expensive computation per tick, JSON parse/stringify on hot paths, regex compilation in loops. You ignore multi-agent interactions entirely — that is the Concurrency Auditor's job."
- **Files in scope:** every file in `src/main/agent-manager/` (key files: `run-agent.ts`, `sdk-adapter.ts`, `worktree.ts`, `completion.ts`, `index.ts`), plus `src/main/agent-event-mapper.ts`
- **Exclusions:** Commit `00e32951` already capped vitest worker parallelism to `Math.max(1, Math.floor(cpuCount / activeTasks))`. Do NOT re-report vitest worker oversubscription. Do NOT report multi-agent interactions (that is Lens 1.2).

#### Lens 1.2 — Concurrency Auditor (Team 1)

- **Team id:** `t1` · **Lens id:** `concur`
- **Output:** `docs/superpowers/audits/2026-04-07/perf-audit/team-1-pipeline-hot-path/lens-concurrency-auditor.md`
- **Persona:** "You are a concurrency auditor. You only care about what changes when N concurrent agents run instead of 1. You hunt for: lock contention, fan-out blowups (one event triggers N handlers, doubled by N agents), race-prone polling, watchers that double-fire across agents, shared state corruption, redundant work duplicated across agents that could be shared, db write contention. You ignore single-agent steady-state cost — that is the Systems Profiler's job."
- **Files in scope:** Same as Lens 1.1 plus `src/main/pr-poller.ts`, `src/main/sprint-pr-poller.ts`, `src/main/handlers/sprint-local.ts`
- **Exclusions:** Same vitest baseline exclusion as Lens 1.1. Do NOT report findings that exist with one agent.

#### Lens 1.3 — SRE / Ops (Team 1)

- **Team id:** `t1` · **Lens id:** `sre`
- **Output:** `docs/superpowers/audits/2026-04-07/perf-audit/team-1-pipeline-hot-path/lens-sre-ops.md`
- **Persona:** "You are an SRE. You only care about scaling cliffs and unbounded resources. You hunt for: unbounded event listeners, in-memory caches that grow without eviction, in-memory indexes that grow with task volume, log files that never rotate, db tables that grow without pruning, retry storms, watchdog timeouts that don't actually fire, resource leaks on agent failure paths. You ignore code-level CPU findings entirely — focus only on what grows without bound and where it falls over."
- **Files in scope:** `src/main/agent-manager/`, `src/main/logger.ts`, `src/main/db.ts`, `src/main/agent-manager/dependency-index.ts`, `src/main/pr-poller.ts`, `src/main/sprint-pr-poller.ts`
- **Exclusions:** Same vitest baseline. Do NOT report code-level CPU findings (that is Lens 1.1).

#### Lens 2.1 — React Performance Engineer (Team 2)

- **Team id:** `t2` · **Lens id:** `react`
- **Output:** `docs/superpowers/audits/2026-04-07/perf-audit/team-2-renderer/lens-react-perf.md`
- **Persona:** "You are a React performance engineer. You hunt for: wasted re-renders, missing memoization, store subscription granularity (component subscribes to whole store vs. selector), expensive derivations recomputed on every render, unstable callback identities passed as props, large lists without virtualization, prop drilling that triggers tree-wide re-renders. You only care about the renderer process."
- **Files in scope:** `src/renderer/src/components/sprint/SprintPipeline.tsx`, `src/renderer/src/components/dashboard/`, `src/renderer/src/stores/sprintTasks.ts`, `src/renderer/src/stores/agentEvents.ts`, `src/renderer/src/hooks/useBackoffInterval.ts`, `src/renderer/src/views/IDEView.tsx`, `src/renderer/src/components/panels/`, `src/renderer/src/views/DashboardView.tsx`
- **Exclusions:** Do NOT analyze bundle size, lazy-loading, or build config — that is Lens 2.2.

#### Lens 2.2 — Bundle / Asset Auditor (Team 2)

- **Team id:** `t2` · **Lens id:** `bundle`
- **Output:** `docs/superpowers/audits/2026-04-07/perf-audit/team-2-renderer/lens-bundle-asset.md`
- **Persona:** "You are a bundle auditor. You hunt for: bundle bloat, missing lazy-loading on heavy views, eagerly imported modules that should be code-split, Monaco worker loading strategy issues, large dependencies that pull in transitively, asset weight on cold start, CSP misconfiguration that forces fallbacks. You only care about the renderer build."
- **Files in scope:** `electron.vite.config.ts` (renderer config and chunking only — main process build is out of scope), `src/renderer/index.html`, `src/renderer/src/main.tsx`, `src/renderer/src/App.tsx` (for top-level imports), `package.json` (for the renderer dependency surface). **You are explicitly granted permission to grep within `src/renderer/` for `monaco`, `worker`, `lazy`, `import(` to locate Monaco worker setup and dynamic import sites — these may live in unexpected places.**
- **Exclusions:** Do NOT analyze runtime React perf — that is Lens 2.1. Do NOT analyze main process build.

#### Lens 3.1 — Database Performance Engineer (Team 3)

- **Team id:** `t3` · **Lens id:** `db`
- **Output:** `docs/superpowers/audits/2026-04-07/perf-audit/team-3-data-layer/lens-db-perf.md`
- **Persona:** "You are a database performance engineer working on SQLite under WAL. You hunt for: query plans, missing indexes, N+1 patterns, repeated queries that could be cached or batched, WAL contention from many concurrent writes during a Pipeline run, full-table scans, expensive joins, queries that fetch more columns than needed, repeated `SELECT *` on large tables. You may use `EXPLAIN QUERY PLAN` against the snapshot at `docs/superpowers/audits/2026-04-07/perf-audit/.snapshot/bde.db`."
- **Files in scope:** `src/main/db.ts`, `src/main/data/sprint-queries.ts`, `src/main/data/sprint-task-repository.ts`, `src/main/data/task-changes.ts`, `src/main/handlers/sprint-local.ts`, the snapshot db at `docs/superpowers/audits/2026-04-07/perf-audit/.snapshot/bde.db`
- **Exclusions:** Do NOT report data-modeling or write-amplification findings — that is Lens 3.2.

#### Lens 3.2 — Data Modeling Critic (Team 3)

- **Team id:** `t3` · **Lens id:** `model`
- **Output:** `docs/superpowers/audits/2026-04-07/perf-audit/team-3-data-layer/lens-data-modeling.md`
- **Persona:** "You are a data modeling critic. You hunt for: write amplification (one user action → N table writes), hot tables, audit-trail bloat (`task_changes` row count growth vs `sprint_tasks`), `agent_events` cap behavior, schema choices that force expensive reads, redundant denormalization, JSON-blob columns that should be relational (or vice versa), file watcher debouncing that fires more than necessary."
- **Files in scope:** `src/main/db.ts` (migrations), `src/main/data/task-changes.ts`, `src/main/data/sprint-queries.ts`, `src/renderer/src/stores/agentEvents.ts` (event cap logic), file watcher emitting `sprint:externalChange` (likely in `src/main/handlers/sprint-local.ts` or `src/main/index.ts`), the snapshot db
- **Exclusions:** Do NOT report query-plan or index findings — that is Lens 3.1.

#### Lens 4.1 — Prompt Engineer (Team 4)

- **Team id:** `t4` · **Lens id:** `prompt`
- **Output:** `docs/superpowers/audits/2026-04-07/perf-audit/team-4-token-economy/lens-prompt-engineer.md`
- **Persona:** "You are a prompt engineer. You want to know exactly what every spawned agent sees in its initial context, and you hunt for redundancy and dead weight. For each of the five agent types (pipeline, assistant, adhoc, copilot, synthesizer), determine: what `buildAgentPrompt()` injects, what auto-loaded files are included via SDK `settingSources`, what tool definitions are attached, what is duplicated. Identify content that is never used by the model, content that is redundant across agent types, and content that could be lazy-injected instead of front-loaded."
- **Files in scope:** `src/main/agent-manager/prompt-composer.ts`, `src/main/sdk-streaming.ts`, `src/main/agent-event-mapper.ts`, `src/main/agent-manager/sdk-adapter.ts`, `CLAUDE.md` (project root), `docs/BDE_FEATURES.md`, any `~/CLAUDE.md` references the agents pull in
- **Required output:** A breakdown table per agent type showing approximate input-token cost (chars/4 heuristic) of each prompt component. The chars/4 heuristic is for sizing only — see Lens 4.2 for authoritative numbers.
- **Exclusions:** Do NOT compute historical cost averages — that is Lens 4.2's job.

#### Lens 4.2 — Cost Analyst (Team 4)

- **Team id:** `t4` · **Lens id:** `cost`
- **Output:** `docs/superpowers/audits/2026-04-07/perf-audit/team-4-token-economy/lens-cost-analyst.md`
- **Persona:** "You are a cost analyst. Your job is **numbers, not opinions**. Read the snapshot db at `docs/superpowers/audits/2026-04-07/perf-audit/.snapshot/bde.db` and produce real measurements of token usage per task and per agent type."
- **Files in scope:** `docs/superpowers/audits/2026-04-07/perf-audit/.snapshot/bde.db`, plus read-only access to `src/main/agent-manager/prompt-composer.ts` for context.
- **Required output procedure:**
  1. Run `sqlite3 .snapshot/bde.db ".schema cost_events"`, `".schema agent_runs"`, `".schema agent_events"` and paste the schemas at the top of your output. This is the source of truth — do NOT assume column names.
  2. Run **per-task totals**: `SELECT task_id, SUM(input_tokens), SUM(output_tokens), SUM(cache_read_input_tokens), SUM(cache_creation_input_tokens) FROM cost_events GROUP BY task_id ORDER BY 2 DESC LIMIT 20;` (adapt column names to actual schema).
  3. Run **per-agent-type averages** by joining `cost_events` to `agent_runs` on the run id FK and `AVG()` by `agent_type`.
  4. Run **recent-N sample**: the 5 most recent completed pipeline runs with full token breakdown.
  5. Compute aggregate stats: total spend (if cost columns exist), p50/p95 input tokens per task, ratio of cache reads to fresh reads.
  6. **Reconstruct 3-5 recent real tasks.** For each: pull the task row from `sprint_tasks`, the prompt that was sent (if available in `agent_runs` or `agent_events`), and the per-turn token consumption. Show what the agent received at spawn time and how its context filled up over the run. This is the most important deliverable — it makes the abstract numbers concrete.
  7. Identify outliers — tasks with anomalously high token cost — and explain what made them expensive.
- **Exclusions:** Do NOT speculate about prompt structure — that is Lens 4.1's job. You produce numbers from the db.

#### Lens 4.3 — Context Window Strategist (Team 4)

- **Team id:** `t4` · **Lens id:** `ctx`
- **Output:** `docs/superpowers/audits/2026-04-07/perf-audit/team-4-token-economy/lens-context-strategist.md`
- **Persona:** "You are a context window strategist. You think about the lifecycle of context across a long agent run: what is front-loaded vs lazy-injected, how the context window fills up over a multi-turn task, where the cliffs are for each agent type. You hunt for: content that is front-loaded but only matters in 5% of tasks, content that could be made retrievable on demand instead of preloaded, agent types that are dangerously close to context-window limits, repeated content across turns that could be pruned. You take Lens 4.1's per-component breakdown and Lens 4.2's per-task numbers as input *if their files exist by the time you finish your reading*, but you do not block on them."
- **Files in scope:** `src/main/agent-manager/prompt-composer.ts`, `src/main/sdk-streaming.ts`, `CLAUDE.md`, `docs/BDE_FEATURES.md`, the snapshot db (for headroom calculations), any sibling lens files in `team-4-token-economy/` if they exist
- **Exclusions:** Do NOT replicate Lens 4.1's per-component breakdown table or Lens 4.2's historical query results. Reference them by file if useful, otherwise stay in your lane: lazy-vs-eager strategy and headroom analysis.

### The dispatch step

- [ ] **Step 4.1: Dispatch all 10 lens agents in a single message**

In **one** message to the user, make 10 `Agent` tool calls in parallel. Each call:
- `description`: short, e.g. `"Lens t1-sysprof"`, `"Lens t1-concur"`, etc.
- `subagent_type`: `"Explore"`
- `prompt`: the shared template above with the per-lens substitutions filled in (persona, file list, exclusions, team id, lens id, output path)

Do NOT pass `isolation: "worktree"` — these are read-only, no isolation needed, and isolation would prevent the Token Economy lenses from reading the snapshot at the path written in Tasks 1-2.

Critical: **single message, 10 parallel tool calls**. If you split this across multiple messages you have lost the parallelism the audit was designed for.

- [ ] **Step 4.2: Wait for all 10 agents to return**

The `Agent` tool blocks until each subagent completes. After the message returns, all 10 lens files should exist.

---

## Task 5: Verify lens outputs

**Files:**
- Verify exists (10 files total): all paths under `docs/superpowers/audits/2026-04-07/perf-audit/team-*/lens-*.md`

- [ ] **Step 5.1: Confirm all 10 files exist**

```bash
ls docs/superpowers/audits/2026-04-07/perf-audit/team-*/lens-*.md
````

Expected: exactly these 10 paths:

```
docs/superpowers/audits/2026-04-07/perf-audit/team-1-pipeline-hot-path/lens-systems-profiler.md
docs/superpowers/audits/2026-04-07/perf-audit/team-1-pipeline-hot-path/lens-concurrency-auditor.md
docs/superpowers/audits/2026-04-07/perf-audit/team-1-pipeline-hot-path/lens-sre-ops.md
docs/superpowers/audits/2026-04-07/perf-audit/team-2-renderer/lens-react-perf.md
docs/superpowers/audits/2026-04-07/perf-audit/team-2-renderer/lens-bundle-asset.md
docs/superpowers/audits/2026-04-07/perf-audit/team-3-data-layer/lens-db-perf.md
docs/superpowers/audits/2026-04-07/perf-audit/team-3-data-layer/lens-data-modeling.md
docs/superpowers/audits/2026-04-07/perf-audit/team-4-token-economy/lens-prompt-engineer.md
docs/superpowers/audits/2026-04-07/perf-audit/team-4-token-economy/lens-cost-analyst.md
docs/superpowers/audits/2026-04-07/perf-audit/team-4-token-economy/lens-context-strategist.md
```

**Recovery:** Diff the expected list against the actual `ls` output. For each missing file, identify the corresponding lens by path (e.g. `lens-react-perf.md` → Lens 2.1) and re-dispatch only those. If multiple are missing, dispatch them in a single message with parallel `Agent` tool calls — never sequentially.

- [ ] **Step 5.2: Spot-check format compliance**

For each file, verify:

- Starts with `# ` heading naming the lens
- Has a `**Lens scope:**` line and a `**Summary:**` paragraph
- Has at least one `## F-{team}-{lens}-{n}:` finding heading
- Findings include `**Severity:**`, `**Location:**`, `**Evidence:**`, `**Impact:**`, `**Recommendation:**`, `**Effort:**`, `**Confidence:**`

Use Grep:

```bash
# All files should match. If any return zero, that file is malformed.
```

```
Grep pattern: ^## F-t[1-4]-[a-z]+-[0-9]+:
Glob: docs/superpowers/audits/2026-04-07/perf-audit/team-*/lens-*.md
output_mode: count
```

Expected: every file shows ≥1 match. If any file shows 0, read it and decide whether to re-dispatch that lens or accept a sub-format finding count.

- [ ] **Step 5.3: Sanity-check Team 4 has real numbers**

```bash
grep -l "schema cost_events\|input_tokens\|SUM(" docs/superpowers/audits/2026-04-07/perf-audit/team-4-token-economy/*.md
```

Expected: at least Lens 4.2 (cost-analyst) shows up. If it doesn't, re-dispatch with stricter instructions on running the canonical queries.

---

## Task 6: Dispatch the synthesis agent

**Files:**

- Create: `docs/superpowers/audits/2026-04-07/perf-audit/SYNTHESIS.md`

- [ ] **Step 6.1: Dispatch one general-purpose synthesis agent**

Use the `Agent` tool with:

- `description`: `"Synthesize perf audit findings"`
- `subagent_type`: `"general-purpose"`
- `prompt`: the synthesis prompt below

```
You are synthesizing the results of a 10-lens performance audit of BDE. Your job is to merge, dedupe, and rank findings into a single prioritized roadmap. You do NOT invent new findings — you only consolidate what the lens agents produced.

## Inputs

Read all 10 of these files:

- docs/superpowers/audits/2026-04-07/perf-audit/team-1-pipeline-hot-path/lens-systems-profiler.md
- docs/superpowers/audits/2026-04-07/perf-audit/team-1-pipeline-hot-path/lens-concurrency-auditor.md
- docs/superpowers/audits/2026-04-07/perf-audit/team-1-pipeline-hot-path/lens-sre-ops.md
- docs/superpowers/audits/2026-04-07/perf-audit/team-2-renderer/lens-react-perf.md
- docs/superpowers/audits/2026-04-07/perf-audit/team-2-renderer/lens-bundle-asset.md
- docs/superpowers/audits/2026-04-07/perf-audit/team-3-data-layer/lens-db-perf.md
- docs/superpowers/audits/2026-04-07/perf-audit/team-3-data-layer/lens-data-modeling.md
- docs/superpowers/audits/2026-04-07/perf-audit/team-4-token-economy/lens-prompt-engineer.md
- docs/superpowers/audits/2026-04-07/perf-audit/team-4-token-economy/lens-cost-analyst.md
- docs/superpowers/audits/2026-04-07/perf-audit/team-4-token-economy/lens-context-strategist.md

Also read the spec for context: docs/superpowers/specs/2026-04-07-perf-audit-design.md

## Scoring rubric (from the spec)

Rank findings using `(severity × confidence) ÷ effort` with these mappings:
- Severity: Critical = 4, High = 3, Medium = 2, Low = 1
- Confidence: High = 3, Medium = 2, Low = 1
- Effort: S = 1, M = 2, L = 4
- Score range: best = 12.0 (Critical / High / S), worst = 0.25 (Low / Low / L)
- Ties broken by Severity first, then Effort (smaller wins)

## Dedup rules

Two findings are duplicates if they identify the same root cause in the same file region OR if fixing one would make the other moot. When deduping:
- Pick the better-evidenced finding as the canonical entry
- Cross-reference the other finding IDs in the canonical entry's "Also surfaced by:" footer
- Sum nothing — the score comes from the canonical finding alone

## Output

Write to: `docs/superpowers/audits/2026-04-07/perf-audit/SYNTHESIS.md`

Sections in this order:

### 1. Top 10 Ranked Actions

Numbered list. For each: title, score, canonical finding ID, one-sentence problem, one-sentence fix, file location, also-surfaced-by IDs if any.

### 2. Cross-Cutting Themes

Patterns that appear in 2+ lenses. Examples to look for: aggressive polling intervals, audit-trail writes on hot paths, eager front-loading of context, fan-out across concurrent agents. For each theme, list the contributing finding IDs.

### 3. Quick Wins

Subset of all findings where Effort=S AND (Severity≥High OR Confidence=High). Separate from the Top 10 — these are "do this Monday" items.

### 4. Deferred / Out of Scope

Real findings that scored < 1.0 OR that are out of the audit's stated scope. One line each with the reason for deferral.

### 5. Open Questions for Human

Places where lenses disagreed, evidence was thin, or a measurement was missing. Ryan will use these to decide what to investigate next.

### Appendix: Score table

A flat table of every finding ID with its score, sorted descending. This lets the user audit your ranking.

## Quality bar

- Cite finding IDs everywhere. The user must be able to drill from the synthesis into the source lens file.
- Do not soften severity ratings. Lens agents picked them; trust them unless you have a specific reason to override (and document the override).
- Be terse. The synthesis is a triage tool, not a narrative.
```

- [ ] **Step 6.2: Wait for the synthesis agent to return**

The `Agent` tool blocks until completion. After the message returns, `SYNTHESIS.md` should exist.

**If synthesis fails or output is malformed beyond simple section repair:** re-dispatch a fresh synthesis agent with the same prompt. Do not edit `SYNTHESIS.md` by hand unless re-dispatch also fails — hand edits invalidate the audit's "machine-merged" guarantee that the synthesis only contains lens-produced findings.

---

## Task 7: Verify synthesis output

- [ ] **Step 7.1: Confirm SYNTHESIS.md exists**

```bash
ls -la docs/superpowers/audits/2026-04-07/perf-audit/SYNTHESIS.md
```

Expected: file exists, non-zero size.

- [ ] **Step 7.2: Verify it has all 5 required sections**

```
Grep pattern: ^### [1-5]\.|^### Appendix
Glob: docs/superpowers/audits/2026-04-07/perf-audit/SYNTHESIS.md
output_mode: content
```

Expected: 6 matches (sections 1-5 plus Appendix). If any are missing, re-dispatch a fresh synthesis agent with the same prompt as Step 6.1 — a new agent is more reliable than trying to resume the prior one.

- [ ] **Step 7.3: Verify Top 10 references real finding IDs**

```
Grep pattern: F-t[1-4]-[a-z]+-[0-9]+
Glob: docs/superpowers/audits/2026-04-07/perf-audit/SYNTHESIS.md
output_mode: count
```

Expected: many matches (≥20 in a healthy synthesis with cross-references). Zero or few = synthesis didn't actually cite sources.

---

## Task 8: Commit the audit

- [ ] **Step 8.1: Stage the audit directory**

```bash
git add docs/superpowers/audits/2026-04-07/perf-audit/
```

Note: `.snapshot/bde.db` will be staged. The audit deliberately commits the snapshot so findings remain reproducible. If db size is a concern (>10MB), consider gitignoring `.snapshot/` and noting the SHA in the README instead — but default behavior is to commit it.

- [ ] **Step 8.2: Verify staged contents**

```bash
git status --short docs/superpowers/audits/2026-04-07/perf-audit/
```

Expected: 13 staged files — README.md, 10 lens files, SYNTHESIS.md, plus `.snapshot/bde.db`.

- [ ] **Step 8.3: Commit**

```bash
git commit -m "$(cat <<'EOF'
docs(audit): perf audit 2026-04-07 — 10 lens findings + synthesis

10 parallel Explore subagents audited BDE across 4 teams (Pipeline Hot
Path, Renderer, Data Layer, Token Economy) using 2-3 lens personas
each. Synthesis pass merged and ranked findings into SYNTHESIS.md.

See docs/superpowers/audits/2026-04-07/perf-audit/SYNTHESIS.md for the
prioritized roadmap. Lens files contain raw evidence and per-finding
detail.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

Expected: commit succeeds. If hooks fail, fix issues and create a new commit (do not amend).

- [ ] **Step 8.4: Surface the synthesis to the user**

Send the user a final message containing:

1. Path to `SYNTHESIS.md`
2. The Top 10 actions (copied from the synthesis, not summarized)
3. The Quick Wins list
4. Any Open Questions that need human input
5. Total finding count and score range

Do NOT push the branch automatically — the user decides when to merge or PR.

---

## Notes for the executor

- **Do not skip the snapshot step.** If `~/.bde/bde.db` is missing or unreadable, STOP and report. Team 4's findings depend on it.
- **Single-message dispatch is non-negotiable for Task 4.** Sequential dispatch wastes the parallelism the audit was designed for.
- **Read-only means read-only.** The lens agents are `Explore` subagents. If any of them tries to write outside its assigned output file, treat that as a bug in the prompt and tighten the next iteration.
- **Token cost.** 10 parallel Explore agents on a moderately large codebase will burn meaningful tokens. This is acceptable — the audit is itself a one-time investment to find ongoing waste.
- **Failure recovery.** If 1-2 lens agents fail or produce malformed output, re-dispatch only those (in parallel if multiple). Do not re-run the whole audit.
