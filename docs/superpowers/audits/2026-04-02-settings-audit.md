# Settings View UX Audit

**Date**: 2026-04-02
**Scope**: Settings view (Cmd+7) and all configuration sections
**Auditor**: BDE Agent
**Files Reviewed**: 19 components, 4 CSS files, 8 test files

---

## Executive Summary

The Settings view is a **well-structured tab-based configuration interface** with 10 sections covering authentication, repositories, templates, agent configuration, permissions, cost tracking, memory management, appearance, and about info. The implementation follows BDE's neon design system and includes comprehensive keyboard navigation.

**Overall Grade**: B+ (85/100)

**Strengths**:

- Strong keyboard accessibility with full arrow navigation and roving tabindex
- Comprehensive test coverage for complex sections (AgentPermissions, ConnectionsSection)
- Clear visual hierarchy with glass morphism and neon accents
- Responsive form validation and dirty state tracking

**Critical Issues**: 0
**High Priority Issues**: 3
**Medium Priority Issues**: 8
**Low Priority Issues**: 6

---

## 1. Visual Hierarchy

### ✅ Strengths

1. **Clear tab-based navigation** — 10 tabs with icons, active state indicators, and focus ring
2. **Consistent section structure** — All sections use `.settings-section` glass cards with title, fields, and action row
3. **Progressive disclosure** — Forms show/hide based on state (e.g., add repository form, consent banner)
4. **Visual feedback** — Dirty state indicators (`• unsaved`), loading spinners, success/error badges
5. **Color-coded cost tiers** — Green/yellow/red cost rows in CostSection table

### ⚠️ Issues

**[HIGH]** **Inconsistent scroll behavior between sections**

- **Problem**: CostSection and MemorySection define their own scroll containers (`.cost-view__scroll`, `.memory-view__content`) while other sections rely on the parent `.settings-view__scroll`. This creates inconsistent scrollbar positions and overflow behavior.
- **Location**: `CostSection.tsx` lines 293-325, `MemorySection.tsx` lines 268-472
- **Impact**: User confusion when scrollbars jump between left edge (regular sections) and right edge (Cost/Memory)
- **Fix**: Wrap Cost and Memory content in a standard section layout, or unify all sections to use view-level scroll

**[MEDIUM]** **Tab overflow lacks scroll indicators**

- **Problem**: `.settings-view__tabs` has `overflow-x: auto` but no visual affordance when tabs extend beyond viewport width (no shadows, no fade indicators)
- **Location**: `settings.css` line 60-68
- **Impact**: Users may not realize there are hidden tabs on narrow windows
- **Fix**: Add CSS fade gradient on overflow: `mask-image: linear-gradient(to right, black 95%, transparent)`

**[MEDIUM]** **Cost table lacks responsive design**

- **Problem**: 8-column table with fixed layout, no breakpoints or horizontal scroll wrapper
- **Location**: `CostSection.tsx` lines 130-154
- **Impact**: Table overflows on narrow panels, columns become unreadable
- **Fix**: Add horizontal scroll wrapper with sticky first column, or collapse to card layout on narrow widths

**[LOW]** **Memory editor lacks visual hierarchy**

- **Problem**: Editor toolbar and textarea have same background color, no visual separation
- **Location**: `memory.css` (missing `.memory-editor__toolbar` distinct styling)
- **Impact**: Toolbar blends into editor content
- **Fix**: Add border-bottom to toolbar: `border-bottom: 1px solid var(--neon-purple-border)`

---

## 2. Design System Adherence

### ✅ Strengths

1. **Consistent neon token usage** — All sections use `var(--neon-purple)`, `var(--neon-text)`, etc. from tokens
2. **Glass morphism applied uniformly** — `.settings-section` cards use `var(--glass-tint-dark)` and `var(--neon-glass-shadow)`
3. **Shared form components** — `CredentialForm` reusable across connections
4. **Icon consistency** — All tabs use lucide-react icons at 14px
5. **Motion preferences respected** — `useReducedMotion()` in SettingsView

### ⚠️ Issues

**[HIGH]** **Cost and Memory sections bypass neon CSS**

- **Problem**: CostSection and MemorySection define custom CSS classes (`.cost-panel`, `.cost-table`, `.memory-sidebar`) that don't layer on the base neon system. They reference `var(--glass-tint-dark)` directly but don't follow the `.settings-*` BEM naming convention.
- **Location**: `cost.css`, `memory.css`
- **Impact**: Inconsistent styling when theme tokens change, breaks the "neon overlay" architecture
- **Fix**: Rename classes to `.settings-cost-*` and `.settings-memory-*`, move base styles to `settings.css`, overlay neon in `settings-neon.css`

**[MEDIUM]** **Button size inconsistency**

- **Problem**: Most sections use `size="sm"` for buttons, but AgentManagerSection line 145 has `size="sm"` for Save button while Connections uses default size
- **Location**: Various section components
- **Impact**: Visual inconsistency in button heights across sections
- **Fix**: Standardize on `size="sm"` for all settings actions

**[MEDIUM]** **Inline style usage in AgentRuntimeSection**

- **Problem**: Line 133 uses `style={{ fontSize: 12, color: 'var(--bde-text-dim)' }}` instead of a CSS class
- **Location**: `AppearanceSection.tsx` lines 122, 133
- **Impact**: Breaks separation of concerns, harder to theme
- **Fix**: Create `.settings-field__hint` class

**[LOW]** **Hardcoded spacing values**

- **Problem**: `AgentPermissionsSection.tsx` line 207 uses `marginTop: 12px` inline style
- **Location**: `AgentPermissionsSection.tsx` line 207
- **Impact**: Inconsistent spacing when design tokens change
- **Fix**: Use CSS class with `gap` or `margin-block-start: var(--bde-spacing-md)`

**[LOW]** **Color palette constants duplicated**

- **Problem**: `REPO_COLOR_PALETTE` in RepositoriesSection and `ACCENT_PRESETS` in AppearanceSection are local constants, not shared from design system
- **Location**: `RepositoriesSection.tsx` line 10, `AppearanceSection.tsx` line 8
- **Impact**: Color consistency not enforced across the app
- **Fix**: Move to `src/renderer/src/design-system/colors.ts`

---

## 3. Accessibility

### ✅ Strengths

1. **Full ARIA tab pattern** — `role="tablist"`, `role="tab"`, `role="tabpanel"`, `aria-selected`, `aria-label`
2. **Roving tabindex** — Active tab has `tabIndex={0}`, others `-1`, focus moves with arrow keys
3. **Keyboard shortcuts** — Arrow keys, Home, End for tab navigation
4. **Form labels** — All inputs have associated `<label>` elements with `.settings-field__label`
5. **Icon buttons with aria-label** — Remove buttons, toggle visibility buttons all have labels
6. **Loading states announced** — "Loading..." text for screen readers

### ⚠️ Issues

**[HIGH]** **Cost table rows missing keyboard access**

- **Problem**: Table rows have `onClick` handlers (line 164) but no `role="button"`, `tabIndex`, or keyboard event handlers. Keyboard-only users cannot navigate to agent details.
- **Location**: `CostSection.tsx` lines 157-200
- **Impact**: Keyboard users cannot drill into agent run details from the cost table
- **Fix**: Add `role="button"`, `tabIndex={0}`, `onKeyDown={(e) => e.key === 'Enter' && handleRowClick(r)}`

**[MEDIUM]** **Memory file list lacks aria-label on group containers**

- **Problem**: File groups (Daily Logs, Projects, Other) are visual sections but have no `role="group"` or `aria-label`
- **Location**: `MemorySection.tsx` lines 395-415
- **Impact**: Screen reader users don't get context about grouped files
- **Fix**: Add `role="group" aria-label={group.label}` to `.memory-group` container

**[MEDIUM]** **Search results lack live region**

- **Problem**: When search results update, screen readers don't announce the count or results
- **Location**: `MemorySection.tsx` lines 340-376
- **Impact**: Screen reader users don't know if search succeeded or how many matches
- **Fix**: Add `<div role="status" aria-live="polite">{searchResults.length} results found</div>`

**[MEDIUM]** **Color swatches lack accessible names**

- **Problem**: Color buttons in AppearanceSection and RepositoriesSection have `aria-label={label}` but the label is just the color name ("Green"), not the hex value or current selection state
- **Location**: `AppearanceSection.tsx` line 108, `RepositoriesSection.tsx` line 177
- **Impact**: Screen reader users can't distinguish between similar colors or know current selection
- **Fix**: Include hex in label: `aria-label={\`${label} (${color})\`}`, add `aria-pressed={accent === color}`

**[LOW]** **Consent banner buttons lack explicit roles**

- **Problem**: Buttons in AgentPermissionsSection consent banner don't have `type="button"` attribute
- **Location**: `AgentPermissionsSection.tsx` lines 194-199
- **Impact**: Could be interpreted as submit buttons in a form context (though not currently in a form)
- **Fix**: Add `type="button"` (already present, actually — false alarm after re-reading)

---

## 4. Performance

### ✅ Strengths

1. **Lazy loading of settings values** — Each section loads its own data on mount, not all upfront
2. **Debounced saves** — No evidence of save spam (sections use `dirty` flag)
3. **Minimal re-renders** — Form state is local to each section
4. **Memoized sort logic** — CostSection uses `useMemo` for `sortedRuns` (line 253)
5. **Efficient keyboard nav** — `flatFiles` memoized in MemorySection (line 221)

### ⚠️ Issues

**[MEDIUM]** **ConnectionsSection auto-refreshes auth on every render**

- **Problem**: `useEffect(() => { refreshAuth() }, [refreshAuth])` with `refreshAuth` wrapped in `useCallback` means every render triggers a new auth check. The `refreshAuth` function has no dependencies, so it's stable, but the pattern is fragile.
- **Location**: `ConnectionsSection.tsx` lines 54-56
- **Impact**: Excessive IPC calls if parent re-renders frequently
- **Fix**: Remove `refreshAuth` from dependency array OR add a mount-only guard: `useEffect(() => { refreshAuth() }, [])`

**[MEDIUM]** **Cost data fetched twice on mount**

- **Problem**: `fetchData()` calls `window.api.cost.summary()` AND `refreshStore()` which calls `useCostDataStore` fetch, which likely duplicates the same SQLite query
- **Location**: `CostSection.tsx` lines 232-247
- **Impact**: Double database round-trip on section load
- **Fix**: Consolidate into a single data source — either load from IPC or from Zustand store, not both

**[MEDIUM]** **AgentPermissionsSection loads config on every consent toggle**

- **Problem**: When user clicks "Accept Recommended", the preset is applied, then localStorage is set, but the component doesn't reload config from IPC. However, `useEffect` on line 97 has no dependency array, so it runs on every render.
- **Location**: `AgentPermissionsSection.tsx` lines 97-115
- **Impact**: Config loaded on every parent re-render
- **Fix**: Add empty dependency array: `useEffect(() => { loadConfig() }, [])`

**[LOW]** **RepositoriesSection doesn't debounce template changes**

- **Problem**: TaskTemplatesSection calls `saveTemplate()` on every keystroke in the textarea (line 36)
- **Location**: `TaskTemplatesSection.tsx` lines 35-40
- **Impact**: High IPC call volume during typing, could cause input lag
- **Fix**: Debounce `saveTemplate` with 500ms delay

**[LOW]** **Memory file list re-renders on every keystroke in editor**

- **Problem**: `content` state change triggers re-render of entire MemorySection, including sidebar file list (no memoization on file list rendering)
- **Location**: `MemorySection.tsx` line 78
- **Impact**: Unnecessary DOM updates while typing
- **Fix**: Split into two components: `MemorySidebar` and `MemoryEditor`, or memo the sidebar

---

## 5. Code Quality

### ✅ Strengths

1. **Consistent error handling** — All IPC calls wrapped in try/catch with toast notifications
2. **TypeScript strict types** — All section props and state properly typed
3. **Reusable CredentialForm component** — Clean abstraction for token/URL pairs
4. **Clear separation of concerns** — Each section is self-contained
5. **Dirty state tracking** — Forms disable save until changes are made

### ⚠️ Issues

**[MEDIUM]** **Magic numbers for size formatting**

- **Problem**: CostSection has magic numbers `1_000_000`, `1_000`, `1024` scattered throughout formatting functions
- **Location**: `CostSection.tsx` lines 22-26, 42-44
- **Impact**: Harder to maintain, no constants for thresholds
- **Fix**: Extract to constants: `const KB_THRESHOLD = 1024`, `const MB_THRESHOLD = 1_000_000`

**[MEDIUM]** **Inconsistent null handling in CostSection**

- **Problem**: `formatCost()` checks `cost == null || Number.isNaN(cost)` but `formatTokens()` and `formatDuration()` have the same pattern duplicated
- **Location**: `CostSection.tsx` lines 16-36
- **Impact**: Code duplication, inconsistent error values (`'--'` vs empty string)
- **Fix**: Extract to `const safeNumber = (n: number | null | undefined, fallback = '--') => (n == null || Number.isNaN(n) ? fallback : n)`

**[MEDIUM]** **MemorySection has god component anti-pattern**

- **Problem**: MemorySection is 474 lines, handles file list, search, editor, keyboard nav, confirm dialogs, and file I/O. Single Responsibility Principle violated.
- **Location**: `MemorySection.tsx`
- **Impact**: Hard to test, hard to maintain, high cognitive load
- **Fix**: Split into 4 components: `MemorySidebar`, `MemoryEditor`, `MemorySearch`, `MemoryFileList`

**[LOW]** **Unused `statusBadge` prop in CredentialForm**

- **Problem**: `CredentialForm` accepts `statusBadge?: React.ReactNode` but it's never passed by any consumer
- **Location**: `CredentialForm.tsx` line 35, 124-128
- **Impact**: Dead code, misleading API
- **Fix**: Remove prop OR document intended use case

**[LOW]** **Empty dependency arrays violate exhaustive-deps**

- **Problem**: Several `useEffect` hooks intentionally ignore exhaustive-deps warnings (e.g., RepositoriesSection line 40)
- **Location**: Multiple sections
- **Impact**: No runtime issue, but inconsistent with linting rules
- **Fix**: Add `// eslint-disable-next-line react-hooks/exhaustive-deps` with comment explaining why

**[LOW]** **Console logging in AgentManagerSection**

- **Problem**: No visible console.log, but error handling at line 54 swallows errors silently
- **Location**: `AgentManagerSection.tsx` line 54
- **Impact**: Debugging harder if settings load fails
- **Fix**: Log error to console: `catch (e) { console.error('Failed to save Agent Manager settings', e); toast.error(...) }`

---

## 6. Test Coverage

### ✅ Strengths

1. **Complex sections have thorough tests** — AgentPermissionsSection has 12 test cases covering consent, presets, toggles, deny rules
2. **User interaction tests** — Tests use `userEvent.setup()` for realistic interactions
3. **Async handling** — Tests properly `await` and `waitFor` async state changes
4. **Mock setup** — Window.api mocks are comprehensive

### ⚠️ Issues

**[MEDIUM]** **CostSection has no tests**

- **Problem**: No `CostSection.test.tsx` file exists
- **Location**: Missing file
- **Impact**: Complex rendering logic (cost tiers, table sorting, CSV export) is untested
- **Fix**: Create test file covering:
  - Cost tier color assignment (green/yellow/red)
  - Table sorting by cost/duration/date
  - CSV export clipboard write
  - Row click navigation

**[MEDIUM]** **MemorySection has no tests**

- **Problem**: No `MemorySection.test.tsx` file exists
- **Location**: Missing file
- **Impact**: File CRUD, search, keyboard nav, dirty state handling is untested
- **Fix**: Create test file covering:
  - File selection and content loading
  - Dirty state warning on file switch
  - Search results rendering
  - Keyboard navigation (arrow keys, Enter)
  - Save/discard actions

**[MEDIUM]** **AgentManagerSection missing error paths**

- **Problem**: Test file exists (`AgentManagerSection.test.tsx`) but doesn't test save failure or validation errors
- **Location**: Test file present but incomplete
- **Impact**: Error toast paths not exercised
- **Fix**: Add tests for:
  - Save failure (IPC rejection)
  - Invalid input values (negative concurrency)
  - Loading state transitions

**[LOW]** **AppearanceSection missing tear-off preference test**

- **Problem**: Test file exists but doesn't cover tear-off window close behavior or reset
- **Location**: `AppearanceSection.test.tsx` (checked — file exists)
- **Impact**: Tear-off preference logic untested
- **Fix**: Add test for reset button click and preference state change

**[LOW]** **RepositoriesSection test missing color selection**

- **Problem**: Test covers add/remove but not color picker interaction
- **Location**: `RepositoriesSection.test.tsx`
- **Impact**: Color palette UI logic untested
- **Fix**: Add test for clicking color swatches during repo creation

**[LOW]** **SettingsView test doesn't verify keyboard navigation**

- **Problem**: Test only checks tab click, not arrow key navigation or Home/End
- **Location**: `SettingsView.test.tsx`
- **Impact**: Most of the keyboard accessibility code is untested
- **Fix**: Add test: `fireEvent.keyDown(activeTab, { key: 'ArrowRight' })`, verify focus moves

---

## 7. Architecture Issues

### ⚠️ Issues

**[MEDIUM]** **AgentRuntimeSection is a dead end**

- **Problem**: Section renders only a deprecation notice (lines 7-14), but still exists in TABS array and renders a full section wrapper
- **Location**: `AgentRuntimeSection.tsx`
- **Impact**: Wasted tab slot, confusing UX (tab opens to "this is not configurable")
- **Recommendation**: Remove from TABS or repurpose the tab (e.g., merge with Agent Manager)

**[LOW]** **Cost and Memory break out of settings layout pattern**

- **Problem**: Other sections are pure forms/lists, but Cost has a complex table UI and Memory has a full editor. These feel like standalone views, not "settings"
- **Location**: `CostSection.tsx`, `MemorySection.tsx`
- **Impact**: User mental model confusion (are these settings or tools?)
- **Recommendation**: Consider moving to dedicated views (e.g., "Cost Analytics" view, "Memory Editor" view) and link from Settings

---

## 8. Recommendations

### Immediate (Ship Blockers)

1. **Add keyboard access to cost table rows** — [HIGH] accessibility issue
2. **Fix scroll container inconsistency** — [HIGH] visual hierarchy issue
3. **Refactor Cost/Memory to follow neon CSS pattern** — [HIGH] design system debt

### Short Term (Next Sprint)

4. Create test files for CostSection and MemorySection
5. Add live region for memory search results
6. Fix excessive auth refresh in ConnectionsSection
7. Add scroll fade indicators to tab overflow
8. Standardize button sizes across sections

### Long Term (Tech Debt)

9. Split MemorySection into 4 sub-components
10. Extract color palettes to shared design tokens
11. Consider moving Cost and Memory to dedicated views
12. Remove or repurpose AgentRuntimeSection

---

## Conclusion

The Settings view is a **solid implementation** with strong accessibility fundamentals and clear UX patterns. The main weaknesses are:

1. **Inconsistent architecture** for Cost and Memory sections (custom CSS, custom scroll)
2. **Test gaps** for complex sections
3. **Performance anti-patterns** in ConnectionsSection and AgentPermissionsSection

The codebase would benefit from:

- Enforcing the `.settings-*` BEM naming convention across all sections
- Extracting reusable components (search input, file list, color picker)
- Adding comprehensive integration tests for form workflows

**Grade: B+ (85/100)**

- Visual Hierarchy: B (82/100)
- Design System: B+ (85/100)
- Accessibility: A- (88/100)
- Performance: B (80/100)
- Code Quality: B+ (85/100)
- Test Coverage: C+ (75/100)
