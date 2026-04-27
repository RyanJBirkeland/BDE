## Why

`sprint-mutations.ts` installs a module-level Proxy that captures `getSharedSprintTaskRepository()` at import time — if the repo isn't initialised yet, mutations silently operate on a stale reference. `review-orchestration-service.ts` and `review-ship-batch.ts` call `getSharedSprintTaskRepository()` at module load. `sprint-service.ts` is simultaneously a barrel re-export, a decorator, and a use-case orchestrator — three responsibilities in one file. The review git-op plan is built and then re-validated at runtime via `if/else` chains that can fall through to an unexpected default.

## What Changes

- `sprint-mutations.ts` Proxy replaced with explicit constructor injection — caller passes the repo instance
- `review-orchestration-service.ts` and `review-ship-batch.ts` receive the repo via constructor/factory parameter
- `sprint-service.ts` split: barrel re-export stays, use-case logic moves to focused modules
- Review git-op plan becomes a discriminated union (`MergeLocally | CreatePr | RequestRevision | Discard`) with an exhaustive switch in the plan builder — no runtime `if/else` fall-through
- Epic dependency graph ownership clarified: `EpicGroupService` owns the graph; `dependency-service.ts` owns task deps; cache added to epic map lookup

## Capabilities

### New Capabilities

- `review-gitop-discriminated-union`: Typed discriminated union for review git-op plans — exhaustive switch eliminates fall-through bugs

### Modified Capabilities

<!-- Architectural refactor — same behavior, better DI hygiene -->

## Impact

- `src/main/services/sprint-mutations.ts` — remove Proxy, inject repo
- `src/main/services/review-orchestration-service.ts` — inject repo via constructor
- `src/main/services/review-ship-batch.ts` — inject repo via constructor
- `src/main/services/sprint-service.ts` — split barrel from use-case logic
- `src/main/services/dependency-service.ts` — split graph from blocking policy
- `src/main/index.ts` — composition root wires new constructor signatures
