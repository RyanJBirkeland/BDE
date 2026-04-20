# T-5 · Preserve typed row from `repo.getQueuedTasks`

**Severity:** P1 · **Audit lens:** type-safety

## Context

`src/main/agent-manager/index.ts:369` has:

```ts
const rows = repo.getQueuedTasks(available) as unknown as Array<Record<string, unknown>>
```

`IAgentTaskRepository.getQueuedTasks` (or `ISprintTaskRepository.getQueuedTasks`) already returns a typed row shape. The double cast (`as unknown as Record<string, unknown>`) erases every field, forcing `_processQueuedTask` and `_validateAndClaimTask` to take `Record<string, unknown>`. Column-name typos (e.g. `'claimed_by'` vs `'claimedBy'`) no longer fail at compile time — the only guard is the mapping layer, which already uses the typed shape upstream.

## Files to Change

- `src/main/agent-manager/index.ts` (line 369 — remove the double cast)
- Wherever the repo interface is declared: `src/main/data/sprint-task-repository.ts` or `src/main/data/agent-task-repository.ts` — confirm the return type is exactly what the rows require.
- `_processQueuedTask` and `_validateAndClaimTask` (elsewhere in `index.ts`) — update their parameter types to match.

## Implementation

1. Read the repo interface's `getQueuedTasks` declaration. Note its return type (likely `Array<SprintTaskCore>` or `Array<{ id: string; repo: string; status: TaskStatus; ... }>`).

2. Replace line 369 with:

```ts
const rows = repo.getQueuedTasks(available)
```

(no cast).

3. Update `_processQueuedTask(row: Record<string, unknown>)` and `_validateAndClaimTask(row: Record<string, unknown>)` to accept the typed row:

```ts
_processQueuedTask(row: QueuedTaskRow): Promise<void>
_validateAndClaimTask(row: QueuedTaskRow): boolean
```

where `QueuedTaskRow` is the repo's declared return-element type (reuse — do not redeclare).

4. Run `typecheck` and fix any genuine mismatches the compiler surfaces. Do not re-cast. If a field is missing from the typed shape, add it to the repo interface or to a view type (`SprintTaskCore` etc.) — do not paper over with `any`.

5. If there is an internal field access like `row['claimed_by']` that uses string indexing, switch to `row.claimed_by` (or the correct camelCase field if the mapper renames).

## How to Test

```bash
npm run typecheck
npm run test:main -- agent-manager
npm run lint
```

Confirm the drain loop still picks up a queued task (manual smoke — queue a trivial task via Task Workbench and watch it transition to active).

## Acceptance

- No `as unknown as` cast on the `getQueuedTasks` return value.
- `_processQueuedTask` and `_validateAndClaimTask` accept the typed row shape.
- `typecheck` green without any new `any`.
- Full suite green; drain loop works end-to-end.
