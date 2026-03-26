import React from 'react'
import { Group, Panel } from 'react-resizable-panels'
import { PanelNode } from '../../stores/panelLayout'
import { PanelLeaf } from './PanelLeaf'
import { PanelResizeHandle } from './PanelResizeHandle'

interface PanelRendererProps {
  node: PanelNode
}

export function PanelRenderer({ node }: PanelRendererProps): React.ReactElement {
  if (node.type === 'leaf') {
    return <PanelLeaf node={node} />
  }

  return (
    <Group
      orientation={node.direction}
      style={{ width: '100%', height: '100%', flex: 1, minHeight: 0 }}
    >
      <Panel defaultSize={node.sizes[0]} minSize={10}>
        <PanelRenderer node={node.children[0]} />
      </Panel>
      <PanelResizeHandle direction={node.direction} />
      <Panel defaultSize={node.sizes[1]} minSize={10}>
        <PanelRenderer node={node.children[1]} />
      </Panel>
    </Group>
  )
}
