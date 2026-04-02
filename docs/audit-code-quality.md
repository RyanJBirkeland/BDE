# Code Quality Audit
**Date**: 2026-03-16
**Auditor**: Claude Opus 4.6
**Scope**: BDE Electron app — src/main/, src/renderer/src/, src/preload/

---

## Executive Summary

**Overall Health**: Good foundation with clear separation of concerns, but suffering from **silent failure proliferation** and **emerging complexity hotspots**.

**Critical Issues**:
- 23+ silent failure patterns across the codebase (try/catch that swallow errors with no logging)
- 2 files exceed 500 LOC (LocalAgentLogViewer: 596, SessionList: 531)
- Dead code exports in agent-history.ts
- Type safety gaps in RPC layer and gateway client

**Strengths**:
- IPC contract is fully aligned (no missing handlers)
- Clean Zustand state management architecture
- Good TypeScript coverage overall
- Consistent error display to users via toast system

---

## IPC Contract Inventory

### ✅ All Channels Verified (main/index.ts ↔ preload/index.ts)

| Channel | Handler Location | Status |
|---------|------------------|--------|
| `get-gateway-config` | main/index.ts:90 | ✅ |
| `get-github-token` | main/index.ts:91 | ✅ |
| `save-gateway-config` | main/index.ts:92 | ✅ |
| `get-repo-paths` | main/index.ts:96 | ✅ |
| `read-sprint-md` | main/index.ts:97 | ✅ |
| `open-external` | main/index.ts:98 | ✅ |
| `list-memory-files` | fs.ts:68 via registerFsHandlers() | ✅ |
| `read-memory-file` | fs.ts:69 via registerFsHandlers() | ✅ |
| `write-memory-file` | fs.ts:70 via registerFsHandlers() | ✅ |
| `local:getAgentProcesses` | main/index.ts:102 | ✅ |
| `local:spawnClaudeAgent` | main/index.ts:103 | ✅ |
| `local:tailAgentLog` | main/index.ts:106 | ✅ |
| `local:sendToAgent` | main/index.ts:107 | ✅ |
| `kill-local-agent` | main/index.ts:111 | ✅ |
| `agents:list` | main/index.ts:122 | ✅ |
| `agents:getMeta` | main/index.ts:125 | ✅ |
| `agents:readLog` | main/index.ts:128 | ✅ |
| `agents:import` | main/index.ts:131 | ✅ |
| `agents:markDone` | main/index.ts:136 | ✅ |
| `sessions:getHistory` | main/index.ts:146 (stub) | ✅ |
| `get-diff` | main/index.ts:151 | ✅ |
| `get-branch` | main/index.ts:152 | ✅ |
| `get-log` | main/index.ts:153 | ✅ |
| `git:status` | main/index.ts:156 | ✅ |
| `git:diff` | main/index.ts:157 | ✅ |
| `git:stage` | main/index.ts:158 | ✅ |
| `git:unstage` | main/index.ts:159 | ✅ |
| `git:commit` | main/index.ts:160 | ✅ |
| `git:push` | main/index.ts:161 | ✅ |
| `git:branches` | main/index.ts:162 | ✅ |
| `git:checkout` | main/index.ts:163 | ✅ |
| `gateway:invoke` | main/index.ts:166 | ✅ |
| `terminal:create` | main/index.ts:182 | ✅ |
| `terminal:write` | main/index.ts:207 (ipcMain.on) | ✅ |
| `terminal:resize` | main/index.ts:211 | ✅ |
| `terminal:kill` | main/index.ts:218 | ✅ |
| `set-title` | main/index.ts:224 (ipcMain.on) | ✅ |

**Finding**: ✅ **No IPC contract gaps detected.** All preload invocations have corresponding main handlers.

---

## Type Safety Issues

### 🟡 Medium Priority

1. **rpc.ts:11-34** — Extensive use of `unknown` with unsafe type assertions
   ```ts
   const data = (await window.api.invokeTool(tool, args)) as {
     ok: boolean
     result?: { details?: unknown; content?: { type: string; text: string }[] }
     error?: string
   }
   ```
   **Impact**: Runtime shape mismatches will fail silently
   **Fix**: Define explicit RPC response types per tool

2. **gateway.ts:83** — Manual type casting without validation
   ```ts
   const msg = data as { type?: string; event?: string; ... }
   ```
   **Impact**: WebSocket messages with unexpected shapes could crash
   **Fix**: Use runtime schema validation (e.g., zod)

3. **unifiedAgents.ts:34-37** — `truncate()` returns `string | undefined` but callers expect `string`
   ```ts
   function truncate(s: string | undefined, max: number): string | undefined {
     if (!s) return undefined  // callers don't handle undefined
     return s.length > max ? s.slice(0, max) : s
   }
   ```
   **Impact**: Could propagate `undefined` into UI
   **Fix**: Return empty string or make return type explicit

4. **preload/index.d.ts:88** — `getSessionHistory` return type is `any[]`
   ```ts
   getSessionHistory: (sessionKey: string) => Promise<any[]>
   ```
   **Impact**: No type safety for session history consumers
   **Fix**: Define SessionHistoryItem type

5. **config.ts:16** — `getGitHubToken()` silently catches and returns null with no logging
   ```ts
   } catch {
     return process.env['GITHUB_TOKEN'] ?? null
   }
   ```
   **Impact**: Silent config read failures
   **Fix**: Log parse errors to help debug config issues

### 🟢 Low Priority

6. **git.ts:29-31, 99-101, etc.** — Multiple functions catch and return empty string
   - Acceptable for read-only operations
   - Consider logging at debug level for troubleshooting

---

## Silent Failure Patterns

### 🔴 **CRITICAL** — Spawn Failures

**SpawnModal.tsx:109** and **TaskComposer.tsx:67-69**
```tsx
} catch (err) {
  toast.error(`Spawn failed: ${err instanceof Error ? err.message : String(err)}`)
  // ❌ NO console.error — debugging spawn failures requires inspecting UI toast
}
```
**Impact**: The spawn modal bug mentioned in the audit prompt — failures are shown to the user but not logged to DevTools, making debugging impossible.
**Fix**: Add `console.error('Agent spawn failed:', err)` before toast.

---

### 🟡 Medium — Store Fetch Failures

All instances swallow errors with vague comments like `// Non-critical` or `// Silently fail`:

1. **localAgents.ts:68**
   ```ts
   } catch {
     // Silently fail — local agents are non-critical
   }
   ```

2. **localAgents.ts:138** (log polling)
   ```ts
   } catch {
     // Log file may not exist yet
   }
   ```

3. **sessions.ts:110**
   ```ts
   } else {
     set({ loading: false, fetchError: 'Could not reach gateway' })
     toast.error('Failed to fetch sessions')  // ❌ No console.error
   }
   ```

4. **sessions.ts:136** (subagents fetch)
   ```ts
   } else {
     set({ subAgentsError: 'Could not fetch sub-agents', subAgentsLoading: false })
     // ❌ No logging of error details
   }
   ```

5. **agentHistory.ts:34, 80, 102**
   ```ts
   } catch {
     // Non-critical
   }
   ```

6. **config.ts:17-19**
   ```ts
   try {
     const raw = readFileSync(configPath, 'utf-8')
     const config = JSON.parse(raw)
     return config.githubToken ?? process.env['GITHUB_TOKEN'] ?? null
   } catch {
     return process.env['GITHUB_TOKEN'] ?? null  // ❌ No logging
   }
   ```

7. **fs.ts:27, 43** (directory walk)
   ```ts
   } catch {
     return // directory doesn't exist yet
   }
   ```

8. **git.ts** — All 12 functions catch and return empty string/array/object
   - `getDiff:29`, `getBranch:40`, `getLog:52`, `gitStatus:87`, `gitDiffFile:99`, `gitBranches:148`

9. **agent-history.ts:38** (readIndex)
   ```ts
   } catch {
     return []
   }
   ```

10. **local-agents.ts:59, 165, 317** (multiple silent catches)

**Total Silent Catches**: **23+**

**Impact**:
- Debugging requires adding logging yourself
- Production issues hard to diagnose
- Users see generic "failed" messages without context

**Recommendation**:
- Add `console.error()` or `console.warn()` at minimum
- Consider structured logging library for production
- Reserve silent catches for truly expected errors (e.g., file not found on first run)

---

## Dead Code

### Exported but Unused

**agent-history.ts:195-204**
```ts
/** Check if an agent ID exists in the index */
export async function hasAgent(id: string): Promise<boolean> { ... }

/** Find agent by PID (for matching live processes to history) */
export async function findAgentByPid(pid: number): Promise<AgentMeta | null> { ... }
```
- Exported but never wired to IPC handlers
- Never called from renderer
- Either remove or add IPC handlers if needed

### Deprecated No-Op

**rpc.ts:6-9**
```ts
/** @deprecated No longer needed with IPC-based RPC */
export function clearConfigCache(): void {
  // no-op — config is managed by the main process
}
```
**Fix**: Remove entirely (deprecated since config moved to main process)

---

## Cognitive Complexity Hotspots

### 🔴 Files Over 500 Lines (CLAUDE.md max: 500 LOC)

1. **LocalAgentLogViewer.tsx** — **596 lines**
   - Combines: log parsing, ANSI rendering, streaming, scroll management, search
   - **Split suggestion**: Extract `AnsiRenderer` component, `LogParser` util, `useLogStreaming` hook

2. **SessionList.tsx** — **531 lines**
   - Combines: list rendering, filtering, grouping, selection, keyboard nav
   - **Split suggestion**: Extract `SessionListItem` component, `useSessionFilter` hook

### 🟡 Files Over 300 Lines

3. **TerminalView.tsx** — 450 lines
   - Tab management, PTY lifecycle, xterm.js integration, split panes
   - **Split suggestion**: Extract `TerminalTab` component, `usePTY` hook

4. **CostView.tsx** — 443 lines
   - Cost calculation, charts, filtering, export
   - **Split suggestion**: Extract `CostChart` component, `useCostAnalytics` hook

5. **DiffView.tsx** — 408 lines
   - Diff parsing, file navigation, hunks, syntax highlighting
   - **Split suggestion**: Extract `DiffHunk` component, `useDiffParser` hook

6. **ChatThread.tsx** — 399 lines
   - Message rendering, virtualization, auto-scroll, markdown
   - **Split suggestion**: Extract `Message` component, `useAutoScroll` hook

7. **SessionsView.tsx** — 329 lines
   - Layout, session list, chat pane, agent history, spawn modal orchestration
   - **Okay** — This is a top-level view, reasonable complexity

8. **local-agents.ts** — 319 lines
   - Process scanning, spawning, log tailing, cleanup
   - **Split suggestion**: Extract `process-scanner.ts`, `agent-spawner.ts`, `log-tail.ts`

9. **stores/sessions.ts** — 296 lines
   - Session lifecycle, subagents, split panes, follow mode, kills with undo
   - **Okay** — Central state management, acceptable complexity

---

## State Management Issues

### 🟢 Overall: Well-Architected

**Strengths**:
- Clean Zustand stores with clear ownership
- Derived state via hooks (e.g., `useUnifiedAgents`)
- Persistence middleware used correctly (localAgents store)

### 🟡 Minor Issues

1. **Interval Cleanup Pattern**
   - `localAgents.ts:61`, `agentHistory.ts:28` — Stores hold `_logInterval` timers
   - **Risk**: Timer cleanup relies on manual `stopLogPolling()` calls
   - **Fix**: Use `useEffect` cleanup in components instead of storing timers in global state

2. **Computed State in Stores**
   - `sessions.ts:141-148` — Auto-follow logic embedded in `fetchSessions`
   - **Better**: Move to a selector or derived hook for clarity

3. **State Duplication Risk**
   - `unifiedAgents.ts` merges 4 data sources (sessions, subAgents, processes, history)
   - **Risk**: If sources update at different times, transient inconsistencies
   - **Mitigation**: Already handled well by useMemo

---

## main/index.ts Health

**Current**: 240 lines, 35 IPC handlers, all in one file

### 🟡 Approaching Threshold

**Recommendation**: Split into domain modules when adding more handlers:

```
src/main/
  ├── index.ts          # App lifecycle, window management
  ├── ipc/
  │   ├── config.ts     # Gateway config, GitHub token, repo paths
  │   ├── git.ts        # Git operations
  │   ├── agents.ts     # Local agent processes + history
  │   ├── terminal.ts   # PTY management
  │   ├── gateway.ts    # Gateway RPC proxy
  │   └── memory.ts     # Memory file I/O
  └── ...
```

**Benefits**:
- Easier to locate handler code
- Better testability (can test handler modules in isolation)
- Reduces main/index.ts cognitive load

**Trigger**: When main/index.ts exceeds 300 lines

---

## Recommendations

### 🔴 High Priority (Fix This Week)

1. **Add logging to spawn failures**
   - SpawnModal.tsx:109, TaskComposer.tsx:67
   - Add `console.error('Spawn failed:', err)` before toast

2. **Split LocalAgentLogViewer.tsx** (596 → ~200 lines each)
   - Extract AnsiRenderer, LogParser, useLogStreaming

3. **Split SessionList.tsx** (531 → ~300 lines)
   - Extract SessionListItem component

4. **Remove dead code**
   - Delete `hasAgent`, `findAgentByPid` (or wire to IPC)
   - Delete `clearConfigCache` deprecated function

### 🟡 Medium Priority (Next Sprint)

5. **Type RPC layer**
   - Define tool-specific request/response types
   - Replace `unknown` with discriminated unions

6. **Add debug logging**
   - Add `console.warn()` to silent catches in stores
   - Use structured logging for production

7. **Validate gateway messages**
   - Use zod or similar for WebSocket frame validation
   - Prevents crashes from malformed gateway responses

8. **Split TerminalView.tsx** (450 → ~250 lines)
   - Extract TerminalTab, usePTY hook

### 🟢 Low Priority (Backlog)

9. **Refactor local-agents.ts** (319 → ~150 lines each)
   - Split into process-scanner, agent-spawner, log-tail

10. **Move auto-follow logic**
    - Extract from sessions.ts:141-148 into derived hook

11. **Replace interval timers in stores**
    - Move log polling intervals to component useEffect cleanup

12. **Split main/index.ts when it hits 300 lines**
    - Create ipc/ module structure

---

## Metrics Summary

| Metric | Count | Notes |
|--------|-------|-------|
| **IPC Contract Gaps** | 0 | ✅ Perfect alignment |
| **Type Safety Holes** | 6 | 2 high, 4 medium |
| **Silent Failures** | 23+ | 🔴 Critical issue |
| **Dead Code Exports** | 3 | Low impact |
| **Files >500 LOC** | 2 | LocalAgentLogViewer, SessionList |
| **Files >300 LOC** | 8 | See hotspots section |
| **Main Process LOC** | 240 | Approaching split threshold |

---

## Conclusion

The BDE codebase is **well-structured** with clean separation of concerns and a solid IPC architecture. The main issues are:

1. **Silent failure proliferation** — makes debugging painful
2. **Two files exceeding complexity limits** — need splitting
3. **Minor type safety gaps** — low risk but should be addressed

**Overall Grade**: **B+**
With the recommended fixes, this would easily be an **A** codebase.

---

*End of Audit*
