# T-23 · Lift module constants above their first use in `index.ts`

**Severity:** P1 · **Audit lenses:** clean-code, architecture

## Context

`src/main/index.ts:157` uses `READY_TO_SHOW_FALLBACK_MS`, `MAX_RENDERER_LOAD_RETRIES`, `RENDERER_RETRY_BASE_DELAY_MS`, `ERR_ABORTED`, and `attachRendererLoadRetry` inside `createWindow` (lines 120–199), but all five are declared at lines 202–234 — *after* the function that references them. This works only because `createWindow` is called asynchronously via `app.whenReady()`, not at module-load time. A refactor that moves the call earlier would throw `ReferenceError` in the temporal dead zone. Violates Clean Code's Stepdown Rule (caller above callee/constant) and the newspaper-layout formatting rule.

## Files to Change

- `src/main/index.ts` — reorder declarations only; no behavioral change.

## Implementation

Move the declarations at lines 202–234 (`READY_TO_SHOW_FALLBACK_MS`, `MAX_RENDERER_LOAD_RETRIES`, `RENDERER_RETRY_BASE_DELAY_MS`, `ERR_ABORTED`, and the `attachRendererLoadRetry` function) to appear **above** `createWindow` at line 120. Preserve declaration order among the five. Keep `createWindow` intact.

Do not merge with T-24 (the `createWindow` split). If T-24 has already landed, reapply the lift against the new structure; the constants still belong above their first use.

After the move, the file should read top-to-bottom as:
1. Imports.
2. Process-level error handlers.
3. `READY_TO_SHOW_FALLBACK_MS`, `MAX_RENDERER_LOAD_RETRIES`, `RENDERER_RETRY_BASE_DELAY_MS`, `ERR_ABORTED`.
4. `attachRendererLoadRetry`.
5. `createWindow`.
6. Remaining `app.on(...)` handlers.
7. `app.whenReady().then(...)`.

## How to Test

```bash
npm run typecheck
npm run lint
npm test -- src/main/__tests__
npm run build
```

Also manually: `npm run dev` and confirm the window opens and the renderer loads. Close and reopen to confirm no regressions in the window lifecycle.

## Acceptance

- The five symbols are declared above `createWindow`.
- `git diff` on `src/main/index.ts` shows only reordered blocks, no logic changes.
- `npm run typecheck && npm test && npm run test:main && npm run lint && npm run build` all green.
- The app starts via `npm run dev` and displays its main window.
