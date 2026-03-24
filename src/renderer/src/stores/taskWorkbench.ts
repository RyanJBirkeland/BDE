import { create } from 'zustand'
import type { SprintTask } from '../../../shared/types'

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

  // --- Copilot ---
  copilotVisible: boolean
  copilotMessages: CopilotMessage[]
  copilotLoading: boolean

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
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const WELCOME_MESSAGE: CopilotMessage = {
  id: 'welcome',
  role: 'system',
  content:
    'I can help you craft this task. Try asking me to research the codebase, brainstorm approaches, or review your spec.',
  timestamp: Date.now(),
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
  | 'copilotVisible'
  | 'copilotMessages'
  | 'copilotLoading'
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
    copilotVisible: true,
    copilotMessages: [{ ...WELCOME_MESSAGE, timestamp: Date.now() }],
    copilotLoading: false,
    checksExpanded: false,
    structuralChecks: [],
    semanticChecks: [],
    operationalChecks: [],
    semanticLoading: false,
    operationalLoading: false,
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
      copilotMessages: [{ ...WELCOME_MESSAGE, timestamp: Date.now() }],
      semanticChecks: [],
      operationalChecks: [],
    }),

  toggleCopilot: () => set((s) => ({ copilotVisible: !s.copilotVisible })),
  toggleChecksExpanded: () => set((s) => ({ checksExpanded: !s.checksExpanded })),

  setStructuralChecks: (checks) => set({ structuralChecks: checks }),
  setSemanticChecks: (checks) => set({ semanticChecks: checks, semanticLoading: false }),
  setOperationalChecks: (checks) => set({ operationalChecks: checks, operationalLoading: false }),

  addCopilotMessage: (msg) => set((s) => ({ copilotMessages: [...s.copilotMessages, msg] })),

  setCopilotLoading: (loading) => set({ copilotLoading: loading }),
}))
