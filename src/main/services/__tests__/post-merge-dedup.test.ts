import { describe, it, expect, vi, beforeEach } from 'vitest'
import { runPostMergeDedup } from '../post-merge-dedup'
import * as fs from 'node:fs'
import * as cssDedup from '../css-dedup'

vi.mock('node:fs')
vi.mock('node:child_process', () => ({
  execFile: (
    _cmd: string,
    _args: string[],
    _opts: unknown,
    callback: (err: Error | null, result?: { stdout: string }) => void
  ) => {
    const mockExecFile = getMockExecFile()
    mockExecFile(_cmd, _args, _opts, callback)
  }
}))
vi.mock('../../logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  })
}))
vi.mock('../../env-utils', () => ({
  buildAgentEnv: vi.fn(() => ({ PATH: '/usr/bin' }))
}))
vi.mock('../css-dedup')

let mockExecFile: ReturnType<typeof vi.fn>

function getMockExecFile() {
  return mockExecFile
}

describe('post-merge-dedup', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mockExecFile = vi.fn(
      (
        cmd: string,
        args: string[],
        _opts: unknown,
        callback: (err: Error | null, result?: { stdout: string }) => void
      ) => {
        if (args.includes('--name-only')) {
          callback(null, { stdout: 'src/styles/main.css\n' })
        } else if (args.includes('add') || args.includes('commit')) {
          callback(null, { stdout: '' })
        } else {
          callback(null, { stdout: '' })
        }
      }
    )

    vi.mocked(fs.readFileSync).mockReturnValue('.class { color: duplicate; }')
    vi.mocked(cssDedup.deduplicateCss).mockReturnValue({
      deduplicated: '.class { color: cleaned; }',
      removed: ['duplicate rule'],
      warnings: []
    })
  })

  it('should return null if HEAD~1 does not exist', async () => {
    mockExecFile = vi.fn((_cmd, _args, _opts, callback: (err: Error | null) => void) => {
      callback(new Error('HEAD~1 not found'))
    })

    const result = await runPostMergeDedup('/repo')

    expect(result).toBeNull()
  })

  it('should return null if no CSS files changed', async () => {
    mockExecFile = vi.fn(
      (
        cmd: string,
        args: string[],
        _opts: unknown,
        callback: (err: Error | null, result?: { stdout: string }) => void
      ) => {
        if (args.includes('--name-only')) {
          callback(null, { stdout: 'src/index.ts\nREADME.md\n' })
        } else {
          callback(null, { stdout: '' })
        }
      }
    )

    const result = await runPostMergeDedup('/repo')

    expect(result).toBeNull()
  })

  it('should process CSS files and return report', async () => {
    const result = await runPostMergeDedup('/repo')

    expect(result).not.toBeNull()
    expect(result?.filesModified).toEqual(['src/styles/main.css'])
    expect(result?.totalRemoved).toBe(1)
  })

  it('should write deduplicated CSS back to file', async () => {
    await runPostMergeDedup('/repo')

    expect(fs.writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining('main.css'),
      expect.stringContaining('cleaned'),
      'utf8'
    )
  })

  it('should commit changes if files were modified', async () => {
    await runPostMergeDedup('/repo')

    expect(mockExecFile).toHaveBeenCalledWith(
      'git',
      ['add', 'src/styles/main.css'],
      expect.any(Object),
      expect.any(Function)
    )

    expect(mockExecFile).toHaveBeenCalledWith(
      'git',
      ['commit', '-m', 'chore: deduplicate CSS from merge\n\nAutomated by BDE post-merge dedup'],
      expect.any(Object),
      expect.any(Function)
    )
  })

  it('should skip files with no duplicates', async () => {
    vi.mocked(cssDedup.deduplicateCss).mockReturnValue({
      deduplicated: '.class { color: red; }',
      removed: [],
      warnings: []
    })

    const result = await runPostMergeDedup('/repo')

    expect(result?.filesModified).toEqual([])
    expect(result?.committed).toBe(false)
  })

  it('should handle multiple CSS files', async () => {
    mockExecFile = vi.fn(
      (
        cmd: string,
        args: string[],
        _opts: unknown,
        callback: (err: Error | null, result?: { stdout: string }) => void
      ) => {
        if (args.includes('--name-only')) {
          callback(null, { stdout: 'a.css\nb.css\n' })
        } else {
          callback(null, { stdout: '' })
        }
      }
    )

    vi.mocked(fs.readFileSync).mockReturnValue('.duplicate { }')

    const result = await runPostMergeDedup('/repo')

    expect(result?.filesModified).toEqual(['a.css', 'b.css'])
    expect(result?.totalRemoved).toBe(2)
  })

  it('should collect warnings from deduplication', async () => {
    vi.mocked(cssDedup.deduplicateCss).mockReturnValue({
      deduplicated: '',
      removed: [],
      warnings: ['Warning 1', 'Warning 2']
    })

    const result = await runPostMergeDedup('/repo')

    expect(result?.warnings).toEqual(['Warning 1', 'Warning 2'])
  })

  it('should handle file read errors gracefully', async () => {
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error('Permission denied')
    })

    const result = await runPostMergeDedup('/repo')

    expect(result?.filesModified).toEqual([])
  })

  it('should handle file write errors gracefully', async () => {
    vi.mocked(fs.writeFileSync).mockImplementation(() => {
      throw new Error('Disk full')
    })

    const result = await runPostMergeDedup('/repo')

    expect(result?.filesModified).toEqual([])
  })

  it('should handle commit errors gracefully', async () => {
    mockExecFile = vi.fn(
      (
        cmd: string,
        args: string[],
        _opts: unknown,
        callback: (err: Error | null, result?: { stdout: string }) => void
      ) => {
        if (args.includes('commit')) {
          callback(new Error('Commit failed'))
        } else if (args.includes('--name-only')) {
          callback(null, { stdout: 'main.css\n' })
        } else {
          callback(null, { stdout: '' })
        }
      }
    )

    const result = await runPostMergeDedup('/repo')

    expect(result?.committed).toBe(false)
  })
})
