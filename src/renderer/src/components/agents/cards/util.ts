/**
 * util.ts — Shared utilities for console cards
 */

import {
  Terminal,
  FileText,
  Edit3,
  FilePlus,
  Search,
  Folder,
  Bot,
  List,
  Wrench,
  type LucideIcon
} from 'lucide-react'

export function formatTime(ts: number): string {
  try {
    return new Date(ts).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    })
  } catch {
    return ''
  }
}

export interface ToolMeta {
  Icon: LucideIcon
  color: string
}

export const TOOL_MAP: Record<string, ToolMeta> = {
  bash: { Icon: Terminal, color: 'var(--fleet-warning)' },
  read: { Icon: FileText, color: 'var(--fleet-status-review)' },
  edit: { Icon: Edit3, color: 'var(--fleet-accent)' },
  write: { Icon: FilePlus, color: 'var(--fleet-accent)' },
  grep: { Icon: Search, color: 'var(--fleet-status-active)' },
  glob: { Icon: Folder, color: 'var(--fleet-warning)' },
  agent: { Icon: Bot, color: 'var(--fleet-status-done)' },
  task: { Icon: Bot, color: 'var(--fleet-status-done)' },
  list: { Icon: List, color: 'var(--fleet-text-muted)' }
}

export function getToolMeta(toolName: string): ToolMeta {
  return TOOL_MAP[toolName.toLowerCase()] ?? { Icon: Wrench, color: 'var(--fleet-text-muted)' }
}
