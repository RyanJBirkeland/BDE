import { useState, useCallback } from 'react'
import { useSessionsStore } from '../../stores/sessions'
import { invokeTool } from '../../lib/rpc'
import { toast } from '../../stores/toasts'

const TASK_TEMPLATES = [
  { id: 'fix-build', label: 'Fix build errors', task: 'Find and fix all build errors in the project. Run the build, read the errors, and fix them one by one.' },
  { id: 'open-pr', label: 'Open PR', task: 'Create a pull request for the current branch with a clear title and description summarizing the changes.' },
  { id: 'review-code', label: 'Review code', task: 'Review the recent changes in this branch for bugs, security issues, and code quality. Provide a summary of findings.' },
  { id: 'write-tests', label: 'Write tests', task: 'Analyze the codebase and write missing unit tests for recently changed files.' }
] as const

const STEERING_CHIPS = [
  { id: 'stop', label: 'Stop & summarize' },
  { id: 'pr', label: 'Open a PR' },
  { id: 'continue', label: 'Keep going' },
  { id: 'explain', label: 'Explain last step' }
] as const

interface SentMessage {
  id: string
  text: string
  timestamp: number
}

export function AgentDirector(): React.JSX.Element {
  const selectedKey = useSessionsStore((s) => s.selectedSessionKey)
  const runTask = useSessionsStore((s) => s.runTask)
  const killSession = useSessionsStore((s) => s.killSession)
  const sessions = useSessionsStore((s) => s.sessions)

  const [taskInput, setTaskInput] = useState('')
  const [spawning, setSpawning] = useState(false)
  const [steerInput, setSteerInput] = useState('')
  const [sending, setSending] = useState(false)
  const [killing, setKilling] = useState(false)
  const [sentMessages, setSentMessages] = useState<SentMessage[]>([])

  const selectedSession = selectedKey
    ? sessions.find((s) => s.key === selectedKey)
    : null
  const isRunning = selectedSession
    ? Date.now() - selectedSession.updatedAt < 5 * 60 * 1000
    : false

  const handleSpawn = useCallback(async (task: string): Promise<void> => {
    if (!task.trim() || spawning) return
    setSpawning(true)
    try {
      await runTask(task.trim())
      setTaskInput('')
    } finally {
      setSpawning(false)
    }
  }, [spawning, runTask])

  const handleTemplateClick = useCallback((task: string): void => {
    handleSpawn(task)
  }, [handleSpawn])

  const handleSpawnSubmit = useCallback((e: React.FormEvent): void => {
    e.preventDefault()
    handleSpawn(taskInput)
  }, [handleSpawn, taskInput])

  const sendMessage = useCallback(async (text: string): Promise<void> => {
    if (!selectedKey || !text.trim() || sending) return
    setSending(true)
    try {
      await invokeTool('sessions_send', {
        sessionKey: selectedKey,
        message: text.trim()
      })
      setSentMessages((prev) =>
        [
          ...prev,
          { id: `${Date.now()}`, text: text.trim(), timestamp: Date.now() }
        ].slice(-3)
      )
      setSteerInput('')
      toast.info('Message sent')
    } catch (err) {
      console.error('Failed to send message:', err)
      toast.error('Failed to send message')
    } finally {
      setSending(false)
    }
  }, [selectedKey, sending])

  const handleChip = useCallback((label: string): void => {
    sendMessage(label)
  }, [sendMessage])

  const handleSteerSubmit = useCallback((e: React.FormEvent): void => {
    e.preventDefault()
    sendMessage(steerInput)
  }, [sendMessage, steerInput])

  const handleKill = useCallback(async (): Promise<void> => {
    if (!selectedKey || killing) return
    setKilling(true)
    try {
      await killSession(selectedKey)
    } finally {
      setKilling(false)
    }
  }, [selectedKey, killing, killSession])

  return (
    <div className="agent-director">
      <div className="agent-director__header">
        <span className="agent-director__title">Agent Director</span>
        {selectedKey && isRunning && (
          <button
            className="agent-director__kill"
            onClick={handleKill}
            disabled={killing}
            title="Stop this session"
          >
            {killing ? '...' : 'Stop'}
          </button>
        )}
      </div>

      {/* Spawn: Quick task launcher */}
      <div className="agent-director__section">
        <span className="agent-director__section-label">Quick Task</span>
        <div className="agent-director__templates">
          {TASK_TEMPLATES.map((t) => (
            <button
              key={t.id}
              className="agent-director__template"
              onClick={() => handleTemplateClick(t.task)}
              disabled={spawning}
              title={t.task}
            >
              {spawning ? <span className="agent-director__spinner" /> : null}
              {t.label}
            </button>
          ))}
        </div>
        <form className="agent-director__form" onSubmit={handleSpawnSubmit}>
          <input
            className="agent-director__input"
            type="text"
            placeholder="Describe a task to run..."
            value={taskInput}
            onChange={(e) => setTaskInput(e.target.value)}
            disabled={spawning}
          />
          <button
            className="agent-director__send"
            type="submit"
            disabled={!taskInput.trim() || spawning}
          >
            {spawning ? 'Starting...' : 'Run'}
          </button>
        </form>
      </div>

      {/* Steer: Send message to selected session */}
      {selectedKey && (
        <div className="agent-director__section">
          <span className="agent-director__section-label">Steer Session</span>
          <div className="agent-director__chips">
            {STEERING_CHIPS.map((chip) => (
              <button
                key={chip.id}
                className="agent-director__chip"
                onClick={() => handleChip(chip.label)}
                disabled={sending}
              >
                {chip.label}
              </button>
            ))}
          </div>
          <form className="agent-director__form" onSubmit={handleSteerSubmit}>
            <input
              className="agent-director__input"
              type="text"
              placeholder="Send a message to the agent..."
              value={steerInput}
              onChange={(e) => setSteerInput(e.target.value)}
              disabled={sending}
            />
            <button
              className="agent-director__send"
              type="submit"
              disabled={!steerInput.trim() || sending}
            >
              {sending ? 'Sending...' : 'Send'}
            </button>
          </form>
          {sentMessages.length > 0 && (
            <div className="agent-director__history">
              {sentMessages.map((msg) => (
                <div key={msg.id} className="agent-director__sent">
                  {msg.text}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
