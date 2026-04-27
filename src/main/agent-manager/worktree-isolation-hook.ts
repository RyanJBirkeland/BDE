import { resolve as resolvePath } from 'node:path'
import type { CanUseTool } from '@anthropic-ai/claude-agent-sdk'
import type { Logger } from '../logger'

export interface WorktreeIsolationDeps {
  /** Absolute path to the agent's worktree (cwd). */
  worktreePath: string
  /** Absolute paths to primary repo checkouts that must not be touched. */
  mainRepoPaths: readonly string[]
  /**
   * Absolute paths outside the worktree that the agent is still permitted
   * to read/write (e.g. `~/.bde/memory/`). Everything not in the worktree
   * and not on this allowlist is denied by default.
   */
  extraAllowedPaths?: readonly string[]
  /** Optional logger for denied operations. */
  logger?: Pick<Logger, 'warn' | 'info' | 'error' | 'debug'> | undefined
}

export function createWorktreeIsolationHook(deps: WorktreeIsolationDeps): CanUseTool {
  const worktreeAbs = resolvePath(deps.worktreePath)
  const mainRepoPrefixes = deps.mainRepoPaths.map((p) => resolvePath(p))
  const extraAllowedPrefixes = (deps.extraAllowedPaths ?? []).map((p) => resolvePath(p))

  function isInsidePrefix(absPath: string, prefix: string): boolean {
    return absPath === prefix || absPath.startsWith(prefix + '/')
  }

  function isInsideWorktree(absPath: string): boolean {
    return isInsidePrefix(resolvePath(absPath), worktreeAbs)
  }

  function pointsAtMainRepo(absPath: string): boolean {
    const resolved = resolvePath(absPath)
    return mainRepoPrefixes.some((prefix) => isInsidePrefix(resolved, prefix))
  }

  function isExplicitlyAllowed(absPath: string): boolean {
    const resolved = resolvePath(absPath)
    return extraAllowedPrefixes.some((prefix) => isInsidePrefix(resolved, prefix))
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

  const FLAG_INTRODUCING_PATH = new Set(['-o', '--output', '-f', '--file', '--log-file', '--config'])

  function findDisallowedAbsolutePath(command: string): string | null {
    const tokens = command.split(/[\s;|&<>()]+/).filter(Boolean)
    for (const rawToken of tokens) {
      const unquoted = rawToken.replace(/^['"]|['"]$/g, '')
      if (!unquoted.startsWith('/')) continue
      if (isInsideWorktree(unquoted)) continue
      if (isExplicitlyAllowed(unquoted)) continue
      return unquoted
    }

    // Also check paths that follow common flag tokens like -o PATH or --output PATH
    for (let i = 0; i < tokens.length - 1; i++) {
      const flag = tokens[i]!
      if (FLAG_INTRODUCING_PATH.has(flag)) {
        const nextToken = tokens[i + 1]!
        const unquoted = nextToken.replace(/^['"]|['"]$/g, '')
        if (unquoted.startsWith('/') && !isInsideWorktree(unquoted) && !isExplicitlyAllowed(unquoted)) {
          return unquoted
        }
      }
    }

    return null
  }

  function denyReasonFor(path: string, toolName: string): string {
    if (pointsAtMainRepo(path)) {
      return (
        `Blocked by worktree-isolation: ${toolName} references main checkout path ${path}. ` +
        `Use relative paths or paths under the worktree (${worktreeAbs}).`
      )
    }
    return (
      `Blocked by worktree-isolation: ${toolName} targets ${path}, which is outside your ` +
      `worktree (${worktreeAbs}) and not on the allowlist. Use a relative path or an absolute ` +
      `path under the worktree.`
    )
  }

  return async (toolName, input) => {
    if (toolName === 'Bash') {
      const command = typeof input.command === 'string' ? input.command : ''
      const offending = findDisallowedAbsolutePath(command)
      if (offending) {
        return deny(denyReasonFor(offending, 'Bash'), 'Bash', offending)
      }
    }

    if (WRITE_TOOLS.has(toolName)) {
      const filePath =
        typeof input.file_path === 'string'
          ? input.file_path
          : typeof input.notebook_path === 'string'
            ? input.notebook_path
            : null
      if (filePath && filePath.startsWith('/')) {
        if (!isInsideWorktree(filePath) && !isExplicitlyAllowed(filePath)) {
          return deny(denyReasonFor(filePath, toolName), toolName, filePath)
        }
      }
    }
    // Echo the original input back as `updatedInput`. The SDK's native
    // permission bridge follows the same convention: `{ behavior: 'allow',
    // updatedInput: <original> }` — signalling "allow this call with its
    // arguments unchanged". An earlier version returned `updatedInput: {}`,
    // which silently replaced every tool call's arguments with an empty
    // object and broke MCP tools with required fields
    // ("expected string, received undefined"). Omitting the field entirely
    // fails the SDK's runtime schema for the allow branch. Echo the input.
    return { behavior: 'allow' as const, updatedInput: input }
  }
}
