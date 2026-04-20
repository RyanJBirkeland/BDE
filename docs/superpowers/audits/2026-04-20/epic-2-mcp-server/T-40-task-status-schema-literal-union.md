# T-40 · Preserve `TaskStatus` literal union in the MCP Zod schema

**Severity:** P1 · **Audit lens:** type-safety

## Context

`src/main/mcp-server/schemas.ts:6` declares:

```ts
export const TaskStatusSchema = z.enum([...TASK_STATUSES] as [string, ...string[]])
```

The cast collapses `TASK_STATUSES` (a readonly 9-literal tuple) into a generic `[string, ...string[]]`, so `z.infer<typeof TaskStatusSchema>` resolves to `string` rather than the 9-literal union. Any downstream consumer that narrows on status (`if (t.status === 'review')`) loses exhaustiveness. If a new status literal is added to `TASK_STATUSES`, Zod silently accepts it under the old broad type.

## Files to Change

- `src/shared/task-state-machine.ts` — ensure `TASK_STATUSES` is declared `as const`.
- `src/main/mcp-server/schemas.ts` (line 6 — drop the cast).
- Anywhere `z.infer<typeof TaskStatusSchema>` is consumed, verify exhaustiveness.

## Implementation

1. In `src/shared/task-state-machine.ts`, confirm `TASK_STATUSES` ends with `as const`:

```ts
export const TASK_STATUSES = ['backlog','queued','blocked','active','review','done','cancelled','failed','error'] as const
export type TaskStatus = typeof TASK_STATUSES[number]
```

If it is already `as const`, no change here.

2. In `src/main/mcp-server/schemas.ts:6`, replace with:

```ts
export const TaskStatusSchema = z.enum(TASK_STATUSES)
```

(Zod's overload accepts `readonly [string, ...string[]]` via `z.enum` since v3; if the repo is on an older version that refuses, use `z.enum(TASK_STATUSES as unknown as readonly [TaskStatus, ...TaskStatus[]])` — preserves the literal union.)

3. Run `typecheck` and fix any call sites that previously got away with passing arbitrary strings. Expected sites: `mcp-server/tools/tasks.ts` (create/update), `mcp-server/tools/tasks.test.ts` fixtures.

4. Add one assertion to `src/main/mcp-server/tools/tasks.test.ts` that `TaskStatusSchema.parse('bogus')` throws — proves the schema rejects unknown literals at runtime.

## How to Test

```bash
npm run typecheck
npm run test:main -- schemas
npm run test:main -- tools/tasks
npm run lint
```

## Acceptance

- `z.infer<typeof TaskStatusSchema>` resolves to `TaskStatus` (the 9-literal union), not `string`.
- `TaskStatusSchema.parse('bogus')` throws; the assertion lives in a test.
- No `as [string, ...string[]]` cast remains in `schemas.ts`.
- Full suite green.
