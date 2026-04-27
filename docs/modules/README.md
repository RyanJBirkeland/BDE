# FLEET Module Documentation

Codebase reference organized by architectural layer. Each layer index lists every module with its purpose and key exports. Modules with a detail file are linked.

| Layer | Description |
|-------|-------------|
| [Services](services/index.md) | Domain services — business logic that IPC handlers delegate to |
| [Handlers](handlers/index.md) | IPC handlers — thin wrappers over services |
| [Data](data/index.md) | Repository and query layer — SQLite access |
| [Agent Manager](agent-manager/index.md) | Pipeline agent lifecycle orchestration |
| [Components](components/index.md) | React UI components, grouped by domain |
| [Views](views/index.md) | Top-level view components (one per app view) |
| [Stores](stores/index.md) | Zustand state stores |
| [Hooks](hooks/index.md) | React hooks |
| [Shared](shared/index.md) | Types, IPC channels, constants shared across processes |
| [Lib — Main](lib/main/index.md) | Utility functions for the main process |
| [Lib — Renderer](lib/renderer/index.md) | Utility functions for the renderer process |

## How to use

- **Find a module:** go to its layer index, scan the Purpose column.
- **Add a module:** add a row to the layer index before committing. See CLAUDE.md § Module Documentation.
- **Add a detail file:** create `docs/modules/<layer>/<module>.md` and link it from the index row.
