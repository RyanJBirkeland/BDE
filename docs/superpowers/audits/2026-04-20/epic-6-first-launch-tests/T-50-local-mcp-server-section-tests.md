# T-50 · Add tests for `LocalMcpServerSection`

**Severity:** P1 · **Audit lens:** testing

## Context

`src/renderer/src/components/settings/LocalMcpServerSection.tsx` is 155 LOC and controls an opt-in local HTTP port + bearer token display. There is no test file under `src/renderer/src/components/settings/__tests__/`. Toggling, token regeneration, copy-to-clipboard, and port/status display are all public-API behaviors with no regression net — and this is a security-sensitive surface.

## Files to Change

- `src/renderer/src/components/settings/__tests__/LocalMcpServerSection.test.tsx` (new)

## Implementation

Create the test file following the pattern in existing settings test files (e.g. `AboutSection.test.tsx`, `RepositoriesSection.test.tsx`). Use vitest + `@testing-library/react`.

Mock `window.api` with a fake that exposes:
- `settings.getJson`, `settings.get`, `settings.set` (for `mcp.enabled`, `mcp.port`, `mcp.token`)
- `mcp.getStatus` (or whatever the status query IPC is — read the component for the exact channel names)
- `mcp.regenerateToken` (or equivalent)

Mock `navigator.clipboard.writeText` with a spy.

Test cases (one concept per test):

1. **Renders disabled state** — `mcp.enabled` is `false`; the toggle shows off; token and port controls are disabled or hidden per the component's design.
2. **Enables server** — user clicks the toggle; `settings.set('mcp.enabled', true)` is called; the server-status indicator updates on the next poll.
3. **Displays masked token** — `mcp.enabled` is true; token is present; the masked form (bullets) is displayed; plain text is not.
4. **Reveal-and-copy** — click the reveal button (if present) or the copy button; `clipboard.writeText` called with the plain token; toast or visual confirmation appears.
5. **Regenerate confirm** — click Regenerate; the `ConfirmModal` (or the current `window.confirm` if T-51 has not landed yet) is shown; accept; `mcp.regenerateToken` called; new token replaces the old.
6. **Regenerate cancel** — same flow; decline; `mcp.regenerateToken` not called.
7. **Port field commits** — type a port; commit on blur/Enter (or every keystroke per current behavior); `settings.set('mcp.port', <number>)` called with the right numeric value. Note: if T-52 lands first, this test becomes "commits on blur, not on every keystroke."
8. **Port rejects non-numeric** — type `abc`; `settings.set` not called with NaN; an error or validation message is surfaced.
9. **Status badge reflects server state** — when `mcp.getStatus` returns `{ running: true, port: 18792 }`, the UI shows the running badge; when `{ running: false }`, the stopped badge.

Do not test the server itself — that's covered by MCP integration tests. Only test this component's behavior.

## How to Test

```bash
npm test -- LocalMcpServerSection
npm run typecheck
npm run lint
```

## Acceptance

- `__tests__/LocalMcpServerSection.test.tsx` exists with the nine cases above (or functionally equivalent coverage).
- All cases pass.
- No flaky timing dependencies (use `await waitFor` for async state).
- Full suite green.
