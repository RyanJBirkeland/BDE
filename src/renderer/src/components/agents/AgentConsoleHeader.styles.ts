/**
 * Style constants for AgentConsoleHeader. Hoisted out of the component file
 * so the render code reads as prose rather than as nested style literals.
 */
import type { CSSProperties } from 'react'

export const STAT_VALUE_STYLE: CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 12,
  color: 'var(--fg)',
  fontWeight: 500
}

export const STAT_LABEL_STYLE: CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 9,
  textTransform: 'uppercase',
  color: 'var(--fg-3)',
  letterSpacing: '0.05em'
}

export const STAT_BLOCK_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-end',
  gap: 1
}

const TRUNCATED_MONO_BASE: CSSProperties = {
  fontFamily: 'var(--font-mono)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap'
}

export const IDENTITY_PRIMARY_STYLE: CSSProperties = {
  ...TRUNCATED_MONO_BASE,
  fontSize: 13,
  color: 'var(--fg)'
}

export const IDENTITY_SECONDARY_STYLE: CSSProperties = {
  ...TRUNCATED_MONO_BASE,
  fontSize: 10,
  color: 'var(--fg-3)'
}

export const IDENTITY_STACK_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  overflow: 'hidden',
  flex: '0 1 auto',
  maxWidth: 220
}

export const HEADER_CONTAINER_STYLE: CSSProperties = {
  height: 48,
  flexShrink: 0,
  padding: '0 var(--s-5)',
  borderBottom: '1px solid var(--line)',
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--s-3)'
}

export const STATS_ROW_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 0
}

export const STATS_DIVIDER_STYLE: CSSProperties = {
  width: 1,
  height: 18,
  background: 'var(--line)',
  margin: '0 var(--s-2)'
}

export const ACTIONS_DIVIDER_STYLE: CSSProperties = {
  ...STATS_DIVIDER_STYLE,
  margin: '0 var(--s-1)'
}

export const ACTIONS_ROW_STYLE: CSSProperties = {
  display: 'flex',
  gap: 'var(--s-1)',
  alignItems: 'center'
}

export const STATUS_DOT_STYLE: CSSProperties = { width: 8, height: 8, flexShrink: 0 }
export const SPACER_STYLE: CSSProperties = { flex: 1 }

export function actionBtnStyle(variant: 'accent' | 'secondary' | 'danger'): CSSProperties {
  const base: CSSProperties = {
    height: 26,
    padding: '0 var(--s-3)',
    fontSize: 12,
    borderRadius: 'var(--r-md)',
    cursor: 'pointer',
    fontWeight: 500
  }
  if (variant === 'accent') {
    return { ...base, background: 'var(--accent)', color: 'var(--accent-fg)', border: 'none' }
  }
  if (variant === 'danger') {
    return {
      ...base,
      background: 'transparent',
      border: `1px solid color-mix(in oklch, var(--st-failed) 30%, transparent)`,
      color: 'var(--st-failed)'
    }
  }
  return {
    ...base,
    background: 'transparent',
    border: '1px solid var(--line)',
    color: 'var(--fg-2)'
  }
}
