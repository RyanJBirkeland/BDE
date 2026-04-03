# AX-S7: Unbounded Log Memory Cap

**Epic:** Architecture & DX
**Priority:** P1
**Size:** S (Small)
**Depends on:** None

---

## Problem

The `logPoller` factory (`src/renderer/src/lib/logPoller.ts`) accumulates log content in a string that grows without bound:

```typescript
// logPoller.ts — called every 1s
logContent: get().logContent + newContent,
logNextByte: result.nextByte
```

Two stores use this factory:

- `localAgents.ts` — streams stdout/stderr from spawned agents
- `agentHistory.ts` — reads historical agent logs

A Claude agent running for 30 minutes at typical output rates can produce 5-10 MB of log text. Since `logContent` is a Zustand state field, every update triggers React reconciliation on the entire accumulated string. At 10 MB+:

1. **Memory:** The string lives in the V8 heap. With two stores potentially active, 20+ MB of log strings in renderer memory.
2. **Rendering:** Components rendering `logContent` (e.g., `LocalAgentLogViewer`, `LogDrawer`) must process the full string on every 1s poll cycle.
3. **No recovery:** The only way to free the memory is to deselect the agent, which calls `stopLogPolling()` and resets `logContent` to `''`.

## Design

### Option A: Sliding Window (Recommended)

Cap `logContent` at a maximum size. When new content would exceed the cap, trim from the beginning:

```typescript
const MAX_LOG_CONTENT_BYTES = 2 * 1024 * 1024 // 2 MB

// In the poll callback:
let updated = get().logContent + newContent
if (updated.length > MAX_LOG_CONTENT_BYTES) {
  // Find the first newline after the trim point to avoid cutting mid-line
  const trimPoint = updated.length - MAX_LOG_CONTENT_BYTES
  const newlineIndex = updated.indexOf('\n', trimPoint)
  updated = newlineIndex !== -1 ? updated.slice(newlineIndex + 1) : updated.slice(trimPoint)
}
set({ logContent: updated, logNextByte: result.nextByte })
```

This keeps the most recent ~2 MB of output visible. The full log remains on disk and can be scrolled back via the `fromByte` parameter if needed.

### Option B: Ring Buffer with Chunks

Store log content as an array of chunks instead of a single string. Drop oldest chunks when total size exceeds the cap. More memory-efficient (no large string concatenation) but requires changes to all consumers.

**Recommendation:** Option A — simpler, single-string API preserved, consumers unchanged.

### Constants

Add to `src/renderer/src/lib/constants.ts`:

```typescript
export const MAX_LOG_CONTENT_BYTES = 2 * 1024 * 1024 // 2 MB
```

### Updated logPoller.ts

```typescript
import { MAX_LOG_CONTENT_BYTES } from './constants'

export function createLogPollerActions(set: SetState, get: GetState) {
  let intervalHandle: ReturnType<typeof setInterval> | null = null

  return {
    startLogPolling(readFn: (fromByte: number) => Promise<{ content: string; nextByte: number }>) {
      this.stopLogPolling()
      intervalHandle = setInterval(async () => {
        try {
          const result = await readFn(get().logNextByte)
          if (!result.content) return

          let updated = get().logContent + result.content
          if (updated.length > MAX_LOG_CONTENT_BYTES) {
            const trimPoint = updated.length - MAX_LOG_CONTENT_BYTES
            const nl = updated.indexOf('\n', trimPoint)
            updated = nl !== -1 ? updated.slice(nl + 1) : updated.slice(trimPoint)
          }

          set({ logContent: updated, logNextByte: result.nextByte })
        } catch {
          // Log file may not exist yet — silently retry
        }
      }, POLL_LOG_INTERVAL)
    },

    stopLogPolling() {
      if (intervalHandle) {
        clearInterval(intervalHandle)
        intervalHandle = null
      }
      set({ logContent: '', logNextByte: 0 })
    }
  }
}
```

## Files to Change

| File                                | Change                                  |
| ----------------------------------- | --------------------------------------- |
| `src/renderer/src/lib/logPoller.ts` | Add sliding window cap to poll callback |
| `src/renderer/src/lib/constants.ts` | Add `MAX_LOG_CONTENT_BYTES`             |

No store files or consumer components change — the `logContent` API stays the same.

## Acceptance Criteria

- [ ] `logContent` never exceeds `MAX_LOG_CONTENT_BYTES` (2 MB)
- [ ] Trimming happens at newline boundaries (no mid-line cuts)
- [ ] `logNextByte` continues to advance correctly (we're trimming the in-memory view, not the disk read position)
- [ ] Existing log viewers (`LocalAgentLogViewer`, `LogDrawer`) render correctly with trimmed content
- [ ] `npm run build` passes
- [ ] `npm test` passes (update logPoller tests if they exist)

## Notes

- 2 MB is ~40,000 lines of typical agent output. This covers the visible scrollback in the log viewer with generous margin.
- The full log remains on disk at `~/.bde/agent-logs/{date}/{id}/output.log` — nothing is lost. A future "scroll to beginning" feature could use the `fromByte=0` parameter to re-read from disk.
- The `agentHistory` store's `readLog` IPC already supports `fromByte`, so a paginated "load more" feature is straightforward to add later.
