import { create } from 'zustand'

export type PipelineDensity = 'card' | 'compact'

export interface OrphanRecoveryBanner {
  recovered: string[]
  exhausted: string[]
}

interface SprintUIState {
  doneViewOpen: boolean
  conflictDrawerOpen: boolean
  healthCheckDrawerOpen: boolean
  quickCreateOpen: boolean
  pipelineDensity: PipelineDensity
  generatingIds: string[]
  orphanRecoveryBanner: OrphanRecoveryBanner | null

  setDoneViewOpen: (open: boolean) => void
  setConflictDrawerOpen: (open: boolean) => void
  setHealthCheckDrawerOpen: (open: boolean) => void
  setQuickCreateOpen: (open: boolean) => void
  toggleQuickCreate: () => void
  setPipelineDensity: (density: PipelineDensity) => void
  setGeneratingIds: (updater: (prev: string[]) => string[]) => void
  addGeneratingId: (id: string) => void
  removeGeneratingId: (id: string) => void
  setOrphanRecoveryBanner: (banner: OrphanRecoveryBanner | null) => void
}

export const selectDoneViewOpen = (s: SprintUIState): boolean => s.doneViewOpen
export const selectConflictDrawerOpen = (s: SprintUIState): boolean => s.conflictDrawerOpen
export const selectHealthCheckDrawerOpen = (s: SprintUIState): boolean => s.healthCheckDrawerOpen
export const selectQuickCreateOpen = (s: SprintUIState): boolean => s.quickCreateOpen
export const selectPipelineDensity = (s: SprintUIState): PipelineDensity => s.pipelineDensity
export const selectGeneratingIds = (s: SprintUIState): string[] => s.generatingIds
export const selectOrphanRecoveryBanner = (s: SprintUIState): OrphanRecoveryBanner | null =>
  s.orphanRecoveryBanner

export const selectIsGenerating =
  (taskId: string) =>
  (s: SprintUIState): boolean =>
    s.generatingIds.includes(taskId)

export const useSprintUI = create<SprintUIState>((set) => ({
  doneViewOpen: false,
  conflictDrawerOpen: false,
  healthCheckDrawerOpen: false,
  quickCreateOpen: false,
  pipelineDensity: 'card',
  generatingIds: [],
  orphanRecoveryBanner: null,

  setDoneViewOpen: (open): void => set({ doneViewOpen: open }),
  setConflictDrawerOpen: (open): void => set({ conflictDrawerOpen: open }),
  setHealthCheckDrawerOpen: (open): void => set({ healthCheckDrawerOpen: open }),
  setQuickCreateOpen: (open): void => set({ quickCreateOpen: open }),
  toggleQuickCreate: (): void => set((s) => ({ quickCreateOpen: !s.quickCreateOpen })),
  setPipelineDensity: (density): void => set({ pipelineDensity: density }),
  setGeneratingIds: (updater): void => {
    set((s) => ({ generatingIds: updater(s.generatingIds) }))
  },
  addGeneratingId: (id): void => {
    set((s) => ({
      generatingIds: s.generatingIds.includes(id) ? s.generatingIds : [...s.generatingIds, id]
    }))
  },
  removeGeneratingId: (id): void => {
    set((s) => ({ generatingIds: s.generatingIds.filter((gid) => gid !== id) }))
  },
  setOrphanRecoveryBanner: (banner): void => set({ orphanRecoveryBanner: banner })
}))
