import { create } from 'zustand'

export type CommandCategory =
  | 'navigation'
  | 'task'
  | 'review'
  | 'filter'
  | 'settings'
  | 'action'
  | 'panel'
  | 'help'
  | 'session'

export interface Command {
  id: string
  label: string
  category: CommandCategory
  hint?: string | undefined
  action: () => void
  keywords?: string[] // Additional search terms | undefined
}

interface CommandPaletteStore {
  isOpen: boolean
  commands: Command[]
  recentCommandIds: string[]

  open: () => void
  close: () => void
  toggle: () => void
  registerCommands: (commands: Command[]) => void
  unregisterCommands: (commandIds: string[]) => void
  fuzzySearch: (query: string, commands: Command[]) => Command[]
  trackCommandUsage: (commandId: string) => void
}

const RECENT_COMMANDS_KEY = 'bde:command-palette:recent'
const MAX_RECENT = 10

// Fuzzy search with scoring
function fuzzyMatchScore(query: string, text: string, keywords: string[] = []): number {
  const q = query.toLowerCase()
  const t = text.toLowerCase()
  const allText = [t, ...keywords.map((k) => k.toLowerCase())].join(' ')

  // Exact match gets highest score
  if (allText.includes(q)) return 100

  // Fuzzy match with position scoring
  let qi = 0
  let lastMatchPos = -1
  let score = 0

  for (let ti = 0; ti < allText.length && qi < q.length; ti++) {
    if (allText[ti] === q[qi]) {
      // Consecutive matches get bonus
      if (lastMatchPos === ti - 1) score += 5
      score += 10
      lastMatchPos = ti
      qi++
    }
  }

  return qi === q.length ? score : 0
}

function loadRecentCommands(): string[] {
  try {
    const stored = localStorage.getItem(RECENT_COMMANDS_KEY)
    return stored ? JSON.parse(stored) : []
  } catch (err) {
    console.error('Failed to load recent commands:', err)
    return []
  }
}

function saveRecentCommands(commandIds: string[]): void {
  try {
    localStorage.setItem(RECENT_COMMANDS_KEY, JSON.stringify(commandIds.slice(0, MAX_RECENT)))
  } catch (err) {
    console.error('Failed to save recent commands:', err)
  }
}

export const useCommandPaletteStore = create<CommandPaletteStore>((set, get) => ({
  isOpen: false,
  commands: [],
  recentCommandIds: loadRecentCommands(),

  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
  toggle: () => set((state) => ({ isOpen: !state.isOpen })),

  registerCommands: (newCommands) =>
    set((state) => {
      // Filter out duplicates by ID
      const existingIds = new Set(state.commands.map((c) => c.id))
      const toAdd = newCommands.filter((c) => !existingIds.has(c.id))
      return { commands: [...state.commands, ...toAdd] }
    }),

  unregisterCommands: (commandIds) =>
    set((state) => {
      const idsToRemove = new Set(commandIds)
      return { commands: state.commands.filter((c) => !idsToRemove.has(c.id)) }
    }),

  fuzzySearch: (query, commands) => {
    if (!query.trim()) return commands

    const scored = commands
      .map((cmd) => ({
        cmd,
        score: fuzzyMatchScore(query, cmd.label, cmd.keywords)
      }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)

    return scored.map(({ cmd }) => cmd)
  },

  trackCommandUsage: (commandId) => {
    const { recentCommandIds } = get()
    const updated = [commandId, ...recentCommandIds.filter((id) => id !== commandId)].slice(
      0,
      MAX_RECENT
    )
    set({ recentCommandIds: updated })
    saveRecentCommands(updated)
  }
}))
