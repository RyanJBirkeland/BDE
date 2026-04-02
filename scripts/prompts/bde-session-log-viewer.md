# BDE Session Log Viewer

You are working in the BDE (Birkeland Development Environment) Electron app repo at `/Users/RBTECHBOT/Documents/Repositories/BDE`.

## Context
- `src/renderer/src/components/sessions/SessionList.tsx` — lists sessions, user can select one
- `src/renderer/src/components/sessions/LiveFeed.tsx` — shows live feed (may already exist)
- `src/renderer/src/lib/rpc.ts` — RPC client for gateway tool calls
- Gateway tool: `sessions_history` — fetches message history for a session key

## Task
Build a Session Log Viewer panel that shows the full message history for a selected session.

### What to build

1. **SessionLogViewer component** — Create `src/renderer/src/components/sessions/SessionLogViewer.tsx`

2. **Data** — When a session is selected in SessionList, call `sessions_history` via RPC:
   ```
   tool: sessions_history
   params: { sessionKey: <selected>, limit: 50 }
   ```

3. **Message rendering**
   - User messages: right-aligned bubble, white text
   - Assistant messages: left-aligned, accent green text
   - Tool calls: collapsed by default, show tool name + expandable JSON params
   - Tool results: collapsed, show first 80 chars of result
   - System messages: center-aligned, muted italic
   - Timestamps: shown on hover

4. **Layout** — The viewer slides in as a right panel (resizable, min 300px) when a session is selected. Show a placeholder "Select a session to view logs" when nothing is selected.

5. **Load more** — "Load earlier messages" button at top fetches with offset.

6. **Copy button** — Copy full conversation as markdown to clipboard.

7. **Wire into SessionsView** — Update `src/renderer/src/views/SessionsView.tsx` to render `<SessionLogViewer />` in the right panel alongside `LiveFeed`.

## Rules
- Work on a branch: `git checkout -b feat/session-log-viewer`
- Build must pass: `npm run build`
- Open a PR when done: `gh api repos/RyanJBirkeland/BDE/pulls --method POST -f title="feat: BDE session log viewer — full message history with tool call expansion" -f body="Session log viewer wired to sessions_history gateway tool" -f head="$(git branch --show-current)" -f base=main --jq ".html_url"`
- Never commit directly to main
- Use `GH_TOKEN=$(git credential fill <<< $'protocol=https\nhost=github.com\n' 2>/dev/null | grep password | cut -d= -f2) gh api repos/RyanJBirkeland/BDE/pulls --method POST ...`
