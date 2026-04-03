# Phase 3: Accessibility Improvements (Remaining)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete WCAG 2.1 AA compliance by adding focus traps to modals and fixing light theme contrast ratios.

**Architecture:** Create a reusable `useFocusTrap` hook and integrate it into ConfirmModal and CommandPalette. Fix contrast-failing CSS variables in the light theme. No new dependencies.

**Tech Stack:** TypeScript, React, CSS custom properties

**Status:** Most accessibility work was completed in PR #350 (landmarks, ARIA attributes, skip-to-content, tab semantics, form labels, live regions, kanban a11y). This plan covers the **remaining gaps only**: focus traps and contrast fixes.

---

## Completed in PR #350 (DO NOT RE-IMPLEMENT)

- ~~Task 3: ARIA on CommandPalette~~ — `role="dialog"`, `aria-modal`, `aria-selected`, `role="listbox"`, `role="option"` ✅
- ~~Task 4: aria-label on icon buttons~~ — ActivityBar `<nav>`, `aria-label`, `aria-current`, `role="menu"`, `role="menuitem"`; CredentialForm toggle; Button component ARIA props ✅
- ~~Task 5: Tab role semantics~~ — PanelTabBar `role="tablist"`, `role="tab"`, `aria-selected`, `id`; PanelLeaf `role="tabpanel"`, `aria-labelledby`; SettingsView tabs ✅
- ~~Task 7: Skip-to-content link~~ — Added to App.tsx with `.sr-only` class ✅
- ~~Input.tsx aria-label~~ — Prop added ✅
- ~~Button.tsx ARIA props~~ — `aria-label`, `aria-pressed`, `aria-expanded`, `aria-controls`, `aria-busy` ✅
- ~~ToastContainer live region~~ — `role="region"`, `aria-live="polite"`, `aria-atomic` ✅
- ~~Kanban accessibility~~ — `role="region"` on columns, `aria-roledescription` on TaskCard ✅

---

## File Structure (Remaining Work)

| Action | File                                                                  | Responsibility                  |
| ------ | --------------------------------------------------------------------- | ------------------------------- |
| Create | `src/renderer/src/hooks/useFocusTrap.ts`                              | Reusable focus trap hook        |
| Create | `src/renderer/src/hooks/__tests__/useFocusTrap.test.ts`               | Test focus trap hook            |
| Modify | `src/renderer/src/components/ui/ConfirmModal.tsx`                     | Integrate focus trap            |
| Create | `src/renderer/src/components/ui/__tests__/ConfirmModal-a11y.test.tsx` | Test focus trap in ConfirmModal |
| Modify | `src/renderer/src/components/layout/CommandPalette.tsx`               | Integrate focus trap            |
| Modify | `src/renderer/src/assets/base.css`                                    | Fix light theme contrast ratios |

---

### Task 1: Create Reusable Focus Trap Hook

**Files:**

- Create: `src/renderer/src/hooks/__tests__/useFocusTrap.test.ts`
- Create: `src/renderer/src/hooks/useFocusTrap.ts`

**Context:** Both ConfirmModal and CommandPalette need focus trapping. A shared hook avoids duplication. The hook should trap Tab/Shift+Tab within a container ref, auto-focus the first focusable element, and restore focus on unmount.

- [ ] **Step 1: Write failing test for useFocusTrap**

```typescript
// src/renderer/src/hooks/__tests__/useFocusTrap.test.ts
import { describe, it, expect, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useFocusTrap } from '../useFocusTrap'

function createContainer(): HTMLDivElement {
  const container = document.createElement('div')
  const btn1 = document.createElement('button')
  btn1.textContent = 'First'
  const btn2 = document.createElement('button')
  btn2.textContent = 'Second'
  container.appendChild(btn1)
  container.appendChild(btn2)
  document.body.appendChild(container)
  return container
}

describe('useFocusTrap', () => {
  it('focuses the first focusable element when active', () => {
    const container = createContainer()
    const ref = { current: container }
    renderHook(() => useFocusTrap(ref, true))
    expect(document.activeElement).toBe(container.querySelector('button'))
    document.body.removeChild(container)
  })

  it('does not focus anything when inactive', () => {
    const container = createContainer()
    const ref = { current: container }
    renderHook(() => useFocusTrap(ref, false))
    expect(document.activeElement).not.toBe(container.querySelector('button'))
    document.body.removeChild(container)
  })

  it('wraps focus from last to first on Tab', () => {
    const container = createContainer()
    const ref = { current: container }
    const buttons = container.querySelectorAll('button')
    renderHook(() => useFocusTrap(ref, true))
    ;(buttons[1] as HTMLElement).focus()
    const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true })
    const preventSpy = vi.spyOn(event, 'preventDefault')
    document.dispatchEvent(event)
    expect(preventSpy).toHaveBeenCalled()
    expect(document.activeElement).toBe(buttons[0])
    document.body.removeChild(container)
  })

  it('wraps focus from first to last on Shift+Tab', () => {
    const container = createContainer()
    const ref = { current: container }
    const buttons = container.querySelectorAll('button')
    renderHook(() => useFocusTrap(ref, true))
    expect(document.activeElement).toBe(buttons[0])
    const event = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true })
    const preventSpy = vi.spyOn(event, 'preventDefault')
    document.dispatchEvent(event)
    expect(preventSpy).toHaveBeenCalled()
    expect(document.activeElement).toBe(buttons[1])
    document.body.removeChild(container)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/hooks/__tests__/useFocusTrap.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the focus trap hook**

```typescript
// src/renderer/src/hooks/useFocusTrap.ts
import { useEffect, useRef, type RefObject } from 'react'

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function useFocusTrap(containerRef: RefObject<HTMLElement | null>, active: boolean) {
  const previousFocus = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!active || !containerRef.current) return

    previousFocus.current = document.activeElement as HTMLElement

    const first = containerRef.current.querySelector<HTMLElement>(FOCUSABLE)
    first?.focus()

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || !containerRef.current) return

      const focusable = Array.from(containerRef.current.querySelectorAll<HTMLElement>(FOCUSABLE))
      if (focusable.length === 0) return

      const firstEl = focusable[0]
      const lastEl = focusable[focusable.length - 1]

      if (e.shiftKey && document.activeElement === firstEl) {
        e.preventDefault()
        lastEl.focus()
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault()
        firstEl.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      previousFocus.current?.focus()
    }
  }, [active, containerRef])
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/src/hooks/__tests__/useFocusTrap.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/hooks/useFocusTrap.ts src/renderer/src/hooks/__tests__/useFocusTrap.test.ts
git commit -m "feat: add reusable useFocusTrap hook for modal accessibility"
```

---

### Task 2: Add Focus Trap to ConfirmModal

**Files:**

- Modify: `src/renderer/src/components/ui/ConfirmModal.tsx`
- Create: `src/renderer/src/components/ui/__tests__/ConfirmModal-a11y.test.tsx`

**Context:** ConfirmModal already has `role="alertdialog"`, `aria-modal="true"`, and `aria-labelledby` (added pre-existing, lines 66-68). It uses `motion.div` from framer-motion. This task ONLY adds the `useFocusTrap` hook — do NOT re-add or overwrite existing ARIA attributes, and do NOT replace `motion.div` with a plain div.

- [ ] **Step 1: Write test for focus trap integration**

```typescript
// src/renderer/src/components/ui/__tests__/ConfirmModal-a11y.test.tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ConfirmModal } from '../ConfirmModal'

describe('ConfirmModal accessibility', () => {
  it('has role="alertdialog" and aria-modal="true"', () => {
    render(
      <ConfirmModal open={true} title="Delete?" message="Are you sure?" onConfirm={() => {}} onCancel={() => {}} />
    )
    const dialog = screen.getByRole('alertdialog')
    expect(dialog).toBeDefined()
    expect(dialog.getAttribute('aria-modal')).toBe('true')
  })

  it('has aria-labelledby pointing to title', () => {
    render(
      <ConfirmModal open={true} title="Delete?" message="Are you sure?" onConfirm={() => {}} onCancel={() => {}} />
    )
    const dialog = screen.getByRole('alertdialog')
    const labelId = dialog.getAttribute('aria-labelledby')
    expect(labelId).toBeTruthy()
    const title = document.getElementById(labelId!)
    expect(title?.textContent).toBe('Delete?')
  })

  it('contains focusable buttons for keyboard users', () => {
    render(
      <ConfirmModal open={true} title="Delete?" message="Are you sure?" onConfirm={() => {}} onCancel={() => {}} />
    )
    const dialog = screen.getByRole('alertdialog')
    const focusable = dialog.querySelectorAll('button')
    expect(focusable.length).toBeGreaterThanOrEqual(2)
  })
})
```

- [ ] **Step 2: Run test to verify existing ARIA passes**

Run: `npx vitest run src/renderer/src/components/ui/__tests__/ConfirmModal-a11y.test.tsx`
Expected: PASS (ARIA already present)

- [ ] **Step 3: Integrate useFocusTrap into ConfirmModal**

In `src/renderer/src/components/ui/ConfirmModal.tsx`, add ref and hook to the existing `motion.div`. Do NOT touch existing ARIA attributes:

```typescript
import { useRef } from 'react'
import { useFocusTrap } from '../../hooks/useFocusTrap'

// Inside the component:
const dialogRef = useRef<HTMLDivElement>(null)
useFocusTrap(dialogRef, open)

// Attach ref to the existing motion.div (preserve all existing attributes):
<motion.div
  ref={dialogRef}
  className="confirm-modal glass-modal elevation-3"
  // ... all existing props stay unchanged
>
```

- [ ] **Step 4: Run tests to verify everything passes**

Run: `npx vitest run src/renderer/src/components/ui/__tests__/ConfirmModal-a11y.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/ui/ConfirmModal.tsx src/renderer/src/components/ui/__tests__/ConfirmModal-a11y.test.tsx
git commit -m "feat: add focus trap to ConfirmModal"
```

---

### Task 3: Add Focus Trap to CommandPalette

**Files:**

- Modify: `src/renderer/src/components/layout/CommandPalette.tsx`

**Context:** PR #350 already added `role="dialog"`, `aria-modal="true"`, `aria-label`, `role="listbox"`, `role="option"`, and `aria-selected` to CommandPalette. This task only adds focus trap integration.

- [ ] **Step 1: Add useFocusTrap to CommandPalette**

```typescript
import { useRef } from 'react'
import { useFocusTrap } from '../../hooks/useFocusTrap'

// Inside the component:
const paletteRef = useRef<HTMLDivElement>(null)
useFocusTrap(paletteRef, open)

// Attach ref to the existing motion.div that already has role="dialog":
<motion.div
  ref={paletteRef}
  className="command-palette glass-modal elevation-3"
  // ... all existing props unchanged
>
```

- [ ] **Step 2: Run full test suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/layout/CommandPalette.tsx
git commit -m "feat: add focus trap to CommandPalette"
```

---

### Task 4: Fix Light Theme Contrast Ratios

**Files:**

- Modify: `src/renderer/src/assets/base.css`

**Context:** Light theme has contrast failures that were not addressed in PR #350:

- `--bde-text-dim: #999999` on `#FAFAFA` bg = 2.85:1 ratio (fails WCAG AA 4.5:1)
- Warning color may fail with small text

- [ ] **Step 1: Fix text-dim contrast**

In `src/renderer/src/assets/base.css`, in the `html.theme-light` block:

```css
/* BEFORE */
--bde-text-dim: #999999;

/* AFTER — 4.64:1 ratio on #FAFAFA bg, passes WCAG AA */
--bde-text-dim: #767676;
```

- [ ] **Step 2: Fix warning color contrast for text**

```css
/* BEFORE */
--bde-warning: #d97706;

/* AFTER — higher contrast for light bg */
--bde-warning: #b45309;
```

- [ ] **Step 3: Run full test suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/assets/base.css
git commit -m "fix: improve light theme contrast ratios for WCAG AA compliance"
```
