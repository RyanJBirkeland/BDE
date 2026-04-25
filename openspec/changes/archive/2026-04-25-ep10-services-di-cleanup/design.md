## Context

`sprint-mutations.ts` does `const _repo = getSharedSprintTaskRepository()` at module load via a Proxy trap — if the repo isn't ready yet the mutation silently operates on a stale reference. The review services grab the singleton similarly. `sprint-service.ts` exports both raw query wrappers (barrel) and orchestration functions (use-case) from the same module — violates SRP and makes it hard to test either in isolation.

## Goals / Non-Goals

**Goals:**
- Replace module-level singleton capture in `sprint-mutations.ts` with constructor injection
- `review-orchestration-service.ts` and `review-ship-batch.ts` receive repo via `create*({repo, ...})` factory
- Split `sprint-service.ts`: barrel re-export stays as `sprint-service.ts`; use-case logic moves to `sprint-use-cases.ts`
- Review git-op plan: define `ReviewGitOp` discriminated union; `buildReviewGitOpPlan` returns one; exhaustive switch in executor
- `dependency-service.ts`: extract graph operations (cycle detection, reverse index) from blocking-policy logic (should-block check)
- Epic map cache: add simple in-process TTL cache to epic dependency lookups

**Non-Goals:**
- Changing any IPC handler signatures
- Moving logic across process boundaries

## Decisions

### D1: Constructor injection via factory functions

```ts
export function createSprintMutations(deps: { repo: ISprintTaskRepository }): SprintMutations { ... }
```

`index.ts` creates instances once and passes them through. No Proxy, no module-level state.

### D2: ReviewGitOp discriminated union

```ts
type ReviewGitOp =
  | { type: 'mergeLocally' }
  | { type: 'createPr'; title: string; body: string }
  | { type: 'requestRevision'; feedback: string }
  | { type: 'discard' }
```

`executeReviewGitOp(op: ReviewGitOp, ctx)` uses an exhaustive switch — TypeScript errors if a new variant is added without handling it.

### D3: sprint-service.ts split strategy

Keep `sprint-service.ts` as the barrel (backward compat). Add `sprint-use-cases.ts` for `createTaskWithValidation`, `updateTaskFromUi`, etc. Migrate callers to import from the focused module over time.

## Risks / Trade-offs

- **Risk**: Constructor injection changes break callers → Mitigation: composition root (`index.ts`) is the only caller for all these services; update it in one place
- **Trade-off**: Two `sprint-service` modules during transition — documented in barrel file header
