# Settings View Redesign — Design Spec

**Date:** 2026-04-03
**Goal:** Redesign the Settings view from a flat 10-tab horizontal bar to a categorized left sidebar with consistent card-based content panels. Professional, cohesive, scannable.

## Navigation: Grouped Sidebar

Replace the horizontal tab bar with a left sidebar (200px) containing 4 category groups and 9 sections.

### Category Groups

| Category | Sections | Icon prefix |
|----------|----------|-------------|
| **Account** | Connections, Permissions | Link, Shield |
| **Projects** | Repositories, Templates | GitFork, FileText |
| **Pipeline** | Agent Manager, Cost & Usage | Bot, DollarSign |
| **App** | Appearance, Memory, About | Palette, Brain, Info |

### Sidebar Behavior
- Category headers: uppercase 9px labels in `var(--neon-purple)` at 60% opacity
- Section items: 12px with Lucide icon + label, 7px vertical padding, 6px border-radius
- Active item: `var(--neon-purple-surface)` background, `var(--neon-purple)` text
- Hover: `var(--bde-surface)` background
- Keyboard: ArrowUp/Down to navigate items, Enter to select. Extend `useRovingTabIndex` hook with `orientation: 'vertical'` parameter (currently only handles horizontal ArrowLeft/Right). Fallback: implement directly like existing `handleTabKeyDown` in SettingsView.
- Sidebar background: `var(--bde-bg-elevated)` with right border `var(--neon-purple-border)`

### Dropped: "Agent" Tab
The current `AgentRuntimeSection.tsx` (15 lines) is a deprecated stub. Remove it entirely.

## Content Panel: Shared Layout

Every section renders inside a content area with consistent structure:

```
<div class="settings-content"> (flex: 1, padding: 28px 36px, overflow-y: auto)
  <div class="settings-content__inner"> (max-width: 560px; wide sections use --wide variant with no max-width)
    <div class="settings-page-header">
      <h2 class="settings-page-header__title">Section Name</h2>
      <p class="settings-page-header__subtitle">One-line description</p>
    </div>
    [section-specific content using shared card pattern]
  </div>
</div>
```

### Shared Card Component: `SettingsCard`

A reusable card wrapper for all settings content:

```tsx
interface SettingsCardProps {
  icon?: ReactNode        // 36x36 icon block (optional)
  title: string           // 13px semibold
  subtitle?: string       // 11px muted
  status?: { label: string; variant: 'success' | 'info' | 'warning' | 'neutral' }
  children: ReactNode     // card body content
  footer?: ReactNode      // actions row (buttons)
}
```

Visual spec:
- Background: `var(--bde-surface)`
- Border: `1px solid var(--bde-border)`
- Border-radius: 10px
- Padding: 18px
- Margin-bottom: 12px
- Footer: top border `var(--bde-border)`, padding-top 12px

### Status Pills

Consistent status indicators across all sections:

| State | Color | Background |
|-------|-------|-----------|
| Connected | `var(--neon-green)` | `var(--neon-green-surface)` |
| Configured | `var(--neon-purple)` | `var(--neon-purple-surface)` |
| Not Set | `var(--bde-text-muted)` | `var(--bde-surface)` |
| Error | `var(--bde-danger)` | `var(--neon-red-surface)` |

### Button Patterns

Two tiers:
- **Primary action:** `var(--neon-purple)` background, white text (Save, Apply). Use `.bde-btn--primary`.
- **Secondary action:** transparent, `1px solid var(--bde-border)`, `var(--bde-text-muted)` text (Test, Refresh, Cancel). Use `.bde-btn--ghost`.

Buttons always right-aligned in card footer. 6px border-radius, 11px font, 5px 14px padding.

## Section Designs (9 sections)

### 1. Connections (Account)
Two `SettingsCard`s:
- **Claude CLI Auth:** Icon block "C" in purple gradient. Status pill (Connected/Disconnected). Footer: expiry date + Refresh button.
- **GitHub:** Icon block "G" in neutral. Status pill. Token input with eye toggle. Footer: Test + Save buttons.

### 2. Permissions (Account)
- Consent banner at top (existing cyan banner, keep as-is)
- **Preset Cards:** 3 horizontal cards (Recommended/Restrictive/Permissive) — clickable, active state highlighted
- **Tool Rules:** `SettingsCard` with checkbox list for tool allow/deny. Existing functionality preserved.
- **Custom Deny Rules:** `SettingsCard` with input + list of deny patterns

### 3. Repositories (Projects)
- **Repo list:** Each configured repo as a `SettingsCard` with name, path, owner/repo, color swatch. Edit/Delete actions in footer.
- **Add Repo:** Button at bottom opens inline form (existing expand pattern). Form fields: name, local path (with Browse), GitHub owner, GitHub repo, color picker.
- **Empty state:** Icon + "No repositories configured" + Add button

### 4. Templates (Projects)
- Each template as a `SettingsCard` with name field + prefix textarea. Auto-saves on debounce (500ms, already implemented).
- **Add Template:** Button at bottom
- **Delete:** Confirm dialog (existing pattern)

### 5. Agent Manager (Pipeline)
Single `SettingsCard` with form fields:
- Max Concurrent Agents (number input)
- Model (text input)
- Worktree Base Path (text input)
- Max Runtime per Task (number input, ms)
- Auto-start toggle (checkbox)
- Footer: Save button
- Note text: "Changes take effect on next app restart"

### 6. Cost & Usage (Pipeline)
Uses `settings-content__inner--wide` (no max-width constraint — table needs horizontal space).
- **ClaudeCodePanel:** Preserve existing summary panel (tasks today/week/all, total tokens this week, avg cost per task, most expensive task). Wrap in `SettingsCard`.
- **Cost table:** `SettingsCard` wrapping the existing sortable `TaskTable` with 8 columns. Column headers with `aria-sort` (already implemented from audit). Row click navigates to Agents view (existing). Loading skeletons + empty state preserved.
- **Footer:** Refresh + Export CSV buttons

### 7. Appearance (App)
- **Theme:** 3 toggle buttons (Dark/Light/Warm) in a `SettingsCard`. Existing `aria-pressed` preserved.
- **Accent Color:** Color swatch picker row, 6 options. Existing `aria-pressed` preserved.
- **Tear-off Window Close:** Preserve existing close-action preference (`tearoff.closeAction` setting) — "Return to main window" vs "Close window" option with Reset button. Wrap in `SettingsCard`.
- **Motion:** Preserve existing reduced-motion toggle if present.

### 8. Memory (App)
Uses `settings-content__inner--wide` (two-pane needs horizontal space).
Compact two-pane layout within the content area:
- **Left pane (180px):** File list with search input, scrollable. New/Refresh buttons in header.
- **Right pane:** Editor textarea with Save/Discard buttons in footer.
- Both panes inside a single `SettingsCard` with no padding (full-bleed). The card provides the border/background, panes divide internally.
- Existing Cmd+S scoped to active editor (already fixed in audit)
- Existing keyboard navigation (ArrowUp/Down in file list) preserved

### 9. About (App)
Single `SettingsCard`:
- App name + version
- Log file paths (clickable to open in IDE)
- GitHub repo link
- Minimal — keep it clean

## CSS Architecture

### New file: `settings-v2-neon.css`
- Replaces `settings-neon.css` (292 lines)
- BEM prefix: `.stg-` (short, unique)
- Classes: `.stg-layout`, `.stg-sidebar`, `.stg-sidebar__category`, `.stg-sidebar__item`, `.stg-content`, `.stg-page-header`, `.stg-card`, `.stg-card__header`, `.stg-card__body`, `.stg-card__footer`, `.stg-status-pill`, `.stg-field`, `.stg-field__label`, `.stg-field__input`

### Keep: `settings.css`
- Base layout primitives stay. View shell structure.

### Tokens only
- All colors via `var(--neon-*)` or `var(--bde-*)` — zero hardcoded values
- Spacing: use `var(--bde-space-*)` where tokens exist (1-4 scale). Pixel values acceptable for one-off measurements (e.g., sidebar width 200px, card radius 10px).
- Light theme works via token propagation (no `html.theme-light` overrides needed)

## Component Architecture

### New components
- `SettingsSidebar.tsx` — sidebar nav with categories, uses `useRovingTabIndex`
- `SettingsCard.tsx` — shared card wrapper (icon, title, subtitle, status, children, footer)
- `SettingsPageHeader.tsx` — title + subtitle for each section
- `StatusPill.tsx` — connected/configured/error status indicator

### Modified components
- `SettingsView.tsx` — replace tab bar with sidebar layout, route to sections
- `CredentialForm.tsx` — keep as reusable form helper, integrate within `SettingsCard` body (no structural changes, just wrapping)
- All 9 section components — wrap content in `SettingsCard` pattern, remove inline layout

### Deleted
- `AgentRuntimeSection.tsx` — deprecated stub (15 lines)
- `settings-neon.css` — replaced by `settings-v2-neon.css`

## Keyboard & Accessibility
- Sidebar: `role="navigation"`, items are `role="link"` with `aria-current="page"` on active
- ArrowUp/Down navigation via `useRovingTabIndex`
- All existing a11y from audit preserved (focus-visible, aria-labels, roving tab on sub-tabs)
- Page header announced on section change via `aria-live="polite"` region

## Migration Strategy
1. Build new layout shell (sidebar + content) alongside existing tab bar
2. Create shared components (`SettingsCard`, `SettingsSidebar`, `SettingsPageHeader`, `StatusPill`)
3. Migrate sections one at a time into new card pattern
4. Update tests at each step — sidebar navigation replaces tab bar assertions, card structure replaces section queries
5. Swap view when all sections are migrated
6. Delete old `settings-neon.css` and `AgentRuntimeSection.tsx`

Existing `framer-motion` page transitions preserved.

This is a visual refresh only — no IPC changes, no store changes, no new data. All existing functionality preserved with better presentation.
