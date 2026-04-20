# T-33 · Extract `cancelTask` orchestration into `sprint-service`

**Severity:** P1 · **Audit lenses:** clean-code, architecture

## Context

`src/main/mcp-server/index.ts:54` defines an inline closure that calls `updateTask({ status: 'cancelled', notes })` then fires-and-forgets `onStatusTerminal` with an error-logging catch. The same two-step terminal transition is duplicated in `src/main/handlers/sprint-local.ts:118` and `:261`. This is a classic shotgun-surgery smell — the same business policy lives in two places, and the MCP closure is embedded in composition/wiring code where it doesn't belong per CLAUDE.md ("handlers delegate — they contain no business logic").

## Files to Change

- `src/main/services/sprint-service.ts` (new or existing — add `cancelTask`)
- `src/main/mcp-server/index.ts` (line 54 — replace closure with service call)
- `src/main/handlers/sprint-local.ts` (lines 118, 261 — replace duplicated two-step with service call)

## Implementation

Add `cancelTask(id: string, opts: { reason?: string; actor?: string }): Promise<void>` to `sprint-service`. It:

1. Reads the current task via the injected repository.
2. Validates the transition to `cancelled` (use `isValidTransition()` from `src/shared/task-transitions.ts`).
3. Calls `updateTask(id, { status: 'cancelled', notes: reason })`.
4. Invokes `onStatusTerminal(id, 'cancelled')` and awaits it (don't fire-and-forget — callers decide whether to await).
5. Wraps any errors with a typed `SprintServiceError` so callers distinguish "task not found" from "transition invalid" from "terminal handler failed".

The service constructor takes `{ repo: ISprintTaskRepository; onStatusTerminal: TaskTerminalHandler; logger: Logger }`. Composition-root wires both MCP and IPC handlers to the same instance.

Update `src/main/mcp-server/index.ts:54` to delete the inline closure and pass `sprintService.cancelTask` into `registerTaskTools(server, deps)`.

Update `src/main/handlers/sprint-local.ts:118` and `:261` to call `sprintService.cancelTask(id, { reason })` instead of the duplicated two-step.

Keep the existing `safeHandle()` wrapper around the IPC registration — only the handler body changes.

## How to Test

```bash
npm run typecheck
npm run test:main -- sprint-service
npm run test:main -- sprint-local
npm run test:main -- mcp-server
npm run lint
```

Add unit tests for `sprint-service.cancelTask` covering:
- Happy path: valid transition, `updateTask` called, `onStatusTerminal` awaited.
- Invalid transition: throws `SprintServiceError('invalid-transition')`, no updateTask/terminal call.
- `onStatusTerminal` rejects: error propagated with context, task status already cancelled.
- Unknown task id: throws `SprintServiceError('not-found')`.

## Acceptance

- `sprint-service.cancelTask` exists with four covered test cases.
- MCP `cancelTask` closure at `mcp-server/index.ts:54` replaced with a one-line service call.
- Both `sprint-local.ts` cancellation sites replaced with service calls.
- Existing MCP and IPC tests still pass.
- Full suite green; no behavior change from the user's perspective.
