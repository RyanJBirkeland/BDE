import { useCallback, useRef, useEffect } from 'react'
import { useTaskWorkbenchStore } from '../stores/taskWorkbench'
import { useTaskWorkbenchValidation } from '../stores/taskWorkbenchValidation'
import { useSprintTasks, type CreateTicketInput } from '../stores/sprintTasks'
import { useSprintTaskActions } from './useSprintTaskActions'
import type { TaskDependency } from '../../../shared/types'
import type { SpecType } from '../../../shared/spec-validation'

export interface TaskCreationFormData {
  title: string
  repo: string
  priority: number
  spec: string
  specType: SpecType | null
  dependsOn: TaskDependency[]
  playgroundEnabled: boolean
  maxCostUsd: number | null
  model: string
  pendingGroupId: string | null
  crossRepoContract: string | null
}

interface UseTaskCreationProps {
  mode: 'create' | 'edit'
  taskId: string | null
  formData: TaskCreationFormData
}

export interface SaveResult {
  /** 'ok' = task was created/updated; 'blocked' = op check failed; 'confirm' = warnings need confirmation */
  outcome: 'ok' | 'blocked' | 'confirm'
  confirmMessage?: string | undefined
}

export interface UseTaskCreationResult {
  /**
   * Save the task with the given target status. Runs operational checks if
   * targetStatus is 'queued'. Returns a SaveResult describing the outcome.
   * Does NOT call resetForm — caller is responsible for that.
   */
  save: (targetStatus: 'backlog' | 'queued') => Promise<SaveResult>
  /**
   * Directly create/update the task without running checks. Used when the
   * user has already confirmed warnings in the confirmation modal.
   */
  saveConfirmed: (targetStatus: 'backlog' | 'queued') => Promise<void>
}

/**
 * Encapsulates task creation/update logic with stable refs to avoid stale
 * closures. formData is kept fresh via useEffect so the stable save callback
 * always reads the latest values from formDataRef.current.
 */
export function useTaskCreation({
  mode,
  taskId,
  formData
}: UseTaskCreationProps): UseTaskCreationResult {
  const formDataRef = useRef(formData)
  const modeRef = useRef(mode)
  const taskIdRef = useRef(taskId)

  // Keep refs fresh on every render
  useEffect(() => {
    formDataRef.current = formData
  })
  useEffect(() => {
    modeRef.current = mode
  })
  useEffect(() => {
    taskIdRef.current = taskId
  })

  const updateTask = useSprintTasks((s) => s.updateTask)
  const updateTaskRef = useRef(updateTask)
  useEffect(() => {
    updateTaskRef.current = updateTask
  })

  const { createTask } = useSprintTaskActions()
  const createTaskRef = useRef(createTask)
  useEffect(() => {
    createTaskRef.current = createTask
  })

  const setOperationalChecks = useTaskWorkbenchValidation((s) => s.setOperationalChecks)
  const setOperationalChecksRef = useRef(setOperationalChecks)
  useEffect(() => {
    setOperationalChecksRef.current = setOperationalChecks
  })

  const structuralChecks = useTaskWorkbenchValidation((s) => s.structuralChecks)
  const semanticChecks = useTaskWorkbenchValidation((s) => s.semanticChecks)
  const checksRef = useRef({ structural: structuralChecks, semantic: semanticChecks })
  useEffect(() => {
    checksRef.current = { structural: structuralChecks, semantic: semanticChecks }
  }, [structuralChecks, semanticChecks])

  /**
   * Core create/update — reads all form data from ref so it is always fresh.
   */
  const applyTask = useCallback(async (targetStatus: 'backlog' | 'queued'): Promise<void> => {
    const {
      title,
      repo,
      priority,
      spec,
      specType,
      dependsOn,
      playgroundEnabled,
      maxCostUsd,
      model,
      pendingGroupId,
      crossRepoContract
    } = formDataRef.current
    const currentMode = modeRef.current
    const currentTaskId = taskIdRef.current

    if (currentMode === 'edit' && currentTaskId) {
      await updateTaskRef.current(currentTaskId, {
        title,
        repo,
        priority,
        spec,
        depends_on: dependsOn.length > 0 ? dependsOn : null,
        status: targetStatus,
        ...(playgroundEnabled ? { playground_enabled: playgroundEnabled } : {}),
        ...(maxCostUsd !== null && maxCostUsd !== undefined ? { max_cost_usd: maxCostUsd } : {}),
        ...(model ? { model } : {}),
        ...(specType ? { spec_type: specType } : {}),
        ...(crossRepoContract ? { cross_repo_contract: crossRepoContract } : {})
      })
    } else {
      const input: CreateTicketInput = {
        title,
        repo,
        prompt: title,
        spec,
        priority,
        depends_on: dependsOn.length > 0 ? dependsOn : undefined,
        playground_enabled: playgroundEnabled || undefined,
        max_cost_usd: maxCostUsd ?? undefined,
        model: model || undefined,
        spec_type: specType ?? undefined,
        group_id: pendingGroupId ?? undefined,
        cross_repo_contract: crossRepoContract || undefined
      }
      const createdId = await createTaskRef.current(input)
      // createTask hardcodes status=backlog. If queuing, promote to queued.
      if (targetStatus === 'queued' && createdId) {
        await updateTaskRef.current(createdId, { status: 'queued' })
      }
    }
  }, [])

  const save = useCallback(
    async (targetStatus: 'backlog' | 'queued'): Promise<SaveResult> => {
      if (targetStatus === 'queued') {
        useTaskWorkbenchValidation.setState({ operationalLoading: true })
        const { repo } = formDataRef.current
        const opResult = await window.api.workbench.checkOperational({ repo })
        const opChecks = [
          {
            id: 'auth',
            label: 'Auth',
            tier: 3 as const,
            status: opResult.auth.status,
            message: opResult.auth.message
          },
          {
            id: 'repo-path',
            label: 'Repo Path',
            tier: 3 as const,
            status: opResult.repoPath.status,
            message: opResult.repoPath.message,
            fieldId: 'wb-form-repo'
          },
          {
            id: 'git-clean',
            label: 'Git Clean',
            tier: 3 as const,
            status: opResult.gitClean.status,
            message: opResult.gitClean.message,
            fieldId: 'wb-form-repo'
          },
          {
            id: 'no-conflict',
            label: 'No Conflict',
            tier: 3 as const,
            status: opResult.noConflict.status,
            message: opResult.noConflict.message,
            fieldId: 'wb-form-repo'
          },
          {
            id: 'slots',
            label: 'Agent Slots',
            tier: 3 as const,
            status: opResult.slotsAvailable.status,
            message: opResult.slotsAvailable.message
          }
        ]
        setOperationalChecksRef.current(opChecks)

        // Block if any operational check fails
        if (opChecks.some((c) => c.status === 'fail')) {
          useTaskWorkbenchStore.setState({ checksExpanded: true })
          return { outcome: 'blocked' }
        }

        // Collect ALL warnings: operational + advisory structural/semantic
        const allStructural = checksRef.current.structural
        const allSemantic = checksRef.current.semantic
        const advisoryWarnings = [...allStructural, ...allSemantic].filter(
          (c) => c.status === 'warn'
        )
        const opWarnings = opChecks.filter((c) => c.status === 'warn')
        const allWarnings = [...advisoryWarnings, ...opWarnings]
        if (allWarnings.length > 0) {
          const lines = allWarnings.map((c) => `• ${c.label}: ${c.message}`)
          useTaskWorkbenchStore.setState({ checksExpanded: true })
          return {
            outcome: 'confirm',
            confirmMessage: `The following checks have warnings:\n\n${lines.join('\n')}\n\nQueue anyway?`
          }
        }
      }

      await applyTask(targetStatus)
      return { outcome: 'ok' }
    },
    [applyTask]
  )

  const saveConfirmed = useCallback(
    async (targetStatus: 'backlog' | 'queued'): Promise<void> => {
      await applyTask(targetStatus)
    },
    [applyTask]
  )

  return { save, saveConfirmed }
}
