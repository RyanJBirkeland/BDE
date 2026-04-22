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

  it('denies Bash referencing a scratchpad dir not on the allowlist', async () => {
    const hook = createWorktreeIsolationHook(deps)
    const result = await hook(
      'Bash',
      { command: 'ls /Users/test/.bde/memory/tasks/t-1' },
      { signal: new AbortController().signal }
    )
    expect(result.behavior).toBe('deny')
  })

  it('allows Bash referencing a path explicitly on extraAllowedPaths', async () => {
    const hook = createWorktreeIsolationHook({
      ...deps,
      extraAllowedPaths: ['/Users/test/.bde/memory']
    })
    const result = await hook(
      'Bash',
      { command: 'ls /Users/test/.bde/memory/tasks/t-1' },
      { signal: new AbortController().signal }
    )
    expect(result.behavior).toBe('allow')
  })
})

describe('Default-deny: writes outside the worktree are blocked by default', () => {
  const deps = {
    worktreePath: '/Users/test/worktrees/bde/abc123',
    mainRepoPaths: ['/Users/test/Projects/git-repos/BDE']
  }

  it('denies Write to ~/.ssh/authorized_keys', async () => {
    const hook = createWorktreeIsolationHook(deps)
    const result = await hook(
      'Write',
      { file_path: '/Users/test/.ssh/authorized_keys', content: 'ssh-rsa AAAA...' },
      { signal: new AbortController().signal }
    )
    expect(result.behavior).toBe('deny')
    if (result.behavior === 'deny') {
      expect(result.message).toMatch(/outside your worktree/i)
    }
  })

  it('denies Write to a launchd plist under ~/Library/LaunchAgents', async () => {
    const hook = createWorktreeIsolationHook(deps)
    const result = await hook(
      'Write',
      {
        file_path: '/Users/test/Library/LaunchAgents/com.evil.plist',
        content: '<plist/>'
      },
      { signal: new AbortController().signal }
    )
    expect(result.behavior).toBe('deny')
  })

  it('denies Write to ~/.zshrc', async () => {
    const hook = createWorktreeIsolationHook(deps)
    const result = await hook(
      'Write',
      { file_path: '/Users/test/.zshrc', content: 'export OOPS=1' },
      { signal: new AbortController().signal }
    )
    expect(result.behavior).toBe('deny')
  })

  it('denies Write to an arbitrary /tmp path', async () => {
    const hook = createWorktreeIsolationHook(deps)
    const result = await hook(
      'Write',
      { file_path: '/tmp/persist.sh', content: '#!/bin/sh' },
      { signal: new AbortController().signal }
    )
    expect(result.behavior).toBe('deny')
  })

  it('denies Edit to ~/.aws/credentials', async () => {
    const hook = createWorktreeIsolationHook(deps)
    const result = await hook(
      'Edit',
      {
        file_path: '/Users/test/.aws/credentials',
        old_string: 'a',
        new_string: 'b'
      },
      { signal: new AbortController().signal }
    )
    expect(result.behavior).toBe('deny')
  })

  it('allows Write to a path in extraAllowedPaths', async () => {
    const hook = createWorktreeIsolationHook({
      ...deps,
      extraAllowedPaths: ['/Users/test/.bde/memory']
    })
    const result = await hook(
      'Write',
      {
        file_path: '/Users/test/.bde/memory/notes.md',
        content: 'scratch'
      },
      { signal: new AbortController().signal }
    )
    expect(result.behavior).toBe('allow')
  })

  it('still denies paths outside both the worktree and extraAllowedPaths', async () => {
    const hook = createWorktreeIsolationHook({
      ...deps,
      extraAllowedPaths: ['/Users/test/.bde/memory']
    })
    const result = await hook(
      'Write',
      { file_path: '/Users/test/.ssh/authorized_keys', content: 'x' },
      { signal: new AbortController().signal }
    )
    expect(result.behavior).toBe('deny')
  })

  it('denies Bash redirect to ~/.ssh/authorized_keys', async () => {
    const hook = createWorktreeIsolationHook(deps)
    const result = await hook(
      'Bash',
      { command: 'echo ssh-rsa... >> /Users/test/.ssh/authorized_keys' },
      { signal: new AbortController().signal }
    )
    expect(result.behavior).toBe('deny')
  })

  it('denies Bash absolute path to ~/Library/LaunchAgents', async () => {
    const hook = createWorktreeIsolationHook(deps)
    const result = await hook(
      'Bash',
      { command: 'cp plist /Users/test/Library/LaunchAgents/com.evil.plist' },
      { signal: new AbortController().signal }
    )
    expect(result.behavior).toBe('deny')
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
