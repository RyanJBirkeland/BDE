# BDE Agent Director — Wire to Real Sessions

You are working in the BDE (Birkeland Development Environment) Electron app repo at `/Users/RBTECHBOT/Documents/Repositories/BDE`.

## Context

- `src/renderer/src/components/sessions/AgentDirector.tsx` — currently has a form to dispatch tasks but uses mock data
- `src/renderer/src/lib/rpc.ts` — RPC client for gateway tool calls
- Gateway tools available: `sessions_spawn`, `sessions_send`, `sessions_list`, `subagents`

## Task

Wire the AgentDirector component to actually dispatch tasks to the OpenClaw gateway.

### What to build

1. **Spawn agent** — The "Run Task" / dispatch form should call `sessions_spawn` via `rpc.ts`:

   ```
   tool: sessions_spawn
   params: { task: <user prompt>, mode: "run", runtime: "subagent" }
   ```

   Show a success toast with the session key returned.

2. **Steer agent** — Add a "Send message" input below the session list. When a session is selected and a message is submitted, call `sessions_send`:

   ```
   tool: sessions_send
   params: { sessionKey: <selected>, message: <text> }
   ```

3. **Kill agent** — Add a stop/kill button per session that calls `subagents`:

   ```
   tool: subagents
   params: { action: "kill", target: <sessionKey> }
   ```

4. **Task templates** — Keep 3–4 quick-launch templates in the UI (e.g. "Fix build errors", "Open PR", "Review code") that pre-fill the task input.

5. **Status feedback** — Show spinner while request is in flight. Show error message if RPC fails.

## Rules

- Work on a branch: `git checkout -b feat/agent-director-wired`
- Build must pass: `npm run build`
- Open a PR when done: `gh api repos/RyanJBirkeland/BDE/pulls --method POST -f title="feat: BDE agent director wired — spawn/steer/kill via gateway RPC" -f body="Wires AgentDirector to real gateway tools" -f head="$(git branch --show-current)" -f base=main --jq ".html_url"`
- Never commit directly to main
- Use `GH_TOKEN=$(git credential fill <<< $'protocol=https\nhost=github.com\n' 2>/dev/null | grep password | cut -d= -f2) gh api repos/RyanJBirkeland/BDE/pulls --method POST ...`
