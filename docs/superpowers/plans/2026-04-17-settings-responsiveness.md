# Settings Responsiveness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every Settings view section responsive on wide displays, fix three concrete layout bugs (broken permissions grid, cramped Auto-start row, duplicate About card, orphaned Webhooks empty state), and centralize the content container to a readable 960px cap.

**Architecture:** Pure CSS + minimal markup cleanup. No behavior changes. Lift the hardcoded 560px cap in `SettingsView.css` to a responsive `min(960px, 100%)` centered container. Add the missing `permissions-*` styles that `AgentPermissionsSection.tsx` already references. Introduce a `.settings-field--inline` modifier for checkbox rows. Remove the redundant "About FLEET" card from Connections. Wrap the Webhooks empty state in a `SettingsCard`.

**Tech Stack:** React + TypeScript, CSS custom properties (`--fleet-*` design tokens), vitest + testing-library for component tests.

Spec: `docs/superpowers/specs/2026-04-17-settings-responsiveness-design.md`

---

## File Structure

**CSS files touched (5):**
- `src/renderer/src/views/SettingsView.css` — responsive outer container
- `src/renderer/src/components/settings/SettingsCard.css` — add `.settings-field--inline`, `.settings-empty-state`
- `src/renderer/src/components/settings/AgentPermissionsSection.css` — **NEW** — styles for the `permissions-*` class family
- `src/renderer/src/components/settings/MemorySection.css` — unchanged (verified; lifting outer cap is sufficient)
- `src/renderer/src/components/settings/AgentManagerSection.css` — unchanged

**TSX files touched (3):**
- `src/renderer/src/components/settings/AgentPermissionsSection.tsx` — add `import './AgentPermissionsSection.css'`
- `src/renderer/src/components/settings/AgentManagerSection.tsx` — Auto-start label gets `settings-field--inline`
- `src/renderer/src/components/settings/ConnectionsSection.tsx` — remove About FLEET card + dead imports (`APP_VERSION`, `GITHUB_URL`, `ExternalLink`)
- `src/renderer/src/components/settings/WebhooksSection.tsx` — wrap empty state in `SettingsCard`

**Test files touched (1):**
- `src/renderer/src/components/settings/__tests__/ConnectionsSection.test.tsx` — update stale comment (no assertion change needed; the `getAllByText('GitHub')` test already uses `toBeGreaterThanOrEqual(1)`)

**Docs touched:**
- `docs/modules/components/index.md` — update `ConnectionsSection.tsx` row; add `AgentPermissionsSection.tsx` detail if needed.

---

## Task 1: Responsive settings content container

**Files:**
- Modify: `src/renderer/src/views/SettingsView.css`

- [ ] **Step 1: Update `.stg-content` and `.stg-content__inner` rules**

Replace the entire file contents with:

```css
/* ─── Settings View Layout ─────────────────────────────────────────────── */

.stg-layout {
  display: flex;
  flex-direction: row;
  width: 100%;
  height: 100%;
  overflow: hidden;
}

.stg-sidebar {
  width: 220px;
  flex-shrink: 0;
}

/* ─── Content ──────────────────────────────────────────────────────────── */

.stg-content {
  flex: 1;
  padding: var(--fleet-space-5) clamp(var(--fleet-space-4), 4vw, var(--fleet-space-8));
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

- [ ] **Step 2: Run typecheck and tests**

Run: `npm run typecheck && npm test -- SettingsView`
Expected: PASS (no structural change; layout only).

- [ ] **Step 3: Visual verification**

Run `npm run dev`. Open Settings. At a 1440px+ window:
- Connections, Repositories, Templates, Agents, Models, Appearance — content centered, max 960px wide.
- Memory and About — content fills full width.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/views/SettingsView.css
git commit -m "fix(settings): responsive content container, lift 560px cap"
```

---

## Task 2: Inline checkbox field variant + Auto-start fix

**Files:**
- Modify: `src/renderer/src/components/settings/SettingsCard.css`
- Modify: `src/renderer/src/components/settings/AgentManagerSection.tsx:198-208`

- [ ] **Step 1: Add `.settings-field--inline` and `.settings-empty-state` to `SettingsCard.css`**

Append after the existing `.settings-field__input[aria-invalid='true']` rule (end of file):

```css
/* ── Inline checkbox field variant ── */

.settings-field--inline {
  display: flex;
  align-items: center;
  gap: var(--fleet-space-2);
  margin-bottom: var(--fleet-space-3);
}

.settings-field--inline .settings-field__label {
  margin-bottom: 0;
}

/* ── Empty state inside a SettingsCard ── */

.settings-empty-state {
  color: var(--fleet-text-muted);
  margin: 0;
  font-size: var(--fleet-size-sm);
}
```

- [ ] **Step 2: Apply inline variant to the Auto-start label**

In `src/renderer/src/components/settings/AgentManagerSection.tsx`, change the Auto-start label's `className` from `"settings-field"` to `"settings-field settings-field--inline"`:

```tsx
<label className="settings-field settings-field--inline">
  <span className="settings-field__label">Auto-start</span>
  <input
    type="checkbox"
    checked={autoStart}
    onChange={(e) => {
      setAutoStart(e.target.checked)
      markDirty()
    }}
  />
</label>
```

- [ ] **Step 3: Run typecheck and tests**

Run: `npm run typecheck && npm test -- AgentManager`
Expected: PASS.

- [ ] **Step 4: Visual verification**

In `npm run dev`, navigate to Settings → Agents. Auto-start label and checkbox should be on a single row with a visible gap. Checkbox aligned vertically with the label text.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/settings/SettingsCard.css src/renderer/src/components/settings/AgentManagerSection.tsx
git commit -m "fix(settings): inline checkbox variant for Auto-start row"
```

---

## Task 3: Agent permissions styling

**Files:**
- Create: `src/renderer/src/components/settings/AgentPermissionsSection.css`
- Modify: `src/renderer/src/components/settings/AgentPermissionsSection.tsx:6` (add CSS import)

- [ ] **Step 1: Create `AgentPermissionsSection.css` with all missing classes**

Create `src/renderer/src/components/settings/AgentPermissionsSection.css`:

```css
/* ─── Agent Permissions Section ─────────────────────────────────────────── */

/* Consent banner shown when the user has not yet chosen a preset. */
.permissions-banner {
  display: flex;
  flex-direction: column;
  gap: var(--fleet-space-3);
  padding: var(--fleet-space-3) var(--fleet-space-4);
  margin-bottom: var(--fleet-space-3);
  border-radius: var(--fleet-radius-md);
  background: var(--fleet-accent-surface);
  border: 1px solid var(--fleet-border);
}

.permissions-banner__text {
  margin: 0;
  color: var(--fleet-text);
  font-size: var(--fleet-size-sm);
  line-height: 1.5;
}

.permissions-banner__actions {
  display: flex;
  gap: var(--fleet-space-2);
  flex-wrap: wrap;
}

/* Preset quick-apply buttons row. */
.permissions-presets {
  display: flex;
  flex-wrap: wrap;
  gap: var(--fleet-space-2);
}

/* Grid of allow-tool checkboxes. */
.permissions-tools {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: var(--fleet-space-2) var(--fleet-space-4);
  margin-bottom: var(--fleet-space-3);
}

.permissions-tool {
  display: grid;
  grid-template-columns: auto auto 1fr;
  align-items: baseline;
  gap: var(--fleet-space-2);
  padding: var(--fleet-space-1) 0;
  cursor: pointer;
}

.permissions-tool input[type='checkbox'] {
  justify-self: start;
}

.permissions-tool__name {
  font-weight: 600;
  color: var(--fleet-text);
  font-size: var(--fleet-size-sm);
}

.permissions-tool__desc {
  color: var(--fleet-text-muted);
  font-size: var(--fleet-size-xs);
}

/* Footer explainer below the grid. */
.permissions-info {
  margin: 0;
  color: var(--fleet-text-muted);
  font-size: var(--fleet-size-xs);
  line-height: 1.5;
}

/* Deny-rule list (custom patterns). */
.permissions-deny-list {
  display: flex;
  flex-direction: column;
  gap: var(--fleet-space-1);
  margin-bottom: var(--fleet-space-3);
}

.permissions-deny-rule {
  display: flex;
  align-items: center;
  gap: var(--fleet-space-2);
  padding: var(--fleet-space-1) var(--fleet-space-2);
  background: var(--fleet-surface);
  border: 1px solid var(--fleet-border);
  border-radius: var(--fleet-radius-sm);
}

.permissions-deny-rule code {
  flex: 1;
  font-family: var(--fleet-font-code);
  font-size: var(--fleet-size-xs);
  color: var(--fleet-text);
  background: none;
  padding: 0;
}

.permissions-deny-add {
  display: flex;
  gap: var(--fleet-space-2);
}
```

- [ ] **Step 2: Import the CSS in `AgentPermissionsSection.tsx`**

At the top of `src/renderer/src/components/settings/AgentPermissionsSection.tsx`, after the docstring block, add:

```tsx
import './AgentPermissionsSection.css'
```

The import block should now read:

```tsx
/**
 * AgentPermissionsSection — manage allow/deny tool permissions for FLEET agents.
 * Reads/writes ~/.claude/settings.json via IPC. Includes a consent banner,
 * preset configurations, tool checkboxes, and a custom deny-rule editor.
 */
import './AgentPermissionsSection.css'
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from '../../stores/toasts'
import { Button } from '../ui/Button'
import { SettingsCard } from './SettingsCard'
```

- [ ] **Step 3: Run typecheck and tests**

Run: `npm run typecheck && npm test -- AgentPermissions`
Expected: PASS.

- [ ] **Step 4: Visual verification**

In `npm run dev`, navigate to Settings → Agents → scroll to "Tool Rules":
- Each tool renders on its own row with `[ ] Read | Read file contents` layout — NOT jammed together.
- At 1200px+ width, the grid shows 3+ columns of tools.
- At 800px width, the grid reflows to fewer columns.
- Deny rules render as pill-like rows with the `<code>` on the left and remove button `×` on the right.
- Preset buttons appear in a horizontal row with gaps.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/settings/AgentPermissionsSection.css src/renderer/src/components/settings/AgentPermissionsSection.tsx
git commit -m "fix(settings): add missing agent permissions styles"
```

---

## Task 4: Remove duplicate About FLEET card from Connections

**Files:**
- Modify: `src/renderer/src/components/settings/ConnectionsSection.tsx`
- Modify: `src/renderer/src/components/settings/__tests__/ConnectionsSection.test.tsx:47` (stale comment)

- [ ] **Step 1: Delete the About FLEET card and its dead dependencies**

In `src/renderer/src/components/settings/ConnectionsSection.tsx`:

**(a)** Remove the entire `{/* About Card */}` block (currently lines 276–296):

```tsx
{/* About Card */}
<SettingsCard title="About FLEET">
  <div className="settings-about">
    <div className="settings-about__row">
      <span className="settings-about__label">Version</span>
      <span className="settings-about__value">{APP_VERSION}</span>
    </div>
    <div className="settings-about__row">
      <span className="settings-about__label">Source</span>
      <Button
        variant="ghost"
        size="sm"
        className="settings-about__link"
        onClick={() => window.api.window.openExternal(GITHUB_URL)}
        type="button"
      >
        GitHub <ExternalLink size={12} />
      </Button>
    </div>
  </div>
</SettingsCard>
```

**(b)** Remove the now-unused constants at the top of the file:

```tsx
const APP_VERSION = __APP_VERSION__
const GITHUB_URL = 'https://github.com/RyanJBirkeland/FLEET'
```

**(c)** Remove `ExternalLink` from the `lucide-react` import. The import becomes:

```tsx
import { RefreshCw, ShieldCheck, ShieldAlert } from 'lucide-react'
```

- [ ] **Step 2: Update the stale test comment**

In `src/renderer/src/components/settings/__tests__/ConnectionsSection.test.tsx`, line 47 has a stale comment referring to the About section. Update the test block at lines 45–50 to:

```tsx
it('renders GitHub credential form', async () => {
  render(<ConnectionsSection />)
  expect(screen.getByText('GitHub')).toBeInTheDocument()
  expect(screen.getByText('Personal Access Token')).toBeInTheDocument()
})
```

(Note: after the About card is gone, `GitHub` appears exactly once in the card title, so `getByText` is now safe.)

- [ ] **Step 3: Run typecheck and tests**

Run: `npm run typecheck && npm test -- ConnectionsSection`
Expected: PASS (all 5+ tests).

- [ ] **Step 4: Visual verification**

In `npm run dev`, navigate to Settings → Connections. The page should show:
- Encryption status banner
- Claude CLI Auth card
- GitHub card (with Read-only mode toggle)
- Webhooks section (next task polishes this)

No "About FLEET" card. Then navigate to Settings → About & Usage and confirm version + GitHub link still exist there.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/settings/ConnectionsSection.tsx src/renderer/src/components/settings/__tests__/ConnectionsSection.test.tsx
git commit -m "fix(settings): remove duplicate About FLEET card from Connections"
```

---

## Task 5: Webhooks empty state wrapped in SettingsCard

**Files:**
- Modify: `src/renderer/src/components/settings/WebhooksSection.tsx:185-188`

- [ ] **Step 1: Wrap the empty state message in a SettingsCard**

In `src/renderer/src/components/settings/WebhooksSection.tsx`, replace the floating `<span>` empty-state block (currently around line 185–188):

```tsx
return (
  <div className="settings-cards-list">
    {webhooks.length === 0 && (
      <span className="settings-repos__empty">No webhooks configured</span>
    )}
```

with a `SettingsCard`:

```tsx
return (
  <div className="settings-cards-list">
    {webhooks.length === 0 && (
      <SettingsCard title="Webhooks" subtitle="No webhooks configured">
        <p className="settings-empty-state">
          Add a webhook to receive task event notifications at an external URL.
        </p>
      </SettingsCard>
    )}
```

(`.settings-empty-state` was added in Task 2.)

- [ ] **Step 2: Run typecheck and tests**

Run: `npm run typecheck && npm test -- Webhooks`
Expected: PASS.

`WebhooksSection.test.tsx` already uses `screen.getByText('No webhooks configured')` (verified) — that text now appears as the `SettingsCard` subtitle, which renders as a `<span>` matched by `getByText`. No test update needed.

- [ ] **Step 3: Visual verification**

In `npm run dev`, navigate to Settings → Connections → scroll to Webhooks. When no webhooks exist, a proper card with title "Webhooks", subtitle "No webhooks configured", and explainer text should render — not a floating span.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/settings/WebhooksSection.tsx
git commit -m "fix(settings): wrap Webhooks empty state in SettingsCard"
```

---

## Task 6: Update module docs

**Files:**
- Modify: `docs/modules/components/index.md`

- [ ] **Step 1: Add AgentPermissionsSection row**

The current `docs/modules/components/index.md` has no row for `AgentPermissionsSection.tsx` (verified 2026-04-17). Add one directly after the existing `AgentManagerSection.tsx` row (line 21):

```markdown
| `AgentPermissionsSection.tsx` | settings | Agent tool permission editor — consent banner, preset buttons (Recommended/Restrictive/Permissive), allow-tool grid with names + descriptions, and custom deny-rule list. Reads/writes `~/.claude/settings.json` via `claudeConfig` IPC. | `AgentPermissionsSection` |
```

The `ConnectionsSection.tsx` row already describes the section correctly and does not mention the removed About card — no change needed there.

- [ ] **Step 3: Commit**

```bash
git add docs/modules/components/index.md
git commit -m "docs: add AgentPermissionsSection row to components index"
```

---

## Task 7: Final verification

- [ ] **Step 1: Run the full pre-commit check suite**

Run: `npm run typecheck && npm test && npm run lint`
Expected: All pass. Zero typecheck errors, all tests green, zero lint errors.

- [ ] **Step 2: Visual smoke test at three widths**

Run `npm run dev`. Resize the window to 1024px, 1440px, and 1920px. At each width, click through every sidebar entry:

| Width | Connections | Repositories | Templates | Agents | Models | Memory | Appearance | About |
|---|---|---|---|---|---|---|---|---|
| 1024 | centered, ~920px | same | same | same | same | full-width | same | full-width |
| 1440 | centered, 960px | same | same | same | same | full-width | same | full-width |
| 1920 | centered, 960px | same | same | same | same | full-width | same | full-width |

At every width, Agents → Tool Rules should render as a clean grid (not run-on text), and Auto-start should show a proper label-gap-checkbox row.

- [ ] **Step 3: Run the full test suite including main process**

Run: `npm run test:main`
Expected: PASS.

- [ ] **Step 4: If all green, the plan is done**

No separate final commit — each task committed its own change. Summary of commits:

```
fix(settings): responsive content container, lift 560px cap
fix(settings): inline checkbox variant for Auto-start row
fix(settings): add missing agent permissions styles
fix(settings): remove duplicate About FLEET card from Connections
fix(settings): wrap Webhooks empty state in SettingsCard
docs: update settings module docs for responsiveness pass
```
