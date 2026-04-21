import { VIEW_LABELS } from '../lib/view-registry'
import type { View, DropZone } from '../lib/view-types'

// Re-export types for convenience
export type { View, DropZone }

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PanelTab {
  viewKey: View
  label: string
}

export interface PanelLeafNode {
  type: 'leaf'
  panelId: string
  tabs: PanelTab[]
  activeTab: number
}

export interface PanelSplitNode {
  type: 'split'
  direction: 'horizontal' | 'vertical'
  children: [PanelNode, PanelNode]
  sizes: [number, number]
}

export type PanelNode = PanelLeafNode | PanelSplitNode

// ---------------------------------------------------------------------------
// ID counter (deterministic for tests)
// ---------------------------------------------------------------------------

let idCounter = 0

export function _resetIdCounter(): void {
  idCounter = 0
}

function nextId(): string {
  idCounter += 1
  return `p${idCounter}`
}

// ---------------------------------------------------------------------------
// Pure tree functions
// ---------------------------------------------------------------------------

export function createLeaf(viewKey: View): PanelLeafNode {
  return {
    type: 'leaf',
    panelId: nextId(),
    tabs: [{ viewKey, label: VIEW_LABELS[viewKey] }],
    activeTab: 0
  }
}

export function findLeaf(node: PanelNode, panelId: string): PanelLeafNode | null {
  if (node.type === 'leaf') {
    return node.panelId === panelId ? node : null
  }
  return findLeaf(node.children[0], panelId) ?? findLeaf(node.children[1], panelId)
}

export function findFirstLeaf(node: PanelNode): PanelLeafNode | null {
  if (node.type === 'leaf') return node
  return findFirstLeaf(node.children[0])
}

export function getOpenViews(node: PanelNode): View[] {
  if (node.type === 'leaf') {
    return node.tabs.map((t) => t.viewKey)
  }
  return [...getOpenViews(node.children[0]), ...getOpenViews(node.children[1])]
}

export function splitNode(
  root: PanelNode,
  targetId: string,
  direction: 'horizontal' | 'vertical',
  viewKey: View
): PanelNode | null {
  if (root.type === 'leaf') {
    if (root.panelId !== targetId) return null
    const newLeaf = createLeaf(viewKey)
    const split: PanelSplitNode = {
      type: 'split',
      direction,
      children: [root, newLeaf],
      sizes: [50, 50]
    }
    return split
  }

  const left = splitNode(root.children[0], targetId, direction, viewKey)
  if (left !== null) {
    return { ...root, children: [left, root.children[1]] }
  }

  const right = splitNode(root.children[1], targetId, direction, viewKey)
  if (right !== null) {
    return { ...root, children: [root.children[0], right] }
  }

  return null
}

export function addTab(root: PanelNode, targetId: string, viewKey: View): PanelNode | null {
  if (root.type === 'leaf') {
    if (root.panelId !== targetId) return null
    const newTab: PanelTab = { viewKey, label: VIEW_LABELS[viewKey] }
    const tabs = [...root.tabs, newTab]
    return { ...root, tabs, activeTab: tabs.length - 1 }
  }

  const left = addTab(root.children[0], targetId, viewKey)
  if (left !== null) {
    return { ...root, children: [left, root.children[1]] }
  }

  const right = addTab(root.children[1], targetId, viewKey)
  if (right !== null) {
    return { ...root, children: [root.children[0], right] }
  }

  return null
}

/**
 * Removes a tab from the target leaf.
 * Returns null when the last tab is removed (caller should remove the panel).
 */
export function closeTab(root: PanelNode, targetId: string, tabIndex: number): PanelNode | null {
  if (root.type === 'leaf') {
    if (root.panelId !== targetId) return null
    if (root.tabs.length === 1) return null // signal: remove leaf
    const tabs = root.tabs.filter((_, i) => i !== tabIndex)
    const activeTab = Math.min(
      root.activeTab - (tabIndex < root.activeTab ? 1 : 0),
      tabs.length - 1
    )
    return { ...root, tabs, activeTab }
  }

  const left = closeTab(root.children[0], targetId, tabIndex)
  // null means the leaf was found and should be removed — replace split with the other child
  if (left !== null || findLeaf(root.children[0], targetId) !== null) {
    if (left === null) return root.children[1] // collapse split
    return { ...root, children: [left, root.children[1]] }
  }

  const right = closeTab(root.children[1], targetId, tabIndex)
  if (right !== null || findLeaf(root.children[1], targetId) !== null) {
    if (right === null) return root.children[0] // collapse split
    return { ...root, children: [root.children[0], right] }
  }

  return null
}

export function setActiveTab(root: PanelNode, panelId: string, tabIndex: number): PanelNode | null {
  if (root.type === 'leaf') {
    if (root.panelId !== panelId) return null
    return { ...root, activeTab: tabIndex }
  }

  const left = setActiveTab(root.children[0], panelId, tabIndex)
  if (left !== null) {
    return { ...root, children: [left, root.children[1]] }
  }

  const right = setActiveTab(root.children[1], panelId, tabIndex)
  if (right !== null) {
    return { ...root, children: [root.children[0], right] }
  }

  return null
}

/**
 * Moves a tab from one panel to another, splitting if needed.
 * Returns null if either panel is not found or the tab index is invalid.
 */
export function moveTab(
  root: PanelNode,
  sourcePanelId: string,
  sourceTabIndex: number,
  targetPanelId: string,
  zone: DropZone
): PanelNode | null {
  const sourceLeaf = findLeaf(root, sourcePanelId)
  if (!sourceLeaf) return null
  if (sourceTabIndex < 0 || sourceTabIndex >= sourceLeaf.tabs.length) return null

  const movedTab = sourceLeaf.tabs[sourceTabIndex]
  if (!movedTab) return null

  // Remove tab from source; if last tab, the leaf will be removed from the tree
  const afterClose = closeTab(root, sourcePanelId, sourceTabIndex)
  // afterClose is null only when root itself was the only leaf with one tab
  const treeAfterClose = afterClose ?? root

  if (zone === 'center') {
    const result = addTab(treeAfterClose, targetPanelId, movedTab.viewKey)
    return result ?? treeAfterClose
  }

  // Edge zones: split the target panel
  const direction: 'horizontal' | 'vertical' =
    zone === 'left' || zone === 'right' ? 'horizontal' : 'vertical'

  // For 'left' and 'top', the new panel should be the first child.
  // For 'right' and 'bottom', the new panel should be the second child (default splitNode behaviour).
  if (zone === 'left' || zone === 'top') {
    // We need to inject as first child — do a manual split
    const targetLeaf = findLeaf(treeAfterClose, targetPanelId)
    if (!targetLeaf) {
      // Target was removed (source == target, only tab); fall back to addTab on any remaining leaf
      return treeAfterClose
    }
    const newLeaf = createLeaf(movedTab.viewKey)
    const splitResult = replaceLeafWithSplit(
      treeAfterClose,
      targetPanelId,
      direction,
      newLeaf,
      'first'
    )
    return splitResult ?? treeAfterClose
  }

  // 'right' or 'bottom': new panel is second child (default)
  const targetLeaf = findLeaf(treeAfterClose, targetPanelId)
  if (!targetLeaf) return treeAfterClose
  const newLeaf = createLeaf(movedTab.viewKey)
  const splitResult = replaceLeafWithSplit(
    treeAfterClose,
    targetPanelId,
    direction,
    newLeaf,
    'second'
  )
  return splitResult ?? treeAfterClose
}

/**
 * Replaces the leaf at targetId with a split containing [newLeaf, targetLeaf]
 * or [targetLeaf, newLeaf] depending on `newPosition`.
 */
export function replaceLeafWithSplit(
  root: PanelNode,
  targetId: string,
  direction: 'horizontal' | 'vertical',
  newLeaf: PanelLeafNode,
  newPosition: 'first' | 'second'
): PanelNode | null {
  if (root.type === 'leaf') {
    if (root.panelId !== targetId) return null
    const children: [PanelNode, PanelNode] =
      newPosition === 'first' ? [newLeaf, root] : [root, newLeaf]
    const split: PanelSplitNode = {
      type: 'split',
      direction,
      children,
      sizes: [50, 50]
    }
    return split
  }

  const left = replaceLeafWithSplit(root.children[0], targetId, direction, newLeaf, newPosition)
  if (left !== null) {
    return { ...root, children: [left, root.children[1]] }
  }

  const right = replaceLeafWithSplit(root.children[1], targetId, direction, newLeaf, newPosition)
  if (right !== null) {
    return { ...root, children: [root.children[0], right] }
  }

  return null
}

// ---------------------------------------------------------------------------
// Layout validation helpers
// ---------------------------------------------------------------------------

export function isValidLayout(node: unknown): boolean {
  if (!node || typeof node !== 'object') return false
  const n = node as Record<string, unknown>
  if (n.type === 'leaf') return Array.isArray(n.tabs) && (n.tabs as unknown[]).length > 0
  if (n.type === 'split')
    return (
      Array.isArray(n.children) &&
      (n.children as unknown[]).length === 2 &&
      isValidLayout((n.children as unknown[])[0]) &&
      isValidLayout((n.children as unknown[])[1])
    )
  return false
}

/**
 * Migrates stale 'memory' and 'cost' tabs to 'settings'.
 * Returns a new layout with migrated tabs.
 */
export function migrateLayout(node: PanelNode): PanelNode {
  if (node.type === 'leaf') {
    const migratedTabs = node.tabs.map((tab) => {
      // Use type assertion to allow checking legacy view names
      const viewKey = tab.viewKey as string
      if (viewKey === 'memory' || viewKey === 'cost') {
        return { viewKey: 'settings' as View, label: VIEW_LABELS.settings }
      }
      if (viewKey === 'pr-station') {
        return { viewKey: 'code-review' as View, label: VIEW_LABELS['code-review'] }
      }
      return tab
    })
    return { ...node, tabs: migratedTabs }
  }

  return {
    ...node,
    children: [migrateLayout(node.children[0]), migrateLayout(node.children[1])] as [
      PanelNode,
      PanelNode
    ]
  }
}

// ---------------------------------------------------------------------------
// Default layout
// ---------------------------------------------------------------------------

export const DEFAULT_LAYOUT: PanelNode = createLeaf('dashboard')
