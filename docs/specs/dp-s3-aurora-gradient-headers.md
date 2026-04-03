# DP-S3: Consistent Aurora Gradient View Headers

**Epic:** Design Polish
**Priority:** P1
**Depends on:** DP-S1

---

## Problem

The aurora gradient text treatment (`text-gradient-aurora`) creates a premium, distinctive look — but it's only used in 2 places:

- `SprintCenter.tsx:206` — "SPRINT CENTER"
- `NewTicketModal.tsx:145` — "NEW TICKET"

Every other view uses plain text for its title:

| View               | Header Text                       | Current Style                               | Line Reference         |
| ------------------ | --------------------------------- | ------------------------------------------- | ---------------------- |
| Sessions sidebar   | "AGENTS"                          | `bde-section-title` (plain uppercase muted) | `SessionsView.tsx:290` |
| DiffView           | (no view title — just repo chips) | N/A                                         | `DiffView.tsx:240`     |
| MemoryView sidebar | "Memory"                          | `memory-sidebar__title` (plain)             | `MemoryView.tsx:193`   |
| CostView           | "Cost Tracker"                    | `cost-view__title` (16px plain)             | `CostView.tsx:403`     |
| SettingsView       | "Settings"                        | `settings-view__title` (20px plain)         | `SettingsView.tsx:120` |

Additionally, the Sprint Center header has an aurora accent underline (`sprint.css:707-715`) that no other view header has.

The design system defines `heading-page` and `heading-hero` classes (`design-system.css:785-814`) that include the aurora gradient — but these classes are used in **zero TSX files**.

---

## Solution

### 1. Add aurora gradient + accent underline to all view headers

Create a reusable `.view-header` CSS pattern:

```css
.view-header {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  flex-shrink: 0;
}

.view-header::after {
  content: '';
  position: absolute;
  bottom: 0;
  left: 16px;
  right: 16px;
  height: 1px;
  background: linear-gradient(
    90deg,
    rgba(0, 211, 127, 0.4) 0%,
    rgba(108, 142, 239, 0.2) 60%,
    transparent 100%
  );
}

.view-header__title {
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  background: var(--gradient-aurora);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}
```

### 2. Apply to each view

| View                      | Change                                                                                              |
| ------------------------- | --------------------------------------------------------------------------------------------------- |
| Sessions sidebar header   | Replace `bde-section-title` with `view-header__title text-gradient-aurora`                          |
| DiffView                  | Add a `.view-header` bar with "GIT" title above repo chips                                          |
| MemoryView sidebar header | Apply `text-gradient-aurora` to "MEMORY" title, add accent underline                                |
| CostView header           | Replace `cost-view__title` with `view-header__title text-gradient-aurora`, wrap in `.view-header`   |
| SettingsView title        | Replace `settings-view__title` with `view-header__title text-gradient-aurora`, add accent underline |
| Sprint Center             | Already done — extract to reusable pattern                                                          |

### 3. Retire unused heading classes

Add deprecation comment to `heading-page`, `heading-hero`, `heading-section` in `design-system.css:785-814`, or adopt them as the implementation for `.view-header__title`.

---

## Files to Modify

| File                                        | Change                                             |
| ------------------------------------------- | -------------------------------------------------- |
| `src/renderer/src/assets/main.css`          | Add `.view-header` / `.view-header__title` classes |
| `src/renderer/src/views/SessionsView.tsx`   | Apply aurora title to sidebar header               |
| `src/renderer/src/views/DiffView.tsx`       | Add `.view-header` with "GIT" title                |
| `src/renderer/src/views/MemoryView.tsx`     | Apply aurora title + accent underline              |
| `src/renderer/src/views/CostView.tsx`       | Wrap header in `.view-header`, apply aurora title  |
| `src/renderer/src/views/SettingsView.tsx`   | Apply aurora title                                 |
| `src/renderer/src/assets/design-system.css` | Deprecation comment on unused heading classes      |

## Acceptance Criteria

- [ ] All 7 views (Sessions, Terminal, Sprint, Diff, Memory, Cost, Settings) have an aurora gradient title
- [ ] All view headers have the accent underline (gradient border-bottom)
- [ ] A shared `.view-header` CSS pattern is used instead of per-view one-offs
- [ ] `heading-page` / `heading-hero` / `heading-section` are either adopted or marked deprecated
- [ ] Visual consistency: switching between views feels like one cohesive app
