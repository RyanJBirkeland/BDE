# Add Memoized Field Selectors to Sprint UI Stores

## Context
`sprintSelection.ts`, `sprintFilters.ts`, and `sprintUI.ts` expose no per-field selectors. Components subscribe using `useShallow` over multi-field objects, which means a `searchQuery` change causes components that only care about `statusFilter` to re-render. The stores audit lens flagged this as a scalability tax that compounds with every new component that subscribes.

Additionally, `sprintTasks.ts:launchTask()` computes an inline activeCount filter that duplicates `selectActiveTaskCount` — replace it.
`notifications.ts` exposes `getUnreadCount()` as an action method (imperative, stale-prone) — replace with `selectUnreadCount` selector.

## Goal
Export one memoized selector per field for the sprint UI stores. Replace two known misuses of computed-as-action patterns.

## Files to Change

**Modify:**
- `src/renderer/src/stores/sprintSelection.ts` — add exported selectors: `selectSelectedTaskId`, `selectSelectedTaskIds`, `selectDrawerOpen`, `selectSpecPanelOpen`
- `src/renderer/src/stores/sprintFilters.ts` — add exported selectors: `selectStatusFilter`, `selectRepoFilter`, `selectTagFilter`, `selectSearchQuery`
- `src/renderer/src/stores/sprintUI.ts` — add exported selectors for any fields currently subscribed with `useShallow` by multiple components
- `src/renderer/src/stores/sprintTasks.ts` — in `launchTask()`, replace inline activeCount filter with `selectActiveTaskCount(get())`
- `src/renderer/src/stores/notifications.ts` — replace `getUnreadCount()` action with `export const selectUnreadCount = (state: NotificationsState) => state.notifications.filter(n => !n.read).length`

**Grep for call sites to update:**
- `getUnreadCount()` — find all call sites in renderer, replace with `useNotificationsStore(selectUnreadCount)`
- `useShallow` subscriptions on sprintSelection/sprintFilters — update to use per-field selectors where applicable

## Instructions
1. Read each store file before modifying.
2. Selector pattern: `export const selectX = (state: StoreState) => state.x` — exported from the store file, not the hook.
3. For `selectUnreadCount`: it must be a function, not a value. Grep for `getUnreadCount` to find all call sites and update each to `useNotificationsStore(selectUnreadCount)`.
4. Do not restructure store state shape — only add selectors alongside existing exports.
5. Grep for `useShallow` in files that subscribe to `sprintSelection` or `sprintFilters` — these are candidates for per-field selector migration.

## How to Test
- `npm run typecheck` must pass.
- `npm test` must pass.
- `npm run lint` must pass.
- No behavioral changes expected — verify Dashboard, Sprint Pipeline, and Code Review views load without errors.
