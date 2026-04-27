import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir, homedir } from 'os'
import { join } from 'path'
import { ipcMain } from 'electron'

// Mock electron before importing the handlers
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/tmp'),
    getName: vi.fn(() => 'FLEET'),
    getVersion: vi.fn(() => '0.0.0')
  },
  BrowserWindow: { getAllWindows: vi.fn(() => []) },
  ipcMain: { handle: vi.fn(), on: vi.fn() },
  shell: { trashItem: vi.fn() }
}))

import {
  registerIdeFsHandlers,
  rememberApprovedIdeRoot,
  _resetApprovedIdeRoots
} from '../../handlers/ide-fs-handlers'

let TEST_DIR_IN_HOME: string
let TEST_FILE_IN_HOME: string
let TEST_DIR_OUTSIDE_HOME: string

describe('IDE fs:watchDir path validation', () => {
  let watchDirHandler: (event: any, dirPath: string) => Promise<void>

  beforeAll(() => {
    const homeDir = homedir()
    TEST_DIR_IN_HOME = mkdtempSync(join(homeDir, 'ide-watchdir-test-'))
    TEST_FILE_IN_HOME = join(TEST_DIR_IN_HOME, 'test-file.txt')
    writeFileSync(TEST_FILE_IN_HOME, 'test content')

    const systemTmp = tmpdir()
    if (!systemTmp.startsWith(homeDir)) {
      TEST_DIR_OUTSIDE_HOME = mkdtempSync(join(systemTmp, 'ide-watchdir-test-outside-'))
    }

    registerIdeFsHandlers()
    const handleCalls = vi.mocked(ipcMain.handle).mock.calls
    const watchDirCall = handleCalls.find((call) => call[0] === 'fs:watchDir')
    if (watchDirCall) {
      watchDirHandler = watchDirCall[1] as any
    }
  })

  beforeEach(() => {
    _resetApprovedIdeRoots()
  })

  afterAll(() => {
    try {
      rmSync(TEST_DIR_IN_HOME, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
    if (TEST_DIR_OUTSIDE_HOME) {
      try {
        rmSync(TEST_DIR_OUTSIDE_HOME, { recursive: true, force: true })
      } catch {
        /* ignore */
      }
    }
  })

  it('accepts a directory the user approved via the Open Folder dialog', async () => {
    rememberApprovedIdeRoot(TEST_DIR_IN_HOME)
    await expect(watchDirHandler({} as any, TEST_DIR_IN_HOME)).resolves.not.toThrow()
  })

  it('rejects a directory inside home that was never approved', async () => {
    await expect(watchDirHandler({} as any, TEST_DIR_IN_HOME)).rejects.toThrow(
      /configured repo|dialog-approved/
    )
  })

  it('rejects a path outside user home directory', async () => {
    if (!TEST_DIR_OUTSIDE_HOME) return
    await expect(watchDirHandler({} as any, TEST_DIR_OUTSIDE_HOME)).rejects.toThrow(
      /configured repo|dialog-approved/
    )
  })

  it('rejects system root directory', async () => {
    await expect(watchDirHandler({} as any, '/')).rejects.toThrow(/configured repo|dialog-approved/)
  })

  it('rejects /etc directory', async () => {
    await expect(watchDirHandler({} as any, '/etc')).rejects.toThrow(
      /configured repo|dialog-approved/
    )
  })

  it('rejects non-existent approved path at the existence check', async () => {
    const nonExistent = join(TEST_DIR_IN_HOME, 'does-not-exist')
    rememberApprovedIdeRoot(nonExistent)
    await expect(watchDirHandler({} as any, nonExistent)).rejects.toThrow(
      /does not exist or is not accessible/
    )
  })

  it('rejects a file path even if approved', async () => {
    rememberApprovedIdeRoot(TEST_FILE_IN_HOME)
    await expect(watchDirHandler({} as any, TEST_FILE_IN_HOME)).rejects.toThrow(/is not a directory/)
  })

  it('rejects the home directory without an explicit approval', async () => {
    const homeDir = homedir()
    await expect(watchDirHandler({} as any, homeDir)).rejects.toThrow(
      /configured repo|dialog-approved/
    )
  })
})
