/**
 * Local agent process detection — scans `ps` output for known AI agent
 * binaries (claude, codex, opencode, pi, aider, cursor) and resolves
 * their working directories via `lsof` on macOS.
 */
import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

const AGENT_BINS = ['claude', 'codex', 'opencode', 'pi', 'aider', 'cursor']

export interface LocalAgentProcess {
  pid: number
  bin: string
  args: string
  cwd: string | null
  startedAt: number
  cpuPct: number
  memMb: number
}

// CWD doesn't change for a given PID — cache it
const cwdCache = new Map<number, string | null>()

async function getProcessCwd(pid: number): Promise<string | null> {
  if (cwdCache.has(pid)) return cwdCache.get(pid)!
  try {
    const { stdout } = await execAsync(`lsof -p ${pid} -a -d cwd -F n`)
    const lines = stdout.split('\n')
    const nLine = lines.find((l) => l.startsWith('n') && l !== 'ncwd')
    const cwd = nLine ? nLine.slice(1) : null
    cwdCache.set(pid, cwd)
    return cwd
  } catch {
    cwdCache.set(pid, null)
    return null
  }
}

function parseElapsedToMs(elapsed: string): number {
  // etime format: [[DD-]HH:]MM:SS
  const trimmed = elapsed.trim()
  const dayParts = trimmed.split('-')
  let days = 0
  let timePart = trimmed
  if (dayParts.length === 2) {
    days = parseInt(dayParts[0])
    timePart = dayParts[1]
  }
  const segments = timePart.split(':').map((s) => parseInt(s))
  let seconds = 0
  if (segments.length === 3) {
    seconds = segments[0] * 3600 + segments[1] * 60 + segments[2]
  } else if (segments.length === 2) {
    seconds = segments[0] * 60 + segments[1]
  } else if (segments.length === 1) {
    seconds = segments[0]
  }
  return (days * 86400 + seconds) * 1000
}

function matchAgentBin(command: string): string | null {
  const parts = command.split(/\s+/)
  for (const part of parts) {
    const basename = (part.split('/').pop() ?? '').toLowerCase()
    const match = AGENT_BINS.find((b) => basename === b)
    if (match) return match
  }
  return null
}

export async function getAgentProcesses(): Promise<LocalAgentProcess[]> {
  try {
    const { stdout } = await execAsync('ps -eo pid,%cpu,rss,etime,args')
    const lines = stdout.trim().split('\n').slice(1) // skip header

    const candidates: {
      pid: number
      cpuPct: number
      rss: number
      elapsed: string
      command: string
      bin: string
    }[] = []

    for (const line of lines) {
      const match = line.match(/^\s*(\d+)\s+([\d.]+)\s+(\d+)\s+(\S+)\s+(.+)$/)
      if (!match) continue

      const [, pidStr, cpuStr, rssStr, elapsed, command] = match
      const bin = matchAgentBin(command!)
      if (!bin) continue

      candidates.push({
        pid: parseInt(pidStr!),
        cpuPct: parseFloat(cpuStr!),
        rss: parseInt(rssStr!),
        elapsed: elapsed!,
        command: command!,
        bin
      })
    }

    // Resolve CWDs in parallel
    const results = await Promise.all(
      candidates.map(async (c) => {
        const cwd = await getProcessCwd(c.pid)
        const cmdParts = c.command.split(/\s+/)
        const args = cmdParts.slice(1).join(' ')
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

    // Evict stale cache entries for dead PIDs
    const livePids = new Set(results.map((r) => r.pid))
    for (const pid of cwdCache.keys()) {
      if (!livePids.has(pid)) cwdCache.delete(pid)
    }

    return results
  } catch {
    return []
  }
}
