/**
 * Tests for the worktree-base cwd allowlist in sdk-adapter.ts.
 *
 * Covers the realpath-based defense: a symlink that physically points
 * outside the allowed base must be rejected even if its lexical path
 * starts with the base prefix.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { DEFAULT_CONFIG } from '../types'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

vi.mock('../../env-utils', () => ({
  buildAgentEnv: vi.fn(() => ({ PATH: '/usr/local/bin' })),
  getOAuthToken: vi.fn(() => 'mock-oauth-token'),
  getClaudeCliPath: vi.fn(() => '/mock/path/to/claude')
}))

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: vi.fn().mockReturnValue({
    [Symbol.asyncIterator]: async function* () {
      yield { type: 'exit_code', exit_code: 0 }
    }
  })
}))

import { spawnAgent } from '../sdk-adapter'

let scratchRoot: string

beforeEach(() => {
  scratchRoot = mkdtempSync(join(tmpdir(), 'bde-worktree-base-test-'))
})

afterEach(() => {
  rmSync(scratchRoot, { recursive: true, force: true })
})

describe('isInsideAllowedWorktreeBase symlink defense', () => {
  it('rejects a cwd whose physical path escapes the worktree base via symlink', async () => {
    const worktreeBase = join(scratchRoot, 'worktrees')
    const outsideTarget = join(scratchRoot, 'outside', 'main-repo')
    mkdirSync(worktreeBase, { recursive: true })
    mkdirSync(outsideTarget, { recursive: true })

    // Inside the allowed base, a symlink whose target is outside it.
    const trojanCwd = join(worktreeBase, 'task-abc')
    symlinkSync(outsideTarget, trojanCwd)

    const logger = { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn(), event: vi.fn() }

    await expect(
      spawnAgent({
        prompt: 'test',
        cwd: trojanCwd,
        model: DEFAULT_CONFIG.defaultModel,
        pipelineTuning: { maxTurns: 20 },
        worktreeBase,
        logger
      })
    ).rejects.toThrow(/Refusing to spawn agent/)
  })

  it('allows a cwd whose physical path resolves inside the worktree base', async () => {
    const worktreeBase = join(scratchRoot, 'worktrees')
    const realCwd = join(worktreeBase, 'task-abc')
    mkdirSync(realCwd, { recursive: true })

    const logger = { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn(), event: vi.fn() }

    await expect(
      spawnAgent({
        prompt: 'test',
        cwd: realCwd,
        model: DEFAULT_CONFIG.defaultModel,
        pipelineTuning: { maxTurns: 20 },
        worktreeBase,
        logger
      })
    ).resolves.toBeDefined()
  })

  it('rejects a non-existent cwd (realpath fails closed)', async () => {
    const worktreeBase = join(scratchRoot, 'worktrees')
    mkdirSync(worktreeBase, { recursive: true })
    const missingCwd = join(worktreeBase, 'never-created')

    const logger = { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn(), event: vi.fn() }

    await expect(
      spawnAgent({
        prompt: 'test',
        cwd: missingCwd,
        model: DEFAULT_CONFIG.defaultModel,
        pipelineTuning: { maxTurns: 20 },
        worktreeBase,
        logger
      })
    ).rejects.toThrow(/Refusing to spawn agent/)
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('realpath failed'))
  })
})
