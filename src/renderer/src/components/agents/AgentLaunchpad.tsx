import { useState, useCallback, useEffect } from 'react'
import './AgentLaunchpad.css'
import { useLocalAgentsStore } from '../../stores/localAgents'
import { usePromptTemplatesStore } from '../../stores/promptTemplates'
import { toast } from '../../stores/toasts'
import { assemblePrompt } from '../../lib/prompt-assembly'
import type { PromptTemplate } from '../../lib/launchpad-types'
import { LaunchpadGrid } from './LaunchpadGrid'

interface AgentLaunchpadProps {
  onAgentSpawned: () => void
}

export function AgentLaunchpad({ onAgentSpawned }: AgentLaunchpadProps): React.JSX.Element {
  const [repoPaths, setRepoPaths] = useState<Record<string, string>>({})

  const templates = usePromptTemplatesStore((s) => s.templates)
  const loadTemplates = usePromptTemplatesStore((s) => s.loadTemplates)
  const spawnAgent = useLocalAgentsStore((s) => s.spawnAgent)
  const fetchProcesses = useLocalAgentsStore((s) => s.fetchProcesses)
  const spawning = useLocalAgentsStore((s) => s.isSpawning)

  useEffect(() => {
    loadTemplates()
    window.api
      .getRepoPaths()
      .then(setRepoPaths)
      .catch(() => {})
  }, [loadTemplates])

  const visibleTemplates = templates.filter((t) => !t.hidden)

  const handleSpawn = useCallback(
    async (prompt: string, repo: string, model: string) => {
      const repoPath = repoPaths[repo.toLowerCase()]
      if (!repoPath) {
        toast.error(`Repo path not found for "${repo}"`)
        return
      }
      try {
        await spawnAgent({ task: prompt, repoPath, model, assistant: true })
        fetchProcesses()
        toast.success('Session started')
        onAgentSpawned()
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        toast.error(`Spawn failed: ${message}`)
      }
    },
    [repoPaths, spawnAgent, fetchProcesses, onAgentSpawned]
  )

  const handleTemplateSpawn = useCallback(
    (template: PromptTemplate, repo: string, model: string) => {
      const prompt = assemblePrompt(template, {})
      handleSpawn(prompt, repo, model)
    },
    [handleSpawn]
  )

  return (
    <LaunchpadGrid
      templates={visibleTemplates}
      onSelectTemplate={handleTemplateSpawn}
      onCustomPrompt={handleSpawn}
      spawning={spawning}
    />
  )
}
