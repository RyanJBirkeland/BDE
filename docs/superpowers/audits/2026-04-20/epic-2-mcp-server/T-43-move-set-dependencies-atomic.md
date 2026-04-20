# T-43 · Move `epics.setDependencies` orchestration into `EpicGroupService` (atomic)

**Severity:** P1 · **Audit lens:** architecture

## Context

`src/main/mcp-server/tools/epics.ts:111` implements `epics.setDependencies` by computing set diffs between current and requested dependencies, then calling `removeDependency` / `addDependency` / `updateDependencyCondition` in a loop. This is business logic (a "replace dependencies atomically" operation) living inside an MCP tool handler — CLAUDE.md says handlers are thin wrappers. The loop is also not atomic: a mid-loop failure leaves partial state that the description claims is "atomic cycle-rejection."

## Files to Change

- `src/main/services/epic-group-service.ts` — add `setDependencies`.
- `src/main/mcp-server/tools/epics.ts` (line 111 — replace loop with service call).
- `src/main/services/__tests__/epic-group-service.test.ts` — add atomicity tests.
- Optionally `src/main/handlers/group-handlers.ts` — expose the same operation via IPC for parity.

## Implementation

Add `setDependencies(epicId: string, deps: EpicDependency[]): Promise<void>` to `EpicGroupService`. The method:

1. Reads current dependencies for `epicId`.
2. Computes the three change sets: `toAdd`, `toRemove`, `toUpdate` (same edge, different condition).
3. Runs cycle detection against the target state (simulate the full replacement before mutating).
4. If cycle detected, throws `EpicGroupError('cycle-detected')` before any mutation.
5. Wraps all mutations in a single SQLite transaction using `better-sqlite3`'s `db.transaction(fn)` helper. Inside the transaction, applies `toRemove`, then `toAdd`, then `toUpdate`. If any step throws, the transaction auto-rolls back.
6. Returns only after commit.

Update `src/main/mcp-server/tools/epics.ts:111` to call the service:

```ts
server.tool('epics.setDependencies', ..., async (args) => {
  await deps.epicService.setDependencies(args.id, args.dependencies)
  return { content: [{ type: 'text', text: 'ok' }] }
})
```

Delete the inline diff-and-loop. Return the same success/error shape the callers expect.

If `group-handlers.ts` already has a `setDependencies` IPC handler, point it at the new service method. If it does not, skip the IPC work here — this task scope is the MCP + service extraction.

## How to Test

```bash
npm run typecheck
npm run test:main -- epic-group-service
npm run test:main -- tools/epics
npm run lint
```

Atomicity tests (new):
1. **Success path** — request a dep change; assert all three change sets applied.
2. **Cycle rejected before mutation** — seed a state where the requested change would cycle; assert throw and assert no rows changed.
3. **Transaction rollback** — mock the dependency-index repo to throw on the second add; assert no rows changed (transaction rolled back).

## Acceptance

- `EpicGroupService.setDependencies` exists with atomic semantics (single SQLite transaction).
- MCP handler at `tools/epics.ts:111` is a one-line service call.
- Three atomicity tests pass.
- Full suite green.

**Depends on:** T-19 (EpicGroupService injected from composition root — otherwise this change is harder to test cleanly).
