import { create } from 'zustand'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EditorTab {
  id: string
  filePath: string
  displayName: string
  language: string
  isDirty: boolean
}

// ---------------------------------------------------------------------------
// Language detection helper
// ---------------------------------------------------------------------------

const EXTENSION_MAP: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  json: 'json',
  md: 'markdown',
  mdx: 'markdown',
  py: 'python',
  rs: 'rust',
  go: 'go',
  css: 'css',
  scss: 'scss',
  html: 'html',
  xml: 'xml',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'toml',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  c: 'c',
  cpp: 'cpp',
  h: 'c',
  hpp: 'cpp',
  java: 'java',
  rb: 'ruby',
  php: 'php',
  swift: 'swift',
  kt: 'kotlin',
  sql: 'sql',
  graphql: 'graphql',
  gql: 'graphql'
}

function detectLanguage(filePath: string): string {
  const parts = filePath.split('.')
  if (parts.length < 2) return 'plaintext'
  const ext = parts[parts.length - 1].toLowerCase()
  return EXTENSION_MAP[ext] ?? 'plaintext'
}

function getDisplayName(filePath: string): string {
  const parts = filePath.split('/')
  return parts[parts.length - 1] || filePath
}

// ---------------------------------------------------------------------------
// Store interface
// ---------------------------------------------------------------------------

interface IDEState {
  rootPath: string | null
  expandedDirs: Record<string, boolean>
  openTabs: EditorTab[]
  activeTabId: string | null
  focusedPanel: 'editor' | 'terminal'
  sidebarCollapsed: boolean
  terminalCollapsed: boolean
  sidebarWidth: number
  terminalHeight: number
  recentFolders: string[]

  // Actions
  setRootPath: (path: string) => void
  toggleDir: (dirPath: string) => void
  openTab: (filePath: string) => void
  closeTab: (tabId: string) => void
  setActiveTab: (tabId: string) => void
  setDirty: (tabId: string, isDirty: boolean) => void
  reorderTabs: (tabs: EditorTab[]) => void
  toggleSidebar: () => void
  toggleTerminal: () => void
  setFocusedPanel: (panel: 'editor' | 'terminal') => void
  setSidebarWidth: (width: number) => void
  setTerminalHeight: (height: number) => void
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useIDEStore = create<IDEState>((set) => ({
  rootPath: null,
  expandedDirs: {},
  openTabs: [],
  activeTabId: null,
  focusedPanel: 'editor',
  sidebarCollapsed: false,
  terminalCollapsed: false,
  sidebarWidth: 240,
  terminalHeight: 200,
  recentFolders: [],

  setRootPath: (path: string): void => {
    set((s) => {
      const prev = s.recentFolders.filter((f) => f !== path)
      const recentFolders = [path, ...prev].slice(0, 5)
      return { rootPath: path, expandedDirs: {}, recentFolders }
    })
  },

  toggleDir: (dirPath: string): void => {
    set((s) => ({
      expandedDirs: {
        ...s.expandedDirs,
        [dirPath]: !s.expandedDirs[dirPath]
      }
    }))
  },

  openTab: (filePath: string): void => {
    set((s) => {
      // If already open, just switch to it
      const existing = s.openTabs.find((t) => t.filePath === filePath)
      if (existing) {
        return { activeTabId: existing.id }
      }

      const tab: EditorTab = {
        id: crypto.randomUUID(),
        filePath,
        displayName: getDisplayName(filePath),
        language: detectLanguage(filePath),
        isDirty: false
      }
      return {
        openTabs: [...s.openTabs, tab],
        activeTabId: tab.id
      }
    })
  },

  closeTab: (tabId: string): void => {
    set((s) => {
      const idx = s.openTabs.findIndex((t) => t.id === tabId)
      if (idx === -1) return s

      const newTabs = s.openTabs.filter((t) => t.id !== tabId)

      let newActiveTabId = s.activeTabId
      if (s.activeTabId === tabId) {
        if (newTabs.length === 0) {
          newActiveTabId = null
        } else {
          // Activate adjacent tab: prefer the one at same position, else previous
          const nextIdx = Math.min(idx, newTabs.length - 1)
          newActiveTabId = newTabs[nextIdx].id
        }
      }

      return { openTabs: newTabs, activeTabId: newActiveTabId }
    })
  },

  setActiveTab: (tabId: string): void => {
    set({ activeTabId: tabId })
  },

  setDirty: (tabId: string, isDirty: boolean): void => {
    set((s) => ({
      openTabs: s.openTabs.map((t) => (t.id === tabId ? { ...t, isDirty } : t))
    }))
  },

  reorderTabs: (tabs: EditorTab[]): void => {
    set({ openTabs: tabs })
  },

  toggleSidebar: (): void => {
    set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed }))
  },

  toggleTerminal: (): void => {
    set((s) => ({ terminalCollapsed: !s.terminalCollapsed }))
  },

  setFocusedPanel: (panel: 'editor' | 'terminal'): void => {
    set({ focusedPanel: panel })
  },

  setSidebarWidth: (width: number): void => {
    set({ sidebarWidth: width })
  },

  setTerminalHeight: (height: number): void => {
    set({ terminalHeight: height })
  }
}))

// ---------------------------------------------------------------------------
// Persistence subscriber (debounced, 2s)
// ---------------------------------------------------------------------------

let persistTimer: ReturnType<typeof setTimeout> | null = null

useIDEStore.subscribe((state) => {
  if (persistTimer) clearTimeout(persistTimer)
  persistTimer = setTimeout(() => {
    const toSave = {
      rootPath: state.rootPath,
      openTabs: state.openTabs.map((t) => ({ filePath: t.filePath })),
      activeFilePath: state.openTabs.find((t) => t.id === state.activeTabId)?.filePath ?? null,
      sidebarCollapsed: state.sidebarCollapsed,
      terminalCollapsed: state.terminalCollapsed,
      recentFolders: state.recentFolders
    }
    window.api.settings.setJson('ide.state', toSave)
  }, 2000)
})
