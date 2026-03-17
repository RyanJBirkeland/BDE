# BDE Cost Tracker

You are working in the BDE (Birkeland Development Environment) Electron app repo at `/Users/RBTECHBOT/Documents/Repositories/BDE`.

## Context
The app connects to an OpenClaw gateway at `ws://127.0.0.1:18789`. Gateway config is read from `~/.openclaw/openclaw.json`. The `src/renderer/src/lib/rpc.ts` file contains the RPC client for calling gateway tools.

## Task
Build a Cost Tracker view that shows API spend across sessions.

### What to build

1. **New view** — Create `src/renderer/src/views/CostView.tsx`

2. **Data source** — Use the gateway's `sessions_list` tool (via `rpc.ts`) to fetch sessions. Each session has `inputTokens` and `outputTokens`. Calculate cost using Claude Sonnet 4.6 pricing:
   - Input: $3 / 1M tokens
   - Output: $15 / 1M tokens

3. **Display**
   - Total spend today (filter sessions by `updatedAt` within last 24h)
   - Total spend this week
   - Per-session breakdown: session key, model, input tokens, output tokens, cost
   - Sort by cost descending
   - Format costs as `$0.0042` (4 decimal places)

4. **Stat cards at top** — Three cards: Today's Cost, This Week's Cost, Total Sessions

5. **Wire into ActivityBar** — Add a `$` or wallet icon in `ActivityBar.tsx` for the cost view. Add `'cost'` to the `View` type in `src/renderer/src/stores/ui.ts` and wire into `ViewRouter` in `App.tsx`.

6. **Auto-refresh** — Refresh every 30 seconds.

## Rules
- Work on a branch: `git checkout -b feat/cost-tracker`
- Build must pass: `npm run build`
- Open a PR when done: `gh api repos/RyanJBirkeland/BDE/pulls --method POST -f title="feat: BDE cost tracker — session spend dashboard" -f body="Cost tracking view with per-session breakdown and daily/weekly totals" -f head="$(git branch --show-current)" -f base=main --jq ".html_url"`
- Never commit directly to main
- Use `GH_TOKEN=$(git credential fill <<< $'protocol=https\nhost=github.com\n' 2>/dev/null | grep password | cut -d= -f2) gh api repos/RyanJBirkeland/BDE/pulls --method POST ...`
