import { create } from 'zustand'
import type { SprintTask, TaskDependency } from '../../../shared/types'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CopilotMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: number
  insertable?: boolean
}

export interface CheckResult {
  id: string
  label: string
  tier: 1 | 2 | 3
  status: 'pass' | 'warn' | 'fail' | 'pending'
  message: string
}

interface TaskWorkbenchState {
  // --- Form ---
  mode: 'create' | 'edit'
  taskId: string | null
  title: string
  repo: string
  priority: number
  spec: string
  taskTemplateName: string
  advancedOpen: boolean
  dependsOn: TaskDependency[]
  playgroundEnabled: boolean

  // --- Copilot ---
  copilotVisible: boolean
  copilotMessages: CopilotMessage[]
  copilotLoading: boolean
  streamingMessageId: string | null
  activeStreamId: string | null

  // --- Readiness ---
  checksExpanded: boolean
  structuralChecks: CheckResult[]
  semanticChecks: CheckResult[]
  operationalChecks: CheckResult[]
  semanticLoading: boolean
  operationalLoading: boolean

  // --- Actions ---
  setField: (field: string, value: unknown) => void
  resetForm: () => void
  loadTask: (task: SprintTask) => void
  toggleCopilot: () => void
  toggleChecksExpanded: () => void
  setStructuralChecks: (checks: CheckResult[]) => void
  setSemanticChecks: (checks: CheckResult[]) => void
  setOperationalChecks: (checks: CheckResult[]) => void
  addCopilotMessage: (msg: CopilotMessage) => void
  setCopilotLoading: (loading: boolean) => void
  startStreaming: (messageId: string, streamId: string) => void
  appendToStreamingMessage: (chunk: string) => void
  finishStreaming: (insertable: boolean) => void
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const WELCOME_MESSAGE: CopilotMessage = {
  id: 'welcome',
  role: 'system',
  content:
    'I can help you craft this task. Try asking me to research the codebase, brainstorm approaches, or review your spec.',
  timestamp: Date.now()
}

function defaults(): Pick<
  TaskWorkbenchState,
  | 'mode'
  | 'taskId'
  | 'title'
  | 'repo'
  | 'priority'
  | 'spec'
  | 'taskTemplateName'
  | 'advancedOpen'
  | 'dependsOn'
  | 'playgroundEnabled'
  | 'copilotVisible'
  | 'copilotMessages'
  | 'copilotLoading'
  | 'streamingMessageId'
  | 'activeStreamId'
  | 'checksExpanded'
  | 'structuralChecks'
  | 'semanticChecks'
  | 'operationalChecks'
  | 'semanticLoading'
  | 'operationalLoading'
> {
  return {
    mode: 'create',
    taskId: null,
    title: '',
    repo: 'BDE',
    priority: 3,
    spec: '',
    taskTemplateName: '',
    advancedOpen: false,
    dependsOn: [],
    playgroundEnabled: false,
    copilotVisible: true,
    copilotMessages: [{ ...WELCOME_MESSAGE, timestamp: Date.now() }],
    copilotLoading: false,
    streamingMessageId: null,
    activeStreamId: null,
    checksExpanded: false,
    structuralChecks: [],
    semanticChecks: [],
    operationalChecks: [],
    semanticLoading: false,
    operationalLoading: false
  }
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useTaskWorkbenchStore = create<TaskWorkbenchState>((set) => ({
  ...defaults(),

  setField: (field, value) => set({ [field]: value } as Partial<TaskWorkbenchState>),

  resetForm: () => set(defaults()),

  loadTask: (task) =>
    set({
      mode: 'edit',
      taskId: task.id,
      title: task.title,
      repo: task.repo,
      priority: task.priority,
      spec: task.spec ?? '',
      taskTemplateName: task.template_name ?? '',
      dependsOn: task.depends_on ?? [],
      playgroundEnabled: task.playground_enabled ?? false,
      copilotMessages: [{ ...WELCOME_MESSAGE, timestamp: Date.now() }],
      streamingMessageId: null,
      activeStreamId: null,
      semanticChecks: [],
      operationalChecks: []
    }),

  toggleCopilot: () => set((s) => ({ copilotVisible: !s.copilotVisible })),
  toggleChecksExpanded: () => set((s) => ({ checksExpanded: !s.checksExpanded })),

  setStructuralChecks: (checks) => set({ structuralChecks: checks }),
  setSemanticChecks: (checks) => set({ semanticChecks: checks, semanticLoading: false }),
  setOperationalChecks: (checks) => set({ operationalChecks: checks, operationalLoading: false }),

  addCopilotMessage: (msg) =>
    set((s) => {
      const messages = [...s.copilotMessages, msg]
      return { copilotMessages: messages.length > 200 ? messages.slice(-200) : messages }
    }),

  setCopilotLoading: (loading) => set({ copilotLoading: loading }),

  startStreaming: (messageId, streamId) =>
    set({
      streamingMessageId: messageId,
      activeStreamId: streamId,
      copilotLoading: true
    }),

  appendToStreamingMessage: (chunk) =>
    set((s) => {
      if (!s.streamingMessageId) return s
      const messages = s.copilotMessages.map((m) =>
        m.id === s.streamingMessageId ? { ...m, content: m.content + chunk } : m
      )
      return { copilotMessages: messages }
    }),

  finishStreaming: (insertable) =>
    set((s) => {
      if (!s.streamingMessageId) return s
      const messages = s.copilotMessages.map((m) =>
        m.id === s.streamingMessageId ? { ...m, insertable } : m
      )
      return {
        copilotMessages: messages,
        streamingMessageId: null,
        activeStreamId: null,
        copilotLoading: false
      }
    })
}))
