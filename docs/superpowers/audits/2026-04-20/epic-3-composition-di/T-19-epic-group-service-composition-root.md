# T-19 · Move `EpicGroupService` construction to the composition root

**Severity:** P1 · **Audit lens:** architecture

## Context

`src/main/handlers/group-handlers.ts:11` holds `let service: EpicGroupService | null = null` and exports a `getEpicGroupService()` accessor. `src/main/index.ts:278` calls this getter rather than constructing the service at the composition root and injecting it downward. The same singleton is consumed by agent-manager, mcp-server, and task-terminal-service — all reaching into a handler module for a cached instance. This inverts the Dependency Inversion rule and prevents test-time substitution without module reset.

## Files to Change

- `src/main/handlers/group-handlers.ts` — remove `let service` and `getEpicGroupService`; accept the service as a registration parameter.
- `src/main/index.ts` — construct `EpicGroupService` once at startup and pass to every consumer.
- `src/main/agent-manager/` — accept `EpicGroupService` via constructor/config.
- `src/main/mcp-server/index.ts` — already accepts `epicService` via deps; confirm the value comes from the composition root, not `getEpicGroupService()`.
- `src/main/services/task-terminal-service.ts` — accept via constructor injection.

## Implementation

1. In `src/main/index.ts`, inside `initStartupServices` (or the equivalent), construct once:

```ts
const epicService = new EpicGroupService({ repo: epicGroupRepository, logger })
```

2. Pass `epicService` as a dependency to every consumer:
   - `createAgentManager(config, repo, logger, { epicService })` — extend the deps shape if needed.
   - `createMcpServer({ ..., epicService })` — already accepts this.
   - `createTaskTerminalService({ repo, epicService, logger })`.
   - `registerGroupHandlers({ epicService })` instead of `registerGroupHandlers()` with a global getter.

3. In `src/main/handlers/group-handlers.ts`:
   - Delete `let service: EpicGroupService | null = null`.
   - Delete `getEpicGroupService()` and `setEpicGroupService()` if it exists.
   - Change `registerGroupHandlers()` to `registerGroupHandlers(deps: { epicService: EpicGroupService })` and use `deps.epicService` inside handlers.

4. Grep for all call sites of `getEpicGroupService`:

```bash
grep -rn "getEpicGroupService" src/
```

Replace each with the injected instance passed through the dep chain.

5. If tests previously imported `getEpicGroupService` for stubbing, update them to construct their own `EpicGroupService` with a fake repo.

## How to Test

```bash
npm run typecheck
npm run test:main -- group-handlers
npm run test:main -- epic-group-service
npm run test:main -- mcp-server
npm run test:main -- task-terminal-service
npm run test:main -- agent-manager
npm run lint
```

## Acceptance

- `getEpicGroupService` and the module-level `let service` are gone.
- `EpicGroupService` is constructed exactly once in the composition root and injected to every consumer.
- Existing tests still pass; test files no longer rely on module reset to inject a fake service.
- Full suite green.
