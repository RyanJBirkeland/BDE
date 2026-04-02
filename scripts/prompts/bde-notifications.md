# BDE Notifications System

You are working in the BDE (Birkeland Development Environment) Electron app repo at `/Users/RBTECHBOT/Documents/Repositories/BDE`.

## Task
Build a toast notification system for in-app feedback.

### What to build

1. **Toast store** — Create `src/renderer/src/stores/toasts.ts` (Zustand):
   ```ts
   type Toast = { id: string; message: string; type: 'success' | 'error' | 'info'; durationMs?: number }
   ```
   Actions: `addToast(message, type, durationMs?)`, `removeToast(id)`
   Auto-remove after `durationMs` (default 3000ms).

2. **ToastContainer component** — Create `src/renderer/src/components/layout/ToastContainer.tsx`
   - Fixed position: bottom-right, 16px from edges
   - Stack up to 4 toasts vertically
   - Each toast: rounded pill, colored by type (accent green = success, red = error, muted = info)
   - Slide-in from right animation, fade-out on dismiss
   - Click to dismiss early

3. **Mount in App.tsx** — Add `<ToastContainer />` inside the app shell (after StatusBar).

4. **Wire to existing actions** — Find places in the codebase that currently have no feedback (e.g. gateway reconnect, file save in MemoryView, PR merge in SprintView) and add `addToast` calls.

5. **Export helper** — Export a `toast` helper from the store:
   ```ts
   export const toast = { success: (msg) => ..., error: (msg) => ..., info: (msg) => ... }
   ```

## Rules
- Work on a branch: `git checkout -b feat/notifications`
- Build must pass: `npm run build`
- Open a PR when done: `gh api repos/RyanJBirkeland/BDE/pulls --method POST -f title="feat: BDE notifications — toast system with Zustand store" -f body="Toast notification system wired to existing actions" -f head="$(git branch --show-current)" -f base=main --jq ".html_url"`
- Never commit directly to main
- Use `GH_TOKEN=$(git credential fill <<< $'protocol=https\nhost=github.com\n' 2>/dev/null | grep password | cut -d= -f2) gh api repos/RyanJBirkeland/BDE/pulls --method POST ...`
