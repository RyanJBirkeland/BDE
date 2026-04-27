/**
 * Keyboard shortcuts data for the shortcuts overlay.
 * Organized by category: Global, IDE, Code Review.
 *
 * View-navigation shortcuts are derived from VIEW_REGISTRY so this file
 * never drifts out of sync when views are added, removed, or re-ordered.
 */
import { VIEW_REGISTRY } from './view-registry'

export interface Shortcut {
  keys: string
  description: string
}

export interface ShortcutCategory {
  name: string
  shortcuts: Shortcut[]
}

const viewShortcuts: Shortcut[] = Object.values(VIEW_REGISTRY)
  .filter((meta) => !meta.hidden && meta.shortcut)
  .map((meta) => ({ keys: meta.shortcut, description: `Go to ${meta.label}` }))

export const GLOBAL_SHORTCUTS: Shortcut[] = [
  ...viewShortcuts,
  { keys: '⌘P', description: 'Command palette' },
  { keys: '⌘R', description: 'Refresh current view' },
  { keys: 'Escape', description: 'Close panel / blur input' },
  { keys: '?', description: 'Show shortcuts' },
  { keys: '↑ / ↓', description: 'Navigate list items' },
  { keys: 'Enter', description: 'Select / open item' },
  { keys: 'PageUp / Down', description: 'Scroll chat thread' },
  { keys: 'End', description: 'Jump to latest message' }
]

export const IDE_SHORTCUTS: Shortcut[] = [
  { keys: '⌘B', description: 'Toggle sidebar' },
  { keys: '⌘J', description: 'Toggle terminal' },
  { keys: '⌘O', description: 'Open folder' },
  { keys: '⌘S', description: 'Save file' },
  { keys: '⌘W', description: 'Close tab' },
  { keys: '⌘T', description: 'New terminal tab' },
  { keys: '⌘F', description: 'Find in terminal' },
  { keys: '⌘⇧D', description: 'Split terminal' },
  { keys: '⌘⇧[ / ]', description: 'Prev/next terminal tab' },
  { keys: '⌘+/-/0', description: 'Terminal zoom' },
  { keys: '⌃L', description: 'Clear terminal' },
  { keys: '⌘/', description: 'Show IDE shortcuts' }
]

export const CODE_REVIEW_SHORTCUTS: Shortcut[] = [
  { keys: 'j / k', description: 'Next / prev task' },
  { keys: '[ / ]', description: 'Prev / next diff file' }
]

export const SHORTCUT_CATEGORIES: ShortcutCategory[] = [
  { name: 'Global', shortcuts: GLOBAL_SHORTCUTS },
  { name: 'IDE', shortcuts: IDE_SHORTCUTS },
  { name: 'Code Review', shortcuts: CODE_REVIEW_SHORTCUTS }
]
