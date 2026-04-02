import { useState, useCallback, useEffect } from 'react'
import '../../assets/agent-launchpad-neon.css'
import { useLocalAgentsStore } from '../../stores/localAgents'
import { usePromptTemplatesStore } from '../../stores/promptTemplates'
import { toast } from '../../stores/toasts'
import { assemblePrompt } from '../../lib/prompt-assembly'
import { migrateHistory } from '../../lib/prompt-assembly'
import type { PromptTemplate, RecentTask } from '../../lib/launchpad-types'
import { RECENT_TASKS_KEY, RECENT_TASKS_LIMIT } from '../../lib/launchpad-types'
import { LaunchpadGrid } from './LaunchpadGrid'
import { LaunchpadConfigure } from './LaunchpadConfigure'
import { LaunchpadReview } from './LaunchpadReview'

type Phase = 'grid' | 'configure' | 'review'

interface AgentLaunchpadProps {
  onAgentSpawned: () => void
}

export function AgentLaunchpad({ onAgentSpawned }: AgentLaunchpadProps) {
  const [phase, setPhase] = useState<Phase>('grid')
  const [selectedTemplate, setSelectedTemplate] = useState<PromptTemplate | null>(null)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [assembledPromptText, setAssembledPromptText] = useState('')
  const [repo, setRepo] = useState('BDE')
  const [model, setModel] = useState('sonnet')
  const [recents, setRecents] = useState<RecentTask[]>([])
  const [repoPaths, setRepoPaths] = useState<Record<string, string>>({})

  const templates = usePromptTemplatesStore((s) => s.templates)
  const loadTemplates = usePromptTemplatesStore((s) => s.loadTemplates)
  const spawnAgent = useLocalAgentsStore((s) => s.spawnAgent)
  const fetchProcesses = useLocalAgentsStore((s) => s.fetchProcesses)
  const spawning = useLocalAgentsStore((s) => s.isSpawning)

  // Load templates and recents on mount
  useEffect(() => {
    loadTemplates()
    window.api
      .getRepoPaths()
      .then(setRepoPaths)
      .catch(() => {})

    try {
      const stored = localStorage.getItem(RECENT_TASKS_KEY)
      if (stored) {
        const parsed = JSON.parse(stored)
        setRecents(migrateHistory(parsed))
      }
    } catch {
      /* ignore */
    }
  }, [loadTemplates])

  const visibleTemplates = templates.filter((t) => !t.hidden)

  const saveRecent = useCallback(
    (prompt: string) => {
      const entry: RecentTask = { prompt, repo, model, timestamp: Date.now() }
      const updated = [entry, ...recents.filter((r) => r.prompt !== prompt)].slice(
        0,
        RECENT_TASKS_LIMIT
      )
      setRecents(updated)
      localStorage.setItem(RECENT_TASKS_KEY, JSON.stringify(updated))
    },
    [recents, repo, model]
  )

  // ── Phase transitions ──

  const handleSelectTemplate = useCallback((template: PromptTemplate) => {
    setSelectedTemplate(template)
    setAnswers({})
    if (template.questions.length === 0) {
      // No questions — go straight to review
      setAssembledPromptText(assemblePrompt(template, {}))
      setPhase('review')
    } else {
      setPhase('configure')
    }
  }, [])

  const handleCustomPrompt = useCallback((prompt: string, repoName: string, modelId: string) => {
    setSelectedTemplate(null)
    setAnswers({})
    setAssembledPromptText(prompt)
    setRepo(repoName)
    setModel(modelId)
    setPhase('review')
  }, [])

  const handleSelectRecent = useCallback((recent: RecentTask) => {
    setSelectedTemplate(null)
    setAnswers({})
    setAssembledPromptText(recent.prompt)
    if (recent.repo) setRepo(recent.repo)
    if (recent.model) setModel(recent.model)
    setPhase('review')
  }, [])

  const handleConfigureComplete = useCallback(
    (configAnswers: Record<string, string>) => {
      setAnswers(configAnswers)
      if (selectedTemplate) {
        setAssembledPromptText(assemblePrompt(selectedTemplate, configAnswers))
      }
      setPhase('review')
    },
    [selectedTemplate]
  )

  const handleSpawn = useCallback(
    async (finalPrompt: string) => {
      const repoPath = repoPaths[repo.toLowerCase()]
      if (!repoPath) {
        toast.error(`Repo path not found for "${repo}"`)
        return
      }
      try {
        await spawnAgent({ task: finalPrompt, repoPath, model })
        saveRecent(finalPrompt)
        fetchProcesses()
        toast.success('Agent spawned')
        onAgentSpawned()
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        toast.error(`Spawn failed: ${message}`)
      }
    },
    [repo, model, repoPaths, spawnAgent, fetchProcesses, saveRecent, onAgentSpawned]
  )

  const handleBack = useCallback(() => {
    if (phase === 'review' && selectedTemplate && selectedTemplate.questions.length > 0) {
      setPhase('configure')
    } else {
      setPhase('grid')
      setSelectedTemplate(null)
      setAnswers({})
    }
  }, [phase, selectedTemplate])

  // ── Render ──

  switch (phase) {
    case 'grid':
      return (
        <LaunchpadGrid
          templates={visibleTemplates}
          recents={recents}
          onSelectTemplate={handleSelectTemplate}
          onCustomPrompt={handleCustomPrompt}
          onSelectRecent={handleSelectRecent}
        />
      )
    case 'configure':
      return selectedTemplate ? (
        <LaunchpadConfigure
          template={selectedTemplate}
          onComplete={handleConfigureComplete}
          onBack={handleBack}
        />
      ) : null
    case 'review':
      return (
        <LaunchpadReview
          template={selectedTemplate}
          assembledPrompt={assembledPromptText}
          answers={answers}
          repo={repo}
          model={model}
          onSpawn={handleSpawn}
          onBack={handleBack}
          spawning={spawning}
        />
      )
  }
}
