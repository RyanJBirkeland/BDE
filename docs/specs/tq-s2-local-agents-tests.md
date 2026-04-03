# TQ-S2: Unit Tests for local-agents.ts

**Epic:** Testing & QA
**Priority:** P0
**Estimate:** Large
**Type:** Unit Test

---

## Problem

`src/main/local-agents.ts` (316 LOC) is the highest-risk untested file in BDE. It:

1. **Spawns child processes** (`spawn('claude', [...])` with `detached: true`) that outlive the parent
2. **Parses raw `ps` output** to detect running agent binaries (claude, codex, aider, etc.)
3. **Resolves CWDs via `lsof`** with PID-based caching
4. **Manages interactive stdin** messaging to running agents
5. **Reads/writes log files** with byte-offset tailing
6. **Deletes old logs** with time-based cleanup (stat + unlink race condition)
7. **Reconciles agent history** — marks running agents as done if their PID disappears

A bug in any of these paths could cause zombie processes, lost agent output, corrupted history, or data loss.

### Exported Functions (6)

| Function                    | LOC     | Risk   | What It Does                                                        |
| --------------------------- | ------- | ------ | ------------------------------------------------------------------- |
| `getAgentProcesses()`       | 97-173  | High   | Parses `ps -eo`, resolves CWDs via `lsof`, reconciles agent history |
| `spawnClaudeAgent(args)`    | 186-251 | High   | Spawns detached child process, pipes stdout/stderr to log file      |
| `sendToAgent(pid, message)` | 255-266 | Medium | Writes JSON message to child process stdin                          |
| `tailAgentLog(args)`        | 280-289 | Medium | Reads log file from byte offset                                     |
| `cleanupOldLogs()`          | 293-309 | Medium | Deletes .log files older than 7 days from /tmp/bde-agents           |
| `isAgentInteractive(pid)`   | 313-316 | Low    | Checks if PID has active stdin handle                               |

### Internal Functions (3)

| Function                    | LOC   | What It Does                                                          |
| --------------------------- | ----- | --------------------------------------------------------------------- |
| `getProcessCwd(pid)`        | 50-63 | Resolves CWD via `lsof -p PID` with cache                             |
| `parseElapsedToMs(elapsed)` | 65-85 | Parses ps etime format `[[DD-]HH:]MM:SS` to milliseconds              |
| `matchAgentBin(command)`    | 87-95 | Extracts agent binary name from command string, excludes .app bundles |

---

## Test Plan

**File to create:** `src/main/__tests__/local-agents.test.ts`
**Config:** `vitest.node.config.ts` (Node environment)

### Mocking Strategy

```ts
vi.mock('child_process', () => ({
  exec: vi.fn(),
  spawn: vi.fn()
}))
vi.mock('fs/promises', () => ({
  readdir: vi.fn(),
  stat: vi.fn(),
  unlink: vi.fn(),
  readFile: vi.fn()
}))
vi.mock('../agent-history', () => ({
  createAgentRecord: vi.fn(),
  updateAgentMeta: vi.fn(),
  appendLog: vi.fn(),
  listAgents: vi.fn()
}))
```

### Test Cases

#### parseElapsedToMs (pure function — extract or test indirectly)

```
✓ parses MM:SS format (e.g., "05:30" → 330000)
✓ parses HH:MM:SS format (e.g., "01:30:00" → 5400000)
✓ parses DD-HH:MM:SS format (e.g., "2-03:00:00" → 183600000)
✓ handles leading whitespace
✓ handles single-digit segments (e.g., "1:05" → 65000)
```

#### matchAgentBin (pure function)

```
✓ matches "claude" binary → "claude"
✓ matches "/usr/local/bin/claude" → "claude"
✓ matches "codex" binary → "codex"
✓ matches "aider" binary → "aider"
✓ rejects macOS .app bundle paths (e.g., "/Applications/Claude.app/Contents/MacOS/Claude") → null
✓ rejects unknown binaries (e.g., "node") → null
✓ case-insensitive match ("Claude" → "claude")
```

#### getAgentProcesses

```
✓ parses ps output and returns LocalAgentProcess array
✓ filters only known agent binaries from ps output
✓ resolves CWD via lsof for each process
✓ caches CWD by PID (second call doesn't invoke lsof)
✓ evicts cache entries for dead PIDs
✓ returns empty array when ps command fails
✓ reconciles agent history — marks running agents as "unknown" when PID is gone
✓ does not fail if agent history reconciliation throws
```

#### spawnClaudeAgent

```
✓ spawns "claude" with correct flags (--output-format stream-json, --input-format stream-json, etc.)
✓ uses detached: true for process independence
✓ augments PATH with /usr/local/bin, /opt/homebrew/bin, ~/.local/bin
✓ sends initial task as JSON user message on stdin
✓ creates agent record via createAgentRecord
✓ updates record with real PID after spawn
✓ pipes stdout chunks to appendAgentLog
✓ pipes stderr chunks to appendAgentLog
✓ on exit code 0 → updates status to "done"
✓ on exit code non-zero → updates status to "failed"
✓ tracks process in activeAgentProcesses map
✓ removes process from activeAgentProcesses on exit
✓ calls child.unref() to allow parent to exit
✓ maps model "haiku" → "claude-haiku-4-5" flag
✓ maps model "opus" → "claude-opus-4-5" flag
✓ defaults to "claude-sonnet-4-5" for unknown models
```

#### sendToAgent

```
✓ writes JSON message to child stdin when process exists
✓ returns { ok: true } on success
✓ returns { ok: false, error } when PID not found
✓ returns { ok: false, error } when stdin is destroyed
```

#### tailAgentLog

```
✓ reads full file when fromByte is 0
✓ reads partial file from byte offset
✓ returns empty content and same offset when file doesn't exist
✓ handles empty files correctly
```

#### cleanupOldLogs

```
✓ deletes .log files older than 7 days
✓ preserves .log files newer than 7 days
✓ ignores non-.log files
✓ does not throw when /tmp/bde-agents directory doesn't exist
```

#### isAgentInteractive

```
✓ returns true when PID has active stdin
✓ returns false when PID not in active processes
✓ returns false when stdin is destroyed
```

---

## Files to Create

| File                                      | Purpose               |
| ----------------------------------------- | --------------------- |
| `src/main/__tests__/local-agents.test.ts` | Unit tests (~200 LOC) |

## Files to Modify

None — tests only.

---

## Implementation Notes

- `parseElapsedToMs` and `matchAgentBin` are not exported. Either:
  - (a) Export them for direct testing (preferred — they're pure functions)
  - (b) Test them indirectly via `getAgentProcesses` with crafted `ps` output
- The `spawn` mock needs to return an object with `pid`, `stdin`, `stdout`, `stderr` EventEmitters and `on`/`unref` methods. Use a helper factory.
- `execAsync` (promisified `exec`) needs mock that returns `{ stdout, stderr }`.
- Be careful with module-scope state (`activeAgentProcesses`, `cwdCache`) — these persist between tests. Use `beforeEach` to clear them, or re-import the module.

## Acceptance Criteria

- [ ] All test cases above pass
- [ ] Mocks properly isolate from real filesystem and processes
- [ ] No real child processes spawned during tests
- [ ] Module-scope state (cwdCache, activeAgentProcesses) reset between tests
- [ ] Tests run via `npm run test:main`
