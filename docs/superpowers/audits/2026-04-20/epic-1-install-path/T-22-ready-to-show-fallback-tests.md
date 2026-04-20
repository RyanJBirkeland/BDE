# T-22 · Unit-test the ready-to-show fallback timer

**Severity:** P0 · **Audit lens:** testing

## Context

`src/main/index.ts:149` adds an 8-second `setTimeout` that calls `mainWindow.show()` if the renderer's `ready-to-show` event never fires (defense against a transient network-service crash). The timer is cleared on `ready-to-show` and on `closed`. Three branches are bug-prone and uncovered: timer fires → show; `ready-to-show` preempts → no double show; `closed` preempts → no show on a destroyed window.

## Files to Change

- `src/main/__tests__/ready-to-show-fallback.test.ts` (new)
- Optionally extract the fallback installer from `createWindow` into `src/main/ready-to-show-fallback.ts` as `installReadyToShowFallback(win)` for testability.

## Implementation

Create a vitest suite with a fake `BrowserWindow` mock that:
- Exposes `show()` and `isDestroyed()` as spies.
- Supports `on('ready-to-show', cb)` and `on('closed', cb)` by capturing callbacks into a registry keyed by event name.

Use `vi.useFakeTimers()`.

Test cases:

1. **Timer fires when `ready-to-show` never arrives** — advance time past `READY_TO_SHOW_FALLBACK_MS` (8000ms); assert `show()` called once, `windowShown` flag true, warn log present.
2. **`ready-to-show` preempts the timer** — trigger the captured `ready-to-show` callback before advancing time; advance past 8000ms; assert `show()` called once (from the handler), not twice.
3. **`closed` clears the timer** — trigger the captured `closed` callback before advancing time; advance past 8000ms; assert `show()` never called.
4. **Destroyed window short-circuits the fallback** — advance past 8000ms with `isDestroyed() → true`; assert `show()` not called.

Mock the `logger.warn` output and assert the "likely a transient network-service crash" message is emitted only in case 1.

## How to Test

```bash
npm run test:main -- ready-to-show-fallback
npm run typecheck
```

## Acceptance

- New test file exists with four cases covering every branch.
- Tests pass under `npm run test:main`.
- `npm run typecheck` green.
- The `show()` spy count matches the expected state transitions exactly (no double-show, no show-on-destroyed).
