import { Code, FolderOpen } from 'lucide-react'
import { useIDEStore } from '../../stores/ide'

export interface IDEEmptyStateProps {
  onOpenFolder: () => void
}

export function IDEEmptyState({ onOpenFolder }: IDEEmptyStateProps): React.JSX.Element {
  const recentFolders = useIDEStore((s) => s.recentFolders)
  const setRootPath = useIDEStore((s) => s.setRootPath)

  async function handleRecentFolder(folderPath: string): Promise<void> {
    setRootPath(folderPath)
    await window.api.watchDir(folderPath)
  }

  return (
    <div className="ide-empty-state">
      <Code size={48} className="ide-empty-state__icon" />
      <h1 className="ide-empty-state__title">BDE IDE</h1>
      <p className="ide-empty-state__subtitle">Open a folder to start editing</p>
      <div className="ide-empty-state__actions">
        <button className="ide-empty-state__open-btn" onClick={onOpenFolder}>
          <FolderOpen size={16} /> Open Folder
        </button>
      </div>
      {recentFolders.length > 0 && (
        <div className="ide-empty-state__recent">
          <span className="ide-empty-state__recent-label">Recent</span>
          {recentFolders.map((folder) => (
            <button
              key={folder}
              className="ide-empty-state__recent-item"
              onClick={() => void handleRecentFolder(folder)}
              title={folder}
            >
              {folder}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
