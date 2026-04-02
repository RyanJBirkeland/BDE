import { useEffect, useState } from 'react'
import { useCodeReviewStore } from '../../stores/codeReview'
import { useSprintTasks } from '../../stores/sprintTasks'
import { Plus, Minus, Edit2 } from 'lucide-react'

export function ChangesTab(): React.JSX.Element {
  const selectedTaskId = useCodeReviewStore((s) => s.selectedTaskId)
  const diffFiles = useCodeReviewStore((s) => s.diffFiles)
  const setDiffFiles = useCodeReviewStore((s) => s.setDiffFiles)
  const setLoading = useCodeReviewStore((s) => s.setLoading)
  const loading = useCodeReviewStore((s) => s.loading)
  const tasks = useSprintTasks((s) => s.tasks)

  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [fileDiff, setFileDiff] = useState<string>('')

  const task = tasks.find((t) => t.id === selectedTaskId)

  // Load file list on task selection
  useEffect(() => {
    if (!task?.worktree_path) return
    setLoading('diff', true)
    window.api.review
      .getDiff({ worktreePath: task.worktree_path, base: 'main' })
      .then((result) => {
        setDiffFiles(result.files)
        if (result.files.length > 0) setSelectedFile(result.files[0].path)
      })
      .catch(() => setDiffFiles([]))
      .finally(() => setLoading('diff', false))
  }, [task?.worktree_path, task?.id, setDiffFiles, setLoading])

  // Load file diff when selection changes
  useEffect(() => {
    if (!task?.worktree_path || !selectedFile) return
    window.api.review
      .getFileDiff({
        worktreePath: task.worktree_path,
        filePath: selectedFile,
        base: 'main'
      })
      .then((result) => setFileDiff(result.diff))
      .catch(() => setFileDiff('Failed to load diff'))
  }, [task?.worktree_path, selectedFile])

  if (loading.diff) {
    return <div className="cr-placeholder">Loading changes...</div>
  }

  if (diffFiles.length === 0) {
    return <div className="cr-placeholder">No changes found</div>
  }

  const statusIcon = (status: string): React.JSX.Element => {
    if (status === 'A' || status === 'added')
      return <Plus size={12} className="cr-file-added" />
    if (status === 'D' || status === 'deleted')
      return <Minus size={12} className="cr-file-deleted" />
    return <Edit2 size={12} className="cr-file-modified" />
  }

  return (
    <div className="cr-changes">
      <div className="cr-changes__files">
        {diffFiles.map((file) => (
          <button
            key={file.path}
            className={`cr-changes__file${file.path === selectedFile ? ' cr-changes__file--selected' : ''}`}
            onClick={() => setSelectedFile(file.path)}
          >
            {statusIcon(file.status)}
            <span className="cr-changes__file-path">{file.path}</span>
            <span className="cr-changes__file-stats">
              +{file.additions} -{file.deletions}
            </span>
          </button>
        ))}
      </div>
      <div className="cr-changes__diff">
        <pre className="cr-changes__diff-content">
          {fileDiff || 'Select a file to view diff'}
        </pre>
      </div>
    </div>
  )
}
