import {
  LayoutDashboard,
  Terminal,
  SquareTerminal,
  ClipboardList,
  GitPullRequest,
  Settings,
  GitCommitHorizontal,
  Workflow,
  type LucideIcon
} from 'lucide-react'
import type { View } from '../stores/panelLayout'

// ---------------------------------------------------------------------------
// Single source of truth for view metadata
// ---------------------------------------------------------------------------

export interface ViewMetadata {
  label: string
  icon: LucideIcon
  shortcut: string // Display format (e.g., '⌘1')
  shortcutKey: string // Key for keyboard handler (e.g., '1')
}

export const VIEW_REGISTRY: Record<View, ViewMetadata> = {
  dashboard: {
    label: 'Dashboard',
    icon: LayoutDashboard,
    shortcut: '⌘1',
    shortcutKey: '1'
  },
  agents: {
    label: 'Agents',
    icon: Terminal,
    shortcut: '⌘2',
    shortcutKey: '2'
  },
  ide: {
    label: 'IDE',
    icon: SquareTerminal,
    shortcut: '⌘3',
    shortcutKey: '3'
  },
  sprint: {
    label: 'Task Pipeline',
    icon: Workflow,
    shortcut: '⌘4',
    shortcutKey: '4'
  },
  'code-review': {
    label: 'Code Review',
    icon: GitPullRequest,
    shortcut: '⌘5',
    shortcutKey: '5'
  },
  git: {
    label: 'Source Control',
    icon: GitCommitHorizontal,
    shortcut: '⌘6',
    shortcutKey: '6'
  },
  settings: {
    label: 'Settings',
    icon: Settings,
    shortcut: '⌘7',
    shortcutKey: '7'
  },
  'task-workbench': {
    label: 'Task Workbench',
    icon: ClipboardList,
    shortcut: '⌘0',
    shortcutKey: '0'
  }
}

// ---------------------------------------------------------------------------
// Derived constants for backward compatibility
// ---------------------------------------------------------------------------

export const VIEW_LABELS: Record<View, string> = Object.fromEntries(
  Object.entries(VIEW_REGISTRY).map(([view, meta]) => [view, meta.label])
) as Record<View, string>

export const VIEW_ICONS: Record<View, LucideIcon> = Object.fromEntries(
  Object.entries(VIEW_REGISTRY).map(([view, meta]) => [view, meta.icon])
) as Record<View, LucideIcon>

export const VIEW_SHORTCUTS: Record<View, string> = Object.fromEntries(
  Object.entries(VIEW_REGISTRY).map(([view, meta]) => [view, meta.shortcut])
) as Record<View, string>

export const VIEW_SHORTCUT_MAP: Record<string, View> = Object.fromEntries(
  Object.entries(VIEW_REGISTRY).map(([view, meta]) => [meta.shortcutKey, view as View])
) as Record<string, View>
