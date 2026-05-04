import { autoUpdater } from 'electron-updater'
import type { Logger } from '../logger'
import { broadcast } from '../broadcast'

const CHECK_DELAY_MS = 30_000

export class UpdaterService {
  private latestVersion: string | null = null

  constructor(private readonly logger: Logger) {
    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = false
    autoUpdater.logger = null // suppress electron-updater's default logging

    autoUpdater.on('checking-for-update', () => {
      broadcast('updates:status', { status: 'checking' })
    })

    autoUpdater.on('update-available', (info) => {
      this.latestVersion = info.version
      broadcast('updates:status', { status: 'available', version: info.version })
    })

    autoUpdater.on('download-progress', (p) => {
      broadcast('updates:status', {
        status: 'downloading',
        percent: p.percent,
        version: this.latestVersion ?? undefined
      })
    })

    autoUpdater.on('update-downloaded', (info) => {
      broadcast('updates:status', { status: 'ready', version: info.version })
    })

    autoUpdater.on('update-not-available', () => {
      broadcast('updates:status', { status: 'up-to-date' })
    })

    autoUpdater.on('error', (err: Error, message?: string) => {
      const detail = message ?? err.message
      this.logger.error(`[updater] ${detail}`)
      broadcast('updates:status', { status: 'error', error: detail })
    })
  }

  checkForUpdates(): void {
    autoUpdater.checkForUpdates().catch((err: Error) => {
      this.logger.error(`[updater] checkForUpdates failed: ${err.message}`)
    })
  }

  quitAndInstall(): void {
    autoUpdater.quitAndInstall()
  }

  /** Schedules a silent background check 30s after app launch. */
  scheduleInitialCheck(): void {
    setTimeout(() => this.checkForUpdates(), CHECK_DELAY_MS)
  }
}
