import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/tmp'),
    getName: vi.fn(() => 'BDE'),
    getVersion: vi.fn(() => '0.0.0')
  },
  BrowserWindow: { getAllWindows: vi.fn(() => []) },
  ipcMain: { handle: vi.fn(), on: vi.fn() },
  shell: { trashItem: vi.fn() }
}))

vi.mock('fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs/promises')>()
  return {
    ...actual,
    stat: vi.fn(),
    readFile: vi.fn(),
    readdir: vi.fn(),
    mkdir: vi.fn(),
    writeFile: vi.fn(),
    rename: vi.fn(),
    rm: vi.fn()
  }
})

import { stat, readFile, readdir } from 'fs/promises'
import {
  validateIdePath,
  readDir,
  readFileContent,
  writeFileContent
} from '../handlers/ide-fs-handlers'

const ROOT = '/home/user/projects/myapp'

describe('validateIdePath', () => {
  it('allows a path within root', () => {
    const result = validateIdePath(`${ROOT}/src/index.ts`, ROOT)
    expect(result).toBe(`${ROOT}/src/index.ts`)
  })

  it('allows the root itself', () => {
    const result = validateIdePath(ROOT, ROOT)
    expect(result).toBe(ROOT)
  })

  it('rejects path traversal with ..', () => {
    expect(() => validateIdePath(`${ROOT}/../../etc/passwd`, ROOT)).toThrow(
      'Path traversal blocked'
    )
  })

  it('rejects absolute path outside root', () => {
    expect(() => validateIdePath('/etc/passwd', ROOT)).toThrow('Path traversal blocked')
  })

  it('rejects a sibling directory that shares a prefix', () => {
    // e.g. /home/user/projects/myapp-evil should not be allowed under /home/user/projects/myapp
    expect(() => validateIdePath(`${ROOT}-evil/file.ts`, ROOT)).toThrow('Path traversal blocked')
  })
})

describe('readDir', () => {
  beforeEach(() => {
    vi.mocked(stat).mockResolvedValue({ size: 1024 } as Awaited<ReturnType<typeof stat>>)
  })

  it('returns sorted entries with folders first', async () => {
    vi.mocked(readdir).mockResolvedValue([
      { name: 'zebra.ts', isDirectory: () => false, isFile: () => true },
      { name: 'alpha', isDirectory: () => true, isFile: () => false },
      { name: 'beta.ts', isDirectory: () => false, isFile: () => true },
      { name: 'aardvark', isDirectory: () => true, isFile: () => false }
    ] as unknown as Awaited<ReturnType<typeof readdir>>)

    const result = await readDir('/some/dir')

    expect(result[0].name).toBe('aardvark')
    expect(result[0].type).toBe('directory')
    expect(result[1].name).toBe('alpha')
    expect(result[1].type).toBe('directory')
    expect(result[2].name).toBe('beta.ts')
    expect(result[2].type).toBe('file')
    expect(result[3].name).toBe('zebra.ts')
    expect(result[3].type).toBe('file')
  })

  it('includes file sizes', async () => {
    vi.mocked(readdir).mockResolvedValue([
      { name: 'file.ts', isDirectory: () => false, isFile: () => true }
    ] as unknown as Awaited<ReturnType<typeof readdir>>)
    vi.mocked(stat).mockResolvedValue({ size: 4096 } as Awaited<ReturnType<typeof stat>>)

    const result = await readDir('/some/dir')
    expect(result[0].size).toBe(4096)
  })

  it('sets size 0 for directories', async () => {
    vi.mocked(readdir).mockResolvedValue([
      { name: 'subdir', isDirectory: () => true, isFile: () => false }
    ] as unknown as Awaited<ReturnType<typeof readdir>>)

    const result = await readDir('/some/dir')
    expect(result[0].size).toBe(0)
  })
})

describe('readFileContent', () => {
  it('reads a UTF-8 file successfully', async () => {
    vi.mocked(stat).mockResolvedValue({ size: 100 } as Awaited<ReturnType<typeof stat>>)
    const content = 'hello world'
    vi.mocked(readFile).mockResolvedValue(Buffer.from(content, 'utf-8') as never)

    const result = await readFileContent('/some/file.ts')
    expect(result).toBe(content)
  })

  it('rejects files larger than 5 MB', async () => {
    vi.mocked(stat).mockResolvedValue({
      size: 6 * 1024 * 1024
    } as Awaited<ReturnType<typeof stat>>)

    await expect(readFileContent('/some/large.ts')).rejects.toThrow('File too large')
  })

  it('rejects binary files with null bytes', async () => {
    vi.mocked(stat).mockResolvedValue({ size: 10 } as Awaited<ReturnType<typeof stat>>)
    const binaryBuf = Buffer.alloc(10, 0) // all null bytes
    vi.mocked(readFile).mockResolvedValue(binaryBuf as never)

    await expect(readFileContent('/some/binary.bin')).rejects.toThrow('binary')
  })

  it('reads a file without null bytes as text', async () => {
    vi.mocked(stat).mockResolvedValue({ size: 50 } as Awaited<ReturnType<typeof stat>>)
    const text = 'const x = 42;\n'
    vi.mocked(readFile).mockResolvedValue(Buffer.from(text) as never)

    const result = await readFileContent('/some/file.ts')
    expect(result).toBe(text)
  })
})

describe('writeFileContent', () => {
  it('writes content via temp file rename (atomic write)', async () => {
    const mkdir = vi.mocked(await import('fs/promises').then((m) => m.mkdir))
    const writeFileFn = vi.mocked(await import('fs/promises').then((m) => m.writeFile))
    const renameFn = vi.mocked(await import('fs/promises').then((m) => m.rename))

    mkdir.mockResolvedValue(undefined)
    writeFileFn.mockResolvedValue(undefined)
    renameFn.mockResolvedValue(undefined)

    await writeFileContent('/some/dir/file.ts', 'hello')

    expect(mkdir).toHaveBeenCalledWith('/some/dir', { recursive: true })
    expect(writeFileFn).toHaveBeenCalledWith(
      expect.stringMatching(/\/some\/dir\/file\.ts\.bde-tmp-\d+/),
      'hello',
      'utf-8'
    )
    expect(renameFn).toHaveBeenCalledWith(
      expect.stringMatching(/\.bde-tmp-\d+/),
      '/some/dir/file.ts'
    )
  })

  it('cleans up temp file on write failure', async () => {
    const mkdir = vi.mocked(await import('fs/promises').then((m) => m.mkdir))
    const writeFileFn = vi.mocked(await import('fs/promises').then((m) => m.writeFile))
    const rmFn = vi.mocked(await import('fs/promises').then((m) => m.rm))

    mkdir.mockResolvedValue(undefined)
    writeFileFn.mockRejectedValue(new Error('disk full'))
    rmFn.mockResolvedValue(undefined)

    await expect(writeFileContent('/some/dir/file.ts', 'hello')).rejects.toThrow('disk full')
    expect(rmFn).toHaveBeenCalledWith(expect.stringMatching(/\.bde-tmp-\d+/), { force: true })
  })
})
