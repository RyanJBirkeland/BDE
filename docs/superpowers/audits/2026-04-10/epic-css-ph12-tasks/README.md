# Epic — CSS Audit Remediation Phase 12

Five pipeline tasks from the 2026-04-10 post-refactor CSS audit. Four spacing-token adoption tasks (split by directory) plus one dead-CSS/!important cleanup. All independent — queue all 5 in parallel.

Design spec: `docs/superpowers/specs/2026-04-10-css-audit-remediation-ph12-design.md`

## Tasks

| #   | Title                                                   | Files | Risk | Est time  |
| --- | ------------------------------------------------------- | ----- | ---- | --------- |
| 01  | Spacing tokens — IDE + diff components                  | 14    | low  | 15-20 min |
| 02  | Spacing tokens — sprint + review + planner + workbench  | 23    | low  | 20-30 min |
| 03  | Spacing tokens — agents + dashboard + settings + layout | 33    | low  | 20-30 min |
| 04  | Spacing tokens — design-system + views + assets         | 22    | low  | 15-20 min |
| 05  | Dead CSS + !important cleanup                           | 9     | low  | 10-15 min |

## Pre-flight

No pre-flight fixes needed. All tasks are mechanical grep-verify operations on CSS files only.

Confirm the `--bde-space-*` tokens exist in `src/renderer/src/assets/tokens.css` before queueing:

```bash
grep -c 'bde-space-' src/renderer/src/assets/tokens.css
```

Expected: 8+ matches.

## Queue strategy

All 5 independent, no shared files between tasks. Queue all at once:

- At `maxConcurrent=3`: Wave 1 (tasks 01, 02, 03), Wave 2 (tasks 04, 05)
- Expected total wall time: ~30-45 min
- At `maxConcurrent=5`: All run simultaneously, ~20-30 min

## How to queue

Option A — Task Workbench (⌘0):

1. Paste title, set repo=`bde`, spec_type=`refactor`
2. Paste task .md body into Spec editor
3. Queue

Option B — Direct SQL (from this directory):

```bash
python3 queue_epic.py
```
