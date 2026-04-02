# BDE MVP Polish

You are working in the BDE (Birkeland Development Environment) Electron app repo at `/Users/RBTECHBOT/Documents/Repositories/BDE`.

## Task
Polish the app for a clean MVP. Fix rough edges, improve consistency.

## Specific items to address

1. **Loading states** — All views that fetch data (SprintView, SessionsView, DiffView) should show a spinner or skeleton while loading. Check if they handle the empty/loading state gracefully.

2. **Error states** — If a fetch fails (gateway offline, GitHub API error), show a user-friendly error message in the view rather than crashing or showing nothing.

3. **Empty states** — Each view needs a sensible empty state when there's no data (e.g. no sessions, no diffs, no sprint tasks).

4. **Consistent spacing** — Check `src/renderer/src/assets/` CSS files for inconsistent padding/margin. Views should have consistent 16px padding from edges.

5. **ActivityBar icons** — In `src/renderer/src/components/layout/ActivityBar.tsx`, verify each view has a distinct icon and the active state (accent color underline or fill) is clearly visible.

6. **Window title** — Set the window title dynamically based on active view in `src/main/index.ts`.

7. **Fix any TypeScript errors** — Run `npm run typecheck` and fix any remaining type errors.

## Rules
- Work on a branch: `git checkout -b feat/mvp-polish`
- Build must pass: `npm run build`
- Open a PR when done: `gh api repos/RyanJBirkeland/BDE/pulls --method POST -f title="feat: BDE MVP polish — loading states, error states, consistent spacing" -f body="Polish pass for MVP" -f head="$(git branch --show-current)" -f base=main --jq ".html_url"`
- Never commit directly to main
- Use `GH_TOKEN=$(git credential fill <<< $'protocol=https\nhost=github.com\n' 2>/dev/null | grep password | cut -d= -f2) gh api repos/RyanJBirkeland/BDE/pulls --method POST ...`
