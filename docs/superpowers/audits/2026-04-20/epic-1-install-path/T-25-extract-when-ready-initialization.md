# T-25 · Extract `app.whenReady()` initialization into focused functions

**Severity:** P1 · **Audit lens:** architecture

## Context

`src/main/index.ts:251` starts a `app.whenReady().then(async () => { ... })` callback that runs ~220 lines and constructs: repositories, task-terminal service, PR pollers, cleanup schedulers, agent manager, status server, MCP server, review service + repo, inline git helpers (`getHeadCommitSha`, `getBranch`, `getDiff`), review chat-stream deps, and finally IPC handler registration. Single function, many reasons to change. Refactoring MCP lifecycle today requires editing the main entry point.

## Files to Change

- `src/main/index.ts` — extract initialization stages.

## Implementation

Extract four functions at module scope. Each accepts a typed `deps` parameter (a struct of dependencies produced by the previous stage) and returns the values needed by subsequent stages. No global state.

1. `async function initStartupServices(): Promise<StartupServices>` — constructs DB connection, repositories (`sprint-task-repository`, `cost-repository`, `agent-run-repository`, `review-repository`), the task-terminal service, the agent manager, and the status server. Returns them grouped.

2. `function createReviewWiring(services: StartupServices): ReviewWiring` — builds the review service with injected repos and a `GitAdapter` (see T-27 for git helpers; for this task, keep them inline inside this function so they move together). Returns `{ reviewService, reviewChatStreamDeps }`.

3. `function wireMcpServer(services: StartupServices): McpServerHandle | null` — reads `mcp.enabled`, starts or skips the MCP server, and wires the settings-change listener that restarts on `mcp.port` change. Returns a handle or `null`.

4. `function schedulePollers(services: StartupServices): void` — starts PR poller, sprint PR poller, and the periodic cleanup timers.

The `whenReady` body becomes:

```ts
app.whenReady().then(async () => {
  electronApp.setAppUserModelId('com.fleet')
  const services = await initStartupServices()
  const review = createReviewWiring(services)
  const mcp = wireMcpServer(services)
  schedulePollers(services)
  registerAllHandlers({ ...services, ...review, mcp })
  createWindow()
})
```

Each extracted function must have JSDoc naming what it owns. `registerAllHandlers` already exists (or extract it from the bottom of `whenReady` — the long block of `*Handlers(...)` calls) and takes a single typed `deps` parameter.

Do not change handler registration order. Do not change startup semantics. If a handler currently depends on a service constructed later, surface that as a TODO comment on the handler — do not silently reorder.

## How to Test

```bash
npm run typecheck
npm run test:main
npm run lint
npm run build
npm run dev   # full-stack smoke: app launches, DB migrates, MCP toggles, drain loop ticks
```

## Acceptance

- `whenReady` body is ≤15 lines.
- Four extracted functions each have a typed deps struct and JSDoc.
- All handler registrations happen via a single `registerAllHandlers(deps)` call.
- `npm run typecheck && npm test && npm run test:main && npm run lint && npm run build` all green.
- App launches via `npm run dev`; drain loop picks up a queued task successfully (manual smoke).
