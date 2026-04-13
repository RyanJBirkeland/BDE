import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  buildConnectSrc,
  initializeDatabase,
  startBackgroundServices,
  setupCleanupTasks
} from '../bootstrap'
import * as db from '../db'
import * as eventQueries from '../data/event-queries'
import * as taskChanges from '../data/task-changes'
import * as sprintQueries from '../data/sprint-queries'
import * as pluginLoader from '../services/plugin-loader'
import * as loadSampler from '../services/load-sampler'

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
vi.mock('../data/supabase-import', () => ({
  importSprintTasksFromSupabase: vi.fn(() => Promise.resolve())
}))
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
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  })
}))
vi.mock('../data/sprint-queries')
vi.mock('../services/plugin-loader')
vi.mock('../services/load-sampler')

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
    vi.mocked(sprintQueries.pruneOldDiffSnapshots).mockReturnValue(3)
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

      expect(sprintQueries.pruneOldDiffSnapshots).toHaveBeenCalledWith(30)
    })

    it('should clean test task artifacts', () => {
      setupCleanupTasks()

      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining("DELETE FROM sprint_tasks WHERE title LIKE 'Test task%'")
      )
    })

    it('should schedule periodic cleanup tasks', () => {
      setupCleanupTasks()

      vi.mocked(eventQueries.pruneOldEvents).mockClear()
      vi.mocked(taskChanges.pruneOldChanges).mockClear()
      vi.mocked(sprintQueries.pruneOldDiffSnapshots).mockClear()

      vi.advanceTimersByTime(24 * 60 * 60 * 1000)

      expect(eventQueries.pruneOldEvents).toHaveBeenCalled()
      expect(taskChanges.pruneOldChanges).toHaveBeenCalled()
      expect(sprintQueries.pruneOldDiffSnapshots).toHaveBeenCalled()
    })

    it('should handle cleanup errors gracefully', () => {
      vi.mocked(taskChanges.pruneOldChanges).mockImplementation(() => {
        throw new Error('Cleanup failed')
      })

      expect(() => setupCleanupTasks()).not.toThrow()
    })
  })
})
