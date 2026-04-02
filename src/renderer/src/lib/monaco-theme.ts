import type { editor } from 'monaco-editor'

/**
 * Build a Monaco dark theme from the currently-active BDE CSS variables.
 * Must be called after DOM is mounted (uses getComputedStyle).
 */
export function getMonacoTheme(): editor.IStandaloneThemeData {
  const style = getComputedStyle(document.documentElement)
  const get = (v: string): string => style.getPropertyValue(v).trim()

  return {
    base: 'vs-dark',
    inherit: true,
    rules: [],
    colors: {
      'editor.background': get('--bde-bg'),
      'editor.foreground': get('--bde-text'),
      'editor.lineHighlightBackground': get('--bde-surface'),
      'editor.selectionBackground': get('--bde-accent-dim') || get('--bde-accent'),
      'editorCursor.foreground': get('--bde-accent'),
      'editorLineNumber.foreground': get('--bde-text-dim') || get('--bde-text'),
      'editorLineNumber.activeForeground': get('--bde-text'),
      'editorIndentGuide.background': get('--bde-border'),
      'editorIndentGuide.activeBackground': get('--bde-accent'),
      'editorWidget.background': get('--bde-surface'),
      'editorWidget.border': get('--bde-border'),
      'editorSuggestWidget.background': get('--bde-surface'),
      'editorSuggestWidget.border': get('--bde-border'),
      'editorSuggestWidget.selectedBackground': get('--bde-accent'),
      'editorHoverWidget.background': get('--bde-surface'),
      'editorHoverWidget.border': get('--bde-border'),
      'input.background': get('--bde-surface'),
      'input.border': get('--bde-border'),
      'input.foreground': get('--bde-text'),
      focusBorder: get('--bde-accent'),
      'scrollbar.shadow': 'transparent',
      'scrollbarSlider.background': get('--bde-border'),
      'scrollbarSlider.hoverBackground': get('--bde-text-dim') || get('--bde-text'),
      'scrollbarSlider.activeBackground': get('--bde-accent'),
      'minimap.background': get('--bde-bg')
    }
  }
}

/**
 * Build a Monaco light theme from the currently-active BDE CSS variables.
 * Must be called after DOM is mounted (uses getComputedStyle).
 */
export function getLightMonacoTheme(): editor.IStandaloneThemeData {
  const style = getComputedStyle(document.documentElement)
  const get = (v: string): string => style.getPropertyValue(v).trim()

  return {
    base: 'vs',
    inherit: true,
    rules: [],
    colors: {
      'editor.background': get('--bde-bg'),
      'editor.foreground': get('--bde-text'),
      'editor.lineHighlightBackground': get('--bde-surface'),
      'editor.selectionBackground': get('--bde-accent-dim') || get('--bde-accent'),
      'editorCursor.foreground': get('--bde-accent'),
      'editorLineNumber.foreground': get('--bde-text-dim') || get('--bde-text'),
      'editorLineNumber.activeForeground': get('--bde-text'),
      'editorIndentGuide.background': get('--bde-border'),
      'editorIndentGuide.activeBackground': get('--bde-accent'),
      'editorWidget.background': get('--bde-surface'),
      'editorWidget.border': get('--bde-border'),
      'editorSuggestWidget.background': get('--bde-surface'),
      'editorSuggestWidget.border': get('--bde-border'),
      'editorSuggestWidget.selectedBackground': get('--bde-accent'),
      'editorHoverWidget.background': get('--bde-surface'),
      'editorHoverWidget.border': get('--bde-border'),
      'input.background': get('--bde-surface'),
      'input.border': get('--bde-border'),
      'input.foreground': get('--bde-text'),
      focusBorder: get('--bde-accent'),
      'scrollbar.shadow': 'transparent',
      'scrollbarSlider.background': get('--bde-border'),
      'scrollbarSlider.hoverBackground': get('--bde-text-dim') || get('--bde-text'),
      'scrollbarSlider.activeBackground': get('--bde-accent'),
      'minimap.background': get('--bde-bg')
    }
  }
}
