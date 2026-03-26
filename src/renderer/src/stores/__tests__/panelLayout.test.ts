import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
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
  _resetIdCounter,
  usePanelLayoutStore,
  VIEW_LABELS
} from '../panelLayout'
import type { PanelLeafNode, PanelSplitNode, PanelNode } from '../panelLayout'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resetStore(): void {
  _resetIdCounter()
  const fresh = createLeaf('agents')
  usePanelLayoutStore.setState({ root: fresh, focusedPanelId: fresh.panelId })
}

// ---------------------------------------------------------------------------
// Pure function tests (already well-covered; kept for completeness)
// ---------------------------------------------------------------------------

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

    it('assigns correct labels for all views', () => {
      const views = ['agents', 'ide', 'sprint', 'pr-station', 'memory', 'cost', 'settings'] as const
      for (const v of views) {
        _resetIdCounter()
        const leaf = createLeaf(v)
        expect(leaf.tabs[0].label).toBe(VIEW_LABELS[v])
      }
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

    it('returns null for unknown id in a split tree', () => {
      const leaf1 = createLeaf('agents')
      const leaf2 = createLeaf('ide')
      const split: PanelSplitNode = {
        type: 'split',
        direction: 'horizontal',
        children: [leaf1, leaf2],
        sizes: [50, 50]
      }
      expect(findLeaf(split, 'nonexistent')).toBeNull()
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

    it('splits a nested leaf in a split tree (left child)', () => {
      const leaf1 = createLeaf('agents')
      const leaf2 = createLeaf('ide')
      const root: PanelSplitNode = {
        type: 'split',
        direction: 'horizontal',
        children: [leaf1, leaf2],
        sizes: [50, 50]
      }
      // Split leaf1 (left child) horizontally
      const result = splitNode(root, leaf1.panelId, 'horizontal', 'sprint')
      expect(result).not.toBeNull()
      expect(result!.type).toBe('split')
      const topSplit = result as PanelSplitNode
      // Left child should now be a nested split
      expect(topSplit.children[0].type).toBe('split')
      // Right child should be unchanged leaf2
      expect((topSplit.children[1] as PanelLeafNode).panelId).toBe(leaf2.panelId)
    })

    it('splits a nested leaf in a split tree (right child)', () => {
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

    it('returns null if target not found in split tree', () => {
      const leaf1 = createLeaf('agents')
      const leaf2 = createLeaf('ide')
      const split: PanelSplitNode = {
        type: 'split',
        direction: 'horizontal',
        children: [leaf1, leaf2],
        sizes: [50, 50]
      }
      expect(splitNode(split, 'nonexistent', 'vertical', 'sprint')).toBeNull()
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

    it('adds tab inside a split tree (right child)', () => {
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

    it('adds tab inside a split tree (left child)', () => {
      const leaf1 = createLeaf('agents')
      const leaf2 = createLeaf('ide')
      const split: PanelSplitNode = {
        type: 'split',
        direction: 'horizontal',
        children: [leaf1, leaf2],
        sizes: [50, 50]
      }
      const result = addTab(split, leaf1.panelId, 'sprint')
      expect(result).not.toBeNull()
      const updatedSplit = result as PanelSplitNode
      const updatedLeaf1 = updatedSplit.children[0] as PanelLeafNode
      expect(updatedLeaf1.tabs).toHaveLength(2)
      expect(updatedLeaf1.tabs[1].viewKey).toBe('sprint')
    })

    it('returns null if target not found in split tree', () => {
      const leaf1 = createLeaf('agents')
      const leaf2 = createLeaf('ide')
      const split: PanelSplitNode = {
        type: 'split',
        direction: 'horizontal',
        children: [leaf1, leaf2],
        sizes: [50, 50]
      }
      expect(addTab(split, 'nonexistent', 'sprint')).toBeNull()
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

    it('returns null when removing the last tab (single leaf root)', () => {
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

    it('returns null for unknown panelId', () => {
      const leaf = createLeaf('agents')
      const result = closeTab(leaf, 'nonexistent', 0)
      expect(result).toBeNull()
    })

    it('collapses split when last tab of left child is removed', () => {
      const leaf1 = createLeaf('agents') // only 1 tab
      const leaf2 = createLeaf('ide')
      const split: PanelSplitNode = {
        type: 'split',
        direction: 'horizontal',
        children: [leaf1, leaf2],
        sizes: [50, 50]
      }
      // Close the only tab of leaf1 — split should collapse to leaf2
      const result = closeTab(split, leaf1.panelId, 0)
      expect(result).not.toBeNull()
      expect(result!.type).toBe('leaf')
      expect((result as PanelLeafNode).panelId).toBe(leaf2.panelId)
    })

    it('collapses split when last tab of right child is removed', () => {
      const leaf1 = createLeaf('agents')
      const leaf2 = createLeaf('ide') // only 1 tab
      const split: PanelSplitNode = {
        type: 'split',
        direction: 'horizontal',
        children: [leaf1, leaf2],
        sizes: [50, 50]
      }
      // Close the only tab of leaf2 — split should collapse to leaf1
      const result = closeTab(split, leaf2.panelId, 0)
      expect(result).not.toBeNull()
      expect(result!.type).toBe('leaf')
      expect((result as PanelLeafNode).panelId).toBe(leaf1.panelId)
    })

    it('removes a tab from a leaf within a split, preserving tree structure', () => {
      let leaf1 = createLeaf('agents')
      leaf1 = addTab(leaf1, leaf1.panelId, 'sprint') as PanelLeafNode
      const leaf2 = createLeaf('ide')
      const split: PanelSplitNode = {
        type: 'split',
        direction: 'horizontal',
        children: [leaf1, leaf2],
        sizes: [50, 50]
      }
      const result = closeTab(split, leaf1.panelId, 0) // remove 'agents', keep 'sprint'
      expect(result).not.toBeNull()
      expect(result!.type).toBe('split')
      const updatedSplit = result as PanelSplitNode
      const updatedLeaf1 = updatedSplit.children[0] as PanelLeafNode
      expect(updatedLeaf1.tabs).toHaveLength(1)
      expect(updatedLeaf1.tabs[0].viewKey).toBe('sprint')
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

    it('sets active tab in a split tree (left child)', () => {
      let leaf1 = createLeaf('agents')
      leaf1 = addTab(leaf1, leaf1.panelId, 'ide') as PanelLeafNode
      const leaf2 = createLeaf('sprint')
      const split: PanelSplitNode = {
        type: 'split',
        direction: 'horizontal',
        children: [leaf1, leaf2],
        sizes: [50, 50]
      }
      const result = setActiveTab(split, leaf1.panelId, 0)
      expect(result).not.toBeNull()
      const updatedSplit = result as PanelSplitNode
      expect((updatedSplit.children[0] as PanelLeafNode).activeTab).toBe(0)
    })

    it('sets active tab in a split tree (right child)', () => {
      const leaf1 = createLeaf('agents')
      let leaf2 = createLeaf('ide')
      leaf2 = addTab(leaf2, leaf2.panelId, 'sprint') as PanelLeafNode
      const split: PanelSplitNode = {
        type: 'split',
        direction: 'horizontal',
        children: [leaf1, leaf2],
        sizes: [50, 50]
      }
      const result = setActiveTab(split, leaf2.panelId, 1)
      expect(result).not.toBeNull()
      const updatedSplit = result as PanelSplitNode
      expect((updatedSplit.children[1] as PanelLeafNode).activeTab).toBe(1)
    })

    it('returns null if panelId not found in split tree', () => {
      const leaf1 = createLeaf('agents')
      const leaf2 = createLeaf('ide')
      const split: PanelSplitNode = {
        type: 'split',
        direction: 'horizontal',
        children: [leaf1, leaf2],
        sizes: [50, 50]
      }
      expect(setActiveTab(split, 'nonexistent', 0)).toBeNull()
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

    it('moveTab to top puts new panel as first child with vertical split', () => {
      const leaf1 = createLeaf('agents')
      const leaf2 = createLeaf('ide')
      const leaf1WithTwo = addTab(leaf1, leaf1.panelId, 'sprint') as PanelLeafNode
      const split: PanelSplitNode = {
        type: 'split',
        direction: 'horizontal',
        children: [leaf1WithTwo, leaf2],
        sizes: [50, 50]
      }
      const result = moveTab(split, leaf1WithTwo.panelId, 1, leaf2.panelId, 'top')
      expect(result).not.toBeNull()
      const rootSplit = result as PanelSplitNode
      const rightChild = rootSplit.children[1]
      expect(rightChild.type).toBe('split')
      const innerSplit = rightChild as PanelSplitNode
      expect(innerSplit.direction).toBe('vertical')
      // new leaf with 'sprint' should be first child (top)
      const newLeaf = innerSplit.children[0] as PanelLeafNode
      expect(newLeaf.tabs[0].viewKey).toBe('sprint')
    })

    it('moveTab to bottom puts new panel as second child with vertical split', () => {
      const leaf1 = createLeaf('agents')
      const leaf2 = createLeaf('ide')
      const leaf1WithTwo = addTab(leaf1, leaf1.panelId, 'sprint') as PanelLeafNode
      const split: PanelSplitNode = {
        type: 'split',
        direction: 'horizontal',
        children: [leaf1WithTwo, leaf2],
        sizes: [50, 50]
      }
      const result = moveTab(split, leaf1WithTwo.panelId, 1, leaf2.panelId, 'bottom')
      expect(result).not.toBeNull()
      const rootSplit = result as PanelSplitNode
      const rightChild = rootSplit.children[1]
      expect(rightChild.type).toBe('split')
      const innerSplit = rightChild as PanelSplitNode
      expect(innerSplit.direction).toBe('vertical')
      // new leaf with 'sprint' should be second child (bottom)
      const newLeaf = innerSplit.children[1] as PanelLeafNode
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

    it('returns null if tab index is negative', () => {
      const leaf = createLeaf('agents')
      expect(moveTab(leaf, leaf.panelId, -1, leaf.panelId, 'center')).toBeNull()
    })

    it('handles moving only tab to center of same panel (target not found after source removal)', () => {
      // When source == target, and moving single tab, the source panel is removed — fallback to treeAfterClose
      const leaf1 = createLeaf('agents')
      const leaf2 = createLeaf('ide')
      const split: PanelSplitNode = {
        type: 'split',
        direction: 'horizontal',
        children: [leaf1, leaf2],
        sizes: [50, 50]
      }
      // Move leaf1's only tab to its own panel center — leaf1 is removed, result is just leaf2
      const result = moveTab(split, leaf1.panelId, 0, leaf1.panelId, 'center')
      // After closing, tree becomes just leaf2, then addTab for 'agents' to leaf1 (not found) → returns leaf2
      expect(result).not.toBeNull()
    })

    it('handles moving to left when target removed (source == target)', () => {
      // Edge: source leaf is removed and target is no longer in tree
      const leaf1 = createLeaf('agents')
      const leaf2 = createLeaf('ide')
      const split: PanelSplitNode = {
        type: 'split',
        direction: 'horizontal',
        children: [leaf1, leaf2],
        sizes: [50, 50]
      }
      // Move leaf1's only tab to itself (left zone) — leaf1 removed, target not found → return treeAfterClose
      const result = moveTab(split, leaf1.panelId, 0, leaf1.panelId, 'left')
      expect(result).not.toBeNull()
      // Should return the tree with just leaf2
      expect(result!.type).toBe('leaf')
      expect((result as PanelLeafNode).panelId).toBe(leaf2.panelId)
    })

    it('handles moving to right when target is removed (source == target)', () => {
      const leaf1 = createLeaf('agents')
      const leaf2 = createLeaf('ide')
      const split: PanelSplitNode = {
        type: 'split',
        direction: 'horizontal',
        children: [leaf1, leaf2],
        sizes: [50, 50]
      }
      // Move leaf1's only tab to itself (right zone) — leaf1 removed, target not found → return treeAfterClose
      const result = moveTab(split, leaf1.panelId, 0, leaf1.panelId, 'right')
      expect(result).not.toBeNull()
      expect(result!.type).toBe('leaf')
      expect((result as PanelLeafNode).panelId).toBe(leaf2.panelId)
    })
  })
})

// ---------------------------------------------------------------------------
// Zustand store tests
// ---------------------------------------------------------------------------

describe('usePanelLayoutStore', () => {
  beforeEach(() => {
    resetStore()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('initial state has a single agents leaf', () => {
    const { root } = usePanelLayoutStore.getState()
    expect(root.type).toBe('leaf')
    const leaf = root as PanelLeafNode
    expect(leaf.tabs[0].viewKey).toBe('agents')
  })

  it('focusedPanelId is set to root panelId initially', () => {
    const { root, focusedPanelId } = usePanelLayoutStore.getState()
    expect(focusedPanelId).toBe((root as PanelLeafNode).panelId)
  })

  // --- splitPanel store action ---

  describe('splitPanel', () => {
    it('splits the root panel and updates root', () => {
      const { root, splitPanel } = usePanelLayoutStore.getState()
      const leafId = (root as PanelLeafNode).panelId
      splitPanel(leafId, 'horizontal', 'ide')
      const newRoot = usePanelLayoutStore.getState().root
      expect(newRoot.type).toBe('split')
      const split = newRoot as PanelSplitNode
      expect(split.direction).toBe('horizontal')
      expect((split.children[1] as PanelLeafNode).tabs[0].viewKey).toBe('ide')
    })

    it('does not change state if targetId not found', () => {
      const { root, splitPanel } = usePanelLayoutStore.getState()
      splitPanel('nonexistent', 'horizontal', 'ide')
      expect(usePanelLayoutStore.getState().root).toBe(root) // same reference
    })
  })

  // --- addTab store action ---

  describe('addTab store action', () => {
    it('adds a tab to the target panel', () => {
      const { root, addTab: storeAddTab } = usePanelLayoutStore.getState()
      const leafId = (root as PanelLeafNode).panelId
      storeAddTab(leafId, 'ide')
      const newRoot = usePanelLayoutStore.getState().root as PanelLeafNode
      expect(newRoot.tabs).toHaveLength(2)
      expect(newRoot.tabs[1].viewKey).toBe('ide')
    })

    it('does not change state if targetId not found', () => {
      const { root, addTab: storeAddTab } = usePanelLayoutStore.getState()
      storeAddTab('nonexistent', 'ide')
      expect(usePanelLayoutStore.getState().root).toBe(root)
    })
  })

  // --- closeTab store action ---

  describe('closeTab store action', () => {
    it('removes a tab from the panel', () => {
      const { root, addTab: storeAddTab, closeTab: storeCloseTab } = usePanelLayoutStore.getState()
      const leafId = (root as PanelLeafNode).panelId
      storeAddTab(leafId, 'ide')
      storeCloseTab(leafId, 0)
      const newRoot = usePanelLayoutStore.getState().root as PanelLeafNode
      expect(newRoot.tabs).toHaveLength(1)
      expect(newRoot.tabs[0].viewKey).toBe('ide')
    })

    it('keeps root intact when closing the only tab', () => {
      const { root, closeTab: storeCloseTab } = usePanelLayoutStore.getState()
      const leafId = (root as PanelLeafNode).panelId
      storeCloseTab(leafId, 0)
      // Root should be unchanged (closeTab returns null for last tab of root)
      const newRoot = usePanelLayoutStore.getState().root
      expect(newRoot).toBe(root)
    })

    it('collapses split when last tab of a leaf is closed', () => {
      const { root, splitPanel, closeTab: storeCloseTab } = usePanelLayoutStore.getState()
      const leafId = (root as PanelLeafNode).panelId
      splitPanel(leafId, 'horizontal', 'ide')
      const splitRoot = usePanelLayoutStore.getState().root as PanelSplitNode
      const rightLeafId = (splitRoot.children[1] as PanelLeafNode).panelId
      // Close the only tab of the right panel
      storeCloseTab(rightLeafId, 0)
      const collapsed = usePanelLayoutStore.getState().root
      expect(collapsed.type).toBe('leaf')
      expect((collapsed as PanelLeafNode).panelId).toBe(leafId)
    })
  })

  // --- setActiveTab store action ---

  describe('setActiveTab store action', () => {
    it('updates activeTab on the target panel', () => {
      const {
        root,
        addTab: storeAddTab,
        setActiveTab: storeSetActiveTab
      } = usePanelLayoutStore.getState()
      const leafId = (root as PanelLeafNode).panelId
      storeAddTab(leafId, 'ide')
      storeSetActiveTab(leafId, 0)
      const newRoot = usePanelLayoutStore.getState().root as PanelLeafNode
      expect(newRoot.activeTab).toBe(0)
    })

    it('does not change state if panelId not found', () => {
      const { root, setActiveTab: storeSetActiveTab } = usePanelLayoutStore.getState()
      storeSetActiveTab('nonexistent', 0)
      expect(usePanelLayoutStore.getState().root).toBe(root)
    })
  })

  // --- moveTab store action ---

  describe('moveTab store action', () => {
    it('moves a tab between panels via center zone', () => {
      const { root, splitPanel, moveTab: storeMoveTab } = usePanelLayoutStore.getState()
      const leafId = (root as PanelLeafNode).panelId
      // First add a tab so there are 2 tabs, then split
      usePanelLayoutStore.getState().addTab(leafId, 'sprint')
      splitPanel(leafId, 'horizontal', 'ide')
      const splitRoot = usePanelLayoutStore.getState().root as PanelSplitNode
      const rightLeafId = (splitRoot.children[1] as PanelLeafNode).panelId
      // Move sprint (index 1) from left to right
      storeMoveTab(leafId, 1, rightLeafId, 'center')
      const finalRoot = usePanelLayoutStore.getState().root
      const rightLeaf = findLeaf(finalRoot, rightLeafId)
      expect(rightLeaf!.tabs.map((t) => t.viewKey)).toContain('sprint')
    })

    it('does not change state if moveTab returns null', () => {
      const { root, moveTab: storeMoveTab } = usePanelLayoutStore.getState()
      storeMoveTab('nonexistent', 0, 'other', 'center')
      expect(usePanelLayoutStore.getState().root).toBe(root)
    })
  })

  // --- focusPanel store action ---

  describe('focusPanel', () => {
    it('updates focusedPanelId', () => {
      usePanelLayoutStore.getState().focusPanel('some-panel-id')
      expect(usePanelLayoutStore.getState().focusedPanelId).toBe('some-panel-id')
    })
  })

  // --- resetLayout store action ---

  describe('resetLayout', () => {
    it('resets to a single agents leaf', () => {
      const { root, splitPanel } = usePanelLayoutStore.getState()
      const leafId = (root as PanelLeafNode).panelId
      splitPanel(leafId, 'horizontal', 'ide')
      // Now reset
      usePanelLayoutStore.getState().resetLayout()
      const newRoot = usePanelLayoutStore.getState().root
      expect(newRoot.type).toBe('leaf')
      expect((newRoot as PanelLeafNode).tabs[0].viewKey).toBe('dashboard')
    })

    it('resets focusedPanelId to new root panelId', () => {
      usePanelLayoutStore.getState().resetLayout()
      const { root, focusedPanelId } = usePanelLayoutStore.getState()
      expect(focusedPanelId).toBe((root as PanelLeafNode).panelId)
    })

    it('calls window.api.settings.setJson with null when api is available', () => {
      const setJson = vi.fn().mockResolvedValue(undefined)
      vi.stubGlobal('window', { api: { settings: { setJson } } })
      usePanelLayoutStore.getState().resetLayout()
      expect(setJson).toHaveBeenCalledWith('panel.layout', null)
      vi.unstubAllGlobals()
    })
  })

  // --- getOpenViews store action ---

  describe('getOpenViews store action', () => {
    it('returns views from the current root', () => {
      const views = usePanelLayoutStore.getState().getOpenViews()
      expect(views).toEqual(['agents'])
    })

    it('returns all views after adding tabs and splits', () => {
      const { root, splitPanel } = usePanelLayoutStore.getState()
      const leafId = (root as PanelLeafNode).panelId
      splitPanel(leafId, 'horizontal', 'ide')
      const views = usePanelLayoutStore.getState().getOpenViews()
      expect(views).toContain('agents')
      expect(views).toContain('ide')
    })
  })

  // --- findPanelByView store action ---

  describe('findPanelByView', () => {
    it('returns null if view is not open', () => {
      const result = usePanelLayoutStore.getState().findPanelByView('ide')
      expect(result).toBeNull()
    })

    it('finds the leaf containing the view', () => {
      const { root } = usePanelLayoutStore.getState()
      const result = usePanelLayoutStore.getState().findPanelByView('agents')
      expect(result).not.toBeNull()
      expect(result!.panelId).toBe((root as PanelLeafNode).panelId)
    })

    it('finds the correct leaf in a split tree', () => {
      const { root, splitPanel } = usePanelLayoutStore.getState()
      const leafId = (root as PanelLeafNode).panelId
      splitPanel(leafId, 'horizontal', 'ide')
      const splitRoot = usePanelLayoutStore.getState().root as PanelSplitNode
      const rightLeafId = (splitRoot.children[1] as PanelLeafNode).panelId
      const result = usePanelLayoutStore.getState().findPanelByView('ide')
      expect(result).not.toBeNull()
      expect(result!.panelId).toBe(rightLeafId)
    })

    it('finds view in right child of split tree', () => {
      const { root, splitPanel } = usePanelLayoutStore.getState()
      const leafId = (root as PanelLeafNode).panelId
      splitPanel(leafId, 'horizontal', 'ide')
      // The right child has 'ide'
      const result = usePanelLayoutStore.getState().findPanelByView('ide')
      expect(result).not.toBeNull()
      expect(result!.tabs.some((t) => t.viewKey === 'ide')).toBe(true)
    })
  })

  // --- loadSavedLayout store action ---

  describe('loadSavedLayout', () => {
    it('does nothing when window is undefined', async () => {
      // In jsdom, window exists, so we mock window.api to be undefined
      const originalApi = (window as { api?: unknown }).api
      ;(window as { api?: unknown }).api = undefined
      const { root } = usePanelLayoutStore.getState()
      await usePanelLayoutStore.getState().loadSavedLayout()
      expect(usePanelLayoutStore.getState().root).toBe(root)
      ;(window as { api?: unknown }).api = originalApi
    })

    it('loads a valid saved layout', async () => {
      _resetIdCounter()
      const savedRoot = createLeaf('sprint')
      const getJson = vi.fn().mockResolvedValue(savedRoot)
      vi.stubGlobal('window', { api: { settings: { getJson } } })
      await usePanelLayoutStore.getState().loadSavedLayout()
      const { root, focusedPanelId } = usePanelLayoutStore.getState()
      expect((root as PanelLeafNode).tabs[0].viewKey).toBe('sprint')
      expect(focusedPanelId).toBe(savedRoot.panelId)
      vi.unstubAllGlobals()
    })

    it('ignores invalid saved layout', async () => {
      const getJson = vi.fn().mockResolvedValue({ type: 'invalid' })
      vi.stubGlobal('window', { api: { settings: { getJson } } })
      const { root } = usePanelLayoutStore.getState()
      await usePanelLayoutStore.getState().loadSavedLayout()
      expect(usePanelLayoutStore.getState().root).toBe(root)
      vi.unstubAllGlobals()
    })

    it('ignores null saved layout', async () => {
      const getJson = vi.fn().mockResolvedValue(null)
      vi.stubGlobal('window', { api: { settings: { getJson } } })
      const { root } = usePanelLayoutStore.getState()
      await usePanelLayoutStore.getState().loadSavedLayout()
      expect(usePanelLayoutStore.getState().root).toBe(root)
      vi.unstubAllGlobals()
    })

    it('handles errors gracefully (uses default)', async () => {
      const getJson = vi.fn().mockRejectedValue(new Error('fail'))
      vi.stubGlobal('window', { api: { settings: { getJson } } })
      const { root } = usePanelLayoutStore.getState()
      await expect(usePanelLayoutStore.getState().loadSavedLayout()).resolves.toBeUndefined()
      expect(usePanelLayoutStore.getState().root).toBe(root)
      vi.unstubAllGlobals()
    })

    it('loads a valid split layout and sets focusedPanelId to first leaf', async () => {
      _resetIdCounter()
      const leftLeaf = createLeaf('agents')
      const rightLeaf = createLeaf('ide')
      const savedRoot: PanelNode = {
        type: 'split',
        direction: 'horizontal',
        children: [leftLeaf, rightLeaf],
        sizes: [50, 50]
      }
      const getJson = vi.fn().mockResolvedValue(savedRoot)
      vi.stubGlobal('window', { api: { settings: { getJson } } })
      await usePanelLayoutStore.getState().loadSavedLayout()
      const { focusedPanelId } = usePanelLayoutStore.getState()
      expect(focusedPanelId).toBe(leftLeaf.panelId) // findFirstLeaf returns left child
      vi.unstubAllGlobals()
    })
  })
})
