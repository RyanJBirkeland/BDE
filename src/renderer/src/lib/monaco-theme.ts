import type { editor } from 'monaco-editor'

/**
 * Build a Monaco dark theme from the currently-active FLEET CSS variables.
 * Must be called after DOM is mounted (uses getComputedStyle).
 */
export function getMonacoTheme(): editor.IStandaloneThemeData {
  const style = getComputedStyle(document.documentElement)
  const get = (v: string): string => style.getPropertyValue(v).trim()

  // Neon syntax colors
  const cyan = '#00ffc8'
  const green = '#00ff96'
  const orange = '#ffb432'
  const pink = '#ff64c8'
  const purple = '#bf5af2'
  // Monaco's rules[].foreground only accepts #RRGGBB hex — no rgba/alpha.
  // This is the dark-theme equivalent of white-30%-over-near-black.
  const dimText = '#7a7a7a'

  return {
    base: 'vs-dark',
    inherit: true,
    rules: [
      // Keywords — cyan
      { token: 'keyword', foreground: cyan, fontStyle: 'bold' },
      { token: 'keyword.control', foreground: cyan, fontStyle: 'bold' },
      { token: 'keyword.operator', foreground: cyan },
      { token: 'storage.type', foreground: cyan, fontStyle: 'bold' },
      { token: 'storage.modifier', foreground: cyan },

      // Strings — green
      { token: 'string', foreground: green },
      { token: 'string.quoted', foreground: green },
      { token: 'string.template', foreground: green },
      { token: 'string.regexp', foreground: green, fontStyle: 'italic' },

      // Comments — dim italic
      { token: 'comment', foreground: dimText, fontStyle: 'italic' },
      { token: 'comment.line', foreground: dimText, fontStyle: 'italic' },
      { token: 'comment.block', foreground: dimText, fontStyle: 'italic' },

      // Numbers — orange
      { token: 'constant.numeric', foreground: orange },
      { token: 'constant.language', foreground: orange },
      { token: 'constant.character', foreground: orange },
      { token: 'number', foreground: orange },

      // Functions — pink
      { token: 'entity.name.function', foreground: pink },
      { token: 'support.function', foreground: pink },
      { token: 'meta.function-call', foreground: pink },

      // Types & Classes — purple
      { token: 'entity.name.type', foreground: purple },
      { token: 'entity.name.class', foreground: purple },
      { token: 'support.type', foreground: purple },
      { token: 'support.class', foreground: purple },

      // Variables — default text (inherit)
      { token: 'variable', foreground: get('--fleet-text') },
      { token: 'variable.parameter', foreground: get('--fleet-text') },

      // Operators — text-muted
      { token: 'keyword.operator.arithmetic', foreground: get('--fleet-text-dim') || dimText },
      { token: 'keyword.operator.assignment', foreground: get('--fleet-text-dim') || dimText },
      { token: 'keyword.operator.comparison', foreground: get('--fleet-text-dim') || dimText },
      { token: 'keyword.operator.logical', foreground: get('--fleet-text-dim') || dimText },

      // Punctuation — subtle
      { token: 'punctuation', foreground: get('--fleet-text-dim') || dimText },
      { token: 'punctuation.definition', foreground: get('--fleet-text-dim') || dimText },

      // Tags (HTML/JSX) — cyan
      { token: 'entity.name.tag', foreground: cyan },
      { token: 'meta.tag', foreground: cyan },

      // Attributes — purple
      { token: 'entity.other.attribute-name', foreground: purple },

      // Invalid/Deprecated — red
      { token: 'invalid', foreground: '#ff3264', fontStyle: 'underline' },
      { token: 'invalid.deprecated', foreground: orange, fontStyle: 'strikethrough' }
    ],
    colors: {
      'editor.background': get('--fleet-bg'),
      'editor.foreground': get('--fleet-text'),
      'editor.lineHighlightBackground': get('--fleet-surface'),
      'editor.selectionBackground': get('--fleet-accent-dim') || get('--fleet-accent'),
      'editorCursor.foreground': get('--fleet-accent'),
      'editorLineNumber.foreground': get('--fleet-text-dim') || get('--fleet-text'),
      'editorLineNumber.activeForeground': get('--fleet-text'),
      'editorIndentGuide.background': get('--fleet-border'),
      'editorIndentGuide.activeBackground': get('--fleet-accent'),
      'editorWidget.background': get('--fleet-surface'),
      'editorWidget.border': get('--fleet-border'),
      'editorSuggestWidget.background': get('--fleet-surface'),
      'editorSuggestWidget.border': get('--fleet-border'),
      'editorSuggestWidget.selectedBackground': get('--fleet-accent'),
      'editorHoverWidget.background': get('--fleet-surface'),
      'editorHoverWidget.border': get('--fleet-border'),
      'input.background': get('--fleet-surface'),
      'input.border': get('--fleet-border'),
      'input.foreground': get('--fleet-text'),
      focusBorder: get('--fleet-accent'),
      'scrollbar.shadow': 'transparent',
      'scrollbarSlider.background': get('--fleet-border'),
      'scrollbarSlider.hoverBackground': get('--fleet-text-dim') || get('--fleet-text'),
      'scrollbarSlider.activeBackground': get('--fleet-accent'),
      'minimap.background': get('--fleet-bg')
    }
  }
}

/**
 * Build a Monaco light theme from the currently-active FLEET CSS variables.
 * Must be called after DOM is mounted (uses getComputedStyle).
 */
export function getLightMonacoTheme(): editor.IStandaloneThemeData {
  const style = getComputedStyle(document.documentElement)
  const get = (v: string): string => style.getPropertyValue(v).trim()

  // Light theme syntax colors (from neon.css light overrides)
  const cyan = '#00b894'
  const green = '#00a67e'
  const orange = '#e17055'
  const pink = '#e84393'
  const purple = '#a855f7'
  // Monaco's rules[].foreground only accepts #RRGGBB hex — no rgba/alpha.
  // Light-theme equivalent of dark-blue-30%-over-white.
  const dimText = '#9aa5b1'

  return {
    base: 'vs',
    inherit: true,
    rules: [
      // Keywords — cyan
      { token: 'keyword', foreground: cyan, fontStyle: 'bold' },
      { token: 'keyword.control', foreground: cyan, fontStyle: 'bold' },
      { token: 'keyword.operator', foreground: cyan },
      { token: 'storage.type', foreground: cyan, fontStyle: 'bold' },
      { token: 'storage.modifier', foreground: cyan },

      // Strings — green
      { token: 'string', foreground: green },
      { token: 'string.quoted', foreground: green },
      { token: 'string.template', foreground: green },
      { token: 'string.regexp', foreground: green, fontStyle: 'italic' },

      // Comments — dim italic
      { token: 'comment', foreground: dimText, fontStyle: 'italic' },
      { token: 'comment.line', foreground: dimText, fontStyle: 'italic' },
      { token: 'comment.block', foreground: dimText, fontStyle: 'italic' },

      // Numbers — orange
      { token: 'constant.numeric', foreground: orange },
      { token: 'constant.language', foreground: orange },
      { token: 'constant.character', foreground: orange },
      { token: 'number', foreground: orange },

      // Functions — pink
      { token: 'entity.name.function', foreground: pink },
      { token: 'support.function', foreground: pink },
      { token: 'meta.function-call', foreground: pink },

      // Types & Classes — purple
      { token: 'entity.name.type', foreground: purple },
      { token: 'entity.name.class', foreground: purple },
      { token: 'support.type', foreground: purple },
      { token: 'support.class', foreground: purple },

      // Variables — default text (inherit)
      { token: 'variable', foreground: get('--fleet-text') },
      { token: 'variable.parameter', foreground: get('--fleet-text') },

      // Operators — text-muted
      { token: 'keyword.operator.arithmetic', foreground: get('--fleet-text-dim') || dimText },
      { token: 'keyword.operator.assignment', foreground: get('--fleet-text-dim') || dimText },
      { token: 'keyword.operator.comparison', foreground: get('--fleet-text-dim') || dimText },
      { token: 'keyword.operator.logical', foreground: get('--fleet-text-dim') || dimText },

      // Punctuation — subtle
      { token: 'punctuation', foreground: get('--fleet-text-dim') || dimText },
      { token: 'punctuation.definition', foreground: get('--fleet-text-dim') || dimText },

      // Tags (HTML/JSX) — cyan
      { token: 'entity.name.tag', foreground: cyan },
      { token: 'meta.tag', foreground: cyan },

      // Attributes — purple
      { token: 'entity.other.attribute-name', foreground: purple },

      // Invalid/Deprecated — red
      { token: 'invalid', foreground: '#d63031', fontStyle: 'underline' },
      { token: 'invalid.deprecated', foreground: orange, fontStyle: 'strikethrough' }
    ],
    colors: {
      'editor.background': get('--fleet-bg'),
      'editor.foreground': get('--fleet-text'),
      'editor.lineHighlightBackground': get('--fleet-surface'),
      'editor.selectionBackground': get('--fleet-accent-dim') || get('--fleet-accent'),
      'editorCursor.foreground': get('--fleet-accent'),
      'editorLineNumber.foreground': get('--fleet-text-dim') || get('--fleet-text'),
      'editorLineNumber.activeForeground': get('--fleet-text'),
      'editorIndentGuide.background': get('--fleet-border'),
      'editorIndentGuide.activeBackground': get('--fleet-accent'),
      'editorWidget.background': get('--fleet-surface'),
      'editorWidget.border': get('--fleet-border'),
      'editorSuggestWidget.background': get('--fleet-surface'),
      'editorSuggestWidget.border': get('--fleet-border'),
      'editorSuggestWidget.selectedBackground': get('--fleet-accent'),
      'editorHoverWidget.background': get('--fleet-surface'),
      'editorHoverWidget.border': get('--fleet-border'),
      'input.background': get('--fleet-surface'),
      'input.border': get('--fleet-border'),
      'input.foreground': get('--fleet-text'),
      focusBorder: get('--fleet-accent'),
      'scrollbar.shadow': 'transparent',
      'scrollbarSlider.background': get('--fleet-border'),
      'scrollbarSlider.hoverBackground': get('--fleet-text-dim') || get('--fleet-text'),
      'scrollbarSlider.activeBackground': get('--fleet-accent'),
      'minimap.background': get('--fleet-bg')
    }
  }
}
