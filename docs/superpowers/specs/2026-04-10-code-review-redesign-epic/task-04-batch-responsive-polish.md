# CR Redesign 04 — BatchActions into TopBar + responsive rails + polish

## Goal

Fold `BatchActions` into `TopBar` as a mode swap, add responsive collapse rails for AIAssistant (≤1120px) and FileTree (≤860px), and verify every `cr-*` CSS file uses only `--bde-*` tokens. This is the final task.

Full reference: `docs/superpowers/specs/2026-04-10-code-review-redesign-design.md` §5.2, §4.3, §6, §12. Depends on Task 3.

## Files to Change

- `src/renderer/src/components/code-review/TopBar.tsx` + `.css` — add batch-mode content swap. When `selectedBatchIds.size > 0`, replace the normal three-zone content with a batch action row (`N tasks selected` + the four batch operations + `Clear` button). Background `var(--bde-accent-surface)`, bottom border `var(--bde-accent)`. Use `AnimatePresence mode="wait"` + `VARIANTS.fadeIn` (120ms).
- `src/renderer/src/components/code-review/BatchActions.tsx` — either delete the file entirely (move handlers into TopBar) or keep as a pure-logic `useBatchActionHandlers()` hook exported from the same file. Floating footer JSX is removed.
- `src/renderer/src/components/code-review/BatchActions.css` — delete if file is obsolete.
- `src/renderer/src/components/code-review/__tests__/BatchActions.test.tsx` — update to test the handlers from their new location.
- `src/renderer/src/views/CodeReviewView.tsx` — remove the `<BatchActions />` element from the root.
- `src/renderer/src/views/CodeReviewView.css` — add `min-width: 620px` on `.cr-view`; add responsive blocks:
  ```css
  @media (max-width: 1120px) {
    .cr-assistant {
      width: 40px;
    }
    .cr-assistant--expanded {
      position: absolute;
      right: 0;
      top: 44px;
      bottom: 0;
      width: 384px;
      box-shadow: var(--bde-shadow-lg);
    }
  }
  @media (max-width: 860px) {
    .cr-filetree {
      width: 40px;
    }
    .cr-filetree--expanded {
      position: absolute;
      left: 0;
      top: 44px;
      bottom: 0;
      width: 256px;
      box-shadow: var(--bde-shadow-lg);
    }
  }
  ```
  Both panels transition with `transition: width 180ms var(--bde-transition-base)`.
- `src/renderer/src/components/code-review/AIAssistantPanel.tsx` — local `isExpanded` state; chevron button visible only in collapsed state; `aria-expanded` on the root aside.
- `src/renderer/src/components/code-review/FileTreePanel.tsx` — same pattern.

## Token sweep

`grep -rE '#[0-9a-fA-F]{3,8}|rgba\(' src/renderer/src/components/code-review/*.css src/renderer/src/views/CodeReviewView.css` must return zero matches. Hex/rgba colours and raw pixel values get replaced with `var(--bde-*)` tokens. Allowed raw pixels: media query breakpoints (1120/860/620), TopBar 44px, column widths 256/384/40, sub-header 36px. Everything else uses `var(--bde-space-*)`.

## How to Test

```bash
npm run typecheck
npm test -- code-review TopBar FileTree AIAssistant
npm run test:main
npm run lint
npm run build
```

Manual:

- Select multiple tasks via checkboxes → TopBar swaps to batch mode with accent background. Click `Clear` → reverts.
- Resize window below 1120px → right AIAssistant column collapses to a 40px rail. Click chevron → expands as overlay.
- Resize below 860px → FileTree also collapses. Both rails expand independently.
- Switch themes via Settings → Appearance. Both dark and light render correctly.

## Out of Scope

Tree-mode FileTree (flat list stays). Resizable splitters. Any AI behaviour.

## Definition of Done

All success criteria in spec §12 (design doc) must pass. Highlights: three-panel `256 / flex / 384` layout with 44px TopBar, no hardcoded colours/spacings/radii outside the explicit pixel allow-list, both themes render correctly, every review action reachable, `j`/`k` + `prefers-reduced-motion` respected, all tests pass.

Branch: `feat/cr-redesign-04-polish`. PR title: `feat: CR Redesign 04 — batch + responsive + token sweep`.
