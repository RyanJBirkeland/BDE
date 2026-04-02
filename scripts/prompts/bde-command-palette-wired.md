# BDE Command Palette — Wire to Real Actions

You are working in the BDE (Birkeland Development Environment) Electron app repo at `/Users/RBTECHBOT/Documents/Repositories/BDE`.

## Context
- `src/renderer/src/components/layout/CommandPalette.tsx` — renders a search modal (Cmd+K), currently shows static shortcuts
- `src/renderer/src/stores/ui.ts` — holds `activeView`, `setView`
- `src/renderer/src/stores/gateway.ts` — holds connection status

## Task
Make the Command Palette actually do things.

### Commands to implement

**Navigation** (filter by typing view name)
- `Go to Sessions` → setView('sessions')
- `Go to Sprint` → setView('sprint')
- `Go to Memory` → setView('memory')
- `Go to Diff` → setView('diff')
- `Go to Settings` → setView('settings')

**Actions**
- `Reconnect Gateway` → call `connect()` from gateway store
- `Refresh` → dispatch a custom event `bde:refresh` that each view listens for
- `New Agent Task` → open AgentDirector task input (dispatch custom event or navigate to sessions)
- `Open GitHub` → `shell.openExternal('https://github.com/RyanJBirkeland/BDE')`

**Recent sessions** (dynamic)
- Query `sessions_list` via RPC on palette open, show top 5 recent sessions as items
- Selecting one navigates to Sessions view and highlights that session

### UX
- Arrow keys to navigate items
- Enter to execute selected item
- Esc to close
- Show keyboard hint on right side of each item (e.g. `⌘1` for Sessions)
- Group items by category: Navigation, Actions, Recent Sessions

## Rules
- Work on a branch: `git checkout -b feat/command-palette-wired`
- Build must pass: `npm run build`
- Open a PR when done: `gh api repos/RyanJBirkeland/BDE/pulls --method POST -f title="feat: BDE command palette wired — navigation, actions, recent sessions" -f body="Wires Cmd+K palette to real navigation and gateway actions" -f head="$(git branch --show-current)" -f base=main --jq ".html_url"`
- Never commit directly to main
- Use `GH_TOKEN=$(git credential fill <<< $'protocol=https\nhost=github.com\n' 2>/dev/null | grep password | cut -d= -f2) gh api repos/RyanJBirkeland/BDE/pulls --method POST ...`
