import type { Logger } from '../logger'
import type { ISprintTaskRepository } from '../data/sprint-task-repository'
import { execFile as execFileCb } from 'node:child_process'
import { promisify } from 'node:util'

const execFile = promisify(execFileCb)

const MAX_PARTIAL_DIFF_SIZE = 50 * 1024 // 50KB

export type DiffCaptureErrorClass =
  | 'git-missing' // ENOENT on spawn — git binary not on PATH
  | 'no-head' // agent has no commits yet — expected, benign
  | 'not-a-repo' // cwd is not a git repository — unusual but benign
  | 'max-buffer' // diff exceeded maxBuffer — expected, we cap at 50KB
  | 'unknown' // other — needs investigation

export function classifyDiffCaptureError(err: unknown): DiffCaptureErrorClass {
  const code = (err as NodeJS.ErrnoException | null)?.code
  if (code === 'ENOENT') return 'git-missing'
  const msg = (err as Error | null)?.message ?? ''
  if (/unknown revision|bad revision|ambiguous argument 'HEAD'/i.test(msg)) return 'no-head'
  if (/not a git repository/i.test(msg)) return 'not-a-repo'
  if (/maxBuffer/i.test(msg)) return 'max-buffer'
  return 'unknown'
}

/**
 * Capture uncommitted/unstaged changes from a failed agent's worktree.
 * Runs `git diff HEAD` and stores the result (capped at 50KB) in task.partial_diff.
 * This preserves partial progress when the worktree is cleaned up after failure.
 */
export async function capturePartialDiff(
  taskId: string,
  worktreePath: string,
  repo: ISprintTaskRepository,
  logger: Logger
): Promise<void> {
  try {
    const { stdout } = await execFile('git', ['diff', 'HEAD'], {
      cwd: worktreePath,
      maxBuffer: MAX_PARTIAL_DIFF_SIZE
    })

    if (stdout.trim()) {
      // Cap at 50KB
      const diff = stdout.slice(0, MAX_PARTIAL_DIFF_SIZE)
      const truncated = stdout.length > MAX_PARTIAL_DIFF_SIZE

      repo.updateTask(taskId, {
        partial_diff: truncated ? diff + '\n\n[... diff truncated at 50KB]' : diff
      })

      logger.info(
        `[agent-manager] Captured partial diff for task ${taskId} (${diff.length} bytes${truncated ? ', truncated' : ''})`
      )
    }
  } catch (err) {
    const kind = classifyDiffCaptureError(err)
    const base = `[agent-manager] Failed to capture partial diff for task ${taskId}`
    if (kind === 'git-missing') {
      logger.error(`${base}: git binary not found on PATH — install Xcode CLT or Homebrew (${err})`)
    } else {
      logger.warn(`${base} [${kind}]: ${err}`)
    }
  }
}
