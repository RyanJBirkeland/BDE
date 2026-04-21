import { create } from 'zustand'
import { createDebouncedPersister } from '../lib/createDebouncedPersister'
import { useIDEFileCache } from './ideFileCache'
import { setJsonSetting } from '../services/settings-storage'

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
  const ext = parts[parts.length - 1]?.toLowerCase() ?? ''
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
  minimapEnabled: boolean
  wordWrapEnabled: boolean
  fontSize: number

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
  /** @deprecated Use useIDEFileCache instead */
  setFileContent: (filePath: string, content: string) => void
  /** @deprecated Use useIDEFileCache instead */
  setFileLoading: (filePath: string, loading: boolean) => void
  /** @deprecated Use useIDEFileCache instead */
  clearFileContent: (filePath: string) => void
  toggleMinimap: () => void
  toggleWordWrap: () => void
  increaseFontSize: () => void
  decreaseFontSize: () => void
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
  minimapEnabled: true,
  wordWrapEnabled: false,
  fontSize: 13,

  setRootPath: (path: string): void => {
    set((s) => {
      const prev = s.recentFolders.filter((f) => f !== path)
      const recentFolders = [path, ...prev].slice(0, 5)
      // IDE-14: Clear stale tabs from old root when changing root
      useIDEFileCache.getState().clearAll()
      return {
        rootPath: path,
        expandedDirs: {},
        recentFolders,
        openTabs: [],
        activeTabId: null
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
      const closedTab = s.openTabs[idx]
      if (!closedTab) return s
      const closedPath = closedTab.filePath

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
          newActiveTabId = updatedTabs[nextIdx]?.id ?? null
        }
      }

      // Evict file content if no other tab references the same file
      const stillOpen = updatedTabs.some((t) => t.filePath === closedPath)
      if (!stillOpen) {
        useIDEFileCache.getState().clearFileContent(closedPath)
      }

      return {
        openTabs: updatedTabs,
        activeTabId: newActiveTabId
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

  // File content management — delegates to ideFileCache store
  setFileContent: (filePath: string, content: string): void => {
    useIDEFileCache.getState().setFileContent(filePath, content)
  },

  setFileLoading: (filePath: string, loading: boolean): void => {
    useIDEFileCache.getState().setFileLoading(filePath, loading)
  },

  clearFileContent: (filePath: string): void => {
    useIDEFileCache.getState().clearFileContent(filePath)
  },

  toggleMinimap: (): void => {
    set((s) => ({ minimapEnabled: !s.minimapEnabled }))
  },

  toggleWordWrap: (): void => {
    set((s) => ({ wordWrapEnabled: !s.wordWrapEnabled }))
  },

  increaseFontSize: (): void => {
    set((s) => ({ fontSize: Math.min(24, s.fontSize + 1) }))
  },

  decreaseFontSize: (): void => {
    set((s) => ({ fontSize: Math.max(10, s.fontSize - 1) }))
  }
}))

// ---------------------------------------------------------------------------
// Persistence subscriber (debounced, 2s)
// ---------------------------------------------------------------------------

let lastSerialized = ''
let lastToSave: unknown = null

const [persistIDEState, cancelIDEPersist] = createDebouncedPersister<unknown>((state) => {
  setJsonSetting('ide.state', state)
}, 2000)

function flushPersistence(): void {
  cancelIDEPersist()
  if (lastToSave) {
    setJsonSetting('ide.state', lastToSave)
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
    expandedDirs: state.expandedDirs, // IDE-11: Persist expanded directories
    minimapEnabled: state.minimapEnabled,
    wordWrapEnabled: state.wordWrapEnabled,
    fontSize: state.fontSize
  }
  const serialized = JSON.stringify(toSave)
  if (serialized === lastSerialized) return // Skip — nothing changed
  lastSerialized = serialized
  lastToSave = toSave
  persistIDEState(toSave)
})

// Flush pending persistence on window close/reload
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', flushPersistence)
}
