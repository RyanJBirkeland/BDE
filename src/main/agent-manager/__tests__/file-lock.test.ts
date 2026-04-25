import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import path from 'node:path'
import os from 'node:os'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'

// Mock node:fs so individual tests can intercept readFileSync and rmSync.
// The factory spreads the real module so all other fs functions work normally.
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    readFileSync: vi.fn(actual.readFileSync),
    rmSync: vi.fn(actual.rmSync),
  }
})

import { readFileSync, rmSync as rmSyncMocked } from 'node:fs'

const readFileSyncMock = vi.mocked(readFileSync)
const rmSyncMock = vi.mocked(rmSyncMocked)

describe('acquireLock — TOCTOU verify-after-rename', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `bde-filelock-test-${Date.now()}`)
    mkdirSync(tmpDir, { recursive: true })
    readFileSyncMock.mockRestore()
  })

  afterEach(() => {
    // Use real rmSync for cleanup — the mock may be overridden in tests
    rmSyncMock.mockRestore()
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('throws LockContestedError when another process wins the rename race', async () => {
    const { acquireLock, LockContestedError } = await import('../file-lock')

    // Seed a dead-PID lock file so the stale-lock path activates
    const locksDir = path.join(tmpDir, '.locks')
    mkdirSync(locksDir, { recursive: true })
    const slug = tmpDir.replace(/[^a-z0-9]/gi, '-').replace(/^-+|-+$/g, '')
    const lockFile = path.join(locksDir, `${slug}.lock`)
    writeFileSync(lockFile, '99999999') // dead PID

    // Intercept the second readFileSync (verify-after-rename) to simulate
    // a rival process overwriting the lock file between our rename and read.
    // The first call reads the stale lock (dead PID); the second is the
    // verify-after-rename that must see a different PID to trigger the error.
    const rivalPid = 12345
    let readCallCount = 0
    const { readFileSync: realRead } = await vi.importActual<typeof import('node:fs')>('node:fs')
    readFileSyncMock.mockImplementation((filePath, ...args) => {
      readCallCount++
      if (readCallCount === 2) {
        // Verify-after-rename call — return rival's PID to simulate losing the race
        return String(rivalPid)
      }
      return realRead(filePath as string, ...(args as [BufferEncoding]))
    })

    expect(() => acquireLock(tmpDir, tmpDir)).toThrow(LockContestedError)
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
    const { readFileSync: realRead } = await vi.importActual<typeof import('node:fs')>('node:fs')
    readFileSyncMock.mockImplementation((filePath, ...args) => {
      readCallCount++
      if (readCallCount === 2) return String(rivalPid)
      return realRead(filePath as string, ...(args as [BufferEncoding]))
    })

    let caught: unknown
    try {
      acquireLock(tmpDir, tmpDir)
    } catch (err) {
      caught = err
    }

    expect(caught).toBeInstanceOf(LockContestedError)
    expect((caught as LockContestedError).name).toBe('LockContestedError')
    expect((caught as LockContestedError).message).toContain(String(rivalPid))
  })

  it('acquires normally when no lock file exists (no race)', async () => {
    const { acquireLock, releaseLock } = await import('../file-lock')

    expect(() => acquireLock(tmpDir, tmpDir)).not.toThrow()
    releaseLock(tmpDir, tmpDir)
  })
})

describe('releaseLock — non-throwing on ENOENT', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `bde-filelock-release-test-${Date.now()}`)
    mkdirSync(tmpDir, { recursive: true })
    rmSyncMock.mockRestore()
  })

  afterEach(() => {
    rmSyncMock.mockRestore()
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('does not throw when the lock file does not exist (ENOENT)', async () => {
    const { releaseLock } = await import('../file-lock')
    const logger = { warn: vi.fn(), info: vi.fn(), error: vi.fn() }

    // Calling release on a path where no lock was ever acquired — ENOENT
    expect(() =>
      releaseLock(tmpDir, '/nonexistent/repo/path', logger as never)
    ).not.toThrow()

    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Failed to remove lock file'))
  })

  it('does not throw on any other rmSync error and logs a warn', async () => {
    const { releaseLock } = await import('../file-lock')
    const logger = { warn: vi.fn(), info: vi.fn(), error: vi.fn() }

    rmSyncMock.mockImplementation(() => {
      throw Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM' })
    })

    expect(() => releaseLock('/fake/base', '/fake/repo', logger as never)).not.toThrow()
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Failed to remove lock file'))
  })
})
