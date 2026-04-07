# Fix README factual errors (clone URL, counts, missing view)

## Problem

The README has multiple factual errors that anyone evaluating BDE will notice in the first 30 seconds:

1. **Wrong clone URL.** `README.md:297` says `git clone https://github.com/rbtechbot/bde.git`. The canonical URL per `src/renderer/src/components/settings/AboutSection.tsx:9` is `https://github.com/RyanJBirkeland/BDE`. Anyone copy-pasting the README install steps will fail at step 1.
2. **Wrong architecture counts.** `README.md` claims "86 typed channels", "17 IPC handler modules", "8 Views". Actuals per CLAUDE.md and the codebase: ~144 typed channels, 23 handler modules, 9 views.
3. **Missing Task Planner from the Views table.** `README.md:324-336` lists 8 views and omits Task Planner (⌘8). Task Workbench is shown with shortcut "—" (actually ⌘0).
4. **"8 Views" label inside the Mermaid architecture diagram** at `README.md:221` contradicts itself (lists 8, BDE actually ships 9).

This task is **only** the factual corrections. The "promote Ship It / Dev Playground / Code Review screenshots" work is Epic 5 — out of scope here.

## Solution

Make exactly the corrections listed above. Do not restructure sections, add screenshots, rewrite copy, or touch the cost-vs-tokens drift (also a separate task).

For counts: read CLAUDE.md as the source of truth. If you cannot find a current handler-module count, run `ls src/main/handlers/ | grep -v __tests__ | wc -l`.

## Files to Change

- `README.md` — clone URL, channel/handler/view counts, Mermaid diagram label, Views table (add Task Planner row, fix Workbench shortcut)

## How to Test

1. `grep -n "rbtechbot" README.md` — must return zero matches
2. `grep -n "RyanJBirkeland/BDE" README.md` — must return at least one match
3. `grep -n "86 typed\|17 IPC\|8 Views" README.md` — must return zero matches
4. `grep -n "Task Planner" README.md` — must return at least one match in the Views table
5. `npm run typecheck`, `npm test`, `npm run lint` — must all pass (README is markdown but lint may complain about line length)

## Out of Scope

- Cost vs tokens drift (separate task)
- Adding Ship It / Dev Playground promotional content (Epic 5)
- Adding screenshots
- Updating CLAUDE.md or BDE_FEATURES.md (separate task)
- Changing onboarding copy
- Restructuring README sections
