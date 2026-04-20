# T-21 · Unit-test `attachRendererLoadRetry`

**Severity:** P0 · **Audit lens:** testing

## Context

`src/main/index.ts:207` adds a 28-line `attachRendererLoadRetry(window)` helper in an uncommitted change. It is the only recovery path when the renderer fails to load on first launch — exactly the install-critical code a fresh-machine audit cares about. Four branches have no test coverage: retry budget exhaustion logging, `ERR_ABORTED` skip, `isMainFrame` filter, `isDestroyed` guard, and the `RENDERER_RETRY_BASE_DELAY_MS * attemptNumber` backoff computation.

## Files to Change

- `src/main/__tests__/attach-renderer-load-retry.test.ts` (new)
- Optionally extract `attachRendererLoadRetry` and the four constants (`MAX_RENDERER_LOAD_RETRIES`, `RENDERER_RETRY_BASE_DELAY_MS`, `ERR_ABORTED`, `READY_TO_SHOW_FALLBACK_MS`) into `src/main/renderer-load-retry.ts` for testability — imports stay as named re-exports from `index.ts` so no handler registration moves.

## Implementation

Create a vitest suite with a fake `BrowserWindow` whose `webContents.on('did-fail-load', cb)` captures the callback and whose `loadURL` and `isDestroyed` are controllable. Use `vi.useFakeTimers()` for the backoff.

Test cases (one concept per test):

1. **Non-main-frame event ignored** — call cb with `isMainFrame=false`; no retry scheduled, no warn logged.
2. **`ERR_ABORTED` ignored** — call cb with `errorCode=-3, isMainFrame=true`; no retry, no warn.
3. **Retry schedules `loadURL` after base delay** — first failure waits 500ms; assert `loadURL` called once with validated URL.
4. **Backoff scales with attempt number** — trigger three failures; delays are 500, 1000, 1500ms.
5. **Budget exhaustion logs once** — trigger four failures; fourth logs "retry budget exhausted" and does not schedule another `loadURL`.
6. **Destroyed window short-circuits** — set `isDestroyed → true`; callback returns early, no `loadURL`, no warn.

Use `expect(logger.warn).toHaveBeenCalledWith(stringContaining('retry budget exhausted'))` etc.

## How to Test

```bash
npm run test:main -- attach-renderer-load-retry
npm run typecheck
```

## Acceptance

- New test file exists with six cases covering every branch.
- Test file passes under `npm run test:main`.
- `npm run typecheck` green.
- If the helper was extracted into its own file, the re-export from `index.ts` preserves the public call site (`attachRendererLoadRetry(mainWindow)` at `createWindow`).
