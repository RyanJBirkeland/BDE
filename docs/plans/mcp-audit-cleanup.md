# MCP Server Audit Cleanup — Phased Plan

**Source audit:** `src/main/mcp-server/` multi-lens review (2026-04-20), 7 lenses, 81 findings → 79 tasks.
**Pattern:** One feature branch per phase (`feat/phaseN-<slug>`), merged to `main` via PR before the next phase starts. Mirrors the RC1–RC6 rollout from 2026-04-20.
**Verification cadence:** Full `npm run typecheck && npm test && npm run test:main && npm run lint` at each phase boundary (pre-push hook enforces). Per-agent checks optional.
**Parallelism:** Within a phase, independent agents run on disjoint files. Cross-file conflicts force serialization.

## Context — what already landed

Three of the 2026-04-20 RCs touched MCP territory:
- **RC4** — `TaskValidationError` with `.code` in `sprint-service`; `skipReadinessCheck` option on `tasks.create`.
- **RC5** — `.describe()` on every length-capped field; `parseToolArgs` + `McpZodError` in `errors.ts`; `toJsonRpcError` enriches Zod issues with field descriptions.
- **RC6** — `isRevivingTerminalTask` + `TERMINAL_STATE_RESET_PATCH` in `tools/tasks.ts`; MCP `tasks.update` now deliberately supports terminal→queued/backlog revival.

The plan below has absorbed those shifts. Task IDs starting `T-NEW-*` are newly introduced by the reconciliation.

---

## Phase 0 — Foundations (serial, 1 agent)

Branch: `feat/phase0-mcp-foundations`. Shared helpers everything downstream builds on.

| ID | Location | Acceptance |
|---|---|---|
| T-8 | new `src/main/mcp-server/tools/response.ts` | Single `jsonContent(value)` helper exported; `tools/tasks.ts`, `tools/epics.ts`, `tools/meta.ts` all import it; local duplicates deleted. |
| T-31 | `src/main/mcp-server/errors.ts` | `writeJsonRpcError(res, status, err, id?)` helper written; emits valid JSON-RPC 2.0 envelope (`jsonrpc`, `id`, nested `error.code/message/data`). Test pins the shape. |
| T-67 | `src/main/mcp-server/errors.ts` | `McpErrorCode` gains `ValidationFailed`, `Conflict`, `RepoUnconfigured`. `CODE_MAP` extended. Tests added in `errors.test.ts`. |
| T-68 | `src/main/mcp-server/errors.ts` | `-32001..-32004` (+ new codes) exported as named constants; `CODE_MAP` references them. |
| T-66 | `src/main/mcp-server/errors.ts` | `toJsonRpcError(err, schema?, logger?)` logs unknown (non-`McpDomainError`, non-`ZodError`) throws before returning `Internal error`. Test asserts logger.error was called. |

---

## Phase 1 — P0 safety + error delivery (2 parallel agents)

Branch: `feat/phase1-mcp-safety`. Two agents on disjoint files.

**Agent A — tools layer** (`tools/tasks.ts`, `tools/epics.ts`, `services/sprint-service.ts` adapters)
| ID | Location | Acceptance |
|---|---|---|
| T-NEW-C | `tools/tasks.ts:tasks.update` | Non-revival terminal transitions (not from RC6's `isRevivingTerminalTask` path) route through a service method that fires `onStatusTerminal`. Regression test: MCP `tasks.update` setting `status='done'` unblocks a hard-dep dependent. |
| T-NEW-A | `tools/tasks.ts:tasks.create` | `TaskValidationError` caught and wrapped as `McpDomainError(McpErrorCode.ValidationFailed, msg, {code})`. |
| T-30 | `index.ts:cancelTask` closure | Known transition throws from `cancelTask` wrapped as `McpDomainError(McpErrorCode.InvalidTransition, ...)`. |
| T-16 | `tools/epics.ts:epics.setDependencies` + `services/epic-group-service.ts` | Service throws typed `EpicNotFoundError` / `EpicCycleError`; tool matches on type (not regex). Existing regex branch deleted. |

**Agent B — transport + index** (`transport.ts`, `index.ts`)
| ID | Location | Acceptance |
|---|---|---|
| T-40d | `tools/*.ts` + `errors.ts` | Tool handlers return `{ isError: true, content: [{type:'text', text: JSON.stringify(toJsonRpcError(err, schema))}] }` for known errors (or throw SDK `McpError`) so the `kind`/`data`/code reach clients. Integration test: `tasks.get` on missing id returns payload containing `NOT_FOUND`. |
| T-41 | `transport.ts:58-64` | Catch-all 500 uses `writeJsonRpcError`; log before write. |
| T-39 | `index.ts` | `safeToolHandler(name, fn)` wraps every tool registration — logs + translates unknown throws. |
| T-28 | `index.ts:72-78` | `transportHandler!.handle(…).catch` calls `logError(logger, 'mcp transport', err)` before writing response. |

---

## Phase 2 — Broken tests + backfill (4 parallel agents)

Branch: `feat/phase2-mcp-tests`. All agents on disjoint test files.

**Agent A — transport.test.ts**
- T-52: rewrite DNS-rebinding test with positive assertion (call-count on `transport.handleRequest` OR real SDK run).
- T-53: rewrite happy-path host test likewise.
- T-54: add e2e happy-path covering `connect → handleRequest → res.on('close')` cleanup.
- T-55: fold `vi.doMock` into proper `vi.mock` or drop entirely.

**Agent B — new files**
- T-21: new `tools/meta.test.ts` covering `meta.repos`, `meta.taskStatuses`, `meta.dependencyConditions`.
- T-24: new `index.test.ts` covering EADDRINUSE, double-start, stop-when-never-started, stop idempotency.

**Agent C — tasks + epics test expansion**
- T-11: `tasks.cancel` 404 path test.
- T-12: pagination + filter-composition tests for `tasks.list`.
- T-13: `tasks.history` offset arithmetic test.
- T-14: "rejects forbidden fields" using a truly forbidden field (`claimed_by` or `pr_url`) — `skipReadinessCheck` is now deliberately writable.
- T-18: tests for `epics.update/delete/addTask/removeTask`.
- T-19: retarget `setDependencies` error-translation test to typed-error assertion.
- T-20: trim `fakeDeps` to methods the handler actually calls.
- T-NEW-E: regression test pinning RC6 terminal→queued revival resets the 7 fields atomically.

**Agent D — auth + token-store tests**
- T-59: malformed-header edge cases in `auth.test.ts`.
- T-64: corrupt-file / missing-dir / non-ENOENT / file-mode tests in `token-store.test.ts`.
- T-65: replace `tokenFilePath` tautology with contract assertion.

---

## Phase 3 — Data-layer push-down (2 parallel agents)

Branch: `feat/phase3-mcp-pushdown`. Disjoint by domain.

**Agent A — tasks**
- T-2: push filter/pagination into `sprint-task-repository.listTasks({status,repo,epicId,tag,search,limit,offset})`; delete `filterInMemory`.
- T-3: extend `getTaskChanges(id, {limit, offset})`; tool passes through; schema caps `limit + offset ≤ 500`.
- T-5: replace `patch: Record<string, unknown>` with named `TaskPatch` type in `TaskToolsDeps.updateTask`.
- T-6: split `TaskToolsDeps` into `TaskCommandPort` / `TaskQueryPort` / `TaskHistoryPort`.

**Agent B — epics**
- T-17: resolve `goal: null` vs `undefined` at service boundary — either service accepts null or schema forbids it; adapter no longer coerces.

---

## Phase 4 — Security hardening (3 parallel agents)

Branch: `feat/phase4-mcp-security`. Disjoint files.

**Agent A — transport.ts**
- T-44: HTTP method allow-list (POST-only for `/mcp`; 405 + `Allow: POST` otherwise).
- T-45: explicit `allowedOrigins` local allow-list.
- T-46: request body size cap (Content-Length + streamed bytes; 413 above cap).
- T-47: `res.on('close')` cleanup wrapped with `withTimeout` + `logError`.

**Agent B — token-store + auth + audit**
- T-62: `fs.open(filePath, 'wx', 0o600)` for exclusive create; chmod `~/.bde` to `0700`.
- T-63: derive hex-regex from `TOKEN_BYTES * 2`; warn on file-mode drift.
- T-60: log non-ENOENT + corrupt-token regeneration paths.
- T-57: `readOrCreateToken` returns `{token, created, path}`; startup emits a one-time warn on regeneration.
- T-77: caller attribution — `tasks.create/update/cancel` accept a `caller` field; MCP injects `'mcp:<client-name>'` (from SDK `clientInfo`) so `task_changes.changedBy` distinguishes MCP from UI.

**Agent C — index.ts hardening**
- T-37: sanitize `manager:warning` broadcast body (no raw error / stack / paths).
- T-38: rate-limit / progressive delay on consecutive 401s.

---

## Phase 5 — Lifecycle + observability (2 parallel agents)

Branch: `feat/phase5-mcp-lifecycle`. Agent A owns `index.ts`; Agent B owns `transport.ts`. Disjoint.

**Agent A — index.ts lifecycle**
- T-25: decompose `start()`; build `transportHandler` before `createServer`; remove `!` assertion.
- T-26: set `headersTimeout` + `requestTimeout`; close `httpServer` on listener error.
- T-27: shutdown deadline on `stop()` via `closeAllConnections()` or `Promise.race`.
- T-29: route `getTaskChanges` through a service layer; no `../data/*` imports at composition root.
- T-32: extract `closeQuietly(closable, label)`.
- T-35: startup log includes token path + `created` flag.
- T-36: port-bind failure log uses `logError` (preserves stack).

**Agent B — transport.ts observability**
- T-42: log auth failures (`logger.warn({event: 'mcp.auth.failure', reason, remoteAddress})`).
- T-43: decompose `handle()` into `routeAndAuthorize` / `dispatch` / `scheduleCleanup`.
- T-48: `logger.error` call in catch uses `logError` with request context.

Note: T-34 (request metrics) and T-50 (404 debug log) folded into Agent A's startup work for coherence.

---

## Phase 6 — Nits + polish (5 parallel agents)

Branch: `feat/phase6-mcp-polish`. Five disjoint file clusters.

**Agent A — tasks.ts nits**
- T-7: extract `DEFAULT_PAGE_LIMIT` + `applyPagination`.
- T-9: remove stray indentation.
- T-10: debug log on `NotFound` branches.

**Agent B — meta.ts**
- T-22: precompute `meta.taskStatuses` payload at module load.
- T-23: replace defensive-clone loop with `Object.fromEntries`.

**Agent C — auth + schemas + errors**
- T-56: rename `a`/`b` → `presentedBytes`/`expectedBytes`.
- T-58: remove `.trim()` or rename to `parseBearerToken`.
- T-71: trim JSDoc on `TaskWriteFieldsSchema`.
- T-69: strengthen "without leaking stack" errors.test assertion.

**Agent D — token-store + test-setup**
- T-61: `path.dirname(filePath)` in place of `join(filePath, '..')`.
- T-76: accept explicit `localPath` in `seedBdeRepo`.

**Agent E — test hygiene**
- T-72: schema boundary tests (incl. `.describe()` text assertions — RC5-aware).
- T-73: remove suite-level shared state from `mcp-server.integration.test.ts`.
- T-74: explicit `import { vi } from 'vitest'` in integration test files.
- T-75: replace `withoutVolatileFields` deny-list with explicit compared-field allow-list in `parity.integration.test.ts`.

Also: T-49 (`allowedHosts` array hoisting), T-51 (drop `close()` no-op), T-33 (cache parsed repos) — folded into matching file agents above.

---

## Branch / PR workflow (per phase)

1. Create worktree: `git worktree add .worktrees/phaseN-<slug> -b feat/phaseN-<slug> main`
2. Dispatch agent(s) in that worktree.
3. Agent commits, runs the pre-push verification suite, pushes branch.
4. Operator opens PR (or I do, with user confirmation), CI runs, PR merges to main.
5. Operator pulls main locally, removes worktree/branch, starts next phase.

Each phase assumes the previous is merged. Do not start Phase N+1 before Phase N is in `origin/main`.

## Deferred / not in scope

Carried over from the RC follow-up notes:
- **Reset-patch duplication** (`TERMINAL_STATE_RESET_PATCH` vs `resetTaskForRetry`) — intentional per RC6; refactor-when-convenient.
- **Full serializable error envelope for cross-IPC** — T-40d handles this for MCP. The analogous renderer/IPC work is a separate spec.
- **Bash-tokenizer escape in RC1** — worktree-isolation bypass via `$(echo …)` — out of threat model; documented on RC1.
