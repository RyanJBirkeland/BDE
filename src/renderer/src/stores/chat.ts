import { create } from 'zustand'

export interface LogLine {
  id: string
  role: 'assistant' | 'user' | 'tool' | 'system'
  content: string
  toolName?: string
  timestamp: number
}

interface ChatStore {
  lines: Record<string, LogLine[]>
  addLine: (sessionKey: string, line: LogLine) => void
  clearSession: (sessionKey: string) => void
  clearAll: () => void
}

export const useChatStore = create<ChatStore>((set, get) => ({
  lines: {},

  addLine: (sessionKey, line): void => {
    const current = get().lines[sessionKey] ?? []
    set({
      lines: {
        ...get().lines,
        [sessionKey]: [...current, line]
      }
    })
  },

  clearSession: (sessionKey): void => {
    const rest = { ...get().lines }
    delete rest[sessionKey]
    set({ lines: rest })
  },

  clearAll: (): void => {
    set({ lines: {} })
  }
}))
