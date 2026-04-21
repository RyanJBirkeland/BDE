import { describe, it, expect, vi } from 'vitest'
import { createWorktreeIsolationHook } from './worktree-isolation-hook'

describe('createWorktreeIsolationHook', () => {
  it('returns a CanUseTool callback', () => {
    const hook = createWorktreeIsolationHook({
      worktreePath: '/Users/test/worktrees/bde/abc123',
      mainRepoPaths: ['/Users/test/Projects/git-repos/BDE']
    })
    expect(typeof hook).toBe('function')
  })
})

describe('Write/Edit with a worktree-scoped absolute path', () => {
  it('allows Write into the worktree', async () => {
    const hook = createWorktreeIsolationHook({
      worktreePath: '/Users/test/worktrees/bde/abc123',
      mainRepoPaths: ['/Users/test/Projects/git-repos/BDE']
    })
    const result = await hook(
      'Write',
      { file_path: '/Users/test/worktrees/bde/abc123/src/main/foo.ts', content: 'x' },
      { signal: new AbortController().signal }
    )
    expect(result.behavior).toBe('allow')
  })

  it('allows Edit into the worktree', async () => {
    const hook = createWorktreeIsolationHook({
      worktreePath: '/Users/test/worktrees/bde/abc123',
      mainRepoPaths: ['/Users/test/Projects/git-repos/BDE']
    })
    const result = await hook(
      'Edit',
      {
        file_path: '/Users/test/worktrees/bde/abc123/src/main/foo.ts',
        old_string: 'a',
        new_string: 'b'
      },
      { signal: new AbortController().signal }
    )
    expect(result.behavior).toBe('allow')
  })
})

describe('Write to main checkout is denied', () => {
  const deps = {
    worktreePath: '/Users/test/worktrees/bde/abc123',
    mainRepoPaths: ['/Users/test/Projects/git-repos/BDE']
  }

  it('denies Write to a main-checkout absolute path', async () => {
    const hook = createWorktreeIsolationHook(deps)
    const result = await hook(
      'Write',
      { file_path: '/Users/test/Projects/git-repos/BDE/src/main/foo.ts', content: 'x' },
      { signal: new AbortController().signal }
    )
    expect(result.behavior).toBe('deny')
    if (result.behavior === 'deny') {
      expect(result.message).toMatch(/worktree/)
      expect(result.message).toMatch(/\/src\/main\/foo\.ts/)
    }
  })

  it('denies Edit to a main-checkout absolute path', async () => {
    const hook = createWorktreeIsolationHook(deps)
    const result = await hook(
      'Edit',
      {
        file_path: '/Users/test/Projects/git-repos/BDE/src/main/foo.ts',
        old_string: 'a',
        new_string: 'b'
      },
      { signal: new AbortController().signal }
    )
    expect(result.behavior).toBe('deny')
  })

  it('denies MultiEdit when any edit targets the main checkout', async () => {
    const hook = createWorktreeIsolationHook(deps)
    const result = await hook(
      'MultiEdit',
      {
        file_path: '/Users/test/Projects/git-repos/BDE/src/main/foo.ts',
        edits: [{ old_string: 'a', new_string: 'b' }]
      },
      { signal: new AbortController().signal }
    )
    expect(result.behavior).toBe('deny')
  })

  it('denies NotebookEdit targeting main-checkout .ipynb', async () => {
    const hook = createWorktreeIsolationHook(deps)
    const result = await hook(
      'NotebookEdit',
      { notebook_path: '/Users/test/Projects/git-repos/BDE/nb.ipynb', new_source: '' },
      { signal: new AbortController().signal }
    )
    expect(result.behavior).toBe('deny')
  })

  it('allows relative paths (SDK will resolve them against cwd)', async () => {
    const hook = createWorktreeIsolationHook(deps)
    const result = await hook(
      'Write',
      { file_path: 'src/main/foo.ts', content: 'x' },
      { signal: new AbortController().signal }
    )
    expect(result.behavior).toBe('allow')
  })
})

describe('Bash commands targeting main checkout are denied', () => {
  const deps = {
    worktreePath: '/Users/test/worktrees/bde/abc123',
    mainRepoPaths: ['/Users/test/Projects/git-repos/BDE']
  }

  it('denies a `cd <main-repo>` prefix', async () => {
    const hook = createWorktreeIsolationHook(deps)
    const result = await hook(
      'Bash',
      { command: 'cd /Users/test/Projects/git-repos/BDE && npm test' },
      { signal: new AbortController().signal }
    )
    expect(result.behavior).toBe('deny')
    if (result.behavior === 'deny') {
      expect(result.message).toMatch(/main checkout/i)
    }
  })

  it('denies a raw absolute path argument pointing at the main repo', async () => {
    const hook = createWorktreeIsolationHook(deps)
    const result = await hook(
      'Bash',
      { command: 'cat /Users/test/Projects/git-repos/BDE/src/main/foo.ts' },
      { signal: new AbortController().signal }
    )
    expect(result.behavior).toBe('deny')
  })

  it('denies a redirect to a main-repo path', async () => {
    const hook = createWorktreeIsolationHook(deps)
    const result = await hook(
      'Bash',
      { command: 'echo x > /Users/test/Projects/git-repos/BDE/tmp.txt' },
      { signal: new AbortController().signal }
    )
    expect(result.behavior).toBe('deny')
  })

  it('allows Bash in the worktree with relative paths', async () => {
    const hook = createWorktreeIsolationHook(deps)
    const result = await hook(
      'Bash',
      { command: 'npm test -- src/main/foo' },
      { signal: new AbortController().signal }
    )
    expect(result.behavior).toBe('allow')
  })

  it('allows Bash with absolute paths inside the worktree', async () => {
    const hook = createWorktreeIsolationHook(deps)
    const result = await hook(
      'Bash',
      {
        command: 'cat /Users/test/worktrees/bde/abc123/src/main/foo.ts'
      },
      { signal: new AbortController().signal }
    )
    expect(result.behavior).toBe('allow')
  })

  it('allows Bash referencing scratchpad dir outside worktree but not in main repo', async () => {
    const hook = createWorktreeIsolationHook(deps)
    const result = await hook(
      'Bash',
      { command: 'ls /Users/test/.bde/memory/tasks/t-1' },
      { signal: new AbortController().signal }
    )
    expect(result.behavior).toBe('allow')
  })
})

describe('deny logging', () => {
  it('invokes the logger.warn with tool and path on deny', async () => {
    const warn = vi.fn()
    const hook = createWorktreeIsolationHook({
      worktreePath: '/Users/test/worktrees/bde/abc123',
      mainRepoPaths: ['/Users/test/Projects/git-repos/BDE'],
      logger: { warn, info: vi.fn(), error: vi.fn(), debug: vi.fn() }
    })
    await hook(
      'Write',
      { file_path: '/Users/test/Projects/git-repos/BDE/src/main/foo.ts', content: 'x' },
      { signal: new AbortController().signal }
    )
    expect(warn).toHaveBeenCalledTimes(1)
    const arg = warn.mock.calls[0][0] as string
    expect(arg).toMatch(/\[worktree-isolation\]/)
    expect(arg).toMatch(/Write/)
    expect(arg).toMatch(/foo\.ts/)
  })

  it('does not log on allow', async () => {
    const warn = vi.fn()
    const hook = createWorktreeIsolationHook({
      worktreePath: '/Users/test/worktrees/bde/abc123',
      mainRepoPaths: ['/Users/test/Projects/git-repos/BDE'],
      logger: { warn, info: vi.fn(), error: vi.fn(), debug: vi.fn() }
    })
    await hook('Bash', { command: 'npm test' }, { signal: new AbortController().signal })
    expect(warn).not.toHaveBeenCalled()
  })
})
