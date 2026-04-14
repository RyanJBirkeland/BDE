import { useEffect } from 'react'
import { useCommandPaletteStore, type Command } from '../stores/commandPalette'

interface UseAgentViewCommandsParams {
  handleSpawnAgent: () => void
  handleClearConsole: () => void
}

export function useAgentViewCommands({
  handleSpawnAgent,
  handleClearConsole
}: UseAgentViewCommandsParams): void {
  const registerCommands = useCommandPaletteStore((s) => s.registerCommands)
  const unregisterCommands = useCommandPaletteStore((s) => s.unregisterCommands)

  useEffect(() => {
    const commands: Command[] = [
      {
        id: 'agent-spawn',
        label: 'Spawn Agent',
        category: 'action',
        keywords: ['spawn', 'new', 'agent', 'create', 'launch'],
        action: handleSpawnAgent
      },
      {
        id: 'agent-clear-console',
        label: 'Clear Console',
        category: 'action',
        keywords: ['clear', 'console', 'reset', 'clean'],
        action: handleClearConsole
      }
    ]

    registerCommands(commands)

    return () => {
      unregisterCommands(commands.map((c) => c.id))
    }
  }, [handleSpawnAgent, handleClearConsole, registerCommands, unregisterCommands])
}
