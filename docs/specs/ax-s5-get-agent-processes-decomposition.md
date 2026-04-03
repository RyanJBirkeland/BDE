# AX-S5: getAgentProcesses() Decomposition

**Epic:** Architecture & DX
**Priority:** P2
**Size:** M (Medium)
**Depends on:** AX-S4 (shell execution fix should ship first)

---

## Problem

`getAgentProcesses()` in `src/main/local-agents.ts:97-172` is 75 lines with 4 distinct responsibilities:

1. **Parse `ps` output** (lines 99-127): Execute `ps`, regex-match lines, filter for known agent binaries
2. **Resolve CWDs** (lines 129-145): Call `lsof` per candidate PID via `getProcessCwd()`, build result objects
3. **Evict stale cache** (lines 147-151): Remove dead PIDs from `cwdCache`
4. **Reconcile agent history** (lines 153-167): Find agents marked `running` in SQLite whose PIDs are gone, mark them `unknown`

This violates the Single Responsibility Principle. The function is called every 5 seconds via polling (`POLL_PROCESSES_INTERVAL`), meaning the reconciliation logic runs every 5s even though it only needs to run when the process list changes.

## Design

Extract each responsibility into a focused function. The orchestrator becomes a thin pipeline.

### Extracted Functions

```typescript
// 1. Parse ps output into raw candidates
interface PsCandidate {
  pid: number
  cpuPct: number
  rss: number
  elapsed: string
  command: string
  bin: string
}

async function scanAgentProcesses(): Promise<PsCandidate[]> {
  const { stdout } = await execFileAsync('ps', ['-eo', 'pid,%cpu,rss,etime,args'])
  const lines = stdout.trim().split('\n').slice(1)
  const candidates: PsCandidate[] = []
  for (const line of lines) {
    const match = line.match(/^\s*(\d+)\s+([\d.]+)\s+(\d+)\s+(\S+)\s+(.+)$/)
    if (!match) continue
    const bin = matchAgentBin(match[5]!)
    if (!bin) continue
    candidates.push({
      pid: parseInt(match[1]!),
      cpuPct: parseFloat(match[2]!),
      rss: parseInt(match[3]!),
      elapsed: match[4]!,
      command: match[5]!,
      bin
    })
  }
  return candidates
}

// 2. Resolve CWDs and build final process objects
async function resolveProcessDetails(candidates: PsCandidate[]): Promise<LocalAgentProcess[]> {
  return Promise.all(
    candidates.map(async (c) => {
      const cwd = await getProcessCwd(c.pid)
      const args = c.command.split(/\s+/).slice(1).join(' ')
      return {
        pid: c.pid,
        bin: c.bin,
        args,
        cwd,
        startedAt: Date.now() - parseElapsedToMs(c.elapsed),
        cpuPct: c.cpuPct,
        memMb: Math.round(c.rss / 1024)
      }
    })
  )
}

// 3. Evict cache entries for dead PIDs
function evictStaleCwdCache(livePids: Set<number>): void {
  for (const pid of cwdCache.keys()) {
    if (!livePids.has(pid)) cwdCache.delete(pid)
  }
}

// 4. Reconcile stale running agents in DB
async function reconcileStaleAgents(livePids: Set<number>): Promise<void> {
  const running = await listAgents(500, 'running')
  for (const agent of running) {
    if (agent.pid && !livePids.has(agent.pid)) {
      await updateAgentMeta(agent.id, {
        finishedAt: new Date().toISOString(),
        status: 'unknown',
        exitCode: null
      })
    }
  }
}
```

### Simplified Orchestrator

```typescript
export async function getAgentProcesses(): Promise<LocalAgentProcess[]> {
  try {
    const candidates = await scanAgentProcesses()
    const results = await resolveProcessDetails(candidates)
    const livePids = new Set(results.map((r) => r.pid))

    evictStaleCwdCache(livePids)

    // Reconciliation is non-critical — don't break process listing
    reconcileStaleAgents(livePids).catch(() => {})

    return results
  } catch {
    return []
  }
}
```

### Optimization: Throttle reconciliation

Reconciliation queries SQLite every 5s unnecessarily. Add a simple throttle:

```typescript
let _lastReconcileAt = 0
const RECONCILE_INTERVAL_MS = 30_000 // 30s

async function maybeReconcileStaleAgents(livePids: Set<number>): Promise<void> {
  const now = Date.now()
  if (now - _lastReconcileAt < RECONCILE_INTERVAL_MS) return
  _lastReconcileAt = now
  await reconcileStaleAgents(livePids)
}
```

Export `RECONCILE_INTERVAL_MS` to `constants.ts` or keep it module-local (preference: module-local since it's a main-process concern).

## Files to Change

| File                       | Change                                                                           |
| -------------------------- | -------------------------------------------------------------------------------- |
| `src/main/local-agents.ts` | Extract 4 functions, simplify `getAgentProcesses()`, add reconciliation throttle |

No other files change — the public API (`getAgentProcesses()`) signature is unchanged.

## Acceptance Criteria

- [ ] `getAgentProcesses()` is ≤15 lines
- [ ] Each extracted function has a single responsibility
- [ ] Reconciliation runs at most every 30s instead of every 5s
- [ ] `getAgentProcesses()` returns identical results before and after refactor
- [ ] `npm run build` passes
- [ ] No behavioral changes observable from the renderer

## Risks

- **Reconciliation timing change:** Moving from 5s to 30s means a dead agent could stay "running" in the UI for up to 30s longer. This is acceptable — the agent's `ps` entry disappears immediately (process list is real-time), and the "running" status in the history panel is cosmetic.
