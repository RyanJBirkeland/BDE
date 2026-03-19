import { MAX_LOG_LINES } from './constants'

export interface LogPollerState {
  logContent: string
  logNextByte: number
  logTrimmedLines: number
}

export function createLogPollerActions(
  get: () => LogPollerState,
  set: (s: Partial<LogPollerState>) => void
): {
  startLogPolling: (readFn: (fromByte: number) => Promise<{ content: string; nextByte: number }>) => () => void
  stopLogPolling: () => void
} {
  let logInterval: ReturnType<typeof setInterval> | null = null

  const stop = (): void => {
    if (logInterval) {
      clearInterval(logInterval)
      logInterval = null
    }
  }

  return {
    startLogPolling: (readFn): (() => void) => {
      stop()

      const poll = async (): Promise<void> => {
        try {
          const result = await readFn(get().logNextByte)
          if (result.content) {
            let updated = get().logContent + result.content
            let trimmedLines = get().logTrimmedLines

            const lines = updated.split('\n')
            if (lines.length > MAX_LOG_LINES) {
              const excess = lines.length - MAX_LOG_LINES
              trimmedLines += excess
              updated = lines.slice(excess).join('\n')
            }

            set({
              logContent: updated,
              logNextByte: result.nextByte,
              logTrimmedLines: trimmedLines
            })
          }
        } catch {
          // Log may not exist yet
        }
      }

      poll()
      logInterval = setInterval(() => {
        if (!document.hidden) poll()
      }, 1000)
      return stop
    },

    stopLogPolling: stop
  }
}
