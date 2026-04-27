import React from 'react'
import { Separator } from 'react-resizable-panels'

export function PanelResizeHandle({
  direction
}: {
  direction: 'horizontal' | 'vertical'
}): React.ReactElement {
  const isVertical = direction === 'vertical'
  return (
    <Separator
      style={{
        width: isVertical ? '100%' : 4,
        height: isVertical ? 4 : '100%',
        background: 'transparent',
        cursor: isVertical ? 'row-resize' : 'col-resize',
        transition: 'var(--fleet-transition-fast)'
      }}
    />
  )
}
