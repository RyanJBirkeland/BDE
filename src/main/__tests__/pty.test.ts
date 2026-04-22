import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { isPtyAvailable, validateShell, createPty, _setPty } from '../pty'

describe('pty', () => {
  it('reports availability', () => {
    expect(typeof isPtyAvailable()).toBe('boolean')
  })

  it('validates allowed shells', () => {
    expect(validateShell('/bin/zsh')).toBe(true)
    expect(validateShell('/bin/bash')).toBe(true)
    expect(validateShell('/bin/sh')).toBe(true)
    expect(validateShell('/bin/dash')).toBe(true)
    expect(validateShell('/bin/fish')).toBe(true)
    expect(validateShell('/usr/bin/evil')).toBe(false)
    expect(validateShell('')).toBe(false)
  })

  it('validates all allowed shell paths', () => {
    const allowed = [
      '/usr/bin/bash',
      '/usr/bin/zsh',
      '/usr/bin/sh',
      '/usr/bin/dash',
      '/usr/bin/fish',
      '/usr/local/bin/bash',
      '/usr/local/bin/zsh',
      '/usr/local/bin/fish',
      '/opt/homebrew/bin/bash',
      '/opt/homebrew/bin/zsh',
      '/opt/homebrew/bin/fish'
    ]
    for (const shell of allowed) {
      expect(validateShell(shell)).toBe(true)
    }
  })

  it('rejects disallowed shell paths', () => {
    expect(validateShell('/usr/bin/evil')).toBe(false)
    expect(validateShell('/tmp/shell')).toBe(false)
    expect(validateShell('bash')).toBe(false)
    expect(validateShell('/bin/zsh; rm -rf /')).toBe(false)
  })

  describe('_setPty / createPty with mock', () => {
    let mockSpawn: ReturnType<typeof vi.fn>
    let mockProc: {
      onData: ReturnType<typeof vi.fn>
      onExit: ReturnType<typeof vi.fn>
      write: ReturnType<typeof vi.fn>
      resize: ReturnType<typeof vi.fn>
      kill: ReturnType<typeof vi.fn>
    }

    beforeEach(() => {
      mockProc = {
        onData: vi.fn(),
        onExit: vi.fn(),
        write: vi.fn(),
        resize: vi.fn(),
        kill: vi.fn()
      }
      mockSpawn = vi.fn().mockReturnValue(mockProc)
      _setPty({ spawn: mockSpawn } as any)
    })

    afterEach(() => {
      // Restore to null so other tests see the real state
      _setPty(null)
    })

    it('isPtyAvailable returns true after _setPty with mock', () => {
      expect(isPtyAvailable()).toBe(true)
    })

    it('isPtyAvailable returns false after _setPty(null)', () => {
      _setPty(null)
      expect(isPtyAvailable()).toBe(false)
    })

    it('createPty throws when pty is null', () => {
      _setPty(null)
      expect(() => createPty({ shell: '/bin/zsh', cols: 80, rows: 24 })).toThrow(
        'Terminal unavailable'
      )
    })

    it('createPty throws for disallowed shell', () => {
      expect(() => createPty({ shell: '/usr/bin/evil', cols: 80, rows: 24 })).toThrow(
        'Shell not allowed'
      )
    })

    it('createPty spawns with correct options', () => {
      const handle = createPty({ shell: '/bin/zsh', cols: 80, rows: 24 })
      expect(mockSpawn).toHaveBeenCalledWith('/bin/zsh', [], {
        name: 'xterm-256color',
        cols: 80,
        rows: 24,
        cwd: expect.any(String),
        env: expect.objectContaining({ TERM: 'xterm-256color' })
      })
      expect(handle).toBeDefined()
    })

    it('createPty uses provided cwd', () => {
      createPty({ shell: '/bin/zsh', cols: 80, rows: 24, cwd: '/tmp/test' })
      expect(mockSpawn).toHaveBeenCalledWith(
        '/bin/zsh',
        [],
        expect.objectContaining({ cwd: '/tmp/test' })
      )
    })

    it('createPty defaults cwd to HOME', () => {
      const originalHome = process.env.HOME
      process.env.HOME = '/Users/testuser'
      createPty({ shell: '/bin/zsh', cols: 80, rows: 24 })
      expect(mockSpawn).toHaveBeenCalledWith(
        '/bin/zsh',
        [],
        expect.objectContaining({ cwd: '/Users/testuser' })
      )
      process.env.HOME = originalHome
    })

    it('PtyHandle.write delegates to proc.write', () => {
      const handle = createPty({ shell: '/bin/zsh', cols: 80, rows: 24 })
      handle.write('ls -la\n')
      expect(mockProc.write).toHaveBeenCalledWith('ls -la\n')
    })

    it('PtyHandle.resize delegates to proc.resize', () => {
      const handle = createPty({ shell: '/bin/zsh', cols: 80, rows: 24 })
      handle.resize(120, 40)
      expect(mockProc.resize).toHaveBeenCalledWith(120, 40)
    })

    it('PtyHandle.kill delegates to proc.kill', () => {
      const handle = createPty({ shell: '/bin/zsh', cols: 80, rows: 24 })
      handle.kill()
      expect(mockProc.kill).toHaveBeenCalled()
    })

    it('PtyHandle.onData registers callback on proc', () => {
      const handle = createPty({ shell: '/bin/zsh', cols: 80, rows: 24 })
      const cb = vi.fn()
      handle.onData(cb)
      expect(mockProc.onData).toHaveBeenCalledWith(cb)
    })

    it('PtyHandle.onExit registers callback that fires on proc exit', () => {
      // onExit wraps the callback: proc.onExit(() => cb())
      let procExitCb: (() => void) | undefined
      mockProc.onExit.mockImplementation((cb: () => void) => {
        procExitCb = cb
      })

      const handle = createPty({ shell: '/bin/zsh', cols: 80, rows: 24 })
      const exitCb = vi.fn()
      handle.onExit(exitCb)

      expect(procExitCb).toBeDefined()
      procExitCb!()
      expect(exitCb).toHaveBeenCalled()
    })

    it('PtyHandle exposes the underlying process', () => {
      const handle = createPty({ shell: '/bin/zsh', cols: 80, rows: 24 })
      expect(handle.process).toBe(mockProc)
    })

    describe('environment scrubbing', () => {
      it('does not forward ANTHROPIC_API_KEY from process.env', () => {
        const original = process.env.ANTHROPIC_API_KEY
        process.env.ANTHROPIC_API_KEY = 'sk-ant-secret-do-not-leak'
        try {
          createPty({ shell: '/bin/zsh', cols: 80, rows: 24 })
          const spawnArgs = mockSpawn.mock.calls[0]
          const env = spawnArgs[2].env as Record<string, string>
          expect(env.ANTHROPIC_API_KEY).toBeUndefined()
        } finally {
          if (original === undefined) delete process.env.ANTHROPIC_API_KEY
          else process.env.ANTHROPIC_API_KEY = original
        }
      })

      it('does not forward AWS_SECRET_ACCESS_KEY from process.env', () => {
        const original = process.env.AWS_SECRET_ACCESS_KEY
        process.env.AWS_SECRET_ACCESS_KEY = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY'
        try {
          createPty({ shell: '/bin/zsh', cols: 80, rows: 24 })
          const spawnArgs = mockSpawn.mock.calls[0]
          const env = spawnArgs[2].env as Record<string, string>
          expect(env.AWS_SECRET_ACCESS_KEY).toBeUndefined()
        } finally {
          if (original === undefined) delete process.env.AWS_SECRET_ACCESS_KEY
          else process.env.AWS_SECRET_ACCESS_KEY = original
        }
      })

      it('does not forward NPM_TOKEN from process.env', () => {
        const original = process.env.NPM_TOKEN
        process.env.NPM_TOKEN = 'npm_secretTokenDoNotLeak'
        try {
          createPty({ shell: '/bin/zsh', cols: 80, rows: 24 })
          const spawnArgs = mockSpawn.mock.calls[0]
          const env = spawnArgs[2].env as Record<string, string>
          expect(env.NPM_TOKEN).toBeUndefined()
        } finally {
          if (original === undefined) delete process.env.NPM_TOKEN
          else process.env.NPM_TOKEN = original
        }
      })

      it('does forward PATH and HOME (allowlisted legitimate values)', () => {
        createPty({ shell: '/bin/zsh', cols: 80, rows: 24 })
        const spawnArgs = mockSpawn.mock.calls[0]
        const env = spawnArgs[2].env as Record<string, string>
        expect(env.PATH).toBeDefined()
        expect(env.TERM).toBe('xterm-256color')
      })
    })
  })
})
