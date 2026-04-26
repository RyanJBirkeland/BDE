import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import path from 'node:path'
import os from 'node:os'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'

// Spread the real module so all ops work normally;
// individual tests override readFile/rm to simulate races.
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    readFile: vi.fn().mockImplementation(actual.readFile),
    rm: vi.fn().mockImplementation(actual.rm)
  }
})

import * as fsPromises from 'node:fs/promises'

describe('acquireLock — TOCTOU verify-after-rename', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = path.join(os.tmpdir(), `bde-filelock-test-${Date.now()}`)
    mkdirSync(tmpDir, { recursive: true })
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
    vi.mocked(fsPromises.readFile).mockImplementation(actual.readFile)
    vi.mocked(fsPromises.rm).mockImplementation(actual.rm)
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('throws LockContestedError when another process wins the rename race', async () => {
    const { acquireLock, LockContestedError } = await import('../file-lock')

    const locksDir = path.join(tmpDir, '.locks')
    mkdirSync(locksDir, { recursive: true })
    const slug = tmpDir.replace(/[^a-z0-9]/gi, '-').replace(/^-+|-+$/g, '')
    const lockFile = path.join(locksDir, `${slug}.lock`)
    writeFileSync(lockFile, '99999999') // dead PID

    const rivalPid = 12345
    let readCallCount = 0
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
    vi.mocked(fsPromises.readFile).mockImplementation(async (filePath, ...args) => {
      readCallCount++
      if (readCallCount === 2) return String(rivalPid) as never
      return actual.readFile(filePath as string, ...(args as [never]))
    })

    await expect(acquireLock(tmpDir, tmpDir)).rejects.toBeInstanceOf(LockContestedError)
  })

  it('throws LockContestedError with correct name and message', async () => {
    const { acquireLock, LockContestedError } = await import('../file-lock')

    const locksDir = path.join(tmpDir, '.locks')
    mkdirSync(locksDir, { recursive: true })
    const slug = tmpDir.replace(/[^a-z0-9]/gi, '-').replace(/^-+|-+$/g, '')
    const lockFile = path.join(locksDir, `${slug}.lock`)
    writeFileSync(lockFile, '99999999') // dead PID

    const rivalPid = 99887
    let readCallCount = 0
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
    vi.mocked(fsPromises.readFile).mockImplementation(async (filePath, ...args) => {
      readCallCount++
      if (readCallCount === 2) return String(rivalPid) as never
      return actual.readFile(filePath as string, ...(args as [never]))
    })

    let caught: unknown
    try {
      await acquireLock(tmpDir, tmpDir)
    } catch (err) {
      caught = err
    }

    expect(caught).toBeInstanceOf(LockContestedError)
    expect((caught as LockContestedError).name).toBe('LockContestedError')
    expect((caught as LockContestedError).message).toContain(String(rivalPid))
  })

  it('acquires normally when no lock file exists (no race)', async () => {
    const { acquireLock, releaseLock } = await import('../file-lock')
    await expect(acquireLock(tmpDir, tmpDir)).resolves.toBeUndefined()
    releaseLock(tmpDir, tmpDir)
  })
})

describe('releaseLock — non-throwing on ENOENT', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = path.join(os.tmpdir(), `bde-filelock-release-test-${Date.now()}`)
    mkdirSync(tmpDir, { recursive: true })
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
    vi.mocked(fsPromises.rm).mockImplementation(actual.rm)
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('does not throw when the lock file does not exist (ENOENT)', async () => {
    const { releaseLock } = await import('../file-lock')
    const logger = { warn: vi.fn(), info: vi.fn(), error: vi.fn() }

    // Simulate ENOENT — rm on a missing lock file
    vi.mocked(fsPromises.rm).mockRejectedValueOnce(
      Object.assign(new Error('ENOENT: no such file or directory'), { code: 'ENOENT' })
    )

    releaseLock(tmpDir, '/nonexistent/repo/path', logger as never)
    await new Promise<void>((resolve) => setImmediate(resolve))

    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Failed to remove lock file'))
  })

  it('does not throw on rm error and logs a warn', async () => {
    const { releaseLock } = await import('../file-lock')
    const logger = { warn: vi.fn(), info: vi.fn(), error: vi.fn() }

    vi.mocked(fsPromises.rm).mockRejectedValue(
      Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM' })
    )

    releaseLock('/fake/base', '/fake/repo', logger as never)
    await new Promise<void>((resolve) => setImmediate(resolve))

    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Failed to remove lock file'))
  })
})
