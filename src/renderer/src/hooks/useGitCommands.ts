/**
 * useGitCommands — Registers git operation commands in the command palette.
 * Extracted from GitTreeView to separate command registration from rendering.
 */
import { useEffect } from 'react'
import { useCommandPaletteStore, type Command } from '../stores/commandPalette'

interface UseGitCommandsProps {
  onStageAll: () => void
  onCommit: () => void
  onPush: () => void
  onSwitchBranch: () => void
}

export function useGitCommands({
  onStageAll,
  onCommit,
  onPush,
  onSwitchBranch
}: UseGitCommandsProps): void {
  const registerCommands = useCommandPaletteStore((s) => s.registerCommands)
  const unregisterCommands = useCommandPaletteStore((s) => s.unregisterCommands)

  useEffect(() => {
    const commands: Command[] = [
      {
        id: 'git-stage-all',
        label: 'Stage All Changes',
        category: 'action',
        keywords: ['stage', 'all', 'changes', 'add'],
        action: onStageAll
      },
      {
        id: 'git-commit',
        label: 'Commit',
        category: 'action',
        keywords: ['commit', 'save', 'record'],
        action: onCommit
      },
      {
        id: 'git-push',
        label: 'Push',
        category: 'action',
        keywords: ['push', 'upload', 'remote'],
        action: onPush
      },
      {
        id: 'git-switch-branch',
        label: 'Switch Branch',
        category: 'action',
        keywords: ['switch', 'branch', 'checkout'],
        action: onSwitchBranch
      }
    ]

    registerCommands(commands)

    return () => {
      unregisterCommands(commands.map((c) => c.id))
    }
  }, [onStageAll, onCommit, onPush, onSwitchBranch, registerCommands, unregisterCommands])
}
