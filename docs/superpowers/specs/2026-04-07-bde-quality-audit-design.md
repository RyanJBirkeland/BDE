# BDE Quality & Pre-Launch Audit — Design

**Date:** 2026-04-07
**Goal:** Comprehensive audit of BDE for pre-launch readiness and product completeness/quality. Not "does it work" — "does it work *well*."

## Outcome

A prioritized master list of findings (`SYNTHESIS.md`) covering bugs, UX gaps, missing affordances, prompt smells, architectural fragility, marketing/story gaps, and feature incoherence — with confidence scoring based on how many independent personas/teams flagged each issue.

## Structure: Hybrid Multi-Team Audit

Three teams of 5 personas each = 15 independent persona reports → synthesis pass → master list.

### Teams

| Team | Scope | Strategy |
|------|-------|----------|
| **Alpha** | Core Task Flow: Task Workbench, Sprint Pipeline, Code Review Station, Task Dependencies, Task Planner | Scope-focused — deep dive on the create→queue→execute→review→done loop |
| **Bravo** | Agent & Dev Surfaces: Agent System (all 5 agent types), Agent Manager, Dev Playground, IDE, Source Control, Dashboard, Settings, Panel System | Scope-focused — deep dive on agent UX and supporting tools |
| **Gamma** | Whole product, end-to-end | Wildcard — catches cross-cutting issues and inconsistencies that only appear when holding the full product in mind |

Gamma is told other teams exist but **not** what they're finding — independence preserves cross-validation signal in synthesis.

### Personas (each team has all 5)

1. **Product Manager** — *Does the product cohere?* Feature completeness, workflow gaps, dead ends, redundant paths, unclear feature boundaries, missing affordances. "What would a new user trip on?" "What's half-built?"

2. **Marketing** — *Can we tell a story about this?* Demo-ability, naming consistency (internal terms vs. user-facing), the "wow" surface area, screenshot-worthy moments, hidden cool features, README/landing-page accuracy.

3. **Senior Dev (User)** — *Would I actually use this daily?* Friction in real workflows: spawning agents, reviewing work, merging, recovering from failure. Keyboard shortcut gaps, error message quality, surprising state losses, "I have to leave the app to do X" moments.

4. **Prompt Engineer** — *Are the agents set up to succeed?* `prompt-composer.ts`, agent personalities, spec templates, copilot/synthesizer prompts, readiness checks, retry context, scope enforcement language. Prompt smells, conflicting guidance, BDE_FEATURES.md context quality.

5. **Architectural Engineer** — *Will this hold up?* Module boundaries, IPC surface bloat, store coupling, data layer, error paths, agent manager lifecycle, fragility, performance (startup, polling, render perf, SQLite). Will the next 6 months of features be additive or painful?

## Execution

### Dispatch
- 15 sub-agents launched in **a single parallel fan-out** via the `Agent` tool (`general-purpose` subagent type).
- No staging — Gamma must remain independent of focused teams' findings.
- Sub-agents are **read-only**: Read, Grep, Glob, Write (only to their own report file). No code modifications, no git operations, no commits.
- No worktree isolation needed (read-only).

### Per-Persona Prompt Contents
Each sub-agent receives:
1. Its persona charter (from above)
2. Its team's scope (Alpha/Bravo/Gamma)
3. The deliverable format spec (see below)
4. Output path: `docs/superpowers/audits/2026-04-07/<team>/<persona>.md`
5. Explicit instructions: read-only, no code changes, write report to assigned path, return when done
6. Pointers to key files: `CLAUDE.md`, `docs/BDE_FEATURES.md`, `src/main/`, `src/renderer/src/`, `src/shared/`

### Deliverable Format (per persona report)

```markdown
# <Persona> — Team <Team> — BDE Audit 2026-04-07

## Summary
<3-5 sentence executive summary of what this persona found>

## Findings

### [CRITICAL] <Finding title>
- **Category:** <e.g. UX / Architecture / Prompt / Feature Gap / Polish>
- **Location:** `path/to/file.ts:123` (or "N/A" for cross-cutting)
- **Observation:** <what the persona saw>
- **Why it matters:** <impact through this persona's lens>
- **Recommendation:** <concrete fix or follow-up>

### [MAJOR] ...
### [MINOR] ...
```

Severities:
- **CRITICAL** — blocks pre-launch / breaks the product story
- **MAJOR** — meaningfully degrades quality but not a blocker
- **MINOR** — polish, nice-to-have, low-impact

## Synthesis

After all 15 reports land, a synthesis pass produces `docs/superpowers/audits/2026-04-07/SYNTHESIS.md`:

- **Dedupes** findings across personas/teams
- **Cross-references** — findings flagged by 2+ personas/teams marked high-confidence
- **Prioritizes** — top 10-20 action items, ranked by confidence × severity × estimated impact
- **Themes** — clusters of related findings (e.g., "Agent error recovery is consistently weak")
- **Coverage map** — which surfaces got the most/least attention, flagging gaps in the audit itself

## Output Tree

```
docs/superpowers/audits/2026-04-07/
├── SYNTHESIS.md
├── alpha/
│   ├── product-manager.md
│   ├── marketing.md
│   ├── senior-dev.md
│   ├── prompt-engineer.md
│   └── architectural-engineer.md
├── bravo/
│   └── ...(5 reports)
└── gamma/
    └── ...(5 reports)
```

## Non-Goals

- No code changes during the audit. Findings only.
- No PR/issue creation. The synthesis is the deliverable; user decides what to action.
- No estimation of fix effort beyond rough severity. Sequencing is post-audit work.
- No security audit. Quality/completeness only.
- No test-coverage-percentage analysis. Architectural Engineer may flag coverage gaps qualitatively, but no metrics-driven coverage report.

## Risks

- **Sub-agent context budget**: 15 agents reading large parts of a substantial codebase. Mitigated by per-team scope limits for Alpha/Bravo; Gamma is the only one with full scope.
- **Persona drift**: agents may default to generic "code review" voice instead of staying in persona. Mitigated by sharp persona charters in the prompt and explicit "stay in persona" instructions.
- **Synthesis bottleneck**: 15 reports is a lot to read. Synthesis pass must aggressively dedupe and surface signal.
