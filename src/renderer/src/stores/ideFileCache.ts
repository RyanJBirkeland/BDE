import { create } from 'zustand'

interface IDEFileCacheState {
  fileContents: Record<string, string>
  fileLoadingStates: Record<string, boolean>

  setFileContent: (path: string, content: string) => void
  setFileLoading: (path: string, loading: boolean) => void
  clearFileContent: (path: string) => void
  clearAll: () => void
}

export const useIDEFileCache = create<IDEFileCacheState>((set) => ({
  fileContents: {},
  fileLoadingStates: {},

  setFileContent: (path, content) =>
    set((s) => ({ fileContents: { ...s.fileContents, [path]: content } })),

  setFileLoading: (path, loading) =>
    set((s) => ({ fileLoadingStates: { ...s.fileLoadingStates, [path]: loading } })),

  clearFileContent: (path) =>
    set((s) => {
      const { [path]: _c, ...contents } = s.fileContents
      const { [path]: _l, ...loading } = s.fileLoadingStates
      return { fileContents: contents, fileLoadingStates: loading }
    }),

  clearAll: () => set({ fileContents: {}, fileLoadingStates: {} })
}))
