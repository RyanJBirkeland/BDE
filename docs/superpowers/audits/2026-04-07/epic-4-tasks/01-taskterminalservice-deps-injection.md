# Replace TaskTerminalService module-level setters with constructor-injection dependency

## Problem

The `TaskTerminalService.onStatusTerminal` callback is the single most important hook in BDE's data layer — it fires dependency resolution when any task reaches a terminal status (done, cancelled, failed, error). The hook MUST fire for every terminal transition or downstream tasks stay blocked forever.

Currently the callback is wired via **four separate module-level setters** in four different files:

| File                                | Setter name                          | Module var              |
| ----------------------------------- | ------------------------------------ | ----------------------- |
| `src/main/handlers/sprint-local.ts` | `setOnStatusTerminal(fn)`            | `let _onStatusTerminal` |
| `src/main/handlers/git-handlers.ts` | `setGitHandlersOnStatusTerminal(fn)` | `let _onStatusTerminal` |
| `src/main/handlers/review.ts`       | `setReviewOnStatusTerminal(fn)`      | `let _onStatusTerminal` |
| `src/main/sprint-pr-poller.ts`      | `setOnTaskTerminal(fn)`              | `let _onTaskTerminal`   |

`src/main/index.ts` calls all four setters at boot (lines ~151-154). Each file has defensive `if (!_onStatusTerminal) logger.warn(...)` fallbacks because **the wiring has silently broken before**. Adding a fifth handler means adding a fifth setter, a fifth fallback, and one more thing for `index.ts` to remember to wire up.

**All three architects (Alpha, Bravo, Gamma) flagged this as CRITICAL** in the 2026-04-07 audit. The top-20 prioritized action list made it item #8.

## Solution

Replace all four setters with **constructor-injection via a `deps` argument** to each module's `register*` / `start*` function. Dependency resolution becomes a required argument — impossible to forget, impossible to silently no-op.

### Exact changes per file

**1. `src/main/handlers/sprint-local.ts`**

- Delete: `let _onStatusTerminal: ((taskId: string, status: string) => void) | null = null` (line 75)
- Delete: `export function setOnStatusTerminal(fn: ...): void { _onStatusTerminal = fn }` (lines 77-79)
- Change: `export function registerSprintLocalHandlers(): void {` → `export function registerSprintLocalHandlers(deps: SprintLocalDeps): void {`
- Add near top of file: `export interface SprintLocalDeps { onStatusTerminal: (taskId: string, status: string) => void | Promise<void> }`
- Replace all `_onStatusTerminal(id, ...)` call sites (around lines 195, 530) with `deps.onStatusTerminal(id, ...)`
- Delete the `if (!_onStatusTerminal) logger.warn(...)` fallback blocks (around lines 188-194, 524-529) — they're no longer needed since deps is required. Just call `deps.onStatusTerminal(...)` directly.

**2. `src/main/handlers/git-handlers.ts`**

- Delete: `let _onStatusTerminal: ... | null = null` (line 138)
- Delete: `export function setGitHandlersOnStatusTerminal(fn: ...): void` (lines 140-142)
- Change: `export function registerGitHandlers(): void {` → `export function registerGitHandlers(deps: GitHandlersDeps): void {`
- Add interface near the top: `export interface GitHandlersDeps { onStatusTerminal: (taskId: string, status: string) => void | Promise<void> }`
- Replace `_onStatusTerminal?.(id, 'done')` / `_onStatusTerminal?.(id, 'cancelled')` call sites (lines 269, 272) with `deps.onStatusTerminal(id, 'done')` / `deps.onStatusTerminal(id, 'cancelled')` (no optional chaining — deps is required).

**3. `src/main/handlers/review.ts`**

- Delete: `let _onStatusTerminal: ... | null = null` (line 27)
- Delete: `export function setReviewOnStatusTerminal(fn: ...): void` (lines 29-31)
- Change: `export function registerReviewHandlers(): void {` → `export function registerReviewHandlers(deps: ReviewHandlersDeps): void {`
- Add interface near the top: `export interface ReviewHandlersDeps { onStatusTerminal: (taskId: string, status: string) => void | Promise<void> }`
- Replace all `if (_onStatusTerminal) { _onStatusTerminal(...) } else { logger.warn(...) }` blocks (around lines 296, 368, 472, 665) with direct calls: `deps.onStatusTerminal(taskId, 'done')` or `deps.onStatusTerminal(taskId, 'cancelled')`. Delete the warn fallbacks.

**4. `src/main/sprint-pr-poller.ts`**

- Delete: `let _onTaskTerminal: ... | null = null` (line 108)
- Delete: `export function setOnTaskTerminal(fn: ...): void` (lines 110-112)
- Change: `export function startSprintPrPoller(): void {` → `export function startSprintPrPoller(deps: SprintPrPollerDeps): void {`
- Add interface near the top: `export interface SprintPrPollerDeps { onStatusTerminal: (taskId: string, status: string) => void | Promise<void> }`
- Replace `if (_onTaskTerminal) { _onTaskTerminal(taskId, status) }` (lines 124-126) with `deps.onStatusTerminal(taskId, status)` (note: rename `_onTaskTerminal` → `onStatusTerminal` for consistency across modules).

**5. `src/main/index.ts`**

- Delete the four setter imports (lines 25, 54, 55, 56 — specifically remove `setReviewOnStatusTerminal`, `setOnStatusTerminal`, `setGitHandlersOnStatusTerminal`, `setOnTaskTerminal` from their respective import statements; keep the other imports like `registerReviewHandlers` from the same lines).
- Delete the four setter calls (lines 151-154).
- Change the four call sites that currently call `registerGitHandlers()`, `registerSprintLocalHandlers()`, `registerReviewHandlers()`, `startSprintPrPoller()` to pass the deps object:
  ```ts
  const terminalDeps = { onStatusTerminal: terminalService.onStatusTerminal }
  registerGitHandlers(terminalDeps)
  registerSprintLocalHandlers(terminalDeps)
  registerReviewHandlers(terminalDeps)
  startSprintPrPoller(terminalDeps)
  ```
  These are NOT in lines 151-154 anymore — you're moving the wiring INTO the register calls themselves. Find the actual register/start call sites (around lines 283-297 for registers, 159 for startSprintPrPoller) and update them to pass `terminalDeps`.

### Tests to update

- `src/main/handlers/__tests__/review.test.ts` imports `setReviewOnStatusTerminal` at line 103 and uses it at line 136, 402. Update the tests to use the new constructor pattern: instead of calling `setReviewOnStatusTerminal(mockFn)`, pass `{ onStatusTerminal: mockFn }` as the `deps` argument to `registerReviewHandlers(deps)`. The existing test around line 134 (`'setReviewOnStatusTerminal sets the callback'`) should be renamed/rewritten to test that the deps callback is correctly passed through and called on terminal transitions.
- Any other tests that import these setters must be updated the same way. Grep for `setOnStatusTerminal`, `setGitHandlersOnStatusTerminal`, `setOnTaskTerminal`, `setReviewOnStatusTerminal` in `src/main/**/__tests__/` and update each.

### Do NOT

- Do NOT change `TaskTerminalService` itself (`src/main/services/task-terminal-service.ts`) — the service's `onStatusTerminal` method signature stays the same.
- Do NOT change `updateTask()` or sprint-queries — this refactor is strictly at the handler-registration boundary.
- Do NOT add a new "fire hook in data layer" pattern (audit's alternative approach B) — this task is the deps-injection approach only.
- Do NOT rename the existing functions (`registerGitHandlers`, `registerSprintLocalHandlers`, `registerReviewHandlers`, `startSprintPrPoller`). Only their signatures change.

## Files to Change

- `src/main/handlers/sprint-local.ts`
- `src/main/handlers/git-handlers.ts`
- `src/main/handlers/review.ts`
- `src/main/sprint-pr-poller.ts`
- `src/main/index.ts`
- `src/main/handlers/__tests__/review.test.ts` (and any other test files that import the removed setters)

## How to Test

1. `npm run typecheck` — 0 errors. This is the primary safety net — the type system will catch any caller that still references the removed setters.
2. `npm run test:main` — all tests pass. Update any test that imported the removed setters (guaranteed: `review.test.ts`; possibly others — grep first).
3. `npm run test:coverage` — all renderer tests pass. If you see flakes, re-run the specific failing file in isolation before concluding anything about pre-existing failures.
4. `npm run lint` — 0 errors.
5. Verification greps (all must return zero matches after the fix):
   - `grep -n "_onStatusTerminal" src/main/handlers/ src/main/sprint-pr-poller.ts`
   - `grep -n "setOnStatusTerminal\|setGitHandlersOnStatusTerminal\|setReviewOnStatusTerminal\|setOnTaskTerminal" src/main/`
6. `grep -n "deps.onStatusTerminal" src/main/handlers/ src/main/sprint-pr-poller.ts` — must return at least 5 matches (one per call site).

## Why this matters

This is the single most fragile architectural seam in the codebase. Every future handler that needs dependency resolution has to remember to wire up its own setter — or forget and silently break the whole system. After this refactor, it's impossible to compile without wiring it up.
