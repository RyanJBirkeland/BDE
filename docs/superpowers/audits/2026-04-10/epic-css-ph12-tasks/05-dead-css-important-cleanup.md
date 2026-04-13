# Dead CSS selectors + unjustified !important cleanup

## Problem

The post-refactor CSS audit found 3 dead selectors (class names not used in any TSX file), 2 unused `@keyframes` animations, and 12 `!important` declarations that can be removed or resolved via specificity.

## Solution

### Dead selectors — remove entirely

1. `.playground-modal__view-btn--active` in `src/renderer/src/components/agents/PlaygroundModal.css` (line 10)
2. `.pipeline-stage__dot--active` in `src/renderer/src/components/sprint/PipelineStage.css` (line 53) **and** `src/renderer/src/components/sprint/PipelineOverlays.css` (line 820, reduced-motion override for same dead class)
3. `.agent-pill--running` in `src/renderer/src/components/agents/PlaygroundModal.css` (line 226)

### Unused @keyframes — remove entirely

1. `@keyframes bde-slide-up-fade` in `src/renderer/src/assets/reset.css` (line 80) — not referenced by any `animation` property
2. `@keyframes toast-slide-in` — remove from **both** `src/renderer/src/assets/toasts.css` (line 84) and `src/renderer/src/components/layout/ToastContainer.css` (line 84). Neither copy is referenced.

### !important — remove or refactor via increased specificity

For each, either delete `!important` and increase selector specificity to win the cascade naturally, or remove the rule if it's redundant.

1. `src/renderer/src/components/agents/PlaygroundModal.css:11-13` — 3 instances (background, color, border-color)
2. `src/renderer/src/components/sprint/PipelineOverlays.css:1195` — 1 instance (opacity)
3. `src/renderer/src/components/diff/PlainDiffContent.css:125,211` — 2 instances (background)
4. `src/renderer/src/components/layout/UnifiedHeader.css:357` — 1 instance (min-width: revert)
5. `src/renderer/src/assets/cost.css:284` — 1 instance (text-align)
6. `src/renderer/src/components/settings/CostSection.css:288` — 1 instance (text-align)
7. `src/renderer/src/views/IDEView.css:17,20` — 2 instances (scrollbar width/height)
8. `src/renderer/src/views/AgentsView.css:73` — 1 instance (min-width)

**Do NOT touch** the 5 justified instances in `src/renderer/src/assets/design-system/utilities.css` (reduced motion overrides — these are correct).

## Files to Change

- `src/renderer/src/components/agents/PlaygroundModal.css`
- `src/renderer/src/components/sprint/PipelineStage.css`
- `src/renderer/src/components/sprint/PipelineOverlays.css`
- `src/renderer/src/components/diff/PlainDiffContent.css`
- `src/renderer/src/components/layout/UnifiedHeader.css`
- `src/renderer/src/assets/reset.css`
- `src/renderer/src/assets/toasts.css`
- `src/renderer/src/components/layout/ToastContainer.css`
- `src/renderer/src/assets/cost.css`
- `src/renderer/src/components/settings/CostSection.css`
- `src/renderer/src/views/IDEView.css`
- `src/renderer/src/views/AgentsView.css`

## How to Test

1. Verify dead selectors are gone:

   ```bash
   grep -rn 'playground-modal__view-btn--active\|pipeline-stage__dot--active\|agent-pill--running' src/renderer/src/
   ```

   Expected: zero matches.

2. Verify dead keyframes are gone:

   ```bash
   grep -rn 'bde-slide-up-fade\|toast-slide-in' src/renderer/src/
   ```

   Expected: zero matches.

3. Verify !important count is exactly 5 (all in utilities.css):

   ```bash
   grep -rn '!important' src/renderer/src/ --include='*.css' | grep -v node_modules
   ```

   Expected: exactly 5 matches, all in `utilities.css`.

4. `npm run typecheck && npm test && npm run lint` — all must pass

## Out of Scope

- Spacing token adoption (covered by tasks 01-04)
- Neon effect removal — separate CSS consolidation plan
- Adding new CSS selectors or animations to replace removed ones
