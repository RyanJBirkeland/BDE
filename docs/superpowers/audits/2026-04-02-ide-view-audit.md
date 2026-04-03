# IDE View UX Audit — 2026-04-02

**Scope:** IDE view and all related components
**Auditor:** Pipeline Agent
**Date:** 2026-04-02

---

## Summary

The IDE view is well-structured with strong test coverage for the main view and store. However, there are several UX and accessibility issues, particularly around font sizes, inline styling, and missing test coverage for FileTreeNode. The neon design system is mostly consistent but has some inline style leakage.

**Critical:** 0 | **High:** 3 | **Medium:** 7 | **Low:** 5

---

## Findings

### #1: Font sizes below 10px minimum — **High**

**What:**
The keyboard shortcuts overlay panel uses font sizes below the 10px minimum requirement:

- `ide-shortcuts-panel__key`: 11px (line 498 in ide-neon.css)
- `ide-shortcuts-panel__hint`: 11px (line 514 in ide-neon.css)

**Impact:**
Poor readability for users, especially those with visual impairments. Fails accessibility guidelines.

**Fix:**

```css
.ide-shortcuts-panel__key {
  font-size: 12px; /* was 11px */
}

.ide-shortcuts-panel__hint {
  font-size: 12px; /* was 11px */
}
```

**Location:** `src/renderer/src/assets/ide-neon.css:498, 514`

---

### #2: Inline styles leak in IDEView loading indicator — **Medium**

**What:**
The file loading indicator in IDEView (lines 414-421) uses inline styles instead of CSS classes:

```tsx
<div
  style={{
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
    color: 'var(--bde-text-dim)',
    fontSize: 'var(--bde-size-sm)'
  }}
>
  Loading...
</div>
```

**Impact:**
Violates neon design system conventions. Makes theming harder. Inconsistent with rest of IDE view which uses CSS classes.

**Fix:**
Add CSS class in `ide-neon.css`:

```css
.ide-loading-indicator {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--bde-text-dim);
  font-size: var(--bde-size-sm);
}
```

Then use: `<div className="ide-loading-indicator">Loading...</div>`

**Location:** `src/renderer/src/views/IDEView.tsx:414-421`

---

### #3: FileSidebar "No folder open" uses inline styles — **Medium**

**What:**
The "No folder open" message in FileSidebar (lines 168-172) uses inline styles:

```tsx
<div
  style={{
    padding: '12px 8px',
    fontSize: 'var(--bde-size-sm)',
    color: 'var(--bde-text-dim)'
  }}
>
  No folder open
</div>
```

**Impact:**
Same as #2 — violates design system conventions, makes theming harder.

**Fix:**
Add CSS class:

```css
.ide-sidebar__empty {
  padding: 12px 8px;
  font-size: var(--bde-size-sm);
  color: var(--bde-text-dim);
}
```

**Location:** `src/renderer/src/components/ide/FileSidebar.tsx:168-172`

---

### #4: FileTree error state uses inline styles — **Low**

**What:**
FileTree error rendering (line 43) uses inline styles:

```tsx
<div className="ide-file-tree" style={{ padding: '8px', color: 'var(--bde-danger)', fontSize: 'var(--bde-size-sm)' }}>
```

**Impact:**
Minor violation of design system. Less critical since error states are rare.

**Fix:**
Add CSS class:

```css
.ide-file-tree--error {
  padding: 8px;
  color: var(--bde-danger);
  font-size: var(--bde-size-sm);
}
```

**Location:** `src/renderer/src/components/ide/FileTree.tsx:43`

---

### #5: Missing focus-visible indicators for keyboard navigation — **High**

**What:**
The IDE components have excellent keyboard navigation (FileTreeNode has arrow key support, tab navigation, etc.) but the CSS lacks explicit `:focus-visible` styles for keyboard users. Only generic `:hover` states exist.

**Impact:**
Keyboard users have poor visual feedback. Fails WCAG 2.1 SC 2.4.7 (Focus Visible).

**Fix:**
Add focus-visible styles to `ide-neon.css`:

```css
.ide-file-node:focus-visible {
  outline: 2px solid var(--neon-cyan);
  outline-offset: -2px;
}

.ide-editor-tab:focus-visible {
  outline: 2px solid var(--neon-cyan);
  outline-offset: -2px;
}

.ide-context-menu__item:focus-visible {
  outline: 2px solid var(--neon-cyan);
  outline-offset: -2px;
}

.ide-sidebar__action-btn:focus-visible {
  outline: 2px solid var(--neon-cyan);
  outline-offset: -2px;
}
```

**Location:** `src/renderer/src/assets/ide-neon.css` (add new rules)

---

### #6: FileTreeNode component has ZERO test coverage — **High**

**What:**
FileTreeNode is a significant component (165 lines) with complex logic:

- Keyboard navigation (Enter, Space, Arrow keys)
- Expansion state management
- Recursive rendering
- File/folder icon logic
- Active state highlighting

Yet there is NO test file (`FileTreeNode.test.tsx` does not exist).

**Impact:**
High risk of regressions. Complex component untested. Branch coverage likely affected.

**Fix:**
Create `src/renderer/src/components/ide/__tests__/FileTreeNode.test.tsx` with tests for:

- Rendering file vs. folder icons
- Keyboard navigation (Enter, Space, Arrow Left/Right)
- Expansion/collapse behavior
- Active state when file is open
- Error state rendering
- Context menu data attributes
- Recursive child rendering

**Location:** `src/renderer/src/components/ide/__tests__/` (missing file)

---

### #7: EditorPane has minimal test coverage — **Medium**

**What:**
EditorPane only has 4 tests (lines 1-40 of EditorPane.test.tsx):

- Empty state rendering (2 tests)
- Monaco editor rendering (2 tests)

Missing coverage:

- `onContentChange` callback
- `onSave` callback
- Monaco theme switching (light/dark)
- Monaco editor mount lifecycle
- Keyboard shortcut registration (Cmd+S)

**Impact:**
Medium risk of regressions. Core functionality (save, change) not covered.

**Fix:**
Add tests for:

```typescript
it('calls onContentChange when content changes')
it('calls onSave when Cmd+S is pressed in Monaco')
it('switches Monaco theme when theme store changes')
it('registers Cmd+S command on mount')
```

**Location:** `src/renderer/src/components/ide/__tests__/EditorPane.test.tsx`

---

### #8: IDEView keyboard handler is too large (140+ lines) — **Medium**

**What:**
The keyboard event handler in IDEView (lines 224-365) is 141 lines long with 18 dependencies in the useEffect. This is hard to maintain and test.

**Impact:**
Low test coverage for individual keyboard shortcuts. Hard to debug when shortcuts conflict. Difficult to maintain as more shortcuts are added.

**Fix:**
Extract to a custom hook:

```typescript
// src/renderer/src/hooks/useIDEKeyboardShortcuts.ts
export function useIDEKeyboardShortcuts({
  activeView,
  focusedPanel,
  activeTabId
  // ... other deps
}) {
  useEffect(
    () => {
      // ... handler logic
    },
    [
      /* deps */
    ]
  )
}
```

Then in IDEView:

```typescript
useIDEKeyboardShortcuts({
  activeView,
  focusedPanel,
  activeTabId
  // ...
})
```

**Location:** `src/renderer/src/views/IDEView.tsx:224-365`

---

### #9: Magic numbers in FileTreeNode padding calculation — **Low**

**What:**
FileTreeNode uses hardcoded magic numbers for indentation (line 84):

```typescript
const paddingLeft = 8 + depth * 16
```

**Impact:**
Hard to adjust indent spacing. Not clear what 8 and 16 represent.

**Fix:**
Extract to constants:

```typescript
const TREE_BASE_PADDING = 8
const TREE_INDENT_PER_LEVEL = 16

const paddingLeft = TREE_BASE_PADDING + depth * TREE_INDENT_PER_LEVEL
```

Or add to `file-tree-constants.ts`:

```typescript
export const TREE_BASE_PADDING = 8
export const TREE_INDENT_PER_LEVEL = 16
```

**Location:** `src/renderer/src/components/ide/FileTreeNode.tsx:84`

---

### #10: Duplicate filename sanitization logic — **Low**

**What:**
FileSidebar has a `sanitizeFilename()` function (lines 31-44) that could be shared with other file operations. If other components need similar validation, they'll duplicate this logic.

**Impact:**
Low — only one usage currently. But creates maintenance burden if sanitization rules change.

**Fix:**
Extract to shared utility:

```typescript
// src/renderer/src/lib/file-utils.ts
export function sanitizeFilename(name: string): string | null {
  if (!name || name.trim() === '') return null
  const trimmed = name.trim()
  if (trimmed.includes('/') || trimmed.includes('\\') || trimmed === '.' || trimmed === '..') {
    return null
  }
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(trimmed)) {
    return null
  }
  return trimmed
}
```

**Location:** `src/renderer/src/components/ide/FileSidebar.tsx:31-44`

---

### #11: EditorTabBar middle-click close is non-discoverable — **Low**

**What:**
EditorTabBar supports middle-click to close tabs (lines 21-27), but this is not documented anywhere and there's no visual indication.

**Impact:**
Users won't know about this feature. Power users expect it (browser tabs pattern), but new users won't discover it.

**Fix:**
Add to keyboard shortcuts overlay (IDE_SHORTCUTS in IDEView.tsx):

```typescript
{ keys: 'Middle Click', desc: 'Close tab' }
```

Or add a tooltip to tabs that mentions middle-click.

**Location:** `src/renderer/src/components/ide/EditorTabBar.tsx:21-27`

---

### #12: No performance optimization on EditorPane — **Medium**

**What:**
EditorPane re-renders whenever any prop changes, even if `filePath` and `content` are the same. Monaco Editor is heavy to re-mount.

**Impact:**
Potential performance issue when switching between tabs or when parent re-renders.

**Fix:**
Wrap with React.memo and custom comparison:

```typescript
export const EditorPane = React.memo(
  function EditorPane({
    filePath,
    content,
    language,
    onContentChange,
    onSave
  }: EditorPaneProps): React.JSX.Element {
    // ... existing code
  },
  (prev, next) => {
    return (
      prev.filePath === next.filePath &&
      prev.content === next.content &&
      prev.language === next.language
    )
  }
)
```

**Location:** `src/renderer/src/components/ide/EditorPane.tsx`

---

### #13: Error handling lacks error boundaries — **Medium**

**What:**
IDE components can crash (e.g., Monaco fails to load, file system errors). There are no React error boundaries to catch these.

**Impact:**
A crash in the IDE view could bring down the entire app UI. Poor user experience.

**Fix:**
Add error boundary in IDEView:

```typescript
import { ErrorBoundary } from '../components/ui/ErrorBoundary'

// In render:
<ErrorBoundary fallback={<IDEErrorState />}>
  {/* existing IDE content */}
</ErrorBoundary>
```

Create a simple fallback component that shows the error and a reload button.

**Location:** `src/renderer/src/views/IDEView.tsx`

---

### #14: Sidebar toggle button lacks hover state documentation — **Low**

**What:**
The sidebar toggle button (`.ide-sidebar-toggle`) appears when sidebar is collapsed and no tabs are open. It has hover styles but no aria-label to explain what it does.

**Impact:**
Minor accessibility issue. Screen reader users won't know what the button does.

**Fix:**
Add aria-label in IDEView.tsx (line 405):

```tsx
<button
  className="ide-sidebar-toggle"
  onClick={toggleSidebar}
  aria-label="Show file explorer sidebar"
>
  <PanelLeftOpen size={16} />
</button>
```

**Location:** `src/renderer/src/views/IDEView.tsx:405`

---

### #15: FileTree and FileTreeNode don't handle symlinks — **Low**

**What:**
The file tree uses `type: 'file' | 'directory'` but doesn't handle symlinks. If the backend returns a symlink, it will be treated as a regular file/folder.

**Impact:**
Low — symlinks in most codebases are rare. But could cause confusion if a symlinked directory doesn't expand.

**Fix:**
Update `DirEntry` type in `file-tree-constants.ts`:

```typescript
export interface DirEntry {
  name: string
  type: 'file' | 'directory' | 'symlink'
  size: number
}
```

Add symlink icon to FileTreeNode `getFileIcon()`:

```typescript
import { Link } from 'lucide-react'

// In FileTreeNode:
if (type === 'symlink') return <Link size={14} />
```

**Location:** `src/renderer/src/components/ide/file-tree-constants.ts`, `FileTreeNode.tsx`

---

## Recommendations

### Immediate (Critical/High priority)

1. **Fix font sizes** (#1) — single CSS change, fixes accessibility violation
2. **Add focus-visible styles** (#5) — critical for keyboard users, WCAG compliance
3. **Add FileTreeNode tests** (#6) — zero coverage on complex component is risky

### Short-term (Medium priority)

4. **Remove inline styles** (#2, #3, #4) — enforce design system consistency
5. **Extract keyboard handler hook** (#8) — improve maintainability
6. **Add EditorPane test coverage** (#7) — cover callbacks and lifecycle
7. **Add error boundary** (#13) — prevent IDE crashes from breaking app
8. **Add React.memo to EditorPane** (#12) — prevent unnecessary Monaco re-renders

### Long-term (Low priority)

9. **Extract sanitization utility** (#10) — DRY principle
10. **Document middle-click** (#11) — discoverability
11. **Add aria-label to sidebar toggle** (#14) — screen reader support
12. **Handle symlinks** (#15) — edge case coverage

---

## Test Coverage Analysis

### Well-covered ✅

- IDEView (950 lines of tests, very comprehensive)
- ide.ts store (349 lines of tests, comprehensive)
- IDEEmptyState (84 lines)
- FileSidebar (114 lines)
- FileTree (63 lines)

### Under-covered ⚠️

- EditorPane (40 lines, minimal — only rendering, no callbacks)
- EditorTabBar (no test file found via glob, but listed in ls)
- FileContextMenu (test file exists but not read)
- TerminalPanel (test file exists but not read)
- UnsavedDialog (test file exists but not read)

### Not covered ❌

- **FileTreeNode** (0 tests — significant gap!)

---

## Design System Compliance

### Compliant ✅

- File tree components use CSS classes consistently
- Tab bars use neon tokens
- Sidebar uses neon tokens
- Keyboard shortcuts overlay mostly uses CSS classes

### Non-compliant ❌

- IDEView loading indicator (inline styles)
- FileSidebar empty state (inline styles)
- FileTree error state (inline styles)

---

## Accessibility Summary

### Good ✅

- ARIA roles on all interactive elements (tree, tablist, menu, dialog)
- Keyboard navigation fully implemented
- Tab management (tabIndex=-1 for non-active tabs)
- Screen reader labels on buttons

### Needs improvement ❌

- No `:focus-visible` indicators (#5)
- Font sizes below 10px (#1)
- Missing aria-label on sidebar toggle (#14)

---

## Performance Summary

### Good ✅

- useCallback on event handlers
- ResizeObserver for overflow detection
- Lazy loading of file contents
- Debounced persistence (2s)

### Could improve ⚠️

- EditorPane lacks memoization (#12)
- Large keyboard handler could be split (#8)
- No error boundary to contain crashes (#13)

---

## Conclusion

The IDE view is architecturally sound with excellent keyboard navigation and strong test coverage for the main view. The primary concerns are:

1. **Accessibility gaps**: Font sizes below minimum, no focus-visible indicators
2. **Test coverage gap**: FileTreeNode has zero tests despite being complex
3. **Design system leakage**: Several inline styles violate neon conventions

Addressing the 3 immediate recommendations will significantly improve UX quality and reduce risk.
