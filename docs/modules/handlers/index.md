# Handlers

IPC handler modules. Thin wrappers — receive IPC calls, delegate to services, return results.
Source: `src/main/handlers/`

| Module | Purpose | Key Exports |
|--------|---------|-------------|
| `git-handlers.ts` | Git and GitHub IPC handlers — source control, PR polling, GitHub API proxy | `registerGitHandlers`, `GitHandlersDeps` |
| `window-handlers.ts` | Window and playground IPC handlers — external URL gating, window title, open-in-browser for playground HTML | `registerWindowHandlers` |
| `synthesizer-handlers.ts` | IPC handlers for AI spec generation and revision (`synthesizer:generate`, `synthesizer:revise`, `synthesizer:cancel`). Validates request payloads before delegating to `spec-synthesizer` service. | `registerSynthesizerHandlers` |
