## 1. Field-Wise Task Equality

- [x] 1.1 Define `MUTABLE_TASK_FIELDS` constant (allowlist of fields that change during a run) in `src/renderer/src/stores/sprintTasks.ts`
- [x] 1.2 Replace the `JSON.stringify` equality check in `stableTaskRef` (or equivalent poll-merge function) with a field-wise compare using `MUTABLE_TASK_FIELDS`
- [x] 1.3 Add unit tests: unchanged task skips update, changed `status` triggers update, changed field not in allowlist falls back safely

## 2. Ring-Buffer Event Store

- [x] 2.1 Create `src/renderer/src/lib/ringBuffer.ts` with `RingBuffer<T>` type, `createRingBuffer(size)`, `pushToRingBuffer(buf, item)`, and `readRingBuffer(buf)` (returns items in insertion order)
- [x] 2.2 Replace the `[...existing, event]` spread in `sprintEvents` store with `pushToRingBuffer`; replace `slice` cap with ring-buffer capacity
- [x] 2.3 Align `MAX_EVENTS_PER_AGENT` to 500 (canonical value from CLAUDE.md) if it differs
- [x] 2.4 Add unit tests for ring buffer: insertion order, overflow wrap, capacity constant

## 3. Stable Time Reference

- [x] 3.1 Create `src/renderer/src/hooks/useNow.ts` — module-level singleton interval at 10s, returns current timestamp, updates all subscribers
- [x] 3.2 Find all `Date.now()` calls in TaskPill (or equivalent task card component) render bodies and replace with `useNow()`
- [x] 3.3 Verify with a comment or test that `React.memo` on TaskPill now prevents re-renders when task data is unchanged

## 4. Filter Chain Debounce & Nav Index Cache

- [x] 4.1 Debounce the search query write to `sprintFilters` store by 150ms (add debounce in the input handler, not in the store)
- [x] 4.2 Wrap the `partitionSprintTasks()` call and keyboard-nav index arrays in `useMemo` keyed on the task list reference in `SprintPipeline`

## 5. IPC Failure Banner

- [x] 5.1 Add `pollError: string | null` and `clearPollError(): void` to `sprintTasks` store; set on poll failure, clear on success or dismiss
- [x] 5.2 Render a dismissible `ErrorBanner` in `SprintPipeline` when `pollError` is non-null, with a "Retry" button that calls `fetchTasks()` immediately

## 6. Verification

- [x] 6.1 All gates pass: `npm run typecheck` + `npm test` + `npm run lint`
- [x] 6.2 Update `docs/modules/stores/index.md` for `sprintTasks.ts` and `sprintEvents.ts` changes
- [x] 6.3 Update `docs/modules/hooks/index.md` with `useNow.ts` row
- [x] 6.4 Update `docs/modules/lib/renderer/index.md` with `ringBuffer.ts` row
