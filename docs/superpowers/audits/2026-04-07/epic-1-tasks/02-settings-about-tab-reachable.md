# Add the About tab to the Settings sidebar

## Problem

The Settings "About" page is fully built and registered in `SECTION_MAP` (line 59) and `SECTION_META` (line 81), but is missing from the `SECTIONS` array (lines 35-46) that renders the sidebar. Users have no way to navigate to it. CLAUDE.md and `BDE_FEATURES.md` both promise an About section exists.

## Solution

Add the `about` entry to the `SECTIONS` array in `SettingsView.tsx`. The icon should be `Info` from lucide-react (currently not imported in this file — add it to the existing lucide-react import on lines 6-17). Place the entry under the `'App'` category alongside Appearance, Notifications, Keybindings, Memory.

The change is exactly two edits:

1. Add `Info` to the lucide-react import (alphabetical order)
2. Add `{ id: 'about', label: 'About', icon: Info, category: 'App' }` to the `SECTIONS` array (place it after `memory` so it lands at the bottom of the App category)

Do NOT touch `SECTION_MAP`, `SECTION_META`, the `AboutSection` component itself, or any other settings file. They are already correct.

## Files to Change

- `src/renderer/src/views/SettingsView.tsx` — add `Info` to lucide import; add the new entry to `SECTIONS`

## How to Test

1. `npm run typecheck` — must pass
2. `npm test` — must pass
3. `npm run lint` — must pass
4. Manual verification (describe in commit message, no automated test required): launch the app, open Settings (⌘7), confirm "About" appears in the sidebar under the "App" category, click it, confirm `AboutSection` renders with the version/log/GitHub info.

## Out of Scope

- Changes to `AboutSection.tsx` itself
- Changes to other settings tabs
- Updating CLAUDE.md or BDE_FEATURES.md tab counts (separate task)
