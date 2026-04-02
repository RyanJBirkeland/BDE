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

function getDisplayName(filePath: string, allTabs: EditorTab[]): string {
  const parts = filePath.split('/')
  const filename = parts[parts.length - 1] || filePath

  // Check if any other tab has the same filename
  const hasDuplicate = allTabs.some(
    (tab) => tab.filePath !== filePath && tab.filePath.split('/').pop() === filename
  )

  // If duplicate exists, include parent directory for disambiguation
  if (hasDuplicate && parts.length >= 2) {
    const parent = parts[parts.length - 2]
    return `${filename} (${parent})`
  }

  return filename
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
  recentFolders: string[]
  fileContents: Record<string, string> // IDE-5: Move from component state to store
  fileLoadingStates: Record<string, boolean> // IDE-9: Track loading state per file

  // Actions
  setRootPath: (path: string) => void
  toggleDir: (dirPath: string) => void
  openTab: (filePath: string) => void
  closeTab: (tabId: string) => void
  setActiveTab: (tabId: string) => void
  setDirty: (tabId: string, isDirty: boolean) => void
  toggleSidebar: () => void
  toggleTerminal: () => void
  setFocusedPanel: (panel: 'editor' | 'terminal') => void
  setFileContent: (filePath: string, content: string) => void // IDE-5
  setFileLoading: (filePath: string, loading: boolean) => void // IDE-9
  clearFileContent: (filePath: string) => void // IDE-5
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
  recentFolders: [],
  fileContents: {}, // IDE-5
  fileLoadingStates: {}, // IDE-9

  setRootPath: (path: string): void => {
    set((s) => {
      const prev = s.recentFolders.filter((f) => f !== path)
      const recentFolders = [path, ...prev].slice(0, 5)
      // IDE-14: Clear stale tabs from old root when changing root
      return {
        rootPath: path,
        expandedDirs: {},
        recentFolders,
        openTabs: [],
        activeTabId: null,
        fileContents: {},
        fileLoadingStates: {}
      }
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
        displayName: getDisplayName(filePath, s.openTabs),
        language: detectLanguage(filePath),
        isDirty: false
      }

      const newTabs = [...s.openTabs, tab]

      // Update display names for all tabs to handle duplicates
      const updatedTabs = newTabs.map((t) => ({
        ...t,
        displayName: getDisplayName(t.filePath, newTabs)
      }))

      return {
        openTabs: updatedTabs,
        activeTabId: tab.id
      }
    })
  },

  closeTab: (tabId: string): void => {
    set((s) => {
      const idx = s.openTabs.findIndex((t) => t.id === tabId)
      if (idx === -1) return s

      // Capture the closed tab's path before filtering
      const closedPath = s.openTabs[idx].filePath

      const newTabs = s.openTabs.filter((t) => t.id !== tabId)

      // Update display names for remaining tabs (handles duplicate resolution)
      const updatedTabs = newTabs.map((t) => ({
        ...t,
        displayName: getDisplayName(t.filePath, newTabs)
      }))

      let newActiveTabId = s.activeTabId
      if (s.activeTabId === tabId) {
        if (updatedTabs.length === 0) {
          newActiveTabId = null
        } else {
          // Activate adjacent tab: prefer the one at same position, else previous
          const nextIdx = Math.min(idx, updatedTabs.length - 1)
          newActiveTabId = updatedTabs[nextIdx].id
        }
      }

      // Evict file content if no other tab references the same file
      const stillOpen = updatedTabs.some((t) => t.filePath === closedPath)
      const newContents = stillOpen
        ? s.fileContents
        : (() => {
            const { [closedPath]: _, ...rest } = s.fileContents
            return rest
          })()
      const newLoading = stillOpen
        ? s.fileLoadingStates
        : (() => {
            const { [closedPath]: _, ...rest } = s.fileLoadingStates
            return rest
          })()

      return {
        openTabs: updatedTabs,
        activeTabId: newActiveTabId,
        fileContents: newContents,
        fileLoadingStates: newLoading
      }
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

  toggleSidebar: (): void => {
    set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed }))
  },

  toggleTerminal: (): void => {
    set((s) => ({ terminalCollapsed: !s.terminalCollapsed }))
  },

  setFocusedPanel: (panel: 'editor' | 'terminal'): void => {
    set({ focusedPanel: panel })
  },

  // IDE-5: File content management actions
  setFileContent: (filePath: string, content: string): void => {
    set((s) => ({
      fileContents: { ...s.fileContents, [filePath]: content }
    }))
  },

  setFileLoading: (filePath: string, loading: boolean): void => {
    set((s) => ({
      fileLoadingStates: { ...s.fileLoadingStates, [filePath]: loading }
    }))
  },

  clearFileContent: (filePath: string): void => {
    set((s) => {
      const { [filePath]: _, ...rest } = s.fileContents
      const { [filePath]: _loading, ...restLoading } = s.fileLoadingStates
      return { fileContents: rest, fileLoadingStates: restLoading }
    })
  }
}))

// ---------------------------------------------------------------------------
// Persistence subscriber (debounced, 2s)
// ---------------------------------------------------------------------------

let persistTimer: ReturnType<typeof setTimeout> | null = null
let lastSerialized = ''
let lastToSave: any = null

function flushPersistence(): void {
  if (persistTimer) {
    clearTimeout(persistTimer)
    persistTimer = null
  }
  if (lastToSave) {
    window.api.settings.setJson('ide.state', lastToSave)
  }
}

// Subscribe only to fields we care about persisting
// We check if the serialized state changed to avoid unnecessary writes
useIDEStore.subscribe((state) => {
  const toSave = {
    rootPath: state.rootPath,
    openTabs: state.openTabs.map((t) => ({ filePath: t.filePath })),
    activeFilePath: state.openTabs.find((t) => t.id === state.activeTabId)?.filePath ?? null,
    sidebarCollapsed: state.sidebarCollapsed,
    terminalCollapsed: state.terminalCollapsed,
    recentFolders: state.recentFolders,
    expandedDirs: state.expandedDirs // IDE-11: Persist expanded directories
  }
  const serialized = JSON.stringify(toSave)
  if (serialized === lastSerialized) return // Skip — nothing changed
  lastSerialized = serialized
  lastToSave = toSave

  if (persistTimer) clearTimeout(persistTimer)
  persistTimer = setTimeout(() => {
    window.api.settings.setJson('ide.state', toSave)
  }, 2000)
})

// Flush pending persistence on window close/reload
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', flushPersistence)
}
