# T-46 · Drop the `as SprintTask` cast from `fakeTask` builder

**Severity:** P3 · **Audit lens:** testing

## Context

`src/main/mcp-server/tools/tasks.test.ts:28` has a `fakeTask` builder that accepts `overrides: Partial<SprintTask>` and returns the merged result cast as `SprintTask`. The outer `as SprintTask` silences type errors if `SprintTask` gains a required field in the future — the whole point of a typed builder is to catch that at compile time.

## Files to Change

- `src/main/mcp-server/tools/tasks.test.ts` (around line 28 — the `fakeTask` definition)

## Implementation

Define a complete base `SprintTask` with every required field explicitly populated (use the narrowest sensible defaults — `null` for optional nullable fields, `0` for counts, `''` or `'backlog'` for required strings). Spread `overrides` on top without a trailing cast.

```ts
const baseTask: SprintTask = {
  id: 't1',
  title: 'test',
  repo: 'fleet',
  prompt: null,
  priority: 0,
  status: 'backlog',
  notes: null,
  spec: null,
  retry_count: 0,
  fast_fail_count: 0,
  agent_run_id: null,
  // ...every other required SprintTask field
  created_at: '2026-04-20T00:00:00.000Z',
  updated_at: '2026-04-20T00:00:00.000Z'
}

const fakeTask = (overrides: Partial<SprintTask> = {}): SprintTask => ({ ...baseTask, ...overrides })
```

Drop the outer cast on the return value. If `SprintTask` has required fields `baseTask` is missing, `tsc` will flag them — fix by adding the field to `baseTask` rather than adding it to the cast.

## How to Test

```bash
npm run typecheck
npm run test:main -- tools/tasks
```

Adding a new required field to `SprintTask` should now fail `typecheck` in this test file until `baseTask` is updated — that's the guard we want.

## Acceptance

- No `as SprintTask` cast anywhere in `tasks.test.ts`.
- `baseTask` is a fully typed SprintTask literal.
- Typecheck and main tests green.
