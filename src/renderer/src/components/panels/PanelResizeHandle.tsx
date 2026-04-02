import React from 'react'
import { Separator } from 'react-resizable-panels'
import { tokens } from '../../design-system/tokens'

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
        transition: tokens.transition.fast
      }}
    />
  )
}
