import { Map, WrapText, Minus, Plus } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useIDEStore } from '../../stores/ide'
import './EditorToolbar.css'

export function EditorToolbar(): React.JSX.Element {
  const {
    minimapEnabled,
    wordWrapEnabled,
    fontSize,
    toggleMinimap,
    toggleWordWrap,
    increaseFontSize,
    decreaseFontSize
  } = useIDEStore(
    useShallow((s) => ({
      minimapEnabled: s.minimapEnabled,
      wordWrapEnabled: s.wordWrapEnabled,
      fontSize: s.fontSize,
      toggleMinimap: s.toggleMinimap,
      toggleWordWrap: s.toggleWordWrap,
      increaseFontSize: s.increaseFontSize,
      decreaseFontSize: s.decreaseFontSize
    }))
  )

  return (
    <div className="editor-toolbar">
      <button
        className={`editor-toolbar__btn ${minimapEnabled ? 'editor-toolbar__btn--active' : ''}`}
        onClick={toggleMinimap}
        title="Toggle minimap"
        aria-label="Toggle minimap"
        aria-pressed={minimapEnabled}
      >
        <Map size={14} />
      </button>
      <button
        className={`editor-toolbar__btn ${wordWrapEnabled ? 'editor-toolbar__btn--active' : ''}`}
        onClick={toggleWordWrap}
        title="Toggle word wrap"
        aria-label="Toggle word wrap"
        aria-pressed={wordWrapEnabled}
      >
        <WrapText size={14} />
      </button>
      <div className="editor-toolbar__divider" />
      <button
        className="editor-toolbar__btn"
        onClick={decreaseFontSize}
        disabled={fontSize <= 10}
        title="Decrease font size"
        aria-label="Decrease font size"
      >
        <Minus size={14} />
      </button>
      <span className="editor-toolbar__font-size">{fontSize}</span>
      <button
        className="editor-toolbar__btn"
        onClick={increaseFontSize}
        disabled={fontSize >= 24}
        title="Increase font size"
        aria-label="Increase font size"
      >
        <Plus size={14} />
      </button>
    </div>
  )
}
