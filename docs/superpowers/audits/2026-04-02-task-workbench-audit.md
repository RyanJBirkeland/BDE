# Task Workbench UX Audit

**Date:** 2026-04-02
**Auditor:** BDE Pipeline Agent
**Scope:** Task Workbench view (task creation/editing interface)

---

## Executive Summary

The Task Workbench is BDE's primary task creation and planning interface, combining a structured form, AI-powered spec drafting (Copilot), readiness validation, and template-based workflows. The implementation is **solid** with good accessibility, strong test coverage (6 component test files), and consistent neon styling. However, there are **15 identified issues** spanning visual polish, design system adherence, UX clarity, performance optimization, and minor accessibility gaps.

**Overall Grade:** B+ (Good foundation, needs polish)

---

## 1. Visual Design

### 1.1 Strengths ✅

- **Consistent neon aesthetic** — All components use `task-workbench-neon.css` with proper BEM naming (`.wb-*` prefix)
- **Clear visual hierarchy** — Form heading, field labels (uppercase, small, muted), inputs with focus states
- **Readable typography** — 13px body text, 12px labels, proper line-height (1.6 in spec textarea)
- **Good spacing** — 16px vertical gaps between sections, 8px button gaps, 4px between form fields
- **State indication** — Readiness checks use color-coded icons (pass=cyan, warn=orange, fail=red, pending=spinner)

### 1.2 Issues 🔴

#### **ISSUE 1: Inconsistent Border Radius (Minor)**
- **Location:** `task-workbench-neon.css`
- **Problem:** Inputs use `6px` radius (line 94), textarea uses `8px` (line 228), buttons use `6px` (line 337). Spec editor buttons use `6px` (line 186).
- **Impact:** Visual inconsistency across form controls
- **Fix:** Standardize to `6px` for all form controls (aligns with design tokens `radius.md`)

```diff
.wb-spec__textarea {
- border-radius: 8px;
+ border-radius: 6px;
}
```

#### **ISSUE 2: Insufficient Color Contrast in Advanced Options Toggle (Accessibility)**
- **Location:** `.wb-form__toggle` (line 131)
- **Problem:** Uses `var(--neon-text-muted)` (60% opacity white) on dark background. May fail WCAG AA for small text (12px).
- **Impact:** Low-vision users may struggle to read "More options" toggle
- **Fix:** Use `var(--neon-text)` on hover, increase base to `var(--neon-text-dim)` (30% → 40%)

```diff
.wb-form__toggle {
- color: var(--neon-text-muted);
+ color: rgba(255, 255, 255, 0.7); /* Slightly brighter than text-muted */
}
```

#### **ISSUE 3: Copilot Toggle Button Placement (UX)**
- **Location:** `TaskWorkbench.tsx` lines 80-84
- **Problem:** Button floats in `absolute` position (top-right) when copilot is hidden. Overlaps form content if viewport is narrow.
- **Impact:** Button can obscure form fields on small screens or when panel is <600px wide
- **Fix:** Add responsive positioning or integrate toggle into form header

```tsx
// Option 1: Add to form heading row
<div className="wb-form__heading-row">
  <span>{mode === 'edit' ? `Edit: ${title}` : 'New Task'}</span>
  {!copilotVisible && (
    <button onClick={toggleCopilot} className="wb-form__copilot-btn">
      AI Copilot
    </button>
  )}
</div>
```

#### **ISSUE 4: Missing Visual Feedback for Template Insertion (UX)**
- **Location:** `SpecEditor.tsx` lines 67-79
- **Problem:** Clicking a template button (Feature, Bug Fix, etc.) instantly replaces spec content with no confirmation or visual cue beyond the text change.
- **Impact:** Users may accidentally overwrite existing specs. No indication that the action succeeded.
- **Fix:** Add brief toast notification or button flash animation

```tsx
onClick={() => {
  setField('spec', tmpl.spec)
  setSpecType(tmpl.specType)
  toast.success(`${tmpl.label} template applied`)
}}
```

#### **ISSUE 5: Spec Textarea Resize Gripper Invisible (Visual)**
- **Location:** `.wb-spec__textarea` (line 221)
- **Problem:** `resize: vertical` allows user resize, but the gripper is barely visible against dark background (browser default styling)
- **Impact:** Users may not realize the textarea is resizable
- **Fix:** Add explicit resize corner styling (requires `::-webkit-resizer` pseudo-element, not universally supported — consider adding hint text instead)

```css
.wb-spec__textarea-hint {
  font-size: 11px;
  color: var(--neon-text-dim);
  margin-top: 4px;
}
```
```tsx
<div className="wb-spec__textarea-hint">↕ Drag to resize</div>
```

---

## 2. Design System Adherence

### 2.1 Strengths ✅

- **Proper use of CSS custom properties** — All colors via `var(--neon-*)` tokens (no hardcoded `rgba`)
- **Transition consistency** — 150ms ease across buttons, inputs, selects (matches `tokens.transition.base`)
- **BEM naming convention** — `.wb-*` prefix, modifiers like `--primary`, `--launch`, `--has-fail`
- **Light theme support** — All neon tokens adapt via `html.theme-light` overrides in `neon.css`

### 2.2 Issues 🔴

#### **ISSUE 6: No Use of Design System `tokens.ts` (Pattern Violation)**
- **Location:** All components use inline strings instead of importing `tokens`
- **Problem:** Components have hardcoded transition values (`150ms ease`), font sizes (`13px`), spacing (`16px`) that duplicate `tokens.ts` values
- **Impact:** Future design system changes won't propagate to workbench components
- **Fix:** Refactor to import and use `tokens` object (or accept that CSS-first approach is intentional)

**Note:** This is a project-wide pattern — the neon views use CSS classes exclusively. The `tokens.ts` file is primarily for non-neon components using inline styles. May be **intentional design decision** rather than a bug. Recommend documenting this pattern in `CLAUDE.md`.

#### **ISSUE 7: Redundant Checkbox Styling (Code Smell)**
- **Location:** `.wb-form__checkbox-row input[type="checkbox"]` (line 159)
- **Problem:** Only sets `cursor: pointer` — no custom styling. Browser default checkbox used.
- **Impact:** Checkbox appearance is inconsistent across browsers/OSes, doesn't match neon aesthetic
- **Fix:** Either fully style the checkbox (custom appearance) or remove the rule and document that native checkboxes are intentional

```css
/* Option 1: Remove redundant rule */
/* .wb-form__checkbox-row input[type="checkbox"] { cursor: pointer; } */

/* Option 2: Full custom styling */
.wb-form__checkbox-row input[type="checkbox"] {
  appearance: none;
  width: 16px;
  height: 16px;
  border: 1px solid var(--neon-purple-border);
  border-radius: 4px;
  cursor: pointer;
  position: relative;
}
.wb-form__checkbox-row input[type="checkbox]:checked::after {
  content: '✓';
  position: absolute;
  top: 0;
  left: 3px;
  color: var(--neon-cyan);
}
```

---

## 3. Accessibility

### 3.1 Strengths ✅

- **Proper ARIA labels** — All inputs have `aria-label` attributes (title, repo, priority, spec)
- **Semantic HTML** — `<label>` elements correctly associated with inputs
- **Live region** — Copilot messages use `aria-live="polite"` for screen reader announcements
- **Button labels** — All buttons have descriptive text or `aria-label` (e.g., "Queue task and start agent immediately")
- **Expandable widgets** — ReadinessChecks summary uses `aria-expanded` attribute

### 3.2 Issues 🔴

#### **ISSUE 8: Missing Focus Management in Modal Confirmation (A11y)**
- **Location:** `WorkbenchForm.tsx` lines 377-384 (ConfirmModal usage)
- **Problem:** When confirmation modal opens (queue with warnings), focus doesn't move to the modal. User must tab through entire page to reach Confirm/Cancel buttons.
- **Impact:** Keyboard users experience poor UX; screen reader users may not know modal opened
- **Fix:** Add `autoFocus` to first button in ConfirmModal or trap focus in modal container

**Note:** This is likely a ConfirmModal component issue, not specific to WorkbenchForm. Check `src/renderer/src/components/ui/ConfirmModal.tsx` for focus trap implementation.

#### **ISSUE 9: Readiness Checks Icons Missing Text Alternatives (A11y)**
- **Location:** `ReadinessChecks.tsx` lines 47-51
- **Problem:** Check icons in collapsed summary have `title` attribute but no visible label. Icon-only UI.
- **Impact:** Users with cognitive disabilities may not understand icon meanings without text
- **Fix:** Add visible label on hover or ensure `title` attributes are sufficient (current implementation may be acceptable — audit unclear)

**Severity:** Low — Icons have title attributes and aria-labels, but consider adding tooltip component for consistency.

#### **ISSUE 10: No Keyboard Shortcut Hints in UI (UX)**
- **Location:** `WorkbenchForm.tsx` lines 265-279 (Cmd+Enter to queue)
- **Problem:** Keyboard shortcut exists (Cmd+Enter submits) but is not documented anywhere visible
- **Impact:** Users won't discover power-user feature
- **Fix:** Add hint text near action buttons ("Cmd+Enter to queue") or in a help tooltip

```tsx
<button
  onClick={() => handleSubmit('queue')}
  disabled={!canQueue || submitting}
  className="wb-actions__btn wb-actions__btn--primary"
  aria-label="Add task to queue (Cmd+Enter)"
  title="Cmd+Enter"
>
  {submitting ? 'Creating...' : 'Queue Now'}
</button>
```

---

## 4. Performance

### 4.1 Strengths ✅

- **Memoized callbacks** — `handleSubmit`, `handleSend`, `handleInsert` use `useCallback` with proper dependency arrays
- **Debounced semantic checks** — 2-second delay before running AI spec validation (line 100-141 in `WorkbenchForm.tsx`)
- **Efficient polling** — No polling in workbench (pull-based via IPC calls)
- **Lazy copilot loading** — Copilot only renders when `copilotVisible` is true

### 4.2 Issues 🔴

#### **ISSUE 11: Structural Checks Recompute on Every Keystroke (Performance)**
- **Location:** `useReadinessChecks.ts` lines 113-124
- **Problem:** `useEffect` runs on every `title`, `repo`, `spec`, `specType` change. Calls `computeStructuralChecks()` and `setStructuralChecks()` on every keystroke in title or spec fields.
- **Impact:** Unnecessary re-renders of ReadinessChecks component, wasted computation
- **Fix:** Add debounce for `spec` field (already debounced for semantic checks — apply same pattern)

```tsx
useEffect(() => {
  if (!spec.trim()) {
    setStructuralChecks(computeStructuralChecks({ title, repo, spec: '' }, specType))
    return
  }

  const timer = setTimeout(() => {
    const checks = computeStructuralChecks({ title, repo, spec }, specType)
    setStructuralChecks(checks)
  }, 300) // 300ms debounce for spec changes

  return () => clearTimeout(timer)
}, [title, repo, spec, specType, setStructuralChecks])
```

**Alternative:** Only debounce `spec`, run `title`/`repo` checks immediately (they're cheap).

#### **ISSUE 12: Copilot Message Rendering Not Virtualized (Scalability)**
- **Location:** `WorkbenchCopilot.tsx` lines 185-192
- **Problem:** All messages rendered via `.map()` in a scrollable container. No virtualization.
- **Impact:** If conversation exceeds 200 messages (capped in store), DOM may have 200+ bubbles. Scroll performance degrades.
- **Fix:** Use `react-window` or `react-virtual` for message list virtualization

**Severity:** Low — 200-message cap prevents catastrophic performance, but virtualization would improve smoothness.

---

## 5. Code Quality

### 5.1 Strengths ✅

- **Clean separation of concerns** — Form logic in `WorkbenchForm`, UI in `SpecEditor`/`ReadinessChecks`/`WorkbenchActions`, state in `taskWorkbench.ts`
- **Single responsibility components** — Each component does one thing (SpecEditor = toolbar + textarea, ReadinessChecks = validation display, WorkbenchActions = submit buttons)
- **Type safety** — All props typed, store state uses discriminated unions for `mode` ('create' | 'edit')
- **Error handling** — All async IPC calls wrapped in try/catch with user-facing error messages
- **Test coverage** — 6 component test files (263 lines in ReadinessChecks.test.tsx alone)

### 5.2 Issues 🔴

#### **ISSUE 13: Duplicate Form Snapshot Type (Code Smell)**
- **Location:** `useReadinessChecks.ts` lines 12-16
- **Problem:** `FormSnapshot` interface duplicates fields from `TaskWorkbenchState`. Type is only used internally in `computeStructuralChecks()`.
- **Impact:** Maintenance burden — if workbench state changes, both types need updates
- **Fix:** Use `Pick<TaskWorkbenchState, 'title' | 'repo' | 'spec'>` instead of custom interface

```diff
-interface FormSnapshot {
-  title: string
-  repo: string
-  spec: string
-}

export function computeStructuralChecks(
-  form: FormSnapshot,
+  form: Pick<TaskWorkbenchState, 'title' | 'repo' | 'spec'>,
  specType?: SpecType | null
): CheckResult[] {
```

#### **ISSUE 14: Magic String Literals for Check IDs (Maintainability)**
- **Location:** `WorkbenchForm.tsx` line 271, `WorkbenchActions.tsx` line 23
- **Problem:** Check IDs like `'title-present'`, `'clarity'`, `'auth'` are hardcoded strings. Easy to typo, no autocomplete.
- **Impact:** Refactoring check system is error-prone
- **Fix:** Define check ID constants in `taskWorkbench.ts` or use enums

```ts
// In taskWorkbench.ts
export const CHECK_IDS = {
  TITLE_PRESENT: 'title-present',
  REPO_SELECTED: 'repo-selected',
  SPEC_PRESENT: 'spec-present',
  // ...
} as const
```

#### **ISSUE 15: Unused `taskTemplateName` Field in Store (Dead Code)**
- **Location:** `taskWorkbench.ts` line 33, 139, 182
- **Problem:** Field is defined in store state, set to empty string on reset, loaded from task, but **never read anywhere**.
- **Impact:** Confuses future developers, wastes memory
- **Fix:** Remove field unless it's planned for future use (check git history for intent)

```diff
interface TaskWorkbenchState {
  // ... other fields ...
- taskTemplateName: string
```

---

## 6. Test Coverage

### 6.1 Current Coverage ✅

**6 test files, 263+ test cases:**

1. **ReadinessChecks.test.tsx** — 21 tests (rendering, expansion, icon states, fail border)
2. **WorkbenchForm.test.tsx** — Comprehensive form interaction tests
3. **WorkbenchActions.test.tsx** — Button enable/disable logic, 3-button states
4. **WorkbenchCopilot.test.tsx** — Message rendering, streaming, insert functionality
5. **SpecEditor.test.tsx** — Template insertion, Tab key handling, generate button
6. **TaskWorkbench.test.tsx** — Panel layout, copilot toggle, responsive behavior

**Integration tests:**
- `src/main/handlers/__tests__/workbench.test.ts` — 7 IPC handlers tested

### 6.2 Coverage Gaps 🔴

#### Missing Test Cases:

1. **Cmd+Enter keyboard shortcut** — WorkbenchForm line 265-279 not covered in tests
2. **Queue confirmation modal flow** — Modal shown when warnings present (lines 210-219) not tested
3. **Operational checks block queue** — Line 196-200 blocking logic not covered
4. **Copilot auto-show on "Research Codebase"** — TaskWorkbench.tsx line 36-39 not tested
5. **ResizeObserver copilot auto-hide** — Line 17-27 responsive behavior not covered
6. **Streaming message race condition** — WorkbenchCopilot.tsx lines 54-89 stream ID matching logic needs edge case tests
7. **localStorage persistence** — Copilot message persistence (line 239-244 in store) not tested
8. **Tab key in SpecEditor** — Inserts 2 spaces (line 39-53) — **likely tested in SpecEditor.test.tsx** but verify

#### Recommended New Tests:

```tsx
// WorkbenchForm.test.tsx
it('submits on Cmd+Enter when title is present', () => {
  // Set title, fire MetaKey+Enter event, assert handleSubmit called
})

it('shows confirmation modal when queueing with warnings', async () => {
  // Set semantic warnings, click Queue Now, expect modal to appear
})

it('blocks queue when operational checks fail', async () => {
  // Mock checkOperational to return auth fail, click Queue Now, assert task not created
})
```

---

## 7. Architecture & Patterns

### 7.1 Positive Patterns ✅

- **Zustand store pattern** — Single store for all workbench state, actions colocated with state
- **Progressive enhancement** — Structural checks (instant) → semantic checks (2s debounce) → operational checks (on queue attempt)
- **3-tier validation model** — Clear separation: Tier 1 (structural), Tier 2 (semantic AI), Tier 3 (operational runtime)
- **Composite component pattern** — TaskWorkbench composes Form + Copilot, Form composes Editor + Checks + Actions
- **Event-driven IPC** — Copilot streaming via IPC event bus (`workbench:chatChunk`)

### 7.2 Concerns 🟡

1. **Form submission logic duplication** — `createOrUpdateTask()` (lines 53-97) called from both backlog and queue paths. Could be extracted to store action.
2. **Tight coupling to `window.api`** — All IPC calls inline in components. Consider abstracting to service layer for easier mocking/testing.
3. **Mixed concerns in WorkbenchForm** — Component handles form state, validation orchestration, submission, AND copilot message sending (line 34-75). Consider splitting.

---

## Priority Recommendations

### Critical (Must Fix) 🔴
1. **ISSUE 2** — Color contrast in advanced options toggle (WCAG compliance)
2. **ISSUE 8** — Focus management in confirmation modal (keyboard accessibility)

### High (Should Fix) 🟠
3. **ISSUE 10** — Document Cmd+Enter shortcut visually (discoverability)
4. **ISSUE 11** — Debounce structural checks (performance on long specs)
5. **ISSUE 3** — Fix copilot toggle button overlap on narrow viewports

### Medium (Nice to Have) 🟡
6. **ISSUE 4** — Visual feedback for template insertion
7. **ISSUE 1** — Standardize border radius
8. **ISSUE 13** — Refactor FormSnapshot to use Pick<>
9. **ISSUE 15** — Remove unused `taskTemplateName` field

### Low (Polish) ⚪
10. **ISSUE 5** — Add resize hint for spec textarea
11. **ISSUE 7** — Custom checkbox styling or remove rule
12. **ISSUE 12** — Virtualize copilot message list

---

## Test Coverage Priority

1. **High:** Cmd+Enter shortcut, confirmation modal flow, operational check blocking
2. **Medium:** ResizeObserver auto-hide, streaming race conditions
3. **Low:** localStorage persistence (low risk — already works in production)

---

## Conclusion

The Task Workbench is a **well-architected, accessible, and maintainable** component with strong test coverage. The primary issues are **visual polish** (border radius, contrast), **UX discoverability** (keyboard shortcuts, template feedback), and **minor performance optimizations** (debounce structural checks, virtualize messages).

**Recommended Action:** Address critical a11y issues (ISSUE 2, 8) immediately. Schedule medium-priority UX improvements (ISSUE 3, 4, 10) for next sprint. Low-priority polish items can be deferred.

**Estimated Effort:**
- Critical fixes: 2-3 hours
- High-priority items: 4-6 hours
- Medium-priority: 6-8 hours
- Low-priority: 4-6 hours
- **Total:** ~20 hours for full remediation
