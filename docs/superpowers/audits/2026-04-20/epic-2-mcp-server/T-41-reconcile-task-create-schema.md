# T-41 · Reconcile `TaskCreateSchema` with `CreateTaskInput`

**Severity:** P1 · **Audit lens:** type-safety

## Context

`src/main/mcp-server/tools/tasks.ts:95` does `TaskCreateSchema.parse(rawArgs) as CreateTaskInput`. The Zod schema (`TaskWriteFieldsSchema`) and the `CreateTaskInput` TypeScript type have asymmetric fields. Schema includes `spec_type` and `max_runtime_ms`; `CreateTaskInput` includes `prompt`, `notes`, `template_name`, `model`, and `cross_repo_contract`. The cast silences this structural mismatch — MCP callers assume the surface mirrors `CreateTaskInput` but it does not, and fields accepted at the schema boundary quietly disappear when forwarded.

## Files to Change

- `src/main/mcp-server/schemas.ts` — align `TaskWriteFieldsSchema` with the actual `CreateTaskInput`.
- `src/main/mcp-server/tools/tasks.ts` (line 95 — drop the cast).
- `src/main/mcp-server/tools/tasks.test.ts` — add round-trip fixture covering every field.
- `src/shared/types/task-types.ts` (or wherever `CreateTaskInput` lives) — confirm the source-of-truth shape.

## Implementation

1. Read `CreateTaskInput` and list its fields. Compare to `TaskWriteFieldsSchema`. The schema must accept every field that `CreateTaskInput` supports (with matching types), excluding only system-managed fields documented in the schema comment (`claimed_by`, `pr_*`, `completed_at`, `agent_run_id`, `failure_reason`).

2. Add missing schema fields: `prompt: z.string().max(200_000).optional()`, `notes: z.string().max(10_000).optional()`, `template_name: z.string().max(200).optional()`, `model: z.string().max(100).optional()`, `cross_repo_contract: z.string().max(10_000).optional()`. Preserve current max-length caps or mirror the DB column caps.

3. Remove any schema-only fields that are not part of `CreateTaskInput` unless they have an explicit reason to exist. `spec_type` stays (documented; consumed). `max_runtime_ms` stays (documented; consumed).

4. In `src/main/mcp-server/tools/tasks.ts:95`, change:

```ts
const input = TaskCreateSchema.parse(rawArgs) as CreateTaskInput
```

to:

```ts
const input: CreateTaskInput = TaskCreateSchema.parse(rawArgs)
```

If the types still don't align, `typecheck` will surface it — fix the schema rather than re-casting.

5. Add one test that calls `tasks.create` with every `CreateTaskInput` field populated and asserts the created task round-trips each value through `tasks.get`.

## How to Test

```bash
npm run typecheck
npm run test:main -- schemas
npm run test:main -- tools/tasks
npm run test:main -- mcp-server.integration
npm run lint
```

## Acceptance

- `TaskCreateSchema.parse(x)` return type is structurally equal to `CreateTaskInput` without a cast.
- One full-field round-trip test exists and passes.
- `typecheck` is green without the cast.
- Full suite green.
