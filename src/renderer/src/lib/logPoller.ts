export interface LogPollerState {
  logContent: string
  logNextByte: number
}

export function createLogPollerActions(
  get: () => LogPollerState,
  set: (s: Partial<LogPollerState>) => void
): {
  startLogPolling: (readFn: (fromByte: number) => Promise<{ content: string; nextByte: number }>) => void
  stopLogPolling: () => void
} {
  let logInterval: ReturnType<typeof setInterval> | null = null

  return {
    startLogPolling: (readFn): void => {
      if (logInterval) clearInterval(logInterval)

      const poll = async (): Promise<void> => {
        try {
          const result = await readFn(get().logNextByte)
          if (result.content) {
            set({
              logContent: get().logContent + result.content,
              logNextByte: result.nextByte
            })
          }
        } catch {
          // Log may not exist yet
        }
      }

      poll()
      logInterval = setInterval(poll, 1000)
    },

    stopLogPolling: (): void => {
      if (logInterval) {
        clearInterval(logInterval)
        logInterval = null
      }
    }
  }
}
