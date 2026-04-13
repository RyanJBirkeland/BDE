# Epic — Agents View Visual & Layout Redesign

Seven pipeline tasks implementing the Agents view redesign. Replaces the terminal-aesthetic console (`[prefix] content timestamp` log lines) with a card grammar, elevates the fleet sidebar from navigation widget to primary observability surface, and adds a Fleet at a Glance empty state. **Style + layout only — no functionality changes, no new IPC, no new stores, no new dependencies.**

Design spec: `docs/superpowers/specs/2026-04-10-agents-view-redesign-design.md`

## Tasks

| #   | Title                                            | Files | Depends on | Risk | Est time  |
| --- | ------------------------------------------------ | ----- | ---------- | ---- | --------- |
| 01  | Inline-styles cleanup (AgentsView + AgentList)   | 4     | —          | low  | 15-20 min |
| 02  | Sidebar card redesign + panel resize             | 3     | 01         | med  | 25-35 min |
| 03  | Cockpit header growth + typography               | 2     | —          | low  | 15-20 min |
| 04  | Console body file restructure (no visual change) | ~14   | —          | med  | 30-40 min |
| 05  | Card grammar — conversation cards                | 8     | 04         | med  | 25-35 min |
| 06  | Card grammar — tool cards + EditDiffCard         | 7     | 05         | med  | 30-40 min |
| 07  | Fleet at a Glance empty state                    | 3     | 01         | low  | 20-30 min |

**Total: 7 tasks, ~3-4 hours wall time at maxConcurrent=2.**

## Pre-flight

Confirm the design spec exists and the diff parser is in place:

```bash
ls docs/superpowers/specs/2026-04-10-agents-view-redesign-design.md
ls src/renderer/src/lib/diff-parser.ts
```

Both must exist before queueing.

## Dependencies

```
        ┌─────────┐  ┌─────────┐
        │  01     │  │  03     │
        │ inline  │  │ header  │
        │ styles  │  │ growth  │
        └────┬────┘  └─────────┘
             │
       ┌─────┴─────┐
       │           │
       ▼           ▼
  ┌─────────┐ ┌─────────┐
  │  02     │ │  07     │
  │ sidebar │ │ fleet   │
  │ cards   │ │ glance  │
  └─────────┘ └─────────┘

  ┌─────────┐
  │  04     │
  │ file    │
  │restruct.│
  └────┬────┘
       │
       ▼
  ┌─────────┐
  │  05     │
  │ convo   │
  │ cards   │
  └────┬────┘
       │
       ▼
  ┌─────────┐
  │  06     │
  │ tool    │
  │ cards   │
  └─────────┘
```

- **Independent (Wave 1):** 01, 03, 04
- **Wave 2:** 02 and 07 (depend on 01); 05 (depends on 04)
- **Wave 3:** 06 (depends on 05)

Tasks 03 is fully independent and can ship alongside any other task.

## Queue strategy

At `maxConcurrent=2`:

- Wave 1: 01 + 03 (parallel), 04 starts when one of those completes
- Wave 2: 02 and 07 unblock after 01; 05 unblocks after 04
- Wave 3: 06 unblocks after 05
- Expected total wall time: ~3-4 hours

At `maxConcurrent=3`:

- Wave 1: 01, 03, 04 all parallel
- Wave 2: 02, 05, 07 all parallel
- Wave 3: 06
- Expected total wall time: ~2-2.5 hours

## How to queue

```bash
cd docs/superpowers/audits/2026-04-10/epic-agents-view-redesign-tasks
python3 queue_epic.py
```

The script:

1. Inserts task 01 first, captures its inserted ID
2. Inserts task 03 (no deps)
3. Inserts task 04 (no deps), captures ID
4. Inserts task 02 with `depends_on: [{id: <task01_id>, type: 'hard'}]`
5. Inserts task 07 with `depends_on: [{id: <task01_id>, type: 'hard'}]`
6. Inserts task 05 with `depends_on: [{id: <task04_id>, type: 'hard'}]`, captures ID
7. Inserts task 06 with `depends_on: [{id: <task05_id>, type: 'hard'}]`

Hard dependencies → BDE auto-blocks downstream tasks until upstream succeeds. If an upstream fails after retries, the downstream stays blocked until human intervention.

## Phased rollout

Phase 1 (task 01) is the only task that has standalone code-health value with zero visual change. It can ship in main even if subsequent visual phases stall — the inline-styles sewer in `AgentsView.tsx` and `AgentList.tsx` is technical debt that should be eliminated regardless. **Consider running task 01 alone first** to get the cleanup landed before queueing the rest.

## Acceptance criteria for the epic

After all 7 tasks complete and merge, the spec's full acceptance checklist must pass — see Section "Acceptance Criteria" in the design spec. Quick smoke tests:

- [ ] Sidebar default width is 28% (was 20%)
- [ ] Cockpit header is 56px tall (was 32px) and task title is prominent
- [ ] Each event in the cockpit body renders as a card with breathing room
- [ ] Tool icons are lucide components, not single letters
- [ ] Edit tool expansion shows an inline diff
- [ ] Empty state shows the Fleet at a Glance panel
- [ ] No `style={{}}` props remain in `AgentsView.tsx` or `AgentList.tsx`
- [ ] All existing tests pass (after assertion updates)
