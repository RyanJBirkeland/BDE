# DP-S2: Glass Morphism for All Views

**Epic:** Design Polish
**Priority:** P0
**Depends on:** DP-S1

---

## Problem

Glass morphism is BDE's signature visual treatment but is only applied to ~40% of the app. The premium look is concentrated in modals and the Sprint board, while most working views feel flat and disconnected.

### Current Glass Coverage

| Component                | Glass? | Class Used                              |
| ------------------------ | ------ | --------------------------------------- |
| TitleBar                 | Yes    | `glass`                                 |
| ActivityBar              | Yes    | CSS-level glass via fallback vars       |
| Sessions sidebar         | Yes    | CSS-level glass (`session-list`)        |
| AgentRow                 | Yes    | `glass glass-highlight`                 |
| NewTicketModal           | Yes    | `glass-modal elevation-3`               |
| SpawnModal               | Yes    | `glass-modal`                           |
| CommandPalette           | Yes    | `glass-modal`                           |
| ShortcutsOverlay         | Yes    | `glass-modal`                           |
| App shell                | Yes    | `elevation-0`                           |
| **DiffView sidebar**     | **No** | `background: var(--bde-surface)` — flat |
| **DiffView file header** | **No** | `background: var(--bde-surface)` — flat |
| **MemoryView sidebar**   | **No** | `background: var(--bde-surface)` — flat |
| **CostView cards**       | **No** | `bde-card` — flat surface               |
| **CostView charts**      | **No** | `background: var(--bde-surface)` — flat |
| **SettingsView**         | **No** | No panel treatment at all               |
| **StatusBar**            | **No** | `background: var(--bde-surface)` — flat |
| **SpecDrawer**           | **No** | `background: var(--bde-surface)` — flat |
| **Sprint columns**       | **No** | `background: var(--bde-surface)` — flat |
| **Sprint cards**         | **No** | `background: var(--bde-bg)` — flat      |

---

## Solution

Apply the elevation system consistently:

| Level                            | Treatment                                | Where                                                         |
| -------------------------------- | ---------------------------------------- | ------------------------------------------------------------- |
| `elevation-0`                    | App background + subtle radial glow      | Already applied to `.app-shell`                               |
| `elevation-1` / `glass`          | Sidebars, panels, StatusBar              | DiffView sidebar, MemoryView sidebar, StatusBar               |
| `elevation-2` / `glass-elevated` | Active panels, drawers, chart containers | SpecDrawer, CostView chart/donut cards, SettingsView sections |
| `elevation-3` / `glass-modal`    | Modals, overlays                         | Already applied                                               |

### Specific Changes

1. **DiffView sidebar** (`main.css:917-925`): Add `glass` class or equivalent CSS-level glass (matching sessions sidebar pattern at `sessions.css:40-51`).

2. **MemoryView sidebar** (`main.css:476-483`): Replace flat `background: var(--bde-surface)` with glass tint + backdrop-filter, matching the sessions sidebar.

3. **CostView charts** (`cost.css:71-76`, `cost.css:94-99`): Replace `background: var(--bde-surface)` with `glass-elevated` or equivalent CSS. The stat cards already use `<Card>` but need glass treatment on the Card itself.

4. **SettingsView** (`main.css:1370-1371`): Wrap each `settings-section` in a glass-elevated panel with border-radius and padding.

5. **StatusBar** (`main.css:206-215`): Replace `background: var(--bde-surface)` with glass tint + subtle backdrop-filter.

6. **SpecDrawer** (`sprint.css:916-929`): Replace flat `background: var(--bde-surface)` with `glass-elevated` treatment.

7. **Sprint columns** (`sprint.css:748-755`): Apply subtle glass to `.kanban-col` background.

8. **Sprint cards** (`sprint.css:786-794`): Apply `.glass .glass-highlight` to `.task-card`.

---

## Files to Modify

| File                                 | Change                                                                           |
| ------------------------------------ | -------------------------------------------------------------------------------- |
| `src/renderer/src/assets/main.css`   | Glass for: `.diff-sidebar`, `.memory-sidebar`, `.statusbar`, `.settings-section` |
| `src/renderer/src/assets/cost.css`   | Glass for: `.cost-chart`, `.cost-donut`, `.cost-stat-card`                       |
| `src/renderer/src/assets/sprint.css` | Glass for: `.kanban-col`, `.task-card`, `.spec-drawer`                           |

## Acceptance Criteria

- [ ] Every sidebar panel uses glass tint + backdrop-filter (consistent with sessions sidebar)
- [ ] StatusBar has glass treatment
- [ ] CostView chart containers have `glass-elevated` appearance
- [ ] SpecDrawer has `glass-elevated` background
- [ ] Sprint columns and task cards have subtle glass sheen
- [ ] SettingsView sections are wrapped in glass panels
- [ ] No visual regression on components that already have glass
- [ ] `npm run build` passes
