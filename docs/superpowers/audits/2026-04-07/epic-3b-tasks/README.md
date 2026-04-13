# Epic 3 Tier 2 — Senior Dev Friction (bigger fixes)

Four tasks, each slightly larger than Epic 3 Tier 1 but still tight-scoped. All independent (different files, no shared state). Queue all 4 at `maxConcurrent=3`:

- Wave 1: tasks 01, 02, 03 run in parallel
- Wave 2: task 04 runs alone as soon as any of the others finishes

## Tasks

| #   | Title                                           | Files         | Risk       | Est time  |
| --- | ----------------------------------------------- | ------------- | ---------- | --------- |
| 01  | Source Control: add Pull and Fetch              | 4-5 (new IPC) | medium     | 20-30 min |
| 02  | Case-insensitive repo lookup + migration v38    | 2-3           | low-medium | 15-20 min |
| 03  | Cap VITEST_MAX_WORKERS default to 2             | 1-2           | low        | 10-15 min |
| 04  | Kill confirmation with uncommitted work preview | 2-4           | medium     | 20-30 min |

## Why these four

- **01 (Pull/Fetch):** The single most-reported missing git affordance in the audit. Confirmed by grep that `git:pull`/`git:fetch` IPC channels don't exist at all.
- **02 (case-insensitive):** Dogfood-loop finding. 22% of historical `sprint_tasks.repo` rows are `'BDE'` uppercase while settings uses `'bde'` lowercase. Ship It fails on all of them until manually patched. Mandatory before older tasks can be acted on.
- **03 (VITEST_MAX_WORKERS):** Direct mitigation for the load-141 disaster we hit in Epic 1 and the load-100+ we hit in Epic 3. Each parallel agent currently spawns `CPU-count` vitest workers; capping to 2 gives ~3× headroom without sacrificing test speed for any single agent.
- **04 (kill confirmation):** Unblocks users who hit thrashing agents and want to safely stop them. Pairs well with the Code Review action-loop fix from Tier 1.

## Deferred

- **Source Control Amend / Discard** — bigger, add to Tier 3
- **IDE Find-in-Files (⌘⇧F)** — needs ripgrep IPC + sidebar panel, its own focused spec
- **Agent Manager settings hot-reload** — needs lifecycle rework
- **electron-rebuild lockfile** — deferred until we decide between lockfile, skip flag, or prebuilt binary
