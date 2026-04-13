# CR Redesign 03 — AIAssistantPanel (visual scaffolding)

## Goal

Replace the right-column placeholder from Task 2 with `AIAssistantPanel` — a fully styled chat surface. **Visual scaffolding only.** No SDK streaming, no prompt composition, no thread persistence. DOM + CSS that a later epic wires up.

Full reference: `docs/superpowers/specs/2026-04-10-code-review-redesign-design.md` §5.5. Depends on Task 2.

## Files to Change

- `src/renderer/src/components/code-review/AIAssistantPanel.tsx` + `.css` — **new**.
- `src/renderer/src/components/code-review/__tests__/AIAssistantPanel.test.tsx` — **new** — header renders with Sparkles icon, input dock present, quick-action chips present, empty state rendered when no task selected.
- `src/renderer/src/views/CodeReviewView.tsx` — replace the `<section className="cr-assistant cr-assistant--placeholder">` element with `<AIAssistantPanel />`.
- `src/renderer/src/views/CodeReviewView.css` — remove the temporary `--placeholder` rule.

## Structure

```tsx
<aside className="cr-assistant" aria-label="AI Assistant">
  <header className="cr-assistant__header">
    <Sparkles size={12} className="cr-assistant__icon" />
    <span className="cr-assistant__title">AI Assistant</span>
    <button className="cr-assistant__kebab" aria-haspopup="menu">
      ⋯
    </button>
  </header>
  <div className="cr-assistant__messages" role="log" aria-live="polite">
    {/* empty state when selectedTaskId == null */}
  </div>
  <div className="cr-assistant__chips">
    <button>Summarize diff</button>
    <button>Risks?</button>
    <button>Explain selected file</button>
  </div>
  <form className="cr-assistant__input" onSubmit={noop}>
    <textarea />{' '}
    <button type="submit">
      <Send size={14} />
    </button>
  </form>
</aside>
```

## CSS requirements

- Header `36px`, `padding: 0 var(--bde-space-4)`, bottom border. Sparkles in `var(--bde-purple)`. Title `var(--bde-text)` weight 600 size `var(--bde-size-sm)`.
- Messages container `flex: 1 1 auto; overflow-y: auto; padding: var(--bde-space-4); display: flex; flex-direction: column; gap: var(--bde-space-3)`.
- Define **all three bubble variants in CSS** (no rendering yet — Task 3 of a later epic uses them):
  - `.cr-assistant__bubble--user` — right-aligned, `background: var(--bde-accent); color: var(--bde-btn-primary-text)`, radii `lg lg sm lg`.
  - `.cr-assistant__bubble--assistant` — left-aligned, `background: var(--bde-surface-high); color: var(--bde-text); border: 1px solid var(--bde-border)`, radii `lg lg lg sm`.
  - `.cr-assistant__bubble--agent-history` — assistant style + `border-left: 2px solid var(--bde-purple)`. Only visible when parent has class `cr-assistant--show-history`.
  - `.cr-assistant__bubble--streaming::after` — `@keyframes cr-cursor-blink { 50% { opacity: 0; } }`, 1s linear infinite, wrapped in `@media (prefers-reduced-motion: no-preference)`.
- Chips row above input, outlined buttons with `border-radius: var(--bde-radius-full)`, `font-size: var(--bde-size-xs)`. Click logs `TODO: CR Redesign follow-up epic`.
- Input dock bottom-pinned, `min-height: 44px; max-height: 160px; padding: var(--bde-space-3) var(--bde-space-4); border-top: 1px solid var(--bde-border)`. Textarea: `resize: none; background: transparent; border: none; outline: none; color: var(--bde-text); field-sizing: content` (fallback to auto-grow via `onInput` if unavailable).
- Empty state (no selected task): centered `<EmptyState />` with text `Select a task to start chatting about its changes.`

## Kebab menu

Clicking the kebab opens a small popover with three items: `Show agent history`, `Clear thread`, `New thread`. All handlers are no-ops. `Show agent history` toggles the `cr-assistant--show-history` class on the root aside; the other two log the TODO marker.

## How to Test

```bash
npm run typecheck
npm test -- AIAssistantPanel
npm test
npm run lint
```

Manual: `npm run dev`. Right panel renders the assistant UI. Empty state visible with no task; empty thread visible with a task selected. Chips and kebab items are clickable but do nothing. Verify in both themes.

## Out of Scope

SDK streaming, IPC, prompt composition, thread persistence in the store, pre-seeding the assistant with agent history.

Branch: `feat/cr-redesign-03-assistant`. PR title: `feat: CR Redesign 03 — AIAssistantPanel visual scaffolding`.
