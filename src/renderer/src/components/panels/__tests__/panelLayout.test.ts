import { describe, it, expect, beforeEach } from 'vitest'
import {
  createLeaf,
  findLeaf,
  getOpenViews,
  splitNode,
  addTab,
  closeTab,
  setActiveTab,
  moveTab,
  DEFAULT_LAYOUT,
  _resetIdCounter
} from '../../../stores/panelLayout'
import type { PanelLeafNode, PanelSplitNode } from '../../../stores/panelLayout'

describe('panelLayout pure functions', () => {
  beforeEach(() => {
    _resetIdCounter()
  })

  // --- createLeaf ---

  describe('createLeaf', () => {
    it('returns a leaf node with correct shape', () => {
      const leaf = createLeaf('agents')
      expect(leaf.type).toBe('leaf')
      expect(leaf.panelId).toBe('p1')
      expect(leaf.tabs).toHaveLength(1)
      expect(leaf.tabs[0].viewKey).toBe('agents')
      expect(leaf.tabs[0].label).toBe('Agents')
      expect(leaf.activeTab).toBe(0)
    })

    it('increments panelId on successive calls', () => {
      const a = createLeaf('agents')
      const b = createLeaf('ide')
      expect(a.panelId).toBe('p1')
      expect(b.panelId).toBe('p2')
    })

    it('uses correct label for each view', () => {
      const leaf = createLeaf('pr-station')
      expect(leaf.tabs[0].label).toBe('PR Station')
    })
  })

  // --- DEFAULT_LAYOUT ---

  describe('DEFAULT_LAYOUT', () => {
    it('is a single dashboard leaf', () => {
      expect(DEFAULT_LAYOUT.type).toBe('leaf')
      const leaf = DEFAULT_LAYOUT as PanelLeafNode
      expect(leaf.tabs).toHaveLength(1)
      expect(leaf.tabs[0].viewKey).toBe('dashboard')
    })
  })

  // --- findLeaf ---

  describe('findLeaf', () => {
    it('finds the leaf by panelId in a simple tree', () => {
      const leaf = createLeaf('agents')
      const result = findLeaf(leaf, leaf.panelId)
      expect(result).not.toBeNull()
      expect(result?.panelId).toBe(leaf.panelId)
    })

    it('returns null when panelId does not exist', () => {
      const leaf = createLeaf('agents')
      expect(findLeaf(leaf, 'nonexistent')).toBeNull()
    })

    it('finds a nested leaf in a split tree', () => {
      const leaf1 = createLeaf('agents')
      const leaf2 = createLeaf('ide')
      const split: PanelSplitNode = {
        type: 'split',
        direction: 'horizontal',
        children: [leaf1, leaf2],
        sizes: [50, 50]
      }
      expect(findLeaf(split, leaf1.panelId)?.panelId).toBe(leaf1.panelId)
      expect(findLeaf(split, leaf2.panelId)?.panelId).toBe(leaf2.panelId)
    })
  })

  // --- getOpenViews ---

  describe('getOpenViews', () => {
    it('returns all viewKeys from a single leaf', () => {
      const leaf = createLeaf('agents')
      expect(getOpenViews(leaf)).toEqual(['agents'])
    })

    it('returns all viewKeys from a split tree', () => {
      const leaf1 = createLeaf('agents')
      const leaf2 = createLeaf('ide')
      const split: PanelSplitNode = {
        type: 'split',
        direction: 'horizontal',
        children: [leaf1, leaf2],
        sizes: [50, 50]
      }
      const views = getOpenViews(split)
      expect(views).toContain('agents')
      expect(views).toContain('ide')
      expect(views).toHaveLength(2)
    })

    it('returns all viewKeys including multiple tabs on one leaf', () => {
      const leaf = createLeaf('agents')
      const updated = addTab(leaf, leaf.panelId, 'sprint')
      const views = getOpenViews(updated!)
      expect(views).toContain('agents')
      expect(views).toContain('sprint')
      expect(views).toHaveLength(2)
    })
  })

  // --- splitNode ---

  describe('splitNode', () => {
    it('splits a leaf node and returns a split with correct direction', () => {
      const leaf = createLeaf('agents')
      const result = splitNode(leaf, leaf.panelId, 'horizontal', 'ide')
      expect(result).not.toBeNull()
      expect(result!.type).toBe('split')
      const split = result as PanelSplitNode
      expect(split.direction).toBe('horizontal')
    })

    it('split contains original leaf and new leaf', () => {
      const leaf = createLeaf('agents')
      const result = splitNode(leaf, leaf.panelId, 'horizontal', 'ide')
      const split = result as PanelSplitNode
      expect(split.children[0].type).toBe('leaf')
      expect(split.children[1].type).toBe('leaf')
      const left = split.children[0] as PanelLeafNode
      const right = split.children[1] as PanelLeafNode
      expect(left.tabs[0].viewKey).toBe('agents')
      expect(right.tabs[0].viewKey).toBe('ide')
    })

    it('split has sizes [50, 50]', () => {
      const leaf = createLeaf('agents')
      const result = splitNode(leaf, leaf.panelId, 'vertical', 'sprint')
      const split = result as PanelSplitNode
      expect(split.sizes).toEqual([50, 50])
    })

    it('splits a nested leaf in a split tree', () => {
      const leaf1 = createLeaf('agents')
      const leaf2 = createLeaf('ide')
      const root: PanelSplitNode = {
        type: 'split',
        direction: 'horizontal',
        children: [leaf1, leaf2],
        sizes: [50, 50]
      }
      // Split leaf2 vertically
      const result = splitNode(root, leaf2.panelId, 'vertical', 'sprint')
      expect(result).not.toBeNull()
      expect(result!.type).toBe('split')
      const topSplit = result as PanelSplitNode
      // Left child should be unchanged leaf1
      expect((topSplit.children[0] as PanelLeafNode).panelId).toBe(leaf1.panelId)
      // Right child should now be a nested split
      expect(topSplit.children[1].type).toBe('split')
    })

    it('returns null if target panelId is not found', () => {
      const leaf = createLeaf('agents')
      expect(splitNode(leaf, 'nonexistent', 'horizontal', 'ide')).toBeNull()
    })
  })

  // --- addTab ---

  describe('addTab', () => {
    it('adds a tab to the target leaf', () => {
      const leaf = createLeaf('agents')
      const result = addTab(leaf, leaf.panelId, 'ide')
      expect(result).not.toBeNull()
      const updatedLeaf = result as PanelLeafNode
      expect(updatedLeaf.tabs).toHaveLength(2)
      expect(updatedLeaf.tabs[1].viewKey).toBe('ide')
    })

    it('sets the new tab as active', () => {
      const leaf = createLeaf('agents')
      const result = addTab(leaf, leaf.panelId, 'ide')
      const updatedLeaf = result as PanelLeafNode
      expect(updatedLeaf.activeTab).toBe(1)
    })

    it('returns null if target not found', () => {
      const leaf = createLeaf('agents')
      expect(addTab(leaf, 'nonexistent', 'ide')).toBeNull()
    })

    it('adds tab inside a split tree', () => {
      const leaf1 = createLeaf('agents')
      const leaf2 = createLeaf('ide')
      const split: PanelSplitNode = {
        type: 'split',
        direction: 'horizontal',
        children: [leaf1, leaf2],
        sizes: [50, 50]
      }
      const result = addTab(split, leaf2.panelId, 'sprint')
      expect(result).not.toBeNull()
      expect(result!.type).toBe('split')
      const updatedSplit = result as PanelSplitNode
      const updatedLeaf2 = updatedSplit.children[1] as PanelLeafNode
      expect(updatedLeaf2.tabs).toHaveLength(2)
      expect(updatedLeaf2.tabs[1].viewKey).toBe('sprint')
    })
  })

  // --- closeTab ---

  describe('closeTab', () => {
    it('removes a tab from the target leaf', () => {
      let leaf = createLeaf('agents')
      leaf = addTab(leaf, leaf.panelId, 'ide') as PanelLeafNode
      const result = closeTab(leaf, leaf.panelId, 0)
      expect(result).not.toBeNull()
      const updatedLeaf = result as PanelLeafNode
      expect(updatedLeaf.tabs).toHaveLength(1)
      expect(updatedLeaf.tabs[0].viewKey).toBe('ide')
    })

    it('returns null when removing the last tab', () => {
      const leaf = createLeaf('agents')
      const result = closeTab(leaf, leaf.panelId, 0)
      expect(result).toBeNull()
    })

    it('adjusts activeTab when closing tab before active', () => {
      let leaf = createLeaf('agents')
      leaf = addTab(leaf, leaf.panelId, 'ide') as PanelLeafNode
      leaf = addTab(leaf, leaf.panelId, 'sprint') as PanelLeafNode
      // activeTab is now 2 (sprint). Close tab 0 (agents).
      const result = closeTab(leaf, leaf.panelId, 0)
      expect(result).not.toBeNull()
      const updated = result as PanelLeafNode
      expect(updated.activeTab).toBe(1) // was 2, now 1 after removal
    })

    it('clamps activeTab to last tab when closing active tab at end', () => {
      let leaf = createLeaf('agents')
      leaf = addTab(leaf, leaf.panelId, 'ide') as PanelLeafNode
      // activeTab is 1. Close tab 1.
      const result = closeTab(leaf, leaf.panelId, 1)
      expect(result).not.toBeNull()
      const updated = result as PanelLeafNode
      expect(updated.activeTab).toBe(0)
    })
  })

  // --- setActiveTab ---

  describe('setActiveTab', () => {
    it('sets active tab on a leaf', () => {
      let leaf = createLeaf('agents')
      leaf = addTab(leaf, leaf.panelId, 'ide') as PanelLeafNode
      const result = setActiveTab(leaf, leaf.panelId, 0)
      expect(result).not.toBeNull()
      const updated = result as PanelLeafNode
      expect(updated.activeTab).toBe(0)
    })

    it('returns null if panelId not found', () => {
      const leaf = createLeaf('agents')
      expect(setActiveTab(leaf, 'nonexistent', 0)).toBeNull()
    })
  })

  // --- moveTab ---

  describe('moveTab', () => {
    it('moveTab to center adds tab to target', () => {
      const leaf1 = createLeaf('agents')
      const leaf2 = createLeaf('ide')
      // Give leaf1 a second tab so it survives removal
      const leaf1WithTwo = addTab(leaf1, leaf1.panelId, 'sprint') as PanelLeafNode
      const split: PanelSplitNode = {
        type: 'split',
        direction: 'horizontal',
        children: [leaf1WithTwo, leaf2],
        sizes: [50, 50]
      }
      // Move leaf1's 'sprint' tab (index 1) to leaf2 center
      const result = moveTab(split, leaf1WithTwo.panelId, 1, leaf2.panelId, 'center')
      expect(result).not.toBeNull()
      const updatedLeaf2 = findLeaf(result!, leaf2.panelId)
      expect(updatedLeaf2).not.toBeNull()
      expect(updatedLeaf2!.tabs.map((t) => t.viewKey)).toContain('sprint')
      // Source leaf should still have 'agents' but not 'sprint'
      const updatedLeaf1 = findLeaf(result!, leaf1WithTwo.panelId)
      expect(updatedLeaf1).not.toBeNull()
      expect(updatedLeaf1!.tabs.map((t) => t.viewKey)).not.toContain('sprint')
    })

    it('moveTab to right splits target horizontally with new panel as second child', () => {
      const leaf1 = createLeaf('agents')
      const leaf2 = createLeaf('ide')
      // Give leaf1 a second tab so it survives removal
      const leaf1WithTwo = addTab(leaf1, leaf1.panelId, 'sprint') as PanelLeafNode
      const split: PanelSplitNode = {
        type: 'split',
        direction: 'vertical',
        children: [leaf1WithTwo, leaf2],
        sizes: [50, 50]
      }
      // Move leaf1's 'sprint' tab (index 1) to leaf2's right zone
      const result = moveTab(split, leaf1WithTwo.panelId, 1, leaf2.panelId, 'right')
      expect(result).not.toBeNull()
      // leaf2 should now be a split containing the original leaf2 and a new leaf with 'sprint'
      const rootSplit = result as PanelSplitNode
      const rightChild = rootSplit.children[1]
      expect(rightChild.type).toBe('split')
      const innerSplit = rightChild as PanelSplitNode
      expect(innerSplit.direction).toBe('horizontal')
      // new leaf with 'sprint' should be second child
      const newLeaf = innerSplit.children[1] as PanelLeafNode
      expect(newLeaf.tabs[0].viewKey).toBe('sprint')
    })

    it('moveTab to left puts new panel as first child', () => {
      const leaf1 = createLeaf('agents')
      const leaf2 = createLeaf('ide')
      const leaf1WithTwo = addTab(leaf1, leaf1.panelId, 'sprint') as PanelLeafNode
      const split: PanelSplitNode = {
        type: 'split',
        direction: 'vertical',
        children: [leaf1WithTwo, leaf2],
        sizes: [50, 50]
      }
      const result = moveTab(split, leaf1WithTwo.panelId, 1, leaf2.panelId, 'left')
      expect(result).not.toBeNull()
      const rootSplit = result as PanelSplitNode
      const rightChild = rootSplit.children[1]
      expect(rightChild.type).toBe('split')
      const innerSplit = rightChild as PanelSplitNode
      expect(innerSplit.direction).toBe('horizontal')
      // new leaf with 'sprint' should be first child
      const newLeaf = innerSplit.children[0] as PanelLeafNode
      expect(newLeaf.tabs[0].viewKey).toBe('sprint')
    })

    it('returns null if source panel not found', () => {
      const leaf = createLeaf('agents')
      expect(moveTab(leaf, 'nonexistent', 0, leaf.panelId, 'center')).toBeNull()
    })

    it('returns null if tab index out of range', () => {
      const leaf = createLeaf('agents')
      expect(moveTab(leaf, leaf.panelId, 5, leaf.panelId, 'center')).toBeNull()
    })
  })
})
