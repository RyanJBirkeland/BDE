import { useState, useEffect, useCallback } from 'react'
import type { LineRange } from '../components/diff/DiffViewer'

interface DiffSelectionState {
  selectionStart: { file: string; line: number; side: 'LEFT' | 'RIGHT' } | null
  isSelecting: boolean
  setSelectionStart: (v: { file: string; line: number; side: 'LEFT' | 'RIGHT' } | null) => void
  setIsSelecting: (v: boolean) => void
  isLineSelected: (
    filePath: string,
    lineNo: number | undefined,
    selectedRange: LineRange | null
  ) => boolean
}

export function useDiffSelection(): DiffSelectionState {
  const [selectionStart, setSelectionStart] = useState<{
    file: string
    line: number
    side: 'LEFT' | 'RIGHT'
  } | null>(null)
  const [isSelecting, setIsSelecting] = useState(false)

  useEffect(() => {
    const handleMouseUp = (): void => setIsSelecting(false)
    window.addEventListener('mouseup', handleMouseUp)
    return () => window.removeEventListener('mouseup', handleMouseUp)
  }, [])

  const isLineSelected = useCallback(
    (filePath: string, lineNo: number | undefined, selectedRange: LineRange | null): boolean => {
      if (!selectedRange || !lineNo) return false
      return (
        selectedRange.file === filePath &&
        lineNo >= selectedRange.startLine &&
        lineNo <= selectedRange.endLine
      )
    },
    []
  )

  return {
    selectionStart,
    isSelecting,
    setSelectionStart,
    setIsSelecting,
    isLineSelected
  }
}
