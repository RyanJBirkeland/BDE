## Context

All five changes are surgically scoped to their source files. No shared abstractions are introduced and no cross-cutting refactors are required.

T-18 is the only fix that touches an interface (`AgentHandle`) that other files depend on. Adding an optional property to an interface is backward-compatible: all existing implementors remain valid (TypeScript structural typing requires no changes from them), and the two cast removal sites in `watchdog-loop.ts` simply gain a typed property access.

T-4 requires understanding what `spawnBdeAgent` from `rbt-coding-agent/adapters/bde` actually returns. The module is an optional peer dep loaded via dynamic `import()`. The existing file comment states the adapter returns a handle whose `.messages` iterable emits `SDKWireMessage`-shaped objects — structurally compatible with `AgentHandle`. The `as unknown as` double-cast is therefore not a shape-mismatch workaround; it was written defensively because the author could not inspect the types at that time. The fix narrows to a single `as AgentHandle` with a comment.

Tests follow established codebase patterns: vitest + `vi.mock` for module mocking, `vi.hoisted` for mock factories, and `vi.spyOn` for per-test overrides.

## Goals / Non-Goals

**Goals:**
- Each fix eliminates the identified unsafe cast without introducing new ones.
- Each fix is independently reviewable and independently deployable.
- All changes leave the existing test suite green.
- The two highest-risk fixes (T-18, T-4) gain explicit tests for the paths the cast was guarding.

**Non-Goals:**
- Achieving 100% branch coverage of modified files.
- Refactoring code beyond what is required to remove the cast.
- Introducing a `McpServerRegistrar` type into the shared types — it is an implementation detail of `safe-tool-handler.ts` and should stay file-local.

## Decisions

### Decision 1: `AgentHandle.process` is typed as `ChildProcess | null`, not `ChildProcess`

The existing `as any` access pattern uses a `if (proc && typeof proc.kill === 'function')` guard, which handles the case where `process` is `null` or `undefined`. Typing the property as `ChildProcess | null` preserves this semantics. The property is `readonly` to match the rest of `AgentHandle`'s surface.

**Alternative considered:** Type as `ChildProcess` (non-nullable). Rejected — the CLI adapter path may set `process` to `null` during cleanup; non-nullable would force non-null assertions at every use site.

### Decision 2: The `process` property is added to `AgentHandle` (the interface), not to `ActiveAgent`

`ActiveAgent.handle` is typed as `AgentHandle`. The watchdog code accesses `agent.handle.process` — that is an `AgentHandle` property, not an `ActiveAgent` property. Placing it on `AgentHandle` is the correct layer; it keeps the kill helpers free of any dependency on `ActiveAgent`'s shape.

**Alternative considered:** Add `process` to `ActiveAgent` directly. Rejected — `ActiveAgent.process` would duplicate the handle's state and could diverge; the handle already owns the subprocess.

### Decision 3: T-4 uses a single `as AgentHandle` cast, not a type-guard function

A type-guard would be correct if `rbt-coding-agent` had a materially different shape. The existing file comment confirms structural compatibility. A single cast with a comment is the minimal change that closes the double-cast gap; a full type-guard is premature until the shapes actually diverge.

**Alternative considered:** Define `interface BdeAgentHandle extends AgentHandle` and cast to that. Rejected — the package is not in scope for this epic; adding a mirroring interface creates a second place to update when the upstream API changes.

### Decision 4: The `oauth-checker.ts` logger is module-level, not created per call

`invalidateCheckOAuthTokenCache` is called once at drain-loop startup. Creating the logger module-level (rather than inside the function) avoids a new `createLogger` call on every invocation of `checkOAuthToken` and is consistent with how other modules in `src/main/agent-manager/` manage their loggers.

**Alternative considered:** Create the logger inside `checkOAuthToken` on each call. Rejected — unnecessary allocation; logger creation writes to disk on the first call (rotation check), which should happen once at module load, not per auth check.

### Decision 5: T-33 imports `StreamableHTTPServerTransportOptions` by name rather than using `ConstructorParameters<...>[0]`

`ConstructorParameters<typeof StreamableHTTPServerTransport>[0]` is technically equivalent but opaque. A named import from `@modelcontextprotocol/sdk/server/streamableHttp.js` makes the type visible in IDE hover and future-proofs the config object against SDK changes. The existing import of `StreamableHTTPServerTransport` is already present; adding `StreamableHTTPServerTransportOptions` to that import is a one-line change.

**Alternative considered:** Keep `ConstructorParameters<...>[0]` but remove the `as unknown as`. Rejected — the named type is clearer and makes the intent obvious to any reader.

### Decision 6: `McpServerRegistrar` is a file-local interface in `safe-tool-handler.ts`

The interface captures the minimal shape of `McpServer` that `wrapRegistrationMethod` needs. It is not exported because no other file needs to name it — the only consumer is the proxy wrapper. If a future refactor requires the interface elsewhere, it can be promoted at that time.

**Alternative considered:** Widen the existing `server: McpServer` parameter type by casting to a more specific proxy interface at the function signature level. Rejected — the function signature already accepts `McpServer`; changing it would break callers. The cast-to-registrar pattern keeps the public API unchanged.

## Risks / Trade-offs

- **T-18 adds `process` to `AgentHandle`.** The SDK adapter (`sdk-adapter.ts`) currently returns a handle that does not declare `process`. Because the property is optional, this is not a breaking change. However, any future implementor that does not expose `process` will have the watchdog fall through to the `abort()` fallback — which is the existing safe-default behaviour. Risk: negligible.

- **T-4 depends on `rbt-coding-agent` structural compatibility.** If the upstream package changes its return type in a way that is incompatible with `AgentHandle`, the single `as AgentHandle` cast will still hide the mismatch. The risk is identical to the current `as unknown as AgentHandle` situation — the fix does not worsen it. The correct long-term fix is for `rbt-coding-agent` to export a type that `AgentHandle` structurally satisfies, but that is out of scope for this epic. Risk: low; the single cast is still better than the double cast.

- **T-32 changes the logger used by `getDefaultCredentialService` in the `invalidateCheckOAuthTokenCache` path.** The credential service was receiving `console` (which happens to implement the methods it calls: `warn`, `info`, `error`). It now receives a proper `Logger` instance. The service's log output will now route through the main-process log file rather than the Electron devtools console. This is the desired behaviour but is a minor observability change. Risk: negligible.
