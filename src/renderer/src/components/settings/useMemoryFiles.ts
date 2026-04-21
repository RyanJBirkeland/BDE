import { useCallback, useEffect, useState } from 'react'
import { toast } from '../../stores/toasts'
import * as memoryService from '../../services/memory'

export interface MemoryFile {
  path: string
  name: string
  size: number
  modifiedAt: number
}

export function useMemoryFiles(): {
  files: MemoryFile[]
  loadingFiles: boolean
  activeFiles: Record<string, boolean>
  loadFiles: () => Promise<void>
  loadActiveFiles: () => Promise<void>
  saveFile: (path: string, content: string) => Promise<void>
  createFile: (name: string, onCreated: (path: string) => void) => Promise<void>
  toggleActive: (path: string) => Promise<void>
} {
  const [files, setFiles] = useState<MemoryFile[]>([])
  const [loadingFiles, setLoadingFiles] = useState(true)
  const [activeFiles, setActiveFiles] = useState<Record<string, boolean>>({})

  const loadFiles = useCallback(async () => {
    try {
      const result = await memoryService.listFiles()
      setFiles(result)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load memory files')
    } finally {
      setLoadingFiles(false)
    }
  }, [])

  const loadActiveFiles = useCallback(async () => {
    try {
      const result = await memoryService.getActiveFiles()
      setActiveFiles(result)
    } catch {
      // Silently fall back — active state is non-critical
    }
  }, [])

  useEffect(() => {
    loadFiles()
    loadActiveFiles()
  }, [loadFiles, loadActiveFiles])

  const saveFile = useCallback(async (path: string, content: string) => {
    try {
      await memoryService.writeFile(path, content)
      toast.success('File saved')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to save file')
    }
  }, [])

  const createFile = useCallback(
    async (name: string, onCreated: (path: string) => void) => {
      const path = name.endsWith('.md') ? name : `${name}.md`
      try {
        await memoryService.writeFile(path, '')
        await loadFiles()
        onCreated(path)
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Failed to create file')
      }
    },
    [loadFiles]
  )

  const toggleActive = useCallback(
    async (path: string) => {
      const newActive = !activeFiles[path]
      try {
        const updated = await memoryService.setFileActive(path, newActive)
        setActiveFiles(updated)
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Failed to toggle')
      }
    },
    [activeFiles]
  )

  return {
    files,
    loadingFiles,
    activeFiles,
    loadFiles,
    loadActiveFiles,
    saveFile,
    createFile,
    toggleActive
  }
}
