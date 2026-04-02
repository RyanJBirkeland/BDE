import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir, homedir } from 'os'
import { join } from 'path'
import { ipcMain } from 'electron'

// Mock electron before importing the handlers
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

import { registerIdeFsHandlers } from '../../handlers/ide-fs-handlers'

let TEST_DIR_IN_HOME: string
let TEST_FILE_IN_HOME: string
let TEST_DIR_OUTSIDE_HOME: string

describe('IDE fs:watchDir path validation', () => {
  let watchDirHandler: (event: any, dirPath: string) => Promise<void>

  beforeAll(() => {
    // Create a test directory inside the user's home directory
    const homeDir = homedir()
    TEST_DIR_IN_HOME = mkdtempSync(join(homeDir, 'ide-watchdir-test-'))

    // Create a test file (not a directory) inside home
    TEST_FILE_IN_HOME = join(TEST_DIR_IN_HOME, 'test-file.txt')
    writeFileSync(TEST_FILE_IN_HOME, 'test content')

    // Create a test directory outside the user's home directory (in system temp)
    // This will fail on systems where tmpdir() is inside home, but typically it's /tmp
    const systemTmp = tmpdir()
    if (!systemTmp.startsWith(homeDir)) {
      TEST_DIR_OUTSIDE_HOME = mkdtempSync(join(systemTmp, 'ide-watchdir-test-outside-'))
    }

    // Register handlers and capture the watchDir handler
    registerIdeFsHandlers()
    const handleCalls = vi.mocked(ipcMain.handle).mock.calls
    const watchDirCall = handleCalls.find((call) => call[0] === 'fs:watchDir')
    if (watchDirCall) {
      watchDirHandler = watchDirCall[1] as any
    }
  })

  afterAll(() => {
    // Clean up test directories
    try {
      rmSync(TEST_DIR_IN_HOME, { recursive: true, force: true })
    } catch {
      // ignore cleanup errors
    }
    if (TEST_DIR_OUTSIDE_HOME) {
      try {
        rmSync(TEST_DIR_OUTSIDE_HOME, { recursive: true, force: true })
      } catch {
        // ignore cleanup errors
      }
    }
  })

  it('accepts a directory within user home directory', async () => {
    if (!watchDirHandler) {
      throw new Error('watchDir handler not registered')
    }

    // Should not throw
    await expect(watchDirHandler({} as any, TEST_DIR_IN_HOME)).resolves.not.toThrow()
  })

  it('rejects a path outside user home directory', async () => {
    if (!watchDirHandler) {
      throw new Error('watchDir handler not registered')
    }

    if (!TEST_DIR_OUTSIDE_HOME) {
      // Skip test if tmpdir is inside home (some macOS setups)
      return
    }

    await expect(watchDirHandler({} as any, TEST_DIR_OUTSIDE_HOME)).rejects.toThrow(
      /outside user home directory/
    )
  })

  it('rejects system root directory', async () => {
    if (!watchDirHandler) {
      throw new Error('watchDir handler not registered')
    }

    await expect(watchDirHandler({} as any, '/')).rejects.toThrow(/outside user home directory/)
  })

  it('rejects /etc directory', async () => {
    if (!watchDirHandler) {
      throw new Error('watchDir handler not registered')
    }

    await expect(watchDirHandler({} as any, '/etc')).rejects.toThrow(/outside user home directory/)
  })

  it('rejects non-existent path', async () => {
    if (!watchDirHandler) {
      throw new Error('watchDir handler not registered')
    }

    const nonExistent = join(TEST_DIR_IN_HOME, 'does-not-exist')
    await expect(watchDirHandler({} as any, nonExistent)).rejects.toThrow(
      /does not exist or is not accessible/
    )
  })

  it('rejects a file path (not a directory)', async () => {
    if (!watchDirHandler) {
      throw new Error('watchDir handler not registered')
    }

    await expect(watchDirHandler({} as any, TEST_FILE_IN_HOME)).rejects.toThrow(
      /is not a directory/
    )
  })

  it('accepts the user home directory itself', async () => {
    if (!watchDirHandler) {
      throw new Error('watchDir handler not registered')
    }

    const homeDir = homedir()
    // Should not throw
    await expect(watchDirHandler({} as any, homeDir)).resolves.not.toThrow()
  })
})
