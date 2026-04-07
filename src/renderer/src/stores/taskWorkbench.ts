import { create } from 'zustand'
import type { SprintTask, TaskDependency } from '../../../shared/types'
import type { SpecType } from '../../../shared/spec-validation'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CopilotMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: number
  insertable?: boolean
  /**
   * Optional kind discriminator for system messages. `tool-use` indicates the
   * copilot invoked a read-only tool (Read/Grep/Glob) — rendered compactly so
   * users can see what the copilot is grounding its answer in.
   */
  kind?: 'tool-use'
}

export interface CheckResult {
  id: string
  label: string
  tier: 1 | 2 | 3
  status: 'pass' | 'warn' | 'fail' | 'pending'
  message: string
  /**
   * Optional id of the form element this check relates to. When set, a failed
   * or warning check renders as a button that focuses + scrolls the field into
   * view, so users can act on failures without hunting.
   */
  fieldId?: string
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
  maxCostUsd: number | null
  model: string
  specType: SpecType | null
  crossRepoContract: string | null
  pendingGroupId: string | null

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
  setSpecType: (type: SpecType | null) => void
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

const COPILOT_STORAGE_KEY = 'bde:copilot-messages'
const ADVANCED_OPEN_STORAGE_KEY = 'bde:workbench-advanced-open'
const DRAFT_STORAGE_KEY = 'bde:workbench-draft'
const DRAFT_SAVE_DEBOUNCE_MS = 500

interface PersistedDraft {
  title: string
  repo: string
  priority: number
  spec: string
  dependsOn: TaskDependency[]
  playgroundEnabled: boolean
  maxCostUsd: number | null
  model: string
  crossRepoContract: string | null
  specType: SpecType | null
}

function loadAdvancedOpen(): boolean {
  try {
    return localStorage.getItem(ADVANCED_OPEN_STORAGE_KEY) === 'true'
  } catch {
    return false
  }
}

function persistAdvancedOpen(open: boolean): void {
  try {
    localStorage.setItem(ADVANCED_OPEN_STORAGE_KEY, open ? 'true' : 'false')
  } catch {
    // Ignore quota errors
  }
}

export function loadDraft(): Partial<PersistedDraft> | null {
  try {
    const raw = localStorage.getItem(DRAFT_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object') return parsed as Partial<PersistedDraft>
  } catch {
    // Ignore corrupt localStorage
  }
  return null
}

export function persistDraft(draft: PersistedDraft): void {
  try {
    localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft))
  } catch {
    // Ignore quota errors
  }
}

export function clearDraftStorage(): void {
  try {
    localStorage.removeItem(DRAFT_STORAGE_KEY)
  } catch {
    // Ignore
  }
}

/**
 * Returns true if a draft is "non-empty" — i.e., the user actually typed
 * something. Used to avoid persisting on every blank-form keystroke.
 */
function draftHasContent(d: PersistedDraft): boolean {
  return (
    d.title.trim().length > 0 ||
    d.spec.trim().length > 0 ||
    d.dependsOn.length > 0 ||
    (d.crossRepoContract?.trim().length ?? 0) > 0
  )
}

function loadPersistedMessages(): CopilotMessage[] {
  try {
    const raw = localStorage.getItem(COPILOT_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed) && parsed.length > 0) return parsed
  } catch {
    // Ignore corrupt localStorage
  }
  return []
}

function persistMessages(messages: CopilotMessage[]): void {
  try {
    // Only persist the last 100 messages to keep localStorage lean
    const toStore = messages.slice(-100)
    localStorage.setItem(COPILOT_STORAGE_KEY, JSON.stringify(toStore))
  } catch {
    // Ignore quota errors
  }
}

type DefaultsShape = Pick<
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
  | 'maxCostUsd'
  | 'model'
  | 'specType'
  | 'crossRepoContract'
  | 'pendingGroupId'
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
>

function emptyDefaults(): DefaultsShape {
  return {
    mode: 'create',
    taskId: null,
    title: '',
    repo: 'BDE',
    priority: 3,
    spec: '',
    taskTemplateName: '',
    advancedOpen: loadAdvancedOpen(),
    dependsOn: [],
    playgroundEnabled: false,
    maxCostUsd: null,
    model: '',
    specType: null,
    crossRepoContract: null,
    pendingGroupId: null,
    copilotVisible: true,
    copilotMessages: (() => {
      const persisted = loadPersistedMessages()
      return persisted.length > 0 ? persisted : [{ ...WELCOME_MESSAGE, timestamp: Date.now() }]
    })(),
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

/**
 * Initial state for the store at first creation. Merges any persisted draft
 * over empty defaults so a refreshed app reopens to the user's in-progress
 * work. After explicit `resetForm()` calls, draft is cleared and never
 * restored — that path uses `emptyDefaults()` directly.
 */
function initialState(): DefaultsShape {
  const empty = emptyDefaults()
  const draft = loadDraft()
  if (!draft) return empty
  return {
    ...empty,
    title: draft.title ?? empty.title,
    repo: draft.repo ?? empty.repo,
    priority: draft.priority ?? empty.priority,
    spec: draft.spec ?? empty.spec,
    dependsOn: draft.dependsOn ?? empty.dependsOn,
    playgroundEnabled: draft.playgroundEnabled ?? empty.playgroundEnabled,
    maxCostUsd: draft.maxCostUsd ?? empty.maxCostUsd,
    model: draft.model ?? empty.model,
    crossRepoContract: draft.crossRepoContract ?? empty.crossRepoContract,
    specType: draft.specType ?? empty.specType
  }
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useTaskWorkbenchStore = create<TaskWorkbenchState>((set) => ({
  ...initialState(),

  setField: (field, value) => set({ [field]: value } as Partial<TaskWorkbenchState>),

  setSpecType: (type) => set({ specType: type }),

  resetForm: () => {
    if (draftSaveTimer) {
      clearTimeout(draftSaveTimer)
      draftSaveTimer = null
    }
    clearDraftStorage()
    set(emptyDefaults())
  },

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
      maxCostUsd: task.max_cost_usd ?? null,
      model: task.model ?? '',
      specType: (task.spec_type as SpecType) ?? null,
      crossRepoContract: task.cross_repo_contract ?? null,
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

// Persist copilot messages to localStorage on change
useTaskWorkbenchStore.subscribe((state, prev) => {
  if (state.copilotMessages !== prev.copilotMessages && !state.streamingMessageId) {
    persistMessages(state.copilotMessages)
  }
  if (state.advancedOpen !== prev.advancedOpen) {
    persistAdvancedOpen(state.advancedOpen)
  }
})

// Debounced draft persistence — only when in create mode (edit mode mutations
// shouldn't pollute the create-mode draft).
let draftSaveTimer: ReturnType<typeof setTimeout> | null = null
const DRAFT_FIELDS: Array<keyof TaskWorkbenchState> = [
  'title',
  'repo',
  'priority',
  'spec',
  'dependsOn',
  'playgroundEnabled',
  'maxCostUsd',
  'model',
  'crossRepoContract',
  'specType'
]

useTaskWorkbenchStore.subscribe((state, prev) => {
  if (state.mode !== 'create') return
  // Only save when one of the persisted fields actually changed.
  const changed = DRAFT_FIELDS.some((k) => state[k] !== prev[k])
  if (!changed) return

  if (draftSaveTimer) clearTimeout(draftSaveTimer)
  draftSaveTimer = setTimeout(() => {
    const snapshot: PersistedDraft = {
      title: state.title,
      repo: state.repo,
      priority: state.priority,
      spec: state.spec,
      dependsOn: state.dependsOn,
      playgroundEnabled: state.playgroundEnabled,
      maxCostUsd: state.maxCostUsd,
      model: state.model,
      crossRepoContract: state.crossRepoContract,
      specType: state.specType
    }
    if (draftHasContent(snapshot)) {
      persistDraft(snapshot)
    } else {
      // Empty form → clear any stale draft.
      clearDraftStorage()
    }
  }, DRAFT_SAVE_DEBOUNCE_MS)
})
