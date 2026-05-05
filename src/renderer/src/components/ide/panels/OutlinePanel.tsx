import type * as monaco from 'monaco-editor'
import { Filter, ArrowUpDown } from 'lucide-react'
import { PanelHeader } from '../PanelHeader'
import { IconBtn } from '../IconBtn'

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface OutlinePanelProps {
  editorRef: React.RefObject<monaco.editor.IStandaloneCodeEditor | null>
  activeFilePath: string | null
}

// ---------------------------------------------------------------------------
// OutlinePanel
// ---------------------------------------------------------------------------

/**
 * Displays the document symbol outline for the active file.
 *
 * TODO(phase-6.5): Wire Monaco document symbol provider.
 * The public monaco-editor API does not expose getDocumentSymbols() directly.
 * Options:
 *   (1) editor.getAction('editor.action.quickOutline') — opens a picker, not embeddable.
 *   (2) monaco.languages.registerDocumentSymbolProvider() — inject a custom provider
 *       that caches results and exposes them via a side-channel ref.
 *   (3) Call the LSP symbol provider if one is registered for the current language.
 * For now the panel renders the correct skeleton structure but shows an empty state.
 */
export function OutlinePanel({ activeFilePath }: OutlinePanelProps): React.JSX.Element {
  const activeFilename = activeFilePath ? activeFilePath.split('/').pop() ?? null : null
  const eyebrow = activeFilename ? `OUTLINE — ${activeFilename}` : 'OUTLINE'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <PanelHeader eyebrow={eyebrow}>
        <IconBtn
          icon={<Filter size={14} />}
          title="Filter"
          onClick={() => {}}
        />
        <IconBtn
          icon={<ArrowUpDown size={14} />}
          title="Sort"
          onClick={() => {}}
        />
      </PanelHeader>

      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          scrollbarWidth: 'thin',
          scrollbarColor: 'var(--line) transparent'
        }}
      >
        {activeFilePath ? <NoSymbolsState /> : <NoFileOpenState />}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Empty states
// ---------------------------------------------------------------------------

function NoSymbolsState(): React.JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        gap: 'var(--s-2)',
        padding: 'var(--s-5)',
        textAlign: 'center'
      }}
    >
      <span className="fleet-eyebrow">NO OUTLINE</span>
      <span style={{ fontSize: 'var(--t-sm)', color: 'var(--fg-3)' }}>
        Symbol outline coming in a future update.
      </span>
    </div>
  )
}

function NoFileOpenState(): React.JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        gap: 'var(--s-2)',
        padding: 'var(--s-5)',
        textAlign: 'center'
      }}
    >
      <span className="fleet-eyebrow">NO FILE OPEN</span>
      <span style={{ fontSize: 'var(--t-sm)', color: 'var(--fg-3)' }}>
        Open a file to see its outline.
      </span>
    </div>
  )
}
