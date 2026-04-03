# Team 4 — Code Review & Git Audit

## Executive Summary

The PR Station is the second-largest component set in the app (11 components + 4 diff components + 5 git-tree components + 2 views + 2 CSS files) and currently reads as a functional but visually utilitarian code review tool. The current design language uses flat `var(--bde-surface)` backgrounds, `border-radius: 4-6px`, and no glassmorphism, gradients, or ambient glows anywhere in this layer. The Git Tree view uses 100% inline styles via the old `tokens` object, completely bypassing CSS variables and the new design system. The Merge Button -- the single most important CTA in the code review flow -- uses a plain `bde-btn--primary` with no gradient, no glow, and no micro-interaction. This is the poster child for the feast-site upgrade.

---

## UX Designer Findings

### PR List

**Current state:** Flat list rows with 2px left-border accent on selection. Repo badges are tiny pills (10px font, full-radius) with hardcoded background colors. CI badges are icon-only with no background treatment.

**Issues:**

1. **Card treatment missing.** PR rows are borderless flat divs. They need `border-radius: 16px`, glass-surface background (`rgba(5,5,5,0.85) + backdrop-filter: blur(20px)`), and a subtle border (`1px solid var(--bde-border)`).
2. **Hover state is anemic.** Current: `background: var(--bde-surface)`. Needs: border brighten on hover (`border-color` transition to `var(--bde-border-hover)`), plus `active:scale(0.97)` micro-interaction.
3. **Selected state uses a left-border accent.** This is fine directionally but should add an ambient glow: `box-shadow: inset 0 0 0 1px var(--bde-accent), 0 0 20px rgba(0,211,127,0.06)`.
4. **CI badges need background pills.** The pass/fail/pending icons float naked. Wrap them in small tinted pills matching the review badge pattern (e.g., `color-mix(in srgb, var(--bde-accent) 15%, transparent)` for pass).
5. **Repo badge radius** is already `9999px` (good) but needs a subtle `box-shadow` or border instead of relying solely on background color for contrast.
6. **Loading skeletons** reuse `sprint-board__skeleton` -- should use a shared skeleton component with the new `var(--bde-surface-high)` shimmer animation.

### PR Detail Panel

**Current state:** Clean section-based layout with 800px max-width. Description body gets a `var(--bde-surface)` card with `border-radius: var(--bde-radius-md)` (6px).

**Issues:**

1. **Section cards need the feast-site radius.** `border-radius: 6px` -> `16px` for description body, review cards, conversation cards. Inner elements like check run items: `12px`.
2. **Header lacks visual weight.** The PR title + number + metadata is plain text. Add a subtle `var(--bde-header-gradient)` underline or a glass-surface card treatment for the entire header block.
3. **Stats badges (+additions / -deletions)** are plain colored text. Wrap in tinted pills: `+42` in a green-tinted pill, `-18` in a red-tinted pill, matching the file-badge pattern but with the new radii.
4. **Labels** use raw `#color` backgrounds from GitHub with white text. Add a `backdrop-filter: blur(4px)` and semi-transparent treatment so they feel native to the app rather than pasted in.
5. **Tab underline** is 2px solid. Consider upgrading to a sliding indicator pill (animated `translateX`) with the accent gradient for the active tab -- more IntelliJ IDEA than VS Code.

### Diff Viewer

**Current state:** Functional unified diff with file sidebar, line gutters, hunk headers. Colors use `var(--bde-diff-add-bg)` / `var(--bde-diff-del-bg)` which are likely low-opacity tints.

**Issues:**

1. **File header sticky bar** (`diff-file__header`) uses `var(--bde-surface)` with no blur. Upgrade to glassmorphism: `backdrop-filter: blur(12px)` + semi-transparent background so diff content scrolls visibly behind it.
2. **Hunk headers** (`diff-hunk__header`) use `var(--bde-hover-subtle)` -- too subtle. Add a left-accent bar (3px solid `var(--bde-info)`) to visually anchor each hunk.
3. **Line selection highlight** uses `!important` override (line 592 of `diff.css`). Replace with a proper specificity chain. The selection color should have a subtle pulse animation to indicate interactivity.
4. **Comment composer** border is `1px solid var(--bde-accent)` -- flat. Upgrade to a glow: `box-shadow: 0 0 0 1px var(--bde-accent), 0 4px 16px rgba(0,211,127,0.08)`.
5. **File sidebar** (`diff-sidebar`, 200px wide) active file uses `background: var(--bde-border)` -- same as hover. Active needs stronger differentiation: accent left-border + tinted background.
6. **Diff add/del line backgrounds** need slightly more saturation for the feast-site aesthetic. Current transparency levels are likely ~5-7%; bump to 10-12% for add lines, 8-10% for delete lines.

### Merge Button

**This is THE feast-site CTA moment.** Current state: plain `bde-btn--primary` with flat `var(--bde-accent)` background. No gradient, no glow, no animation.

**Required upgrades:**

1. **Gradient background:** `linear-gradient(135deg, #00D37F, #00A863)` -- the signature feast-site CTA gradient.
2. **Ambient glow on idle:** `box-shadow: 0 4px 16px rgba(0,211,127,0.25), 0 8px 32px rgba(0,211,127,0.08)`.
3. **Hover glow intensification:** `box-shadow: 0 4px 24px rgba(0,211,127,0.35), 0 8px 48px rgba(0,211,127,0.12)`.
4. **Active press:** `transform: scale(0.97)` + slightly dimmed glow.
5. **Border radius:** `12px` for the main button, `0 12px 12px 0` for the dropdown trigger.
6. **Dropdown trigger divider:** Currently `border-left: 1px solid var(--bde-border)` on `var(--bde-accent)` background. Needs `border-left: 1px solid rgba(255,255,255,0.2)` for the translucent-on-gradient effect.
7. **Merging state:** Add a subtle shimmer/pulse animation during the merge operation instead of just text change.
8. **Strategy dropdown** (`merge-button__dropdown`): Glass-surface with `backdrop-filter: blur(20px)`, `border-radius: 12px`, layered shadow.
9. **Both `MergeButton.tsx` and `PRStationActions.tsx` duplicate** the merge button pattern (same `MERGE_STRATEGIES` array, same dropdown logic). The `MergeButton` in the detail header and the `PRStationActions` at the bottom both render merge controls -- consolidate to one component.

### Filter Bar

**Current state:** Button group for repo chips using `bde-btn--sm` + `bde-btn--primary/ghost`. Sort dropdown is a native `<select>`.

**Issues:**

1. **Repo chips** should be pill-shaped (`border-radius: 9999px`) with glass surface when inactive and the accent gradient fill when active.
2. **Sort dropdown** is a native `<select>` element (line 56-68 of `PRStationFilters.tsx`). Native selects cannot be styled consistently. Replace with a custom dropdown matching the merge strategy dropdown pattern -- glass surface, `border-radius: 12px`, layered shadow.
3. **Filter bar container** needs `padding` increase and a subtle bottom-border gradient separator.
4. **No search input exists.** For repos with many PRs, a text filter would reduce cognitive load. Consider adding an inline search field with the feast-site input treatment (`border-radius: 16px`, focus glow).

### Git Tree View

**Current state:** Entirely inline-styled using the `tokens` object. No CSS classes, no design system CSS variables. Visually functional but completely disconnected from the feast-site direction.

**Issues:**

1. **All components use inline styles.** `GitFileRow.tsx`, `FileTreeSection.tsx`, `CommitBox.tsx`, `BranchSelector.tsx`, `InlineDiffDrawer.tsx` -- every one uses `style={{...}}` with `tokens.color.*` / `tokens.radius.*`. This bypasses CSS variables, makes theming impossible, and prevents hover/focus pseudo-class styling (hence the `onMouseEnter`/`onMouseLeave` JS hacks throughout).
2. **Hover states are JS-managed.** Every interactive element manually sets `style.backgroundColor` and `style.color` on mouseenter/mouseleave. This is fragile, doesn't handle keyboard focus, and creates accessibility gaps (no `:focus-visible` styling).
3. **Border radius uses `tokens.radius.sm` (4px)** everywhere. Needs feast-site upgrade: commit box `16px`, branch selector `12px`, file rows `8px`.
4. **Commit button** uses `tokens.color.accent` flat background with `color: '#000'` hardcoded. Needs the feast-site gradient CTA treatment (same as Merge Button).
5. **Push button** is visually subordinate (ghost style) which is correct hierarchy, but needs `border-radius: 12px` and hover border-brighten.
6. **Branch selector dropdown** uses inline-styled absolute positioning. Needs glass-surface treatment: `backdrop-filter: blur(20px)`, `border-radius: 12px`, layered shadow.
7. **InlineDiffDrawer** hardcodes `rgba()` values for line backgrounds (line 28-32). Violates the CSS theming rule. Must use CSS variables.
8. **Section headers** (Staged Changes, Changes) use `textTransform: 'uppercase'` + `letterSpacing: '0.05em'` inline. This is a pattern that should be a CSS utility class.

### Branch Selector

**Issues:**

1. **Trigger button** is a small inline-styled element. Needs feast-site treatment: glass-surface background, `border-radius: 12px`, border-brighten on hover.
2. **Dropdown uses `zIndex: 1000`** with a full-viewport invisible backdrop div. This works but the overlay should use `var(--bde-overlay)` instead of being invisible.
3. **Active branch** in dropdown uses `tokens.color.accentDim` background. Good start -- add a left-accent bar or checkmark icon for stronger affordance.
4. **No keyboard navigation** within the dropdown. Arrow keys don't move through branches. Only Escape closes it.

### Commit Box

**Issues:**

1. **Textarea** uses inline `onFocus`/`onBlur` to toggle border color. Should be CSS `:focus` pseudo-class.
2. **No character count or conventional commit format hinting.** Consider a subtle helper below the textarea.
3. **Button group** is horizontal flex. The commit button is `flex: 1` while push is fixed-width -- good hierarchy, but both need `border-radius: 12px`.

---

## Product Manager Findings

### Code Review Workflow

**PR discovery -> review -> merge flow:**

1. **Friction: Two merge button locations.** `MergeButton` renders in the PR detail header (line 184 of `PRStationDetail.tsx`) AND `PRStationActions` renders at the bottom of the detail content (line 183 of `PRStationView.tsx`). Both have independent merge strategy state. If a user selects "Rebase" in one, the other still shows "Squash". This is confusing.

2. **Friction: Tab switching loses scroll position.** Switching between Info and Diff tabs re-renders the entire content. Scroll position in the diff or info panel is lost.

3. **Friction: No way to view diff inline from the file list.** The "Changed Files" section in PRStationDetail shows filenames but they're not clickable -- you have to switch to the Diff tab and find the file in the sidebar manually.

4. **Friction: Review submission is disconnected.** The "Submit Review" button only appears in a banner when pending comments exist. There's no persistent "Review" action in the header or action bar. Users must add at least one inline comment before they can submit a review (the dialog opens from the banner).

5. **Good: Confirmation dialog on PR switch with pending comments.** The `handleSelectPr` flow correctly warns users about pending comments (which persist to localStorage).

6. **Good: Size warning for large diffs.** `DiffSizeWarning` component with "Load anyway" escape hatch.

7. **Gap: No way to re-request review** after pushing changes.

8. **Gap: No PR description editing.** Users can read the description but can't edit it inline.

### Git Workflow

**Stage -> commit -> push flow:**

1. **Good: Cmd+Enter to commit** is well-signaled in the placeholder text.
2. **Friction: No commit message templates.** No conventional commit prefix suggestions, no previous commit message recall.
3. **Friction: No amend commit option.** Common workflow: commit, realize you forgot a file, amend.
4. **Friction: Push has no feedback about remote state.** No indication of commits ahead/behind remote.
5. **Gap: No stash support.** Branch switching is blocked by uncommitted changes with no stash option.
6. **Gap: No pull/fetch.** Only push exists. Users have no way to pull remote changes from within the UI.
7. **Good: Repo selector** when multiple repos are configured.
8. **Good: Inline diff drawer** for previewing changes before staging.

### Missing UX Patterns

1. **Keyboard-driven review:** The diff viewer has `]`/`[` for file navigation and arrow keys for hunk navigation (good), but no `n`/`p` for next/prev comment thread, no `c` to open composer, no `Enter` on a selected line range to start a comment.
2. **Batch file actions in diff:** No "Viewed" checkbox per file (GitHub-style) to track review progress.
3. **PR status transitions:** No way to convert draft to ready-for-review.
4. **Cross-linking:** Clicking a file in the PR detail's "Changed Files" section should jump to that file in the Diff tab.
5. **Review progress indicator:** No "3 of 12 files reviewed" counter.

---

## Sr. Frontend Dev Findings

### Component-Level Changes

#### `MergeButton.tsx` + `PRStationActions.tsx` — Duplicate Logic (P1)

Both components duplicate: `MERGE_STRATEGIES` array, merge method state, dropdown open/close logic, outside-click handler, merge API call. `PRStationActions` adds close-PR functionality. **Recommendation:** Extract `MergeButton` as the single merge CTA and have `PRStationActions` compose it alongside the Close button. Remove the `MergeButton` render from `PRStationDetail.tsx` (line 184) to eliminate the dual-merge-button problem.

#### Git Tree Components — Inline Style Migration (P1)

All 5 git-tree components use inline styles exclusively. This creates:

- No `:hover`, `:focus`, `:focus-visible`, `:active` pseudo-class support
- JS-managed hover states (`onMouseEnter`/`onMouseLeave`) that don't fire on keyboard navigation
- No CSS transition support (inline style changes are instant)
- No theming (bypasses CSS variable system entirely)

**Recommendation:** Create a `git-tree.css` file. Migrate all inline styles to CSS classes. Use CSS variables for colors. This unblocks all feast-site styling and fixes accessibility gaps.

#### `DiffViewer.tsx` — Prop Drilling (P2)

`PlainDiffContent` receives 18 props. This is a maintenance burden. **Recommendation:** Extract a `DiffViewerContext` to hold selection state, composer range, and event handlers. Components within the diff tree can consume via `useContext`.

#### `InlineDiffDrawer.tsx` — Hardcoded rgba() Values (P2)

Lines 28-32 use `rgba(0, 211, 127, 0.07)`, `rgba(255, 77, 77, 0.07)`, `rgba(59, 130, 246, 0.07)`. These violate the CSS theming rule. **Recommendation:** Use `var(--bde-diff-add-bg)`, `var(--bde-diff-del-bg)`, `var(--bde-diff-info-bg)` CSS variables (already defined for the main diff view).

#### `ReviewSubmitDialog.tsx` — Missing ARIA (P2)

The dialog uses `onClick={onClose}` on backdrop but has no `role="dialog"`, no `aria-modal="true"`, no focus trap, no `Escape` key handler. **Recommendation:** Add `role="dialog" aria-modal="true" aria-labelledby="review-dialog-title"`. Add focus trap and Escape handler.

#### `PRStationFilters.tsx` — Native Select (P2)

The `<select>` element (line 56) cannot be styled for the feast-site aesthetic. Native selects render differently per OS. **Recommendation:** Replace with a custom dropdown component matching the pattern in `MergeButton` or `BranchSelector`.

#### `PRStationList.tsx` — Triple Filter Call (P3)

The `removedKeys` filter runs three times (lines 79, 93, 96) per render. **Recommendation:** Compute filtered list once in a `useMemo`.

### CSS Changes

#### `pr-station.css` — Feast-Site Upgrade Targets

| Selector                    | Current                                     | Target                                 |
| --------------------------- | ------------------------------------------- | -------------------------------------- |
| `.pr-station-list__row`     | `border-radius: 0`                          | `border-radius: 12px; margin: 2px 8px` |
| `.pr-detail__body`          | `border-radius: var(--bde-radius-md)` (6px) | `border-radius: 16px`                  |
| `.pr-review`                | `border-radius: var(--bde-radius-md)` (6px) | `border-radius: 16px`                  |
| `.pr-conversation__comment` | `border-radius: var(--bde-radius-md)` (6px) | `border-radius: 16px`                  |
| `.pr-conflict-banner`       | `border-radius: var(--bde-radius-md)` (6px) | `border-radius: 16px`                  |
| `.review-dialog`            | `border-radius: var(--bde-radius-md)` (6px) | `border-radius: 20px` + glassmorphism  |
| `.pr-actions__dropdown`     | `border-radius: 6px`                        | `border-radius: 12px` + glassmorphism  |
| `.merge-button__action`     | `bde-btn--primary` (flat)                   | Gradient + glow (see UX section)       |
| `.pr-station__tab--active`  | `border-bottom: 2px`                        | Sliding pill indicator                 |

#### `diff.css` — Feast-Site Upgrade Targets

| Selector                  | Current                                     | Target                                                |
| ------------------------- | ------------------------------------------- | ----------------------------------------------------- |
| `.diff-file__header`      | `background: var(--bde-surface)`            | Glassmorphism sticky header                           |
| `.diff-comment-widget`    | `border-radius: var(--bde-radius-md)` (6px) | `border-radius: 12px`                                 |
| `.diff-comment-composer`  | `border: 1px solid var(--bde-accent)`       | Accent glow shadow                                    |
| `.diff-sidebar`           | `background: var(--bde-surface)`            | Glass-surface with blur                               |
| `.diff-line--selected`    | `!important` override                       | Proper specificity chain                              |
| `.diff-selection-trigger` | `border-radius: 50%`                        | Add glow: `box-shadow: 0 2px 8px rgba(0,211,127,0.3)` |

#### New CSS File Needed: `git-tree.css`

All git-tree inline styles need to be migrated here. Estimated ~200 lines of CSS to replace ~400 lines of inline style objects.

### Performance Concerns

1. **Large diffs:** Virtualization kicks in above `DIFF_VIRTUALIZE_THRESHOLD` but disables when comments exist (`useVirtualization = totalLines > threshold && !hasComments`). A PR with many review comments on a large diff will render all lines -- potential frame drops. Consider virtualized rendering with comment widgets.

2. **`PRStationList` triple-filter:** The `removedKeys` filter creates a new array on each of three calls per render. Wrap in `useMemo`.

3. **`PRStationDetail` waterfall:** The component fetches PR detail, files, reviews, review comments, and issue comments in one `Promise.all`, then fetches check runs in a second sequential call (depends on `head.sha`). The two-phase fetch is correct but the component has 8 `useState` calls and 4 loading states -- consider a reducer or data-fetching abstraction.

4. **Git Tree polling:** `POLL_GIT_STATUS_INTERVAL` (30s) calls `git status` via IPC. Each poll triggers a full re-render of all file rows because `useGitTreeStore.getState()` actions are called outside of selectors. The `fetchStatus` / `fetchBranches` / etc. are pulled via `getState()` on every render (line 25-39 of `GitTreeView.tsx`) -- this is fine for actions but the pattern is unusual and could confuse future contributors.

5. **Inline style objects recreated per render:** Every git-tree component creates new style objects on each render. React's reconciler treats these as changed props, potentially causing unnecessary child re-renders. Moving to CSS classes eliminates this entirely.

---

## Priority Matrix

| Priority | Item                                                               | Persona | Effort |
| -------- | ------------------------------------------------------------------ | ------- | ------ |
| **P0**   | Merge Button feast-site gradient CTA treatment                     | UX/Dev  | S      |
| **P0**   | Git Tree inline styles -> CSS migration                            | Dev     | L      |
| **P1**   | Deduplicate MergeButton / PRStationActions merge logic             | PM/Dev  | M      |
| **P1**   | PR list row card treatment (radius, glass, hover)                  | UX/Dev  | M      |
| **P1**   | Review dialog ARIA / focus trap / keyboard                         | Dev     | S      |
| **P1**   | All border-radius upgrades (6px -> 12-20px across pr-station.css)  | UX/Dev  | M      |
| **P1**   | Diff file header glassmorphism sticky bar                          | UX/Dev  | S      |
| **P1**   | InlineDiffDrawer hardcoded rgba -> CSS variables                   | Dev     | S      |
| **P2**   | Replace native `<select>` in PRStationFilters with custom dropdown | UX/Dev  | M      |
| **P2**   | Review submit dialog glassmorphism + radius upgrade                | UX/Dev  | S      |
| **P2**   | Tab active indicator -> sliding pill animation                     | UX/Dev  | S      |
| **P2**   | CI badge pill treatment (background tints)                         | UX/Dev  | S      |
| **P2**   | Diff comment composer glow treatment                               | UX/Dev  | S      |
| **P2**   | DiffViewer PlainDiffContent prop drilling -> Context               | Dev     | M      |
| **P2**   | PRStationList triple-filter -> useMemo                             | Dev     | S      |
| **P2**   | Branch selector dropdown glass-surface + keyboard nav              | UX/Dev  | M      |
| **P2**   | Commit button feast-site gradient treatment                        | UX/Dev  | S      |
| **P3**   | Keyboard shortcuts for review (n/p comments, c to compose)         | PM/Dev  | M      |
| **P3**   | Changed Files -> Diff tab cross-linking                            | PM/Dev  | M      |
| **P3**   | PR description editing                                             | PM/Dev  | L      |
| **P3**   | Git stash / pull / amend support                                   | PM/Dev  | L      |
| **P3**   | Virtualized diff with comment widgets                              | Dev     | L      |
| **P3**   | Review progress indicator (files reviewed counter)                 | PM/Dev  | M      |
| **P3**   | Commit message templates / conventional commit hints               | PM/Dev  | S      |

**Effort key:** S = < 2 hours, M = 2-6 hours, L = 6+ hours

### Implementation Order Recommendation

1. **Phase 1 (CSS-only, low risk):** All border-radius upgrades, glassmorphism sticky headers, Merge Button gradient, glow treatments. Pure CSS changes to `pr-station.css` and `diff.css`. No component logic changes.
2. **Phase 2 (Component refactors):** Git Tree CSS migration, MergeButton deduplication, ReviewSubmitDialog ARIA, native select replacement. These touch component code but are straightforward.
3. **Phase 3 (Feature additions):** Keyboard review shortcuts, cross-linking, progress indicators. These add new functionality and need tests.
