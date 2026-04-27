import { useCallback, useEffect } from 'react'
import { useCommandPaletteStore } from '../stores/commandPalette'
import { useSprintUI } from '../stores/sprintUI'
import { useKeybindingsStore } from '../stores/keybindings'
import { usePanelLayoutStore, findLeaf } from '../stores/panelLayout'
import { useAgentHistoryStore } from '../stores/agentHistory'
import { openSettings } from '../components/settings/settings-nav'

interface UseAppShortcutsParams {
  paletteOpen: boolean
  shortcutsOpen: boolean
  setShortcutsOpen: (open: boolean | ((prev: boolean) => boolean)) => void
}

/**
 * Global keyboard shortcut handler — view navigation, panel management, palette, and quick create.
 * Extracted from App.tsx to reduce file size and follow SRP.
 */
export function useAppShortcuts({
  paletteOpen,
  shortcutsOpen,
  setShortcutsOpen
}: UseAppShortcutsParams): void {
  const setView = usePanelLayoutStore((s) => s.setView)
  const closePalette = useCommandPaletteStore((s) => s.close)
  const togglePalette = useCommandPaletteStore((s) => s.toggle)
  const toggleQuickCreate = useSprintUI((s) => s.toggleQuickCreate)

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      const tag = target.tagName
      const inInput =
        target.isContentEditable || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'

      if (e.key === 'Escape') {
        e.preventDefault()
        if (paletteOpen) {
          closePalette()
          return
        }
        if (shortcutsOpen) {
          setShortcutsOpen(false)
          return
        }
        if (inInput) {
          ;(document.activeElement as HTMLElement)?.blur()
          return
        }
        window.dispatchEvent(new CustomEvent('bde:escape'))
        return
      }

      if (inInput && !e.metaKey) return

      // Build current key combo for matching against keybindings
      const parts: string[] = []
      if (e.metaKey) parts.push('⌘')
      if (e.ctrlKey && !e.metaKey) parts.push('Ctrl')
      if (e.altKey) parts.push('⌥')
      if (e.shiftKey) parts.push('⇧')
      parts.push(e.key.toUpperCase())
      const combo = parts.join('')

      const bindings = useKeybindingsStore.getState().bindings

      // View navigation shortcuts
      if (combo === bindings['view.dashboard']) {
        e.preventDefault()
        setView('dashboard')
        return
      }
      if (combo === bindings['view.agents']) {
        e.preventDefault()
        setView('agents')
        return
      }
      if (combo === bindings['view.ide']) {
        e.preventDefault()
        setView('ide')
        return
      }
      if (combo === bindings['view.sprint']) {
        e.preventDefault()
        setView('sprint')
        return
      }
      if (combo === bindings['view.codeReview']) {
        e.preventDefault()
        setView('code-review')
        return
      }
      if (combo === bindings['view.git']) {
        e.preventDefault()
        setView('git')
        return
      }
      if (combo === bindings['view.settings']) {
        e.preventDefault()
        setView('settings')
        return
      }
      if (combo === bindings['view.planner']) {
        e.preventDefault()
        setView('planner')
        return
      }

      // Settings shortcut with deep linking
      if (combo === bindings['settings.open']) {
        e.preventDefault()
        openSettings()
        return
      }

      // Panel shortcuts
      if (combo === bindings['panel.splitRight']) {
        e.preventDefault()
        const { focusedPanelId, splitPanel } = usePanelLayoutStore.getState()
        if (focusedPanelId) splitPanel(focusedPanelId, 'horizontal', 'agents')
        return
      }

      if (combo === bindings['panel.closeTab']) {
        e.preventDefault()
        const { focusedPanelId, root } = usePanelLayoutStore.getState()
        if (focusedPanelId) {
          const leaf = findLeaf(root, focusedPanelId)
          if (leaf) usePanelLayoutStore.getState().closeTab(focusedPanelId, leaf.activeTab)
        }
        return
      }

      if (combo === bindings['panel.nextTab'] || combo === bindings['panel.prevTab']) {
        e.preventDefault()
        const { focusedPanelId, root, setActiveTab } = usePanelLayoutStore.getState()
        if (focusedPanelId) {
          const leaf = findLeaf(root, focusedPanelId)
          if (leaf && leaf.tabs.length > 1) {
            const delta = combo === bindings['panel.nextTab'] ? 1 : -1
            const next = (leaf.activeTab + delta + leaf.tabs.length) % leaf.tabs.length
            setActiveTab(focusedPanelId, next)
          }
        }
        return
      }

      // Command palette
      if (combo === bindings['palette.toggle']) {
        e.preventDefault()
        togglePalette()
        return
      }

      // Refresh
      if (combo === bindings['refresh']) {
        e.preventDefault()
        window.dispatchEvent(new CustomEvent('bde:refresh'))
        return
      }

      // Quick create
      if (combo === bindings['quickCreate.toggle']) {
        e.preventDefault()
        toggleQuickCreate()
        return
      }

      // Shortcuts overlay (special case - no modifiers)
      if (e.key === '?' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        setShortcutsOpen((prev) => !prev)
      }
    },
    [
      setView,
      paletteOpen,
      shortcutsOpen,
      closePalette,
      togglePalette,
      toggleQuickCreate,
      setShortcutsOpen
    ]
  )

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  // Listen for custom navigation events
  useEffect(() => {
    const handler = (e: CustomEvent): void => {
      const { view, sessionId } = e.detail
      if (view === 'agents') {
        setView('agents')
        if (sessionId) {
          useAgentHistoryStore.getState().selectAgent(sessionId)
        }
      }
    }
    window.addEventListener('bde:navigate', handler as EventListener)
    return () => window.removeEventListener('bde:navigate', handler as EventListener)
  }, [setView])

  // Listen for shortcuts modal trigger
  useEffect(() => {
    const handler = (): void => {
      setShortcutsOpen(true)
    }
    window.addEventListener('bde:show-shortcuts', handler)
    return () => window.removeEventListener('bde:show-shortcuts', handler)
  }, [setShortcutsOpen])
}
