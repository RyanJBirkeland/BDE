# BDE Live Feed — Real WebSocket Streaming

You are working in the BDE (Birkeland Development Environment) Electron app repo at `/Users/RBTECHBOT/Documents/Repositories/BDE`.

## Context

The app connects to an OpenClaw gateway at `ws://127.0.0.1:18789`. The gateway token is read from `~/.openclaw/openclaw.json`. The gateway WebSocket connection is managed in `src/renderer/src/lib/gateway.ts` and `src/renderer/src/stores/gateway.ts`.

The `LiveFeed` component lives at `src/renderer/src/components/sessions/LiveFeed.tsx`. It currently renders placeholder data.

## Task

Wire the LiveFeed component to stream real messages from the OpenClaw gateway WebSocket.

### What to build

1. **Subscribe to gateway messages** — In `LiveFeed.tsx`, use the gateway store/websocket to receive incoming messages. The gateway sends JSON frames — display them as a scrolling log.

2. **Message format** — Each log entry should show:
   - Timestamp (HH:MM:SS)
   - Message type/role (user, assistant, tool_call, tool_result, system)
   - Content preview (first 120 chars, truncated with "…")
   - Color-coded by type (accent green for assistant, muted for tool, white for user)

3. **Auto-scroll** — The feed should auto-scroll to bottom on new messages, with a "pause scroll" button that appears when user scrolls up.

4. **Clear button** — Add a clear button to reset the feed.

5. **Filter by session** — If a session is selected in `SessionList`, filter the feed to only show messages from that session.

6. **IPC bridge** — The WebSocket lives in the renderer process (via `src/renderer/src/lib/gateway.ts`). Make sure messages flow correctly from the gateway store into LiveFeed.

## Rules

- Work on a branch: `git checkout -b feat/live-feed`
- Build must pass: `npm run build`
- Open a PR when done: `gh api repos/RyanJBirkeland/BDE/pulls --method POST -f title="feat: BDE live feed — real WebSocket streaming from gateway" -f body="Wires LiveFeed to real gateway WebSocket messages" -f head="$(git branch --show-current)" -f base=main --jq ".html_url"`
- Never commit directly to main
- Use `GH_TOKEN=$(git credential fill <<< $'protocol=https\nhost=github.com\n' 2>/dev/null | grep password | cut -d= -f2) gh api repos/RyanJBirkeland/BDE/pulls --method POST ...`
