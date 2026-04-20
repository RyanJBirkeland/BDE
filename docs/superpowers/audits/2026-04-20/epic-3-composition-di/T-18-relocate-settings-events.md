# T-18 · Relocate the `settings-events` emitter out of `mcp-server/`

**Severity:** P1 · **Audit lens:** architecture

## Context

`src/main/handlers/config-handlers.ts:13` imports `emitSettingChanged` from `../mcp-server/settings-events`. The generic settings IPC layer now has a source dependency on a specific subsystem folder. The event bus is the right mechanism, but its location couples a stable module (settings IPC) to a volatile one (mcp-server). Per Clean Architecture, stable modules should not depend on volatile ones — relocate the bus to a neutral location.

## Files to Change

- `src/main/events/settings-events.ts` (new — destination)
- `src/main/mcp-server/settings-events.ts` (existing — delete after move)
- `src/main/handlers/config-handlers.ts` (line 13 — import path update)
- `src/main/mcp-server/index.ts` — import path update
- Any other consumer of `mcp-server/settings-events` — import path update

## Implementation

1. Create `src/main/events/settings-events.ts` with the exact contents of `src/main/mcp-server/settings-events.ts`. Preserve the public API (`emitSettingChanged`, any exported types, any listener-registration helpers).

2. Update `src/main/handlers/config-handlers.ts:13` to import from `../events/settings-events`.

3. Grep the repo for `mcp-server/settings-events` and update every consumer:

```bash
grep -rn "mcp-server/settings-events" src/
```

Expected consumers: `src/main/handlers/config-handlers.ts`, `src/main/mcp-server/index.ts`, possibly `src/main/mcp-server/transport.ts` or a test file.

4. Delete `src/main/mcp-server/settings-events.ts` after all imports are moved.

5. Preserve existing tests. If `mcp-server/settings-events.test.ts` exists, move it to `src/main/events/__tests__/settings-events.test.ts` and update the import.

## How to Test

```bash
npm run typecheck
npm run test:main -- settings-events
npm run test:main -- config-handlers
npm run test:main -- mcp-server
npm run lint
```

Manual smoke: toggle `mcp.enabled` in Settings; confirm the MCP server starts/stops as before. Change `mcp.port`; confirm the server restarts.

## Acceptance

- `src/main/events/settings-events.ts` exists with the public API.
- `src/main/mcp-server/settings-events.ts` is deleted.
- No remaining `mcp-server/settings-events` imports in the repo.
- Existing tests still pass; behavior unchanged.
- Full suite green; manual MCP toggle works.
