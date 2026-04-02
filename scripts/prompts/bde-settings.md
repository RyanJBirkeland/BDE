# BDE Settings View

You are working in the BDE (Birkeland Development Environment) Electron app repo at `/Users/RBTECHBOT/Documents/Repositories/BDE`.

## Context
Gateway config is read from `~/.openclaw/openclaw.json` via `src/main/config.ts`. The `getGatewayConfig` IPC handler returns `{ url, token }`.

## Task
Build a Settings view so users can configure the app without editing files.

### What to build

1. **New view** — Create `src/renderer/src/views/SettingsView.tsx`

2. **Sections**

   **Gateway**
   - Gateway URL (default: `ws://127.0.0.1:18789`)
   - Gateway token (password input, masked by default, toggle to reveal)
   - Connection status indicator (connected/disconnected based on gateway store)
   - "Test connection" button — attempts to connect and shows result

   **Repositories**
   - List of repo paths (life-os, feast, BDE) from `getRepoPaths()` IPC
   - Read-only display for now (just show the paths)

   **Appearance**
   - Accent color picker (6 presets: `#00D37F` default green, blue, purple, orange, red, white)
   - Store in localStorage, apply as `--bde-accent` CSS variable on `:root`

   **About**
   - App version from `package.json`
   - Link to GitHub repo (`https://github.com/RyanJBirkeland/BDE`)

3. **Persistence** — Save gateway URL/token changes to `~/.openclaw/openclaw.json` via a new `saveGatewayConfig` IPC handler in `src/main/config.ts`. Reconnect after save.

4. **Wire in** — Add settings (gear) icon to `ActivityBar.tsx`. The `'settings'` view is already in `VIEW_ORDER` — just make sure `ViewRouter` renders `<SettingsView />` for it.

## Rules
- Work on a branch: `git checkout -b feat/settings-view`
- Build must pass: `npm run build`
- Open a PR when done: `gh api repos/RyanJBirkeland/BDE/pulls --method POST -f title="feat: BDE settings view — gateway config, repo paths, accent color" -f body="Settings screen for gateway config and appearance" -f head="$(git branch --show-current)" -f base=main --jq ".html_url"`
- Never commit directly to main
- Use `GH_TOKEN=$(git credential fill <<< $'protocol=https\nhost=github.com\n' 2>/dev/null | grep password | cut -d= -f2) gh api repos/RyanJBirkeland/BDE/pulls --method POST ...`
