import { describe, it, expect } from 'vitest'
import { createWorktreeIsolationHook } from '../worktree-isolation-hook'

describe('createWorktreeIsolationHook', () => {
  const hook = createWorktreeIsolationHook({
    worktreePath: '/tmp/worktree',
    mainRepoPaths: ['/Users/me/repo']
  })

  const permissionExtras = {
    signal: new AbortController().signal,
    suggestions: []
  }

  // Regression guard for the adhoc MCP bug. Two earlier attempts both broke:
  //   - `updatedInput: {}` silently replaced every tool call's arguments with
  //     an empty object, so MCP tools with required fields failed validation
  //     with "expected string, received undefined".
  //   - Omitting `updatedInput` entirely violated the SDK's runtime schema
  //     for the allow branch — tool permission requests crashed with a
  //     ZodError before dispatch.
  // The only right answer is to echo the model's original input back so the
  // SDK gets "allow, unchanged arguments".
  it('allows MCP tools and echoes the model-supplied input back', async () => {
    const input = { name: 'Test Epic', goal: 'verify tool access' }

    const result = await hook('mcp__fleet__epics_create', input, permissionExtras)

    expect(result.behavior).toBe('allow')
    if (result.behavior === 'allow') {
      expect(result.updatedInput).toEqual(input)
    }
  })

  it('allows built-in read tools with the original input echoed', async () => {
    const input = { file_path: '/tmp/worktree/src/foo.ts' }

    const result = await hook('Read', input, permissionExtras)

    expect(result.behavior).toBe('allow')
    if (result.behavior === 'allow') {
      expect(result.updatedInput).toEqual(input)
    }
  })

  it('allows Write inside the worktree with the original input echoed', async () => {
    const input = { file_path: '/tmp/worktree/src/new.ts', content: 'x' }

    const result = await hook('Write', input, permissionExtras)

    expect(result.behavior).toBe('allow')
    if (result.behavior === 'allow') {
      expect(result.updatedInput).toEqual(input)
    }
  })

  it('denies Write targeting a main-repo path', async () => {
    const result = await hook(
      'Write',
      { file_path: '/Users/me/repo/src/foo.ts', content: 'x' },
      permissionExtras
    )

    expect(result.behavior).toBe('deny')
    if (result.behavior === 'deny') {
      expect(result.message).toMatch(/worktree-isolation/i)
    }
  })

  it('denies Bash commands that reference a main-repo path', async () => {
    const result = await hook(
      'Bash',
      { command: 'rm /Users/me/repo/foo.txt' },
      permissionExtras
    )

    expect(result.behavior).toBe('deny')
  })
})
