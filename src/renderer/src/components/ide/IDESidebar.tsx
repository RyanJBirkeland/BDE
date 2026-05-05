import type * as monaco from 'monaco-editor'
import type { ActivityMode } from './ActivityRail'
import { FilesPanel } from './panels/FilesPanel'
import { SearchPanel } from './panels/SearchPanel'
import { ScmPanel } from './panels/ScmPanel'
import { OutlinePanel } from './panels/OutlinePanel'
import { AgentsOnTreePanel } from './panels/AgentsOnTreePanel'

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface IDESidebarProps {
  activity: ActivityMode
  activeFilePath: string | null
  onOpenFile: (path: string) => void
  open: boolean
  rootPath?: string | null
  editorRef?: React.RefObject<monaco.editor.IStandaloneCodeEditor | null>
  onAgentClick?: (agentId: string) => void
}

// ---------------------------------------------------------------------------
// IDESidebar
// ---------------------------------------------------------------------------

export function IDESidebar({
  activity,
  activeFilePath,
  onOpenFile,
  open,
  rootPath = null,
  editorRef,
  onAgentClick
}: IDESidebarProps): React.JSX.Element | null {
  if (!open) return null

  return (
    <div
      style={{
        width: 240,
        flexShrink: 0,
        background: 'var(--surf-1)',
        borderRight: '1px solid var(--line)',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        overflow: 'hidden'
      }}
    >
      {activity === 'files' && (
        <FilesPanel activeFilePath={activeFilePath} onOpenFile={onOpenFile} />
      )}
      {activity === 'search' && <SearchPanel />}
      {activity === 'scm' && <ScmPanel rootPath={rootPath} />}
      {activity === 'outline' && (
        <OutlinePanel
          editorRef={editorRef ?? { current: null }}
          activeFilePath={activeFilePath}
        />
      )}
      {activity === 'agents' && (
        <AgentsOnTreePanel
          rootPath={rootPath}
          onAgentClick={onAgentClick ?? (() => {})}
        />
      )}
    </div>
  )
}
