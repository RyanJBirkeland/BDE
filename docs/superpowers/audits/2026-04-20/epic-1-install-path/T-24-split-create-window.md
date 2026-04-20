# T-24 · Split `createWindow` into single-purpose helpers

**Severity:** P1 · **Audit lens:** clean-code

## Context

`src/main/index.ts:120` defines an 80-line `createWindow()` that does six things: constructs the BrowserWindow, installs an 8s ready-to-show fallback, wires `ready-to-show`/`closed` handlers, attaches `attachRendererLoadRetry`, configures the window-open handler (URL parsing + allow-list), installs a `will-navigate` guard, and branches dev vs production to load the renderer. Violates Clean Code's "functions do one thing" rule.

## Files to Change

- `src/main/index.ts` — extract helpers.

## Implementation

Extract the following top-level functions from `createWindow`. Each takes the `BrowserWindow` (and any other needed value) and returns `void`. Name them for intent:

1. `installReadyToShowFallback(win: BrowserWindow): void` — owns the `windowShown` flag, the 8s `setTimeout`, the `ready-to-show` handler that shows and calls `emitStartupWarnings`, and the `closed` handler that clears the timer. No module-level flag.
2. `installExternalLinkHandler(win: BrowserWindow): void` — calls `win.webContents.setWindowOpenHandler` with URL parsing + `ALLOWED_EXTERNAL_SCHEMES` check; returns `{ action: 'deny' }` unconditionally.
3. `installNavigationGuard(win: BrowserWindow, appUrl: string): void` — adds the `will-navigate` listener that calls `event.preventDefault()` for URLs outside `appUrl`.
4. `loadRendererEntry(win: BrowserWindow): void` — the dev-vs-prod branch and `loadURL`/`loadFile` call, using `is.dev && ELECTRON_RENDERER_URL` to pick.

The final `createWindow` should read as:

```ts
function createWindow(): void {
  const mainWindow = createMainWindow()
  if (!mainWindow) return
  installReadyToShowFallback(mainWindow)
  attachRendererLoadRetry(mainWindow)
  installExternalLinkHandler(mainWindow)
  installNavigationGuard(mainWindow, resolveAppUrl())
  loadRendererEntry(mainWindow)
}
```

Extract `createMainWindow(): BrowserWindow | null` to own the `new BrowserWindow({...})` call plus the headless-system error dialog branch (lines 122–147).

Extract `resolveAppUrl(): string` for the dev/prod branch used by both navigation guard and renderer load.

All existing tests must still pass. Add at least one test per helper that can be unit-tested in isolation (the handler installers and `resolveAppUrl`).

## How to Test

```bash
npm run typecheck
npm run test:main
npm run lint
npm run build
npm run dev   # manual: window opens, renderer loads, external link click opens browser, internal navigation allowed
```

## Acceptance

- `createWindow` body is ≤15 lines and reads as a list of named helper calls.
- Six extracted helpers each have JSDoc explaining what they do (one sentence).
- At least three helpers have direct unit tests (`installReadyToShowFallback`, `installExternalLinkHandler`, `installNavigationGuard`, or `resolveAppUrl`).
- Full suite green; app starts via `npm run dev`.

**Depends on:** T-23 (constants must be above first use first).
