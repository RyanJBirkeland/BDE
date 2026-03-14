# BDE — Birkeland Development Environment

A desktop Electron app for managing OpenClaw AI agent sessions, git workflows, cost tracking, and agent memory. Built with React, TypeScript, and Zustand.

## Prerequisites

- **Node.js** v22+ (managed via nvm)
- **npm** for dependency management
- **OpenClaw gateway** running locally — BDE reads its config from `~/.openclaw/openclaw.json` to connect on port 18789

## Setup

```bash
npm install
npm run dev      # Start dev server with hot reload
npm run build    # Type-check + production build
npm test         # Run unit tests (vitest)
```

## Views

| View | Shortcut | Description |
|------|----------|-------------|
| **Sessions** | `Cmd+1` | Multi-panel workspace — session list, task composer, live feed, agent director, log viewer. Polls gateway every 10s. |
| **Sprint / PRs** | `Cmd+2` | Kanban-style sprint board and GitHub PR list side-by-side. |
| **Diff** | `Cmd+3` | Full git client — file staging/unstaging, diff viewer, commit composer, push. Supports multi-repo. |
| **Memory** | `Cmd+4` | File browser + editor for OpenClaw agent memory at `~/.openclaw/workspace/memory/`. |
| **Cost Tracker** | `Cmd+5` | Token cost analytics — daily spend chart, model breakdown, per-session table, CSV export. Polls every 30s. |
| **Settings** | `Cmd+6` | Gateway URL/token config, theme switcher (dark/light), accent color presets. |

## Gateway Config

BDE requires `~/.openclaw/openclaw.json` to exist with at minimum:

```json
{
  "gateway": {
    "url": "ws://127.0.0.1:18789",
    "token": "your-gateway-token"
  }
}
```

If the file is missing or malformed, BDE shows an error dialog on launch.

## Scripts

| Script | Purpose |
|--------|---------|
| `npm run dev` | Electron-vite dev server with HMR |
| `npm run build` | Type-check + build for production |
| `npm start` | Preview the built app |
| `npm test` | Run unit tests once (vitest) |
| `npm run test:watch` | Vitest in watch mode |
| `npm run lint` | ESLint with cache |
| `npm run format` | Prettier |
| `npm run build:mac` | macOS app bundle |
| `npm run build:win` | Windows executable |
| `npm run build:linux` | Linux AppImage |

## Architecture

```
src/
  main/           # Electron main process — IPC handlers, git ops, config
  preload/        # Preload bridge — exposes window.api to renderer
  renderer/src/
    views/         # 6 top-level views (Sessions, Sprint, Diff, Memory, Cost, Settings)
    stores/        # Zustand stores (chat, gateway, sessions, toasts, ui, theme)
    components/    # UI components (layout, sessions, sprint, diff, ui primitives)
    design-system/ # Design tokens (colors, spacing, typography, etc.)
    lib/           # RPC client, diff parser, utilities
```

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Cmd+1–6` | Switch views |
| `Cmd+K` | Command palette |
| `Cmd+R` | Refresh sessions |
| `?` | Shortcuts overlay |
| `Esc` | Close overlays |
