# Settings Pages — Flex & Responsiveness

**Date:** 2026-04-17
**Scope:** Pure CSS/layout + small markup cleanup for every Settings view section.
**Non-goals:** No new features. No behavior changes to IPC, forms, or state.

## Problem

The Settings view is pinned to `max-width: 560px` and left-anchored, which on a 1920px display leaves the right ~60% of the content area empty. On top of the wasted space, several concrete UI bugs are visible:

1. The Agent Permissions "Tool Rules" block renders as an unstyled run-on: `☑ReadRead file contents☑WriteCreate new files…`. Classes (`permissions-tool`, `permissions-tool__name`, `permissions-tool__desc`, `permissions-presets`, `permissions-banner`, `permissions-info`, `permissions-deny-*`) are referenced in `AgentPermissionsSection.tsx` but have no CSS defined anywhere in the renderer.
2. The Auto-start checkbox row renders with zero gap (`Auto-start☑`) because `.settings-field` is a column-stacked label and a lone checkbox has no separator from its label.
3. The Connections page embeds an "About BDE" card that duplicates the dedicated **About & Usage** tab (⌘7 → About).
4. The Webhooks empty state renders as a bare `<span>No webhooks configured</span>` floating between cards and the Add button — visually orphaned.
5. The Memory page is marked `wide` but the inner file-list / viewer split still reads as narrow because nothing in `MemorySection.css` takes advantage of the wide container.

## Design

### 1. Responsive content container (`SettingsView.css`)

Replace the hardcoded 560px cap with a responsive, centered container. Padding scales with viewport width via `clamp` so narrow windows keep breathing room and very wide windows don't develop massive gutters.

```css
.stg-content {
  flex: 1;
  padding: var(--bde-space-5) clamp(var(--bde-space-4), 4vw, var(--bde-space-8));
  overflow-y: auto;
  min-width: 0;
}

.stg-content__inner {
  width: 100%;
  max-width: min(960px, 100%);
  margin: 0 auto;
}

.stg-content__inner--wide {
  max-width: none;
}
```

Breakpoint behavior:
- `≤ 640px` window: padding collapses to `var(--bde-space-4)`, content is effectively full-width.
- `640–1200px`: padding scales with `4vw`, content fills available width up to 960px.
- `≥ 1200px`: padding caps at `var(--bde-space-8)`, content centers at 960px.
- Wide sections (`memory`, `about`) use `max-width: none` and fill the flex container.

### 2. Inline checkbox field variant (`SettingsCard.css`)

Add a row-layout modifier so a checkbox sits beside its label instead of stacking below it:

```css
.settings-field--inline {
  display: flex;
  align-items: center;
  gap: var(--bde-space-2);
  margin-bottom: var(--bde-space-3);
}

.settings-field--inline .settings-field__label {
  margin-bottom: 0;
}
```

Apply in `AgentManagerSection.tsx` to the Auto-start label (line ~199): `className="settings-field settings-field--inline"`.

### 3. Agent permissions styling

Create a new `AgentPermissionsSection.css` and import it from the top of `AgentPermissionsSection.tsx`. Putting the styles in their own file (rather than appending to `AgentManagerSection.css`) keeps the component self-contained — `AgentPermissionsSection` is also rendered standalone in tests. Classes to define:

- **`.permissions-banner`** — accent-tinted block with `display: flex; flex-direction: column; gap: var(--bde-space-3);` padding `var(--bde-space-3) var(--bde-space-4)`, `border-radius: var(--bde-radius-md)`, `background: var(--bde-accent-surface)`, `margin-bottom: var(--bde-space-3)`.
- **`.permissions-banner__text`** — body text, `margin: 0`.
- **`.permissions-banner__actions`** — `display: flex; gap: var(--bde-space-2);`.
- **`.permissions-presets`** — `display: flex; flex-wrap: wrap; gap: var(--bde-space-2);`.
- **`.permissions-tools`** — `display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: var(--bde-space-2) var(--bde-space-4);`.
- **`.permissions-tool`** — `display: grid; grid-template-columns: auto auto 1fr; align-items: baseline; gap: var(--bde-space-2); padding: var(--bde-space-1) 0; cursor: pointer;`.
- **`.permissions-tool__name`** — `font-weight: 600;`.
- **`.permissions-tool__desc`** — `font-size: var(--bde-size-xs); color: var(--bde-text-muted);`.
- **`.permissions-info`** — muted explainer below the grid, `font-size: var(--bde-size-xs); color: var(--bde-text-muted); margin-top: var(--bde-space-3);`.
- **`.permissions-deny-list`** — `display: flex; flex-direction: column; gap: var(--bde-space-1); margin-bottom: var(--bde-space-3);`.
- **`.permissions-deny-rule`** — `display: flex; align-items: center; gap: var(--bde-space-2); padding: var(--bde-space-1) var(--bde-space-2); background: var(--bde-surface); border-radius: var(--bde-radius);`. The `<code>` child gets `flex: 1` and a monospace font already inherited.
- **`.permissions-deny-add`** — wrapper so the add-rule input stretches to the card width.

### 4. Remove duplicate About card

In `ConnectionsSection.tsx`, delete the entire `{/* About Card */}` block (lines 276–296). Also remove the resulting dead imports and constants — after the card is gone, `APP_VERSION`, `GITHUB_URL`, and the `ExternalLink` import from `lucide-react` are all unreferenced. The same content is already rendered by `AboutSection.tsx` in the About & Usage tab.

### 5. Webhooks empty state polish

Wrap the empty-state message in a `SettingsCard` so it reads as a peer card rather than a floating span. In `WebhooksSection.tsx` (line ~186):

```tsx
{webhooks.length === 0 && (
  <SettingsCard title="Webhooks" subtitle="No webhooks configured">
    <p className="settings-empty-state">
      Add a webhook to receive task event notifications at an external URL.
    </p>
  </SettingsCard>
)}
```

Add a small `.settings-empty-state` rule to `SettingsCard.css`: `color: var(--bde-text-muted); margin: 0;`.

### 6. Memory section wide layout

`MemorySection` is already `wide: true` and its inner structure is correct (`.memory-sidebar` fixed 260px, `.memory-editor` uses `flex: 1`). The squeezed look in Image 5 is a downstream effect of the narrow `.stg-content__inner` cap — lifting that cap in §1 automatically fixes Memory without touching `MemorySection.css`.

No changes needed in `MemorySection.css`.

## Testing

- Run `npm test` — update any snapshot assertions that pin on class strings for the Auto-start label (now includes `settings-field--inline`).
- `ConnectionsSection.test.tsx` — drop any assertion that expects "About BDE" text, since the card is moving out.
- Visual verification in `npm run dev` at three widths: 1024, 1440, 1920. Hit every sidebar entry (Connections, Repositories, Templates, Agents, Models, Memory, Appearance, About).
- Typecheck + lint must pass.

## Scope guardrails

- Do **not** touch form logic, IPC calls, or state in any section.
- Do **not** redesign the sidebar or page header.
- Do **not** add new Settings sections.
- The only component-code edits are: Auto-start `className`, remove About block + its unused imports in Connections, and wrap Webhooks empty state in a `SettingsCard`.

## Files touched

| File | Change |
|---|---|
| `src/renderer/src/views/SettingsView.css` | Responsive `.stg-content` + `.stg-content__inner` |
| `src/renderer/src/components/settings/SettingsCard.css` | Add `.settings-field--inline`, `.settings-empty-state` |
| `src/renderer/src/components/settings/AgentPermissionsSection.css` | **NEW** — all `.permissions-*` styles |
| `src/renderer/src/components/settings/AgentPermissionsSection.tsx` | Import the new CSS file |
| `src/renderer/src/components/settings/AgentManagerSection.tsx` | Auto-start row: add `settings-field--inline` |
| `src/renderer/src/components/settings/ConnectionsSection.tsx` | Remove About BDE card + dead imports (`APP_VERSION`, `GITHUB_URL`, `ExternalLink`) |
| `src/renderer/src/components/settings/WebhooksSection.tsx` | Wrap empty state in `SettingsCard` |
| `src/renderer/src/components/settings/__tests__/ConnectionsSection.test.tsx` | Drop About-BDE assertions if present |

## Module docs

Every touched file needs its row updated in the matching `docs/modules/*/index.md` (components/index.md, views/index.md) per CLAUDE.md's mandatory pre-commit rule.
