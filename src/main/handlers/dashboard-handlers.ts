import { safeHandle } from '../ipc-utils'
import { getDailySuccessRate } from '../services/sprint-service'
import { getLoadSnapshot } from '../services/load-sampler'
import { getCompletionsPerHour, getRecentEvents } from '../data/dashboard-queries'

export function registerDashboardHandlers(): void {
  safeHandle('dashboard:completionsPerHour', async () => {
    return getCompletionsPerHour()
  })

  safeHandle('dashboard:recentEvents', async (_e: unknown, limit?: number) => {
    return getRecentEvents(limit)
  })

  safeHandle('dashboard:dailySuccessRate', async (_e: unknown, days?: number) => {
    return getDailySuccessRate(days)
  })

  safeHandle('system:loadAverage', async () => {
    return getLoadSnapshot()
  })

  safeHandle('clipboard:readImage', async () => {
    const { clipboard } = await import('electron')
    const img = clipboard.readImage()
    if (img.isEmpty()) return null
    const png = img.toPNG()
    return { data: png.toString('base64'), mimeType: 'image/png' as const }
  })
}
