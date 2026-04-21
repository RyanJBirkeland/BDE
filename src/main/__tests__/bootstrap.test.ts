import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  buildConnectSrc,
  initializeDatabase,
  startBackgroundServices,
  setupCleanupTasks,
  warnPlaintextSensitiveSettings,
  emitStartupWarnings
} from '../bootstrap'

const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn()
}))
import * as db from '../db'
import * as settingsQueries from '../data/settings-queries'
import * as secureStorage from '../secure-storage'
import * as eventQueries from '../data/event-queries'
import * as taskChanges from '../data/task-changes'
import * as sprintMaintenanceFacade from '../data/sprint-maintenance-facade'
import * as pluginLoader from '../services/plugin-loader'
import * as loadSampler from '../services/load-sampler'
import * as broadcastModule from '../broadcast'

vi.mock('fs', async () => {
  const actual = await vi.importActual('fs')
  return {
    ...actual,
    watch: vi.fn(() => ({
      close: vi.fn()
    }))
  }
})

vi.mock('electron', () => ({
  app: {
    on: vi.fn()
  },
  BrowserWindow: {
    getAllWindows: vi.fn(() => [mockWindow])
  },
  session: {
    defaultSession: {
      webRequest: {
        onHeadersReceived: vi.fn()
      }
    }
  }
}))

vi.mock('@electron-toolkit/utils', () => ({
  is: { dev: false }
}))

vi.mock('../db')
vi.mock('../pr-poller', () => ({
  startPrPoller: vi.fn(),
  stopPrPoller: vi.fn()
}))
vi.mock('../sprint-pr-poller', () => ({
  startSprintPrPoller: vi.fn(),
  stopSprintPrPoller: vi.fn()
}))
vi.mock('../data/event-queries')
vi.mock('../data/task-changes')
vi.mock('../config', () => ({
  getEventRetentionDays: vi.fn(() => 30)
}))
vi.mock('../logger', () => ({
  createLogger: () => mockLogger
}))
vi.mock('../data/sprint-queries')
vi.mock('../data/sprint-maintenance-facade')
vi.mock('../broadcast', () => ({
  broadcast: vi.fn()
}))
vi.mock('../services/plugin-loader')
vi.mock('../services/load-sampler')
vi.mock('../data/settings-queries', () => ({
  getSetting: vi.fn(() => null),
  setSetting: vi.fn(),
  deleteSetting: vi.fn(),
  getSettingJson: vi.fn(() => null),
  setSettingJson: vi.fn()
}))
vi.mock('../secure-storage', () => ({
  ENCRYPTED_PREFIX: 'ENC:',
  SENSITIVE_SETTING_KEYS: new Set(['github.token']),
  encryptSetting: vi.fn((v: string) => 'ENC:' + v),
  decryptSetting: vi.fn((v: string) => v),
  isEncryptionAvailable: vi.fn(() => true)
}))

const mockWindow = {
  webContents: {
    send: vi.fn()
  }
}

const mockDb = {
  prepare: vi.fn(() => ({
    run: vi.fn(() => ({ changes: 2 }))
  }))
}

describe('bootstrap', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()

    vi.mocked(db.getDb).mockReturnValue(mockDb as never)
    vi.mocked(db.backupDatabase).mockImplementation(() => {})
    vi.mocked(eventQueries.pruneOldEvents).mockImplementation(() => {})
    vi.mocked(taskChanges.pruneOldChanges).mockReturnValue(5)
    vi.mocked(sprintMaintenanceFacade.pruneOldDiffSnapshots).mockReturnValue(3)
    vi.mocked(pluginLoader.loadPlugins).mockImplementation(() => {})
    vi.mocked(loadSampler.startLoadSampler).mockImplementation(() => {})
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('buildConnectSrc', () => {
    it('should return GitHub API URL', () => {
      const result = buildConnectSrc()
      expect(result).toBe('https://api.github.com')
    })
  })

  describe('initializeDatabase', () => {
    it('should initialize DB and run backup', () => {
      initializeDatabase()

      expect(db.getDb).toHaveBeenCalled()
      expect(db.backupDatabase).toHaveBeenCalled()
    })

    it('should schedule periodic backups', () => {
      initializeDatabase()

      vi.advanceTimersByTime(24 * 60 * 60 * 1000)

      expect(db.backupDatabase).toHaveBeenCalledTimes(2)
    })
  })

  describe('startBackgroundServices', () => {
    it('should load plugins and start load sampler', () => {
      startBackgroundServices()

      expect(pluginLoader.loadPlugins).toHaveBeenCalled()
      expect(loadSampler.startLoadSampler).toHaveBeenCalled()
    })
  })

  describe('warnPlaintextSensitiveSettings', () => {
    it('should not warn when all sensitive settings return null', () => {
      vi.mocked(settingsQueries.getSetting).mockReturnValue(null)

      warnPlaintextSensitiveSettings()

      expect(mockLogger.warn).not.toHaveBeenCalled()
    })

    it('should re-encrypt a plaintext sensitive setting at startup', () => {
      vi.mocked(settingsQueries.getSetting).mockImplementation((_db, key) => {
        if (key === 'github.token') return 'ghp_plaintext'
        return null
      })

      warnPlaintextSensitiveSettings()

      expect(settingsQueries.setSetting).toHaveBeenCalledWith(
        mockDb,
        'github.token',
        'ENC:ghp_plaintext'
      )
      expect(mockLogger.warn).not.toHaveBeenCalled()
    })

    it('should warn when re-encryption fails', () => {
      vi.mocked(settingsQueries.getSetting).mockImplementation((_db, key) => {
        if (key === 'github.token') return 'ghp_plaintext'
        return null
      })
      vi.mocked(settingsQueries.setSetting).mockImplementation(() => {
        throw new Error('disk full')
      })

      warnPlaintextSensitiveSettings()

      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('github.token'))
    })

    it('should skip re-encryption when safeStorage is unavailable', () => {
      vi.mocked(secureStorage.isEncryptionAvailable).mockReturnValueOnce(false)
      vi.mocked(settingsQueries.getSetting).mockReturnValue('ghp_plaintext')

      warnPlaintextSensitiveSettings()

      expect(settingsQueries.setSetting).not.toHaveBeenCalled()
      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('unavailable'))
    })
  })

  describe('setupCleanupTasks', () => {
    it('should prune old events on startup', () => {
      setupCleanupTasks()

      expect(eventQueries.pruneOldEvents).toHaveBeenCalledWith(mockDb, 30)
    })

    it('should prune old task changes on startup', () => {
      setupCleanupTasks()

      expect(taskChanges.pruneOldChanges).toHaveBeenCalledWith(30)
    })

    it('should prune old diff snapshots on startup', () => {
      setupCleanupTasks()

      expect(sprintMaintenanceFacade.pruneOldDiffSnapshots).toHaveBeenCalledWith(30)
    })

    it('should clean test task artifacts', () => {
      vi.mocked(sprintMaintenanceFacade.cleanTestArtifacts).mockReturnValue(2)

      setupCleanupTasks()

      expect(sprintMaintenanceFacade.cleanTestArtifacts).toHaveBeenCalled()
    })

    it('should schedule periodic cleanup tasks', () => {
      setupCleanupTasks()

      vi.mocked(eventQueries.pruneOldEvents).mockClear()
      vi.mocked(taskChanges.pruneOldChanges).mockClear()
      vi.mocked(sprintMaintenanceFacade.pruneOldDiffSnapshots).mockClear()

      vi.advanceTimersByTime(24 * 60 * 60 * 1000)

      expect(eventQueries.pruneOldEvents).toHaveBeenCalled()
      expect(taskChanges.pruneOldChanges).toHaveBeenCalled()
      expect(sprintMaintenanceFacade.pruneOldDiffSnapshots).toHaveBeenCalled()
    })

    it('should handle cleanup errors gracefully', () => {
      vi.mocked(taskChanges.pruneOldChanges).mockImplementation(() => {
        throw new Error('Cleanup failed')
      })

      expect(() => setupCleanupTasks()).not.toThrow()
    })
  })

  describe('emitStartupWarnings', () => {
    it('should not broadcast when there are no startup errors', () => {
      emitStartupWarnings()

      expect(broadcastModule.broadcast).not.toHaveBeenCalled()
    })
  })
})
