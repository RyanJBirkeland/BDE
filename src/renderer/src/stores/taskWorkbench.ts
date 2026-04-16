import { create } from 'zustand'
import type { SprintTask, TaskDependency } from '../../../shared/types'
import type { SpecType } from '../../../shared/spec-validation'
import { createDebouncedPersister } from '../lib/createDebouncedPersister'
import { useTaskWorkbenchValidation } from './taskWorkbenchValidation'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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

  // --- Dirty state tracking ---
  originalSnapshot: PersistedDraft | null

  // --- Validation UI (expanded state only; check data lives in taskWorkbenchValidation) ---
  checksExpanded: boolean

  // --- Actions ---
  setField: (field: string, value: unknown) => void
  setSpecType: (type: SpecType | null) => void
  resetForm: () => void
  loadTask: (task: SprintTask) => void
  toggleChecksExpanded: () => void
  /** @deprecated Import from useTaskWorkbenchValidation instead */
  setStructuralChecks: (checks: CheckResult[]) => void
  /** @deprecated Import from useTaskWorkbenchValidation instead */
  setSemanticChecks: (checks: CheckResult[]) => void
  /** @deprecated Import from useTaskWorkbenchValidation instead */
  setOperationalChecks: (checks: CheckResult[]) => void
  isDirty: () => boolean
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const ADVANCED_OPEN_STORAGE_KEY = 'bde:workbench-advanced-open'
const DRAFT_STORAGE_KEY = 'bde:workbench-draft'
const DRAFT_SAVE_DEBOUNCE_MS = 500

export interface PersistedDraft {
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
  } catch (err) {
    console.error('Failed to load advanced open state:', err)
    return false
  }
}

function persistAdvancedOpen(open: boolean): void {
  try {
    localStorage.setItem(ADVANCED_OPEN_STORAGE_KEY, open ? 'true' : 'false')
  } catch (err) {
    console.error('Failed to persist advanced open state:', err)
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

export function loadDraft(): Partial<PersistedDraft> | null {
  try {
    const raw = localStorage.getItem(DRAFT_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object') return parsed as Partial<PersistedDraft>
  } catch (err) {
    console.error('Failed to load draft from localStorage:', err)
  }
  return null
}

export function persistDraft(draft: PersistedDraft): void {
  try {
    localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft))
  } catch (err) {
    console.error('Failed to persist draft to localStorage:', err)
  }
}

export function clearDraftStorage(): void {
  try {
    localStorage.removeItem(DRAFT_STORAGE_KEY)
  } catch (err) {
    console.error('Failed to clear draft storage:', err)
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
  | 'originalSnapshot'
  | 'checksExpanded'
>

function emptyDefaults(): DefaultsShape {
  return {
    mode: 'create',
    taskId: null,
    title: '',
    repo: '',
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
    originalSnapshot: null,
    checksExpanded: false
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
// Debounced draft persister (declared before store so resetForm can cancel it)
// ---------------------------------------------------------------------------

let lastDraftToSave: PersistedDraft | null = null
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

const [debouncedPersistDraft, cancelDraftPersist] = createDebouncedPersister<PersistedDraft>(
  (snapshot) => {
    if (draftHasContent(snapshot)) {
      persistDraft(snapshot)
    } else {
      // Empty form → clear any stale draft.
      clearDraftStorage()
    }
  },
  DRAFT_SAVE_DEBOUNCE_MS
)

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useTaskWorkbenchStore = create<TaskWorkbenchState>((set) => ({
  ...initialState(),

  setField: (field, value) => set({ [field]: value } as Partial<TaskWorkbenchState>),

  setSpecType: (type) => set({ specType: type }),

  resetForm: () => {
    cancelDraftPersist()
    clearDraftStorage()
    set(emptyDefaults())
  },

  loadTask: (task) => {
    const snapshot: PersistedDraft = {
      title: task.title,
      repo: task.repo,
      priority: task.priority,
      spec: task.spec ?? '',
      dependsOn: task.depends_on ?? [],
      playgroundEnabled: task.playground_enabled ?? false,
      maxCostUsd: task.max_cost_usd ?? null,
      model: task.model ?? '',
      specType: (task.spec_type as SpecType) ?? null,
      crossRepoContract: task.cross_repo_contract ?? null
    }
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
      originalSnapshot: snapshot
    })
    // Clear stale validation checks from prior editing session
    useTaskWorkbenchValidation.setState({ semanticChecks: [], operationalChecks: [] })
  },

  toggleChecksExpanded: () => set((s) => ({ checksExpanded: !s.checksExpanded })),

  // Thin wrappers — delegate to the focused validation store
  setStructuralChecks: (checks) => useTaskWorkbenchValidation.getState().setStructuralChecks(checks),
  setSemanticChecks: (checks) => useTaskWorkbenchValidation.getState().setSemanticChecks(checks),
  setOperationalChecks: (checks) => useTaskWorkbenchValidation.getState().setOperationalChecks(checks),

  isDirty: () => {
    const state = useTaskWorkbenchStore.getState()
    const { originalSnapshot } = state

    // No original snapshot = pristine create mode
    if (!originalSnapshot) return false

    const current: PersistedDraft = {
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

    return (
      current.title !== originalSnapshot.title ||
      current.repo !== originalSnapshot.repo ||
      current.priority !== originalSnapshot.priority ||
      current.spec !== originalSnapshot.spec ||
      current.playgroundEnabled !== originalSnapshot.playgroundEnabled ||
      current.maxCostUsd !== originalSnapshot.maxCostUsd ||
      current.model !== originalSnapshot.model ||
      current.crossRepoContract !== originalSnapshot.crossRepoContract ||
      current.specType !== originalSnapshot.specType ||
      JSON.stringify(current.dependsOn) !== JSON.stringify(originalSnapshot.dependsOn)
    )
  }
}))

// Persist advancedOpen to localStorage on change
useTaskWorkbenchStore.subscribe((state, prev) => {
  if (state.advancedOpen !== prev.advancedOpen) {
    persistAdvancedOpen(state.advancedOpen)
  }
})

// Debounced draft subscriber — only active in create mode (edit mode mutations
// shouldn't pollute the create-mode draft).
function flushDraftPersistence(): void {
  cancelDraftPersist()
  if (lastDraftToSave) {
    if (draftHasContent(lastDraftToSave)) {
      persistDraft(lastDraftToSave)
    } else {
      clearDraftStorage()
    }
  }
}

useTaskWorkbenchStore.subscribe((state, prev) => {
  if (state.mode !== 'create') return
  // Only save when one of the persisted fields actually changed.
  const changed = DRAFT_FIELDS.some((k) => state[k] !== prev[k])
  if (!changed) return

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
  lastDraftToSave = snapshot
  debouncedPersistDraft(snapshot)
})

// Flush pending draft persistence on window close/reload
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', flushDraftPersistence)
}
