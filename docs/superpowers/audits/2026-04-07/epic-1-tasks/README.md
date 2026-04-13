# Epic 1 — Demo Killers

Six tight, single-file (or near-single-file) tasks. Each is independent of the others, so all six can run in parallel with WIP=3 or higher. Total estimated agent runtime: 15-25 min per task.

## Tasks

| #   | Title                                           | Files touched | Risk   |
| --- | ----------------------------------------------- | ------------- | ------ |
| 01  | Make sample-first-task runnable as-shipped      | 1             | low    |
| 02  | Add About tab to Settings sidebar               | 1             | low    |
| 03  | Delete fake estimateCost from console header    | 1             | low    |
| 04  | Extract playground HTML sanitization (security) | 3 (1 new)     | medium |
| 05  | Fix README factual errors (URL, counts, views)  | 1             | low    |
| 06  | Migration v36 — restore dropped SQLite indexes  | 2             | medium |

## Pre-flight checklist

Before queuing these, fix the prompt-system contradictions or every agent will burn time on the wrong checks:

- [ ] `prompt-composer.ts` — drop the hardcoded `2563+ tests` string
- [ ] `prompt-composer.ts` — gate the `npm install as FIRST action` rule to `agentType === 'pipeline'`
- [ ] `prompt-composer.ts` — pick `npm test` OR `npm run test:coverage` and use it consistently in both the preamble and the Definition of Done
- [ ] `agent-system/skills/pr-review.ts` — rename "PR Station (Cmd+5)" to "Code Review Station (Cmd+5)"
- [ ] `agent-system/personality/assistant-personality.ts` — fix the "you work in the repo directly (not worktrees)" line; assistant agents now run in worktrees per `spawnAdhocAgent`

These are ~30 min of hand edits. Without them, expect 1-2 of the six tasks to thrash on contradictory instructions.

## How to use these specs

For each task:

1. Open Task Workbench (⌘0)
2. Paste the title into the Title field, repo = `BDE`, spec_type = appropriate template
3. Paste the body of the .md file into the Spec editor
4. Confirm readiness checks pass
5. Queue

Or, when the audit's "import spec from file" Epic 1 task itself ships, point Workbench at this directory.

## Order

These can run in any order — none depend on the others. If you want to validate the loop with the lowest-risk task first, queue **02** (About tab — one-line change) by itself, watch it complete, then queue the rest.
