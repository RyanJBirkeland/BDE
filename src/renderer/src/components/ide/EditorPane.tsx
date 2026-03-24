import { useEffect, useRef } from 'react'
import MonacoEditor, { loader } from '@monaco-editor/react'
import type * as Monaco from 'monaco-editor'
import { useThemeStore } from '../../stores/theme'
import { getMonacoTheme, getLightMonacoTheme } from '../../lib/monaco-theme'

loader.config({ paths: { vs: undefined as unknown as string } })

export interface EditorPaneProps {
  filePath: string | null
  content: string | null
  language: string
  onContentChange?: (content: string) => void
  onSave?: () => void
}

export function EditorPane({
  filePath, content, language, onContentChange, onSave,
}: EditorPaneProps): React.JSX.Element {
  const theme = useThemeStore((s) => s.theme)
  const monacoRef = useRef<typeof Monaco | null>(null)

  useEffect(() => {
    if (!monacoRef.current) return
    const monaco = monacoRef.current
    if (theme === 'light') {
      monaco.editor.defineTheme('bde-light', getLightMonacoTheme())
      monaco.editor.setTheme('bde-light')
    } else {
      monaco.editor.defineTheme('bde-dark', getMonacoTheme())
      monaco.editor.setTheme('bde-dark')
    }
  }, [theme])

  if (!filePath || content === null) {
    return <div className="ide-editor-empty">Open a file from the sidebar to start editing</div>
  }

  function handleBeforeMount(monaco: typeof Monaco): void {
    monacoRef.current = monaco
    monaco.editor.defineTheme('bde-dark', getMonacoTheme())
    monaco.editor.defineTheme('bde-light', getLightMonacoTheme())
  }

  function handleMount(editor: Monaco.editor.IStandaloneCodeEditor, monaco: typeof Monaco): void {
    monacoRef.current = monaco
    monaco.editor.setTheme(theme === 'light' ? 'bde-light' : 'bde-dark')
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => { onSave?.() })
  }

  function handleChange(value: string | undefined): void {
    if (value !== undefined) onContentChange?.(value)
  }

  return (
    <MonacoEditor
      height="100%" width="100%" language={language} value={content}
      theme={theme === 'light' ? 'bde-light' : 'bde-dark'}
      beforeMount={handleBeforeMount} onMount={handleMount} onChange={handleChange}
      options={{ fontSize: 13, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
        minimap: { enabled: true }, automaticLayout: true, tabSize: 2,
        bracketPairColorization: { enabled: true }, scrollBeyondLastLine: false, wordWrap: 'off' }}
    />
  )
}
