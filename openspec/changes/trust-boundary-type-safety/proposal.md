## Why

The main process treats SQLite rows and external JSON as trusted typed values via bare `as` casts, but none of those casts are verified at runtime. A corrupt DB row, schema drift, or upstream API change silently produces a lying TypeScript type that propagates across IPC into the renderer — causing crashes that are invisible to the compiler and impossible to diagnose from a stack trace alone.

## What Changes

- Replace the `...row as SprintTask` spread-and-cast in `mapRowToTask` with explicit per-field validation so every DB-to-domain boundary is verified
- Add `mapRowToSprint` validator (currently Sprint rows have no boundary check at all)
- Add union-membership guards for `row.status` / `row.source` in `agent-queries.ts` and `task-group-queries.ts`
- Add `isTaskStatus` guard in `sprint-pr-ops.ts` before state-machine calls
- Add runtime shape validation to `review-repository.ts` findings JSON, `agent-history.ts` agents JSON import, and `tearoff-window-manager.ts` settings read
- Require a validator argument at structured `getSettingJson` call sites in `index.ts` and `paths.ts`
- Add shape validation to OAuth refresh HTTP response in `env-utils.ts`
- Add shape validation to paginated GitHub API responses in `github-fetch.ts`
- Replace repeated `as`-casts in `agent-message-classifier.ts` with type-narrowing guards

## Capabilities

### New Capabilities

- `db-row-validators`: Per-field boundary validators for every SQLite row type that crosses into the domain layer (`SprintTask`, `Sprint`, `TaskGroup`, `AgentMeta`, `AgentRun`). Each validator throws (or returns a safe default) rather than forwarding a lying type.
- `external-response-validators`: Runtime shape validation for all external data sources — GitHub API responses, OAuth token refresh responses, AI model JSON output — before they are assigned to TypeScript types.
- `settings-read-validators`: Enforced validator argument for structured `getSettingJson` call sites; catches settings schema drift between app versions at read time.

### Modified Capabilities

## Impact

- `src/main/data/sprint-task-mapper.ts` — primary change; all downstream consumers of `mapRowToTask` benefit automatically
- `src/main/data/sprint-planning-queries.ts`, `agent-queries.ts`, `task-group-queries.ts`, `sprint-pr-ops.ts`, `review-repository.ts` — each gains a boundary validator
- `src/main/agent-history.ts` — JSON import gains an array + shape guard
- `src/main/tearoff-window-manager.ts` — settings read gains a guard; malformed persisted state no longer crashes startup
- `src/main/data/settings-queries.ts`, `src/main/index.ts`, `src/main/lib/paths.ts` — structured `getSettingJson` call sites updated to pass validators
- `src/main/env-utils.ts`, `src/main/github-fetch.ts` — external HTTP responses validated before use
- `src/main/agent-message-classifier.ts` — `as`-casts replaced with type guards; no behavioral change
- No IPC channel signatures change; no migrations required; no new npm dependencies
