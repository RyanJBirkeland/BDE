## Why

The Sprint Pipeline view serializes every task to JSON on every poll merge, allocates a new array on every single agent event, and recalculates Date.now() inside TaskPill render bodies — defeating React.memo entirely. At 50+ tasks and 2000+ events per agent this is already noticeably janky. At 500 tasks it becomes unusable.

## What Changes

- **BREAKING** `stableTaskRef` switches from `JSON.stringify` equality to field-wise comparison — same external contract, much cheaper
- Per-agent event accumulation switches from O(N) spread to a ring-buffer (fixed-size overwrite) — existing `MAX_EVENTS_PER_AGENT` cap enforced at write time, not at slice time
- `Date.now()` hoisted out of TaskPill render body into a `useNow()` hook updated at a coarse interval (e.g. 10s) so React.memo can do its job
- Keyboard-nav index arrays cached with `useMemo` — currently recomputed on every render
- Filter chain debounced so typing into search doesn't trigger a full re-partition on every keystroke
- IPC poll failures surface as a recoverable in-app banner (currently silent)
- `MAX_EVENTS_PER_AGENT` in `sprintEvents` store aligned to the CLAUDE.md canonical value (500) — currently may diverge

## Capabilities

### New Capabilities

- `pipeline-render-performance`: Field-wise task equality, ring-buffer event store, stable time reference for TaskPill, debounced filter chain, IPC failure banner

### Modified Capabilities

<!-- No spec-level behavior changes — same data, same UI, faster rendering -->

## Impact

- `src/renderer/src/stores/sprintTasks.ts` — `stableTaskRef` field-wise compare
- `src/renderer/src/stores/sprintEvents.ts` — ring-buffer event accumulation, MAX_EVENTS_PER_AGENT alignment
- `src/renderer/src/components/sprint/TaskPill.tsx` (or equivalent) — hoist Date.now()
- `src/renderer/src/components/sprint/SprintPipeline.tsx` — debounce filter chain, keyboard-nav index memoization
- `src/renderer/src/stores/sprintTasks.ts` — IPC failure banner state
- New hook `src/renderer/src/hooks/useNow.ts`
