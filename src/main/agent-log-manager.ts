/**
 * Agent log management — tail log files and clean up old logs.
 */
import { readdir, stat, unlink, open } from 'fs/promises'
import { join } from 'path'
import { validateLogPath } from './fs'
import { BDE_AGENT_TMP_DIR as LOG_DIR } from './paths'

export const LOG_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

export interface TailLogArgs {
  logPath: string
  fromByte?: number | undefined
}

export interface TailLogResult {
  content: string
  nextByte: number
}

export async function tailAgentLog(args: TailLogArgs): Promise<TailLogResult> {
  const safePath = validateLogPath(args.logPath)
  const fromByte = args.fromByte ?? 0
  let fh: import('fs/promises').FileHandle | undefined
  try {
    fh = await open(safePath, 'r')
    const stats = await fh.stat()
    const size = stats.size
    if (fromByte >= size) return { content: '', nextByte: fromByte }
    const buf = Buffer.alloc(size - fromByte)
    await fh.read(buf, 0, buf.length, fromByte)
    return { content: buf.toString('utf-8'), nextByte: size }
  } catch {
    return { content: '', nextByte: fromByte }
  } finally {
    await fh?.close()
  }
}

export async function cleanupOldLogs(): Promise<void> {
  try {
    const entries = await readdir(LOG_DIR)
    const now = Date.now()
    await Promise.all(
      entries
        .filter((f) => f.endsWith('.log'))
        .map(async (f) => {
          const fullPath = join(LOG_DIR, f)
          const s = await stat(fullPath)
          if (now - s.mtimeMs > LOG_MAX_AGE_MS) await unlink(fullPath)
        })
    )
  } catch {
    // Dir may not exist yet — that's fine
  }
}
