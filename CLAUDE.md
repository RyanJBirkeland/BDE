# CLAUDE.md — BDE

## Build & Test

```bash
npm install          # Install dependencies
npm run dev          # Dev server with HMR
npm run build        # Type-check + production build (must pass before PR)
npm test             # Unit tests via vitest (must pass before PR)
npm run lint         # ESLint
npm run format       # Prettier
```

## Branch Conventions

- `feat/` — New features (e.g. `feat/git-client`)
- `fix/` — Bug fixes (e.g. `fix/rpc-layer`)
- `chore/` — Maintenance, docs, refactors (e.g. `chore/audit`)

## Commit Messages

Format: `{type}: {description}`

- `feat:` new feature
- `fix:` bug fix
- `chore:` maintenance / docs

## PR Rules

1. Branch from `main`, PR back to `main`
2. **Self-heal**: `npm run build` and `npm test` must both pass before opening a PR
3. Keep PRs focused — one feature or fix per PR
4. **UX PRs must include screenshots or ASCII art** of every changed UI surface in the PR body. Use ASCII art as fallback if the app can't be rendered. This is required — no exceptions.

## Conflict-Prone Files

These files are edited frequently across branches. Take extra care when modifying:

- `src/renderer/src/App.tsx` — main app shell, keyboard shortcuts, view routing
- `src/main/index.ts` — all IPC handler registrations
- `src/preload/index.ts` — preload bridge API surface

## Architecture Notes

- **State**: Zustand stores in `src/renderer/src/stores/`
- **IPC**: Main process handlers in `src/main/index.ts`, preload bridge in `src/preload/index.ts`
- **RPC**: Renderer talks to OpenClaw gateway via HTTP POST (`src/renderer/src/lib/rpc.ts`)
- **Design tokens**: `src/renderer/src/design-system/tokens.ts` — use these instead of hardcoded values
- **Views**: 6 views in `src/renderer/src/views/` — Sessions, Sprint, Diff, Memory, Cost, Settings

## Key Conventions

- TypeScript strict mode
- Zustand for all client state
- `lucide-react` for icons
- `react-resizable-panels` for panel layouts
- Max one Zustand store per domain concern
