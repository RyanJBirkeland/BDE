## Why

Five unsafe casts in `src/main/agent-manager/` and `src/main/mcp-server/` each hide a shape mismatch that would produce a runtime crash rather than a compile error. TypeScript's job is to surface these mismatches at build time; every `as any` or `as unknown as` at a public interface boundary defeats that. All five findings were surfaced by the multi-lens type-safety audit.

The two P1 findings are the highest risk: the `as any` casts in `watchdog-loop.ts` access `.process` on a subprocess handle without any compile-time guarantee the property exists, and the `as unknown as AgentHandle` double-cast in `local-adapter.ts` makes it impossible for the compiler to detect if `rbt-coding-agent`'s return type diverges from `AgentHandle`. Both paths are exercised on every watchdog tick and every local-backend agent spawn.

The three P2 findings are lower in frequency but still dangerous: `console as unknown as Logger` in `oauth-checker.ts` throws at runtime if any callee calls a Logger-specific method (`createChild`, `event`); the `as unknown as ConstructorParameters<...>[0]` in `opencode-session-mcp.ts` is unnecessary (all four config properties are already in `StreamableHTTPServerTransportOptions`) and exists only because the developer did not check the SDK types; the four `as any` casts in `safe-tool-handler.ts` make `McpServer` API changes invisible to the compiler at four separate sites.

None of these require new features or architectural changes. Each fix is small, independently reviewable, and leaves the existing test suite green.

## What Changes

- **T-18** — `AgentHandle` interface in `types.ts` gains `readonly process?: ChildProcess | null`. Both `as any` casts in `watchdog-loop.ts` (`forceKillAgent` line 92, `abortAgent` line 134) are removed. The existing `typeof proc.kill === 'function'` runtime guard is preserved.
- **T-4** — `spawnLocalAgent` in `local-adapter.ts` replaces `handle as unknown as AgentHandle` with `handle as AgentHandle`, narrowing the double-cast to a single cast. A comment explains the structural compatibility between `spawnBdeAgent`'s return type and `AgentHandle`.
- **T-32** — `invalidateCheckOAuthTokenCache` in `oauth-checker.ts` replaces `console as unknown as Logger` with a module-level `createLogger('oauth-checker')` instance. The `Logger` import from `../logger` is added; the bogus cast is removed.
- **T-33** — `handleRequest` in `opencode-session-mcp.ts` removes the `as unknown as ConstructorParameters<typeof StreamableHTTPServerTransport>[0]` cast. The config object is typed directly as `StreamableHTTPServerTransportOptions` (imported from the SDK) so future property additions are checked against the interface immediately.
- **T-29** — `wrapRegistrationMethod` in `safe-tool-handler.ts` introduces a local `McpServerRegistrar` interface (`{ tool: (...args: unknown[]) => unknown; registerTool: (...args: unknown[]) => unknown }`). The four inline `as any` casts are replaced by a single cast of `server` to `McpServerRegistrar` at the top of the function; subsequent accesses use the typed local. The four `eslint-disable` comments are removed.

## Capabilities

### New Capabilities

None. This is a type-safety hardening epic — no user-facing features are added.

### Modified Capabilities

- **`AgentHandle` interface** (`types.ts`): gains an optional `process` property. Existing implementations that do not expose `.process` remain valid (the property is optional). New implementations that expose `.process` are now type-checked.
- **`invalidateCheckOAuthTokenCache`** (`oauth-checker.ts`): now uses a proper `Logger` instance. Behaviour is identical but any future Logger-method calls within `getDefaultCredentialService` will no longer throw.
- **`StreamableHTTPServerTransport` construction** (`opencode-session-mcp.ts`): no behavioural change; the cast removal makes the config shape visible to the compiler.
- **`wrapRegistrationMethod`** (`safe-tool-handler.ts`): no behavioural change; `McpServer` API changes now produce a compile error at the registration wrapper rather than a silent runtime failure.

## Impact

**Production files modified:**
- `src/main/agent-manager/types.ts`
- `src/main/agent-manager/watchdog-loop.ts`
- `src/main/agent-manager/local-adapter.ts`
- `src/main/agent-manager/oauth-checker.ts`
- `src/main/agent-manager/opencode-session-mcp.ts`
- `src/main/mcp-server/safe-tool-handler.ts`

**Test files modified or created:**
- `src/main/agent-manager/__tests__/watchdog-loop.test.ts` — add 2 cases verifying `forceKillAgent` and `abortAgent` call `.process.kill('SIGKILL')` when the property is present
- `src/main/agent-manager/__tests__/oauth-checker.test.ts` — verify `invalidateCheckOAuthTokenCache` calls through to `getDefaultCredentialService` without throwing (existing or new test)

**No IPC surface changes. No new npm dependencies. No renderer changes.**
