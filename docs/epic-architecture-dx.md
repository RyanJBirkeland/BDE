# Epic: Architecture & Developer Experience (AX)

**Date:** 2026-03-16
**Author:** Senior Systems Audit (Claude Opus 4.6)
**Scope:** IPC layer, main process, stores, type safety, dead code
**Depends on:** audit-engineering-report.md findings

---

## Motivation

The engineering audit identified structural issues across the IPC boundary, main process handlers, and renderer stores that affect correctness, maintainability, and security posture. This epic addresses them in 7 focused stories, ordered by impact.

The SQLite migration (PR #103) and shell injection fix in git.ts (PR #105) have already shipped. This epic targets the remaining architectural gaps.

---

## Audit Summary

### IPC Layer

| Metric | Count |
|--------|-------|
| Total IPC channels registered | 44 |
| Channels with real implementations | 38 |
| Stub handlers (always return `[]`) | 1 (`sessions:getHistory`) |
| Dead channels (registered, never invoked from renderer) | 5 (`get-diff`, `get-branch`, `get-log`, `read-sprint-md`, `sessions:getHistory`) |
| Dead preload methods (exposed but never called) | 3 (`agents:getMeta`, `agents:markDone`, `sprint.delete`) |
| Channels using `safeHandle()` | 41/44 (3 use raw `ipcMain.on` — acceptable for fire-and-forget) |
| `any` types in IPC foundation | 2 (both in `safeHandle()` signature) |
| Runtime payload validation | Partial — only `fs.ts` validates paths |

### Main Process

| Finding | File | Status |
|---------|------|--------|
| Shell injection via `execSync` in git.ts | `src/main/git.ts` | **Fixed** (PR #105) |
| Shell injection via `execAsync` template literal | `src/main/local-agents.ts:53` | **Open** — `lsof -p ${pid}` |
| Concurrent write corruption (agents.json) | `src/main/agent-history.ts` | **Fixed** — migrated to SQLite (PR #103) |
| `getAgentProcesses()` SRP violation (75 LOC, 4 jobs) | `src/main/local-agents.ts:97-172` | **Open** |
| Path traversal in `tailAgentLog` | `src/main/local-agents.ts:280-289` | **Open** — reads any path |
| Weak `normalizePath` in fs.ts | `src/main/fs.ts:60-65` | **Open** — regex-based, no `path.resolve` |

### Stores

| Finding | Files |
|---------|-------|
| `logContent` grows unbounded (1s polling) | `logPoller.ts`, `localAgents.ts`, `agentHistory.ts` |
| `isAgentTab` duplicates `kind === 'agent'` | `terminal.ts` |
| `SubAgent.status` has `string` catch-all | `sessions.ts` |
| `sprint.list` returns `unknown[]` | `preload/index.ts:89` |
| `lastUpdated` field never read by UI | `localAgents.ts` |
| `loading` boolean stale after first fetch | `agentHistory.ts` |

### Dead Code (post PR #81)

| Item | Location |
|------|----------|
| `getSupabaseConfig()` export (replaced by IPC) | `src/renderer/src/lib/supabase.ts` |
| `clearConfigCache()` deprecated no-op | `src/renderer/src/lib/rpc.ts` |
| `AgentSource` type exported but unused | `src/renderer/src/hooks/useUnifiedAgents.ts` |
| 5 dead IPC handlers + 3 dead preload methods | See AX-S2 |

---

## Stories

| ID | Title | Priority | Size | Spec |
|----|-------|----------|------|------|
| AX-S1 | Typed IPC Channel Map | P1 | L | [ax-s1-typed-ipc-channel-map.md](specs/ax-s1-typed-ipc-channel-map.md) |
| AX-S2 | Dead Channel & Dead Code Cleanup | P1 | S | [ax-s2-dead-channel-cleanup.md](specs/ax-s2-dead-channel-cleanup.md) |
| AX-S3 | IPC Boundary Validation & Path Safety | P0 | M | [ax-s3-ipc-boundary-validation.md](specs/ax-s3-ipc-boundary-validation.md) |
| AX-S4 | Shell Execution Consistency | P0 | S | [ax-s4-shell-execution-consistency.md](specs/ax-s4-shell-execution-consistency.md) |
| AX-S5 | getAgentProcesses() Decomposition | P2 | M | [ax-s5-get-agent-processes-decomposition.md](specs/ax-s5-get-agent-processes-decomposition.md) |
| AX-S6 | Store Type Hygiene | P1 | M | [ax-s6-store-type-hygiene.md](specs/ax-s6-store-type-hygiene.md) |
| AX-S7 | Unbounded Log Memory Cap | P1 | S | [ax-s7-unbounded-log-memory-cap.md](specs/ax-s7-unbounded-log-memory-cap.md) |

### Execution Order

```
Phase 1 (Security):  AX-S4 → AX-S3
Phase 2 (Cleanup):   AX-S2 → AX-S6 → AX-S7
Phase 3 (Foundation): AX-S1 → AX-S5
```

AX-S4 and AX-S3 are security fixes — ship first. AX-S2 removes dead code that would otherwise need typing in AX-S1. AX-S5 is a refactor with no behavioral change — lowest risk, do last.

---

## Out of Scope

These items from the engineering audit have their own epics or are already resolved:

- **TerminalView refactor** (446 LOC, inline styles) — separate DP epic
- **SQLite migration** — already shipped (PR #103)
- **git.ts shell injection** — already shipped (PR #105)
- **Performance wins** (useMemo, debounce) — already shipped (PR #104)
- **Test coverage for main process handlers** — separate Testing epic
- **Polling architecture consolidation** — separate epic
