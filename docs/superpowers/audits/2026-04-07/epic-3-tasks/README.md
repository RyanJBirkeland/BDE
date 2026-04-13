# Epic 3 — Senior Dev Friction Fixes

Six pipeline-friendly single-file fixes from the 2026-04-07 quality audit's P2 "senior dev friction" bucket. Each is independent (no shared files), tight-scoped, and parallelizable.

## Tasks

| #   | Title                                            | Files | Risk   | Est time  |
| --- | ------------------------------------------------ | ----- | ------ | --------- |
| 01  | Scope Workbench Cmd+Enter to form                | 1     | low    | 10-15 min |
| 02  | Code Review: preserve selection, advance to next | 1-2   | medium | 15-25 min |
| 03  | Agent CommandBar → auto-growing textarea         | 1     | low    | 10-15 min |
| 04  | Move Workbench shortcut Cmd+0 → Cmd+9            | 1     | low    | 5-10 min  |
| 05  | Launchpad repo cycler → dropdown                 | 1     | medium | 15-20 min |
| 06  | IDE Cmd+F → Monaco find when editor focused      | 1-2   | medium | 15-20 min |

## Pre-flight

All Epic 1 preflight fixes are already on main:

- Deduped pre-commit verification (one canonical block)
- `npm run test:coverage` unified across preamble + DoD
- `npm install` gated to pipeline only
- PR Station → Code Review Station in skills
- Assistant personality worktree accuracy fix
- **New in this session:** Pipeline judgment rules (don't misjudge load flakes, use ls-remote to verify pushes)
- **New in this session:** `maxConcurrent` safe-threshold warning in Settings UI

User's local `agentManager.maxConcurrent` has been lowered to **3** for this session. The new build picks it up on restart.

## Queue strategy

All 6 independent, no shared files. Queue all 6 at once at `maxConcurrent=3`:

- Wave 1: tasks 01, 02, 03 run in parallel
- Wave 2: tasks 04, 05, 06 run as the first wave finishes
- Expected total wall time: ~25-40 min

## Deferred to Epic 4+

These senior-dev items need more scope and stay out of Epic 3:

- **Source Control Pull/Fetch** — needs new IPC channels + 2-3 files
- **Source Control Amend/Discard** — multiple sub-features
- **IDE Find-in-Files (Cmd+Shift+F)** — needs ripgrep IPC + sidebar panel
- **Kill confirmation with WIP summary** — needs git status shell-out per running agent
- **Local merge conflict resolution UI** — audit top-20 #12, blocks Code Review recovery
- **Agent Manager settings hot-reload** — requires lifecycle rework
- **Terminal tab persistence** — requires state capture + restore
