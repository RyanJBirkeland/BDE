## Context

`sprintTasks` store runs `JSON.stringify(incoming) === JSON.stringify(existing)` per task on every 3-second poll. With 100 tasks that is 100 full serializations per tick. `sprintEvents` store does `[...existing, event]` spread on every agent message — at 2000 events × N agents that is N × 2000-element array copies per message. `TaskPill` calls `Date.now()` directly in render, making every pill re-render on every parent update regardless of task data changes. The filter chain in `SprintPipeline` re-partitions all tasks on every search keystroke without debounce.

## Goals / Non-Goals

**Goals:**
- Replace JSON.stringify equality with field-wise compare for the 6–8 fields that actually change during a run (`status`, `claimed_by`, `completed_at`, `failure_reason`, `pr_status`, `pr_url`, `retry_count`, `notes`)
- Ring-buffer event store: fixed-size array, write pointer wraps — no spread allocation on every message
- `useNow(intervalMs)` hook: single `setInterval` shared across all pills via context or module-level subscription
- Debounce search input (150ms) before updating `sprintFilters` store
- Cache `partitionSprintTasks()` result and keyboard-nav indices with `useMemo` keyed on task list identity
- Surface IPC poll errors as a dismissible banner in SprintPipeline

**Non-Goals:**
- Full virtualization of task columns (T-165 is in the epic but requires a virtualizer lib — defer if no approved dep)
- Changing poll interval or adding server-push
- Renderer-side SQLite queries

## Decisions

### D1: Field-wise compare uses an explicit allowlist, not a deep-equal library

```ts
const MUTABLE_FIELDS = ['status','claimed_by','completed_at','failure_reason',
  'pr_status','pr_url','retry_count','notes','title','spec'] as const
```

Comparing only these fields means new columns added to `SprintTask` don't silently break the optimization. If a field is missing from the list, it falls back to JSON.stringify for that task only (safe degradation).

_Alternative_: `fast-deep-equal` or `lodash.isEqual`. Rejected — no new deps; the allowlist is self-documenting.

### D2: Ring buffer is a fixed-size typed array with a write pointer

```ts
interface RingBuffer<T> { items: T[]; head: number; size: number }
```

`push(buf, item)` writes to `buf.items[buf.head % buf.size]` and increments `head`. Reading ordered items: `items.slice(head % size).concat(items.slice(0, head % size))`. Statically sized at `MAX_EVENTS_PER_AGENT` (500). No allocations after initialization.

_Alternative_: Keep the existing `slice` approach but only do it at read time. Rejected — still allocates on every push.

### D3: `useNow` is a module-level singleton interval, not a React context

```ts
let listeners = new Set<() => void>()
let now = Date.now()
setInterval(() => { now = Date.now(); listeners.forEach(fn => fn()) }, 10_000)

export function useNow() {
  const [t, setT] = useState(now)
  useEffect(() => { listeners.add(() => setT(Date.now())); return () => listeners.delete(...) }, [])
  return t
}
```

Single interval for the whole process, fires at 10s. All TaskPills share one update source.

### D4: IPC failure banner uses existing error pattern in sprintTasks store

Add `pollError: string | null` to `sprintTasks` state. SprintPipeline reads it and renders a dismissible `<ErrorBanner>` when non-null. Retry clears it and re-polls immediately.

## Risks / Trade-offs

- **Risk**: Field-wise allowlist misses a field that the UI actually needs to react to → Mitigation: the allowlist is in one place and easy to extend; the fallback to JSON.stringify for unknown fields prevents silent stale renders
- **Risk**: Ring buffer read order is wrong if not careful about head pointer → Mitigation: unit test with known insertion order and verify read sequence
- **Trade-off**: `useNow` singleton means the interval keeps running even when SprintPipeline is not mounted — acceptable since it is a lightweight 10s tick
