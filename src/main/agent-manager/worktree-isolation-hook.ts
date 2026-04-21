import { resolve as resolvePath } from 'node:path'
import type { CanUseTool } from '@anthropic-ai/claude-agent-sdk'
import type { Logger } from '../logger'

export interface WorktreeIsolationDeps {
  /** Absolute path to the agent's worktree (cwd). */
  worktreePath: string
  /** Absolute paths to primary repo checkouts that must not be touched. */
  mainRepoPaths: readonly string[]
  /** Optional logger for denied operations. */
  logger?: Pick<Logger, 'warn' | 'info' | 'error' | 'debug'> | undefined
}

export function createWorktreeIsolationHook(deps: WorktreeIsolationDeps): CanUseTool {
  const worktreeAbs = resolvePath(deps.worktreePath)
  const blockedPrefixes = deps.mainRepoPaths.map((p) => resolvePath(p) + '/')

  function isInsideWorktree(absPath: string): boolean {
    const resolved = resolvePath(absPath)
    return resolved === worktreeAbs || resolved.startsWith(worktreeAbs + '/')
  }

  function pointsAtMainRepo(absPath: string): boolean {
    const resolved = resolvePath(absPath)
    return blockedPrefixes.some(
      (prefix) => resolved === prefix.slice(0, -1) || resolved.startsWith(prefix)
    )
  }

  function deny(
    message: string,
    toolName: string,
    path: string
  ): { behavior: 'deny'; message: string } {
    deps.logger?.warn(`[worktree-isolation] denied ${toolName} path=${path} — ${message}`)
    return { behavior: 'deny' as const, message }
  }

  const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit'])

  function bashCommandHitsMainRepo(command: string): string | null {
    // Tokenize loosely on whitespace + shell separators. Conservative:
    // we only need to find absolute paths that start with /.
    const tokens = command.split(/[\s;|&<>()]+/).filter(Boolean)
    for (const tok of tokens) {
      // Strip common shell quoting.
      const unquoted = tok.replace(/^['"]|['"]$/g, '')
      if (!unquoted.startsWith('/')) continue
      if (pointsAtMainRepo(unquoted)) return unquoted
    }
    return null
  }

  return async (toolName, input) => {
    if (toolName === 'Bash') {
      const command = typeof input.command === 'string' ? input.command : ''
      const offending = bashCommandHitsMainRepo(command)
      if (offending) {
        return deny(
          `Blocked by worktree-isolation: Bash command references main checkout path ${offending}. ` +
            `Use relative paths or paths under the worktree (${worktreeAbs}).`,
          'Bash',
          offending
        )
      }
    }

    if (WRITE_TOOLS.has(toolName)) {
      const filePath =
        typeof input.file_path === 'string'
          ? input.file_path
          : typeof input.notebook_path === 'string'
            ? input.notebook_path
            : null
      if (filePath && filePath.startsWith('/') && !isInsideWorktree(filePath)) {
        if (pointsAtMainRepo(filePath)) {
          return deny(
            `Blocked by worktree-isolation: ${toolName} targeting ${filePath} ` +
              `is outside your worktree (${worktreeAbs}). Use a relative path ` +
              `or an absolute path under the worktree.`,
            toolName,
            filePath
          )
        }
      }
    }
    return { behavior: 'allow' as const, updatedInput: {} }
  }
}
