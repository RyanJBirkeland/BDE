/**
 * util.ts — Shared utilities for console cards
 */

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

export function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}K`
  return String(n)
}

export interface ToolMeta {
  letter: string
  iconClass: string
}

export const TOOL_MAP: Record<string, ToolMeta> = {
  bash: { letter: '$', iconClass: 'console-tool-icon--bash' },
  read: { letter: 'R', iconClass: 'console-tool-icon--read' },
  edit: { letter: 'E', iconClass: 'console-tool-icon--edit' },
  write: { letter: 'W', iconClass: 'console-tool-icon--write' },
  grep: { letter: '?', iconClass: 'console-tool-icon--grep' },
  glob: { letter: 'F', iconClass: 'console-tool-icon--glob' },
  agent: { letter: 'A', iconClass: 'console-tool-icon--agent' },
  list: { letter: 'L', iconClass: 'console-tool-icon--default' },
  task: { letter: 'T', iconClass: 'console-tool-icon--default' }
}

export function getToolMeta(toolName: string): ToolMeta {
  return (
    TOOL_MAP[toolName.toLowerCase()] ?? {
      letter: '\u2022',
      iconClass: 'console-tool-icon--default'
    }
  )
}
