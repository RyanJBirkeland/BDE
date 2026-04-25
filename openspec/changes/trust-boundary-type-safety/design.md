## Context

The BDE main process reads data from three untrusted sources: SQLite rows, local JSON files, and external HTTP APIs. Currently, values from all three are forwarded to TypeScript types using bare `as` casts — meaning the compiler treats them as verified but no runtime check exists. When a value deviates from the expected shape (schema drift, corrupt row, API change), the lie propagates silently until a property access crashes the renderer.

The existing `mapRowToTask` in `sprint-task-mapper.ts` validates 7 of ~40 `SprintTask` fields and spreads the rest with `...row as SprintTask`. Other row types (`Sprint`, `TaskGroup`, `AgentRun`) have no validator at all. External responses (`/oauth/token`, GitHub REST, AI model JSON) are cast with `as T` immediately after `JSON.parse` or `.json()`.

Constraints:
- No new npm dependencies
- No IPC channel signature changes (renderer unaffected)
- No DB migrations (validators read, never write)
- TypeScript strict mode must continue to pass

## Goals / Non-Goals

**Goals:**
- Every value crossing a trust boundary (SQLite → domain, HTTP → domain, JSON file → domain) is runtime-validated before being assigned to a TypeScript type
- Invalid values fail loudly (throw or return a safe default with a logged warning) rather than propagating a lying type
- The validation pattern is consistent and discoverable — one `mapRowToX` or `isX` guard per boundary, no scattered inline casts

**Non-Goals:**
- Validating values that originate from within the main process (function return values, in-memory objects)
- Adding validation to the renderer side (separate concern)
- Changing the shape of any existing type (this is validators, not type redesign)
- Achieving 100% runtime type safety across the entire codebase — only trust boundaries

## Decisions

### Decision 1: Throw on invalid domain entities; safe-default on optional/aggregate data

For row types that represent core domain objects (`SprintTask`, `Sprint`, `TaskGroup`), invalid rows should throw at the boundary so the caller can log and skip. The existing `mapRowsToTasks` already does this — it logs and skips invalid rows. This pattern should be consistent across all row mappers.

For aggregate/metadata reads (`QueueStats`, `AgentMeta[]`, `PersistedTearoff[]`, settings JSON), return a safe default (empty array, null, fallback value) with a logged warning rather than throwing — these are best-effort reads where a partial result is preferable to an outright failure.

**Alternative considered:** Return `Result<T, ValidationError>` at every boundary. Rejected — it would require changes to every call site and is a much larger refactor than the scope of this change.

### Decision 2: Inline field guards over a schema validation library (zod/io-ts)

Each validator is a plain TypeScript function (`isTaskStatus`, `isAgentSource`, `mapRowToSprint`, etc.) that checks the specific fields that matter for that type. No new npm dependency.

**Alternative considered:** Introduce `zod` for schema validation. Rejected — adds a dependency, changes the error message format, and is heavier than needed for this use case. The existing `mapRowToTask` pattern (explicit field extraction) is already readable and consistent with the codebase style.

### Decision 3: `getSettingJson` keeps the optional validator signature; call sites are updated

`getSettingJson<T>(key, validator?)` already accepts an optional validator. The change is to audit every structured call site and pass a validator where one is missing. This is a call-site update, not a breaking API change.

**Alternative considered:** Make the validator required. Rejected — some call sites read primitive settings that don't need validation; making it required would force unnecessary validators everywhere.

### Decision 4: External HTTP validators are thin shape checks, not full schema validation

For `github-fetch.ts` (generic `T[]` cast) and `env-utils.ts` (OAuth response), we add a caller-supplied `validate: (item: unknown) => item is T` parameter. Callers that care about specific fields supply a guard; callers that don't can supply a permissive `isObject` check. This keeps the fetch utility generic while adding the validation seam.

## Risks / Trade-offs

- **Risk: Overly strict validators break existing flows on edge-case DB state** → Mitigation: validators log + skip (not throw) for list queries; only single-row `getTask`-style calls throw. Existing `mapRowsToTasks` already demonstrates this is safe.
- **Risk: Missing a call site** → Mitigation: TypeScript compilation; after adding the validator requirement to `getSettingJson` for known structured keys, any unguarded call site becomes a type error.
- **Risk: Validator maintenance burden** → Trade-off accepted. A validator that gets out of sync with the type is a bug, but it's a visible, testable one — better than a silent lie.

## Migration Plan

All changes are additive at runtime. No DB migrations. No IPC changes. Deploy as a standard PR. Rollback is a revert.
