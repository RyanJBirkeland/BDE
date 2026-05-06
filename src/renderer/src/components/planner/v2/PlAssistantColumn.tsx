import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import type { TaskGroup, SprintTask } from '../../../../../shared/types'
import { parseActionMarkers, type ParseResult } from '../PlannerAssistant'
import { useRepoOptions } from '../../../hooks/useRepoOptions'
import { useTaskWorkbenchModalStore } from '../../../stores/taskWorkbenchModal'
import { useSprintTasks } from '../../../stores/sprintTasks'
import { useTaskGroups } from '../../../stores/taskGroups'
import {
  sanitizeAgentPayloadString,
  stripActionMarkers,
  MAX_TASK_TITLE_CHARS,
  MAX_TASK_SPEC_CHARS
} from '../../../lib/sanitize-agent-output'
import { buildSystemPrefix, buildApiMessages } from './pl-assistant-helpers'
import { useWorkbenchChat } from './hooks/useWorkbenchChat'

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  actions?: ParseResult['actions']
}

interface ActionCardState {
  dismissed: boolean
  confirmed: string | null
}

interface PlAssistantColumnProps {
  epic: TaskGroup
  tasks: SprintTask[]
  initialInput?: string
  onAddTask: () => void
  onClose: () => void
}

const SLASH_CHIPS = ['/draft-spec', '/split-task', '/review-epic', '/estimate'] as const

export function PlAssistantColumn({
  epic,
  tasks,
  initialInput,
  onAddTask,
  onClose
}: PlAssistantColumnProps): React.JSX.Element {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState(initialInput ?? '')
  const [cardStates, setCardStates] = useState<Record<string, ActionCardState>>({})
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const chat = useWorkbenchChat()
  const repos = useRepoOptions()
  const firstRepo = repos[0]?.label ?? ''

  const taskSummaries = useMemo(
    () =>
      tasks.map((t) => ({
        id: t.id,
        title: stripActionMarkers(t.title),
        status: t.status,
        hasSpec: !!t.spec?.trim()
      })),
    [tasks]
  )

  const epicContext = useMemo(
    () =>
      JSON.stringify(
        {
          epicName: stripActionMarkers(epic.name),
          epicGoal: epic.goal != null ? stripActionMarkers(epic.goal) : null,
          tasks: taskSummaries
        },
        null,
        2
      ),
    [epic, taskSummaries]
  )

  const suggestions = useMemo(() => deriveSuggestions(tasks), [tasks])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const appendOptimisticMessages = useCallback((body: string, assistantId: string): void => {
    const userMsg: Message = { id: crypto.randomUUID(), role: 'user', content: body }
    const assistantMsg: Message = { id: assistantId, role: 'assistant', content: '' }
    setMessages((prev) => [...prev, userMsg, assistantMsg])
  }, [])

  const streamAssistantReply = useCallback(
    async (
      assistantId: string,
      apiMessages: Array<{ role: 'user' | 'assistant'; content: string }>
    ): Promise<void> => {
      await chat.stream({
        messages: apiMessages,
        formContext: { title: epic.name, repo: firstRepo, spec: epicContext },
        onChunk: (text) =>
          setMessages((prev) =>
            prev.map((m) => (m.id === assistantId ? { ...m, content: text } : m))
          ),
        onDone: (fullText) => {
          const { cleanText, actions } = parseActionMarkers(fullText)
          setMessages((prev) =>
            prev.map((m) => (m.id === assistantId ? { ...m, content: cleanText, actions } : m))
          )
        },
        onError: () =>
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? { ...m, content: 'Error: failed to connect to assistant.' }
                : m
            )
          )
      })
    },
    [chat, epic.name, firstRepo, epicContext]
  )

  const sendMessage = useCallback(
    async (text?: string): Promise<void> => {
      const body = (text ?? input).trim()
      if (!body || chat.isStreaming) return

      const assistantId = crypto.randomUUID()
      appendOptimisticMessages(body, assistantId)
      setInput('')

      const apiMessages = buildApiMessages(messages, body, buildSystemPrefix(epicContext))
      await streamAssistantReply(assistantId, apiMessages)
    },
    [input, messages, chat, epic, epicContext, firstRepo, appendOptimisticMessages, streamAssistantReply]
  )

  const handleCardState = (key: string, state: ActionCardState): void => {
    setCardStates((prev) => ({ ...prev, [key]: state }))
  }

  return (
    <div
      style={{
        width: 420,
        minWidth: 420,
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--bg)'
      }}
    >
      <div
        style={{
          height: 38,
          padding: '0 16px',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          borderBottom: '1px solid var(--line)',
          flexShrink: 0
        }}
      >
        {chat.isStreaming ? (
          <span className="fleet-pulse" style={{ background: 'var(--accent)' }} />
        ) : (
          <span style={{ width: 6, height: 6, borderRadius: 3, background: 'var(--st-running)' }} />
        )}
        <span style={{ fontSize: 11, color: 'var(--fg)', fontWeight: 500 }}>
          Planning Assistant
        </span>
        <span style={{ fontSize: 10, color: 'var(--fg-4)', fontFamily: 'var(--font-mono)' }}>
          · {epic.id}
        </span>
        <span style={{ flex: 1 }} />
        <button
          type="button"
          onClick={() => setMessages([])}
          aria-label="Clear conversation"
          style={{
            height: 22,
            padding: '0 8px',
            background: 'transparent',
            border: '1px solid var(--line)',
            borderRadius: 4,
            fontSize: 10,
            color: 'var(--fg-3)',
            cursor: 'pointer'
          }}
        >
          clear
        </button>
        <button
          onClick={onClose}
          aria-label="Close assistant"
          style={{
            width: 22,
            height: 22,
            marginLeft: 4,
            background: 'transparent',
            border: '1px solid var(--line)',
            borderRadius: 4,
            fontSize: 12,
            color: 'var(--fg-3)',
            cursor: 'pointer'
          }}
        >
          ×
        </button>
      </div>

      <div
        style={{
          flex: 1,
          overflow: 'auto',
          padding: '14px 16px',
          display: 'flex',
          flexDirection: 'column',
          gap: 12
        }}
      >
        {messages.length === 0 && (
          <PlSuggestions suggestions={suggestions} onSelect={(s) => void sendMessage(s)} />
        )}

        {messages.map((msg) => (
          <div key={msg.id}>
            <PlChatMessage role={msg.role}>
              {msg.content || (msg.role === 'assistant' && chat.isStreaming ? '…' : '')}
            </PlChatMessage>
            {msg.actions?.map((action, i) => {
              const key = `${msg.id}-${i}`
              return (
                <PlActionCard
                  key={key}
                  cardKey={key}
                  action={action}
                  epic={epic}
                  tasks={tasks}
                  firstRepo={firstRepo}
                  cardState={cardStates[key] ?? { dismissed: false, confirmed: null }}
                  onCardStateChange={handleCardState}
                  onAddTask={onAddTask}
                  onClose={onClose}
                />
              )
            })}
          </div>
        ))}

        {chat.isStreaming && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span className="fleet-pulse" style={{ background: 'var(--accent)' }} />
            <span style={{ fontSize: 11, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)' }}>
              thinking…
            </span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <div
        style={{
          borderTop: '1px solid var(--line)',
          padding: '10px 12px',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          flexShrink: 0
        }}
      >
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {SLASH_CHIPS.map((chip) => (
            <button
              key={chip}
              onClick={() => setInput(chip + ' ')}
              style={{
                height: 22,
                padding: '0 8px',
                background: 'var(--surf-1)',
                border: '1px solid var(--line)',
                borderRadius: 4,
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                color: 'var(--fg-2)',
                cursor: 'pointer'
              }}
            >
              {chip}
            </button>
          ))}
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-end',
            gap: 8,
            padding: '6px 10px',
            background: 'var(--surf-1)',
            border: '1px solid var(--line)',
            borderRadius: 8
          }}
        >
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void sendMessage()
              }
            }}
            rows={1}
            disabled={chat.isStreaming}
            placeholder="Ask the assistant…"
            aria-label="Message the planning assistant"
            style={{
              flex: 1,
              background: 'transparent',
              border: 'none',
              outline: 'none',
              resize: 'none',
              fontSize: 12,
              color: 'var(--fg)',
              fontFamily: 'inherit',
              minHeight: 22
            }}
          />
          <kbd
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 9,
              color: 'var(--fg-4)',
              border: '1px solid var(--line-2)',
              borderRadius: 3,
              padding: '0 4px'
            }}
          >
            ↵
          </kbd>
        </div>
      </div>
    </div>
  )
}

function PlSuggestions({
  suggestions,
  onSelect
}: {
  suggestions: string[]
  onSelect: (s: string) => void
}): React.JSX.Element {
  return (
    <div
      style={{
        padding: '10px 12px',
        background: 'var(--surf-1)',
        border: '1px solid var(--line)',
        borderRadius: 8,
        display: 'flex',
        flexDirection: 'column',
        gap: 6
      }}
    >
      <span
        style={{
          fontSize: 10,
          color: 'var(--fg-3)',
          textTransform: 'uppercase',
          letterSpacing: '0.08em'
        }}
      >
        Suggested for this epic
      </span>
      {suggestions.map((s) => (
        <button
          key={s}
          onClick={() => onSelect(s)}
          style={{
            height: 26,
            padding: '0 10px',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            background: 'transparent',
            border: '1px solid var(--line)',
            borderRadius: 6,
            fontSize: 11,
            color: 'var(--fg-2)',
            cursor: 'pointer',
            textAlign: 'left'
          }}
        >
          <span style={{ color: 'var(--fg-4)' }}>→</span>
          <span style={{ flex: 1 }}>{s}</span>
        </button>
      ))}
    </div>
  )
}

function PlChatMessage({
  role,
  children
}: {
  role: 'user' | 'assistant'
  children: React.ReactNode
}): React.JSX.Element {
  const isUser = role === 'user'
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        alignSelf: isUser ? 'flex-end' : 'stretch',
        maxWidth: isUser ? '88%' : '100%'
      }}
    >
      <span
        style={{
          fontSize: 9,
          color: 'var(--fg-4)',
          fontFamily: 'var(--font-mono)',
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          textAlign: isUser ? 'right' : 'left'
        }}
      >
        {isUser ? 'you' : 'assistant'}
      </span>
      <div
        style={{
          padding: '8px 12px',
          background: isUser ? 'var(--surf-2)' : 'transparent',
          border: '1px solid ' + (isUser ? 'var(--line-2)' : 'transparent'),
          borderRadius: 8,
          fontSize: 12.5,
          color: 'var(--fg)',
          lineHeight: 1.55,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word'
        }}
      >
        {children}
      </div>
    </div>
  )
}

type ParsedAction = ParseResult['actions'][number]
type ActionType = ParsedAction['type']

interface ActionCardProps {
  cardKey: string
  action: ParsedAction
  epic: TaskGroup
  tasks: SprintTask[]
  firstRepo: string
  cardState: ActionCardState
  onCardStateChange: (key: string, state: ActionCardState) => void
  onAddTask: () => void
  onClose: () => void
}

const ACTION_LABELS: Record<ActionType, string> = {
  'create-task': 'New Task',
  'create-epic': 'New Epic',
  'update-spec': 'Update Spec'
}

function PlActionCard({
  cardKey,
  action,
  epic,
  tasks,
  firstRepo,
  cardState,
  onCardStateChange,
  onAddTask,
  onClose
}: ActionCardProps): React.JSX.Element | null {
  const createTask = useSprintTasks((s) => s.createTask)
  const updateTask = useSprintTasks((s) => s.updateTask)
  const createGroup = useTaskGroups((s) => s.createGroup)
  const openForCreateWithDefaults = useTaskWorkbenchModalStore((s) => s.openForCreateWithDefaults)

  if (cardState.dismissed) return null

  const applyCreateTask = async (): Promise<void> => {
    if (action.type !== 'create-task') return
    await createTask({
      title:
        sanitizeAgentPayloadString(action.payload.title, MAX_TASK_TITLE_CHARS) || 'Untitled',
      spec: sanitizeAgentPayloadString(action.payload.spec, MAX_TASK_SPEC_CHARS),
      repo: firstRepo,
      priority: 0,
      playground_enabled: false,
      group_id: epic.id
    })
  }

  const applyCreateEpic = async (): Promise<void> => {
    if (action.type !== 'create-epic') return
    await createGroup({
      name: sanitizeAgentPayloadString(action.payload.name, MAX_TASK_TITLE_CHARS) || 'New Epic',
      goal: sanitizeAgentPayloadString(action.payload.goal, MAX_TASK_SPEC_CHARS)
    })
  }

  const applyUpdateSpec = async (): Promise<void> => {
    if (action.type !== 'update-spec' || !action.payload.taskId) return
    await updateTask(action.payload.taskId, {
      spec: sanitizeAgentPayloadString(action.payload.spec, MAX_TASK_SPEC_CHARS)
    })
  }

  const handleApply = async (): Promise<void> => {
    try {
      if (action.type === 'create-task') await applyCreateTask()
      else if (action.type === 'create-epic') await applyCreateEpic()
      else if (action.type === 'update-spec') await applyUpdateSpec()

      onCardStateChange(cardKey, {
        dismissed: false,
        confirmed: action.type === 'create-task' ? '✓ Added to backlog' : '✓ Done'
      })
    } catch {
      onCardStateChange(cardKey, { dismissed: false, confirmed: '✗ Failed' })
    }
  }

  const handleEditFirst = (): void => {
    if (action.type === 'create-task') {
      openForCreateWithDefaults({
        title: sanitizeAgentPayloadString(action.payload.title, MAX_TASK_TITLE_CHARS),
        spec: sanitizeAgentPayloadString(action.payload.spec, MAX_TASK_SPEC_CHARS),
        groupId: epic.id
      })
    } else if (action.type === 'create-epic') {
      openForCreateWithDefaults({
        title: sanitizeAgentPayloadString(action.payload.name, MAX_TASK_TITLE_CHARS),
        spec: sanitizeAgentPayloadString(action.payload.goal, MAX_TASK_SPEC_CHARS)
      })
    }
    onAddTask()
    onClose()
  }

  const displayTitle = resolveDisplayTitle(action, tasks)

  return (
    <div
      style={{
        marginTop: 8,
        padding: '10px 12px',
        background: 'var(--surf-1)',
        border: '1px solid var(--line-2)',
        borderRadius: 8,
        display: 'flex',
        flexDirection: 'column',
        gap: 8
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span
          style={{
            fontSize: 9,
            fontFamily: 'var(--font-mono)',
            color: 'var(--accent)',
            textTransform: 'uppercase',
            letterSpacing: '0.1em',
            padding: '2px 6px',
            border: '1px solid var(--accent-line)',
            background: 'var(--accent-soft)',
            borderRadius: 3
          }}
        >
          {ACTION_LABELS[action.type]}
        </span>
        <span
          style={{
            flex: 1,
            fontSize: 12,
            color: 'var(--fg)',
            fontWeight: 500,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap'
          }}
        >
          {displayTitle}
        </span>
      </div>

      {cardState.confirmed ? (
        <div style={{ fontSize: 11, color: 'var(--st-done)' }}>{cardState.confirmed}</div>
      ) : (
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            onClick={() => void handleApply()}
            style={{
              height: 24,
              padding: '0 10px',
              borderRadius: 4,
              background: 'var(--accent)',
              color: 'var(--accent-fg)',
              border: 'none',
              fontSize: 11,
              fontWeight: 500,
              cursor: 'pointer'
            }}
          >
            {action.type === 'update-spec' ? 'Apply' : 'Create'}
          </button>
          {action.type !== 'update-spec' && (
            <button
              onClick={handleEditFirst}
              style={{
                height: 24,
                padding: '0 10px',
                borderRadius: 4,
                background: 'transparent',
                color: 'var(--fg-2)',
                border: '1px solid var(--line)',
                fontSize: 11,
                cursor: 'pointer'
              }}
            >
              Edit first
            </button>
          )}
          <button
            onClick={() => onCardStateChange(cardKey, { dismissed: true, confirmed: null })}
            style={{
              height: 24,
              padding: '0 10px',
              borderRadius: 4,
              background: 'transparent',
              color: 'var(--fg-3)',
              border: '1px solid var(--line)',
              fontSize: 11,
              cursor: 'pointer'
            }}
          >
            Skip
          </button>
        </div>
      )}
    </div>
  )
}

/**
 * Resolves the human-readable title for an action card.
 *
 * Uses a switch on action.type so each variant accesses only the payload
 * fields that belong to it, making future shape changes visible at
 * compile time.
 */
function resolveDisplayTitle(action: ParsedAction, tasks: SprintTask[]): string {
  switch (action.type) {
    case 'create-task':
      return action.payload.title ?? '—'
    case 'create-epic':
      return action.payload.name ?? '—'
    case 'update-spec':
      return tasks.find((t) => t.id === action.payload.taskId)?.title ?? '—'
  }
}

function deriveSuggestions(tasks: SprintTask[]): string[] {
  const suggestions: string[] = []
  const noSpecCount = tasks.filter((t) => !t.spec?.trim()).length
  if (noSpecCount > 0)
    suggestions.push(`Draft spec for ${noSpecCount} backlog task${noSpecCount > 1 ? 's' : ''}`)
  suggestions.push('Identify split candidates in running tasks')
  suggestions.push('Review acceptance criteria coverage')
  return suggestions.slice(0, 3)
}

