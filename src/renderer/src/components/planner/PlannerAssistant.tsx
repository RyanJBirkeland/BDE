import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import type { TaskGroup, SprintTask } from '../../../../shared/types'
import { useRepoOptions } from '../../hooks/useRepoOptions'
import { useTaskWorkbenchStore } from '../../stores/taskWorkbench'
import './PlannerAssistant.css'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ActionType = 'create-task' | 'create-epic' | 'update-spec'

interface ActionPayload {
  title?: string
  spec?: string
  name?: string
  goal?: string
  taskId?: string
}

interface ParsedAction {
  type: ActionType
  payload: ActionPayload
}

export interface ParseResult {
  cleanText: string
  actions: ParsedAction[]
}

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  actions?: ParsedAction[]
}

interface ActionCardState {
  dismissed: boolean
  confirmed: string | null
}

export interface PlannerAssistantProps {
  open: boolean
  onClose: () => void
  epic: TaskGroup | null
  tasks: SprintTask[]
  onOpenWorkbench: () => void
}

// ---------------------------------------------------------------------------
// parseActionMarkers
// ---------------------------------------------------------------------------

const ACTION_REGEX = /\[ACTION:(\w[\w-]*)\]([\s\S]*?)\[\/ACTION\]/g

const VALID_ACTION_TYPES = new Set<string>(['create-task', 'create-epic', 'update-spec'])

// Fix 4: module-level constant — not reconstructed on every render
const ACTION_TYPE_LABELS: Record<ActionType, string> = {
  'create-task': 'New Task',
  'create-epic': 'New Epic',
  'update-spec': 'Update Spec',
}

// eslint-disable-next-line react-refresh/only-export-components
export function parseActionMarkers(text: string): ParseResult {
  const actions: ParsedAction[] = []
  let cleanText = text

  cleanText = cleanText.replace(ACTION_REGEX, (_, type, jsonStr) => {
    // Fix 6: validate action type before casting
    if (!VALID_ACTION_TYPES.has(type)) return ''
    try {
      const payload = JSON.parse(jsonStr.trim()) as ActionPayload
      actions.push({ type: type as ActionType, payload })
    } catch {
      // malformed JSON — skip
    }
    return ''
  })

  return { cleanText: cleanText.trim(), actions }
}

// ---------------------------------------------------------------------------
// ActionCard
// ---------------------------------------------------------------------------

interface ActionCardProps {
  messageId: string
  index: number
  action: ParsedAction
  epicId: string
  cardStates: Record<string, ActionCardState>
  onCardStateChange: (key: string, state: ActionCardState) => void
  onOpenWorkbench: () => void
  onClose: () => void
  epic: TaskGroup
  // Fix 2: receive the configured repo so create-task uses a valid repo
  firstRepo: string
}

function ActionCard({
  messageId,
  index,
  action,
  epicId,
  cardStates,
  onCardStateChange,
  onOpenWorkbench,
  onClose,
  epic,
  firstRepo,
}: ActionCardProps): React.JSX.Element | null {
  const key = `${messageId}-${index}`
  const state = cardStates[key] ?? { dismissed: false, confirmed: null }

  if (state.dismissed) return null

  const handleCreate = async (): Promise<void> => {
    try {
      if (action.type === 'create-task') {
        await (window.api.sprint.create as (input: Record<string, unknown>) => Promise<unknown>)({
          title: action.payload.title ?? 'Untitled Task',
          spec: action.payload.spec ?? '',
          // Fix 2: use the configured repo, not an empty string
          repo: firstRepo,
          priority: 0,
          playground_enabled: false,
          group_id: epicId,
        })
      } else if (action.type === 'create-epic') {
        await window.api.groups.create({
          name: action.payload.name ?? 'New Epic',
          goal: action.payload.goal ?? '',
        })
      } else if (action.type === 'update-spec') {
        if (action.payload.taskId) {
          await window.api.sprint.update(action.payload.taskId, { spec: action.payload.spec ?? '' })
        }
      }
      onCardStateChange(key, { dismissed: false, confirmed: '✓ Done' })
    } catch (err) {
      // Fix 3: log errors so failures surface in DevTools
      console.error('PlannerAssistant: action creation failed', err)
      onCardStateChange(key, { dismissed: false, confirmed: '✗ Failed' })
    }
  }

  const handleEditFirst = (): void => {
    const store = useTaskWorkbenchStore.getState()
    store.resetForm()
    if (action.type === 'create-task') {
      store.setField('title', action.payload.title ?? '')
      store.setField('spec', action.payload.spec ?? '')
      store.setField('pendingGroupId', epic.id)
    } else if (action.type === 'create-epic') {
      store.setField('title', action.payload.name ?? '')
      store.setField('spec', action.payload.goal ?? '')
    }
    onOpenWorkbench()
    onClose()
  }

  const handleSkip = (): void => {
    onCardStateChange(key, { dismissed: true, confirmed: null })
  }

  return (
    <div
      className={`planner-assistant__action-card${state.confirmed ? ' planner-assistant__action-card--dismissed' : ''}`}
    >
      {/* Fix 4: use module-level ACTION_TYPE_LABELS instead of per-render object */}
      <div className="planner-assistant__action-card-type">{ACTION_TYPE_LABELS[action.type]}</div>
      <div className="planner-assistant__action-card-title">
        {action.payload.title ?? action.payload.name ?? action.payload.taskId ?? '—'}
      </div>
      {state.confirmed ? (
        <div className="planner-assistant__action-confirm">{state.confirmed}</div>
      ) : (
        <div className="planner-assistant__action-card-buttons">
          <button
            className="planner-assistant__action-btn planner-assistant__action-btn--primary"
            onClick={() => void handleCreate()}
          >
            {action.type === 'update-spec' ? 'Apply' : 'Create'}
          </button>
          {action.type !== 'update-spec' && (
            <button className="planner-assistant__action-btn" onClick={handleEditFirst}>
              Edit first
            </button>
          )}
          <button className="planner-assistant__action-btn" onClick={handleSkip}>
            Skip
          </button>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// PlannerAssistantInner
// ---------------------------------------------------------------------------

interface PlannerAssistantInnerProps {
  epic: TaskGroup
  tasks: SprintTask[]
  onClose: () => void
  onOpenWorkbench: () => void
}

function PlannerAssistantInner({
  epic,
  tasks,
  onClose,
  onOpenWorkbench,
}: PlannerAssistantInnerProps): React.JSX.Element {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [cardStates, setCardStates] = useState<Record<string, ActionCardState>>({})

  const messagesEndRef = useRef<HTMLDivElement>(null)
  // Fix 5: textareaRef used for auto-focus on open
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  // Fix 1: track active unsubscribe function so we can clean up on unmount
  const unsubRef = useRef<(() => void) | null>(null)

  const repos = useRepoOptions()
  const firstRepo = repos[0]?.label ?? ''

  const epicContext = useMemo(() => {
    return JSON.stringify(
      {
        epicName: epic.name,
        epicGoal: epic.goal ?? null,
        tasks: tasks.map((t) => ({
          id: t.id,
          title: t.title,
          status: t.status,
          hasSpec: (t.spec ?? '').trim().length > 0,
        })),
      },
      null,
      2
    )
  }, [epic, tasks])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Fix 1: cleanup subscription on unmount
  useEffect(() => {
    return () => {
      unsubRef.current?.()
    }
  }, [])

  // Fix 5: auto-focus textarea when the drawer opens
  useEffect(() => {
    textareaRef.current?.focus()
  }, [])

  const sendMessage = useCallback(async () => {
    const text = input.trim()
    if (!text || isStreaming) return

    const userMsg: Message = { id: crypto.randomUUID(), role: 'user', content: text }
    const assistantMsgId = crypto.randomUUID()

    setMessages((prev) => [
      ...prev,
      userMsg,
      { id: assistantMsgId, role: 'assistant', content: '' },
    ])
    setInput('')
    setIsStreaming(true)

    const systemPrefix = `You are a planning assistant for the BDE software development environment. Help the user brainstorm and plan tasks for their epic.\n\nEpic context:\n${epicContext}\n\nWhen you propose creating a task, use this exact format:\n[ACTION:create-task]{"title":"...","spec":"..."}[/ACTION]\n\nWhen you propose creating an epic, use:\n[ACTION:create-epic]{"name":"...","goal":"..."}[/ACTION]\n\nWhen you propose updating a task spec, use:\n[ACTION:update-spec]{"taskId":"<existing task id>","spec":"..."}[/ACTION]\n\nKeep responses concise and actionable.`

    const apiMessages = [
      ...messages.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
      { role: 'user' as const, content: text },
    ]
    // Prepend system context to first user message
    if (apiMessages.length > 0 && apiMessages[0].role === 'user') {
      apiMessages[0] = { role: 'user', content: `${systemPrefix}\n\n${apiMessages[0].content}` }
    }

    let buffer = ''

    // Fix 1: clean up any in-flight subscription before registering a new one
    unsubRef.current?.()
    const unsub = window.api.workbench.onChatChunk((data) => {
      if (data.done) {
        const { cleanText, actions } = parseActionMarkers(buffer)
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsgId ? { ...m, content: cleanText, actions } : m
          )
        )
        setIsStreaming(false)
        // Fix 1: clear the ref and unsubscribe immediately when the stream ends
        unsubRef.current = null
        unsub()
        return
      }
      if (data.chunk) {
        buffer += data.chunk
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantMsgId ? { ...m, content: buffer } : m))
        )
      }
    })
    unsubRef.current = unsub

    try {
      await window.api.workbench.chatStream({
        messages: apiMessages,
        formContext: { title: epic.name, repo: firstRepo, spec: epicContext },
      })
    } catch (err) {
      // Fix 3: log errors so failures surface in DevTools
      console.error('PlannerAssistant: chat stream failed', err)
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantMsgId
            ? { ...m, content: 'Error: failed to connect to assistant.' }
            : m
        )
      )
      setIsStreaming(false)
      // Fix 1: clean up subscription on error
      unsubRef.current = null
      unsub()
    }
  }, [input, isStreaming, messages, epic, epicContext, firstRepo])

  if (firstRepo === '') {
    return (
      <div className="planner-assistant">
        <header className="planner-assistant__header">
          <span className="planner-assistant__header-title">Planning Assistant</span>
          <button
            className="planner-assistant__close"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </header>
        <div className="planner-assistant__no-repo">
          Configure a repository in Settings to use the assistant.
        </div>
      </div>
    )
  }

  return (
    <div className="planner-assistant">
      <header className="planner-assistant__header">
        <span className="planner-assistant__header-live">
          <span className="planner-assistant__header-live-dot" />
          live
        </span>
        <span className="planner-assistant__header-title">Planning Assistant</span>
        <span className="planner-assistant__header-meta">
          {epic.name} / {tasks.length} task{tasks.length !== 1 ? 's' : ''}
        </span>
        <button className="planner-assistant__close" onClick={onClose} aria-label="Close">
          ×
        </button>
      </header>
      <div className="planner-assistant__messages">
        {messages.map((msg) => (
          <React.Fragment key={msg.id}>
            <div
              className={`planner-assistant__message planner-assistant__message--${msg.role}`}
            >
              {msg.content}
            </div>
            {msg.actions?.map((action, i) => (
              <ActionCard
                key={`${msg.id}-${i}`}
                messageId={msg.id}
                index={i}
                action={action}
                epicId={epic.id}
                cardStates={cardStates}
                onCardStateChange={(k, s) => setCardStates((prev) => ({ ...prev, [k]: s }))}
                onOpenWorkbench={onOpenWorkbench}
                onClose={onClose}
                epic={epic}
                firstRepo={firstRepo}
              />
            ))}
          </React.Fragment>
        ))}
        <div ref={messagesEndRef} />
      </div>
      <div className="planner-assistant__input-bar">
        <textarea
          ref={textareaRef}
          className="planner-assistant__textarea"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void sendMessage()
            }
          }}
          placeholder="Ask the assistant..."
          rows={1}
          disabled={isStreaming}
        />
        <button
          className="planner-assistant__send"
          onClick={() => void sendMessage()}
          disabled={isStreaming || !input.trim()}
        >
          ↑
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// PlannerAssistant (public export with guard)
// ---------------------------------------------------------------------------

export function PlannerAssistant({
  open,
  onClose,
  epic,
  tasks,
  onOpenWorkbench,
}: PlannerAssistantProps): React.JSX.Element | null {
  if (!open || !epic) return null
  return (
    <PlannerAssistantInner
      epic={epic}
      tasks={tasks}
      onClose={onClose}
      onOpenWorkbench={onOpenWorkbench}
    />
  )
}
