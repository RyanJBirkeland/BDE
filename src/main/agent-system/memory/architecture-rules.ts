/**
 * Architecture rules - memory module for BDE architectural patterns
 */
export const architectureRules = `## Architecture Rules

### Process Boundaries
- Main: Node.js APIs, SQLite, fs, child processes
- Preload: IPC bridge only (no business logic)
- Renderer: React UI, Zustand state, no direct fs/db

### Data Flow
1. Renderer → window.api.method()
2. Preload → ipcRenderer.invoke()
3. Main handler (safeHandle) processes
4. Main broadcasts via ipcMain.emit()
5. Renderer subscribers update Zustand

### IPC Surface Minimalism
- Coarse-grained channels (not chatty)
- Pass aggregated data
- Use SQLite triggers + file watchers for reactive updates
- Broadcast for 1-to-many updates

### Zustand Store Rules
- Max one store per domain concern
- Never nest stores (no store calling another's setState)
- Use selectors for stable references
- Aggregate with useShallow for 5+ fields

### File Organization
- Shared types: src/shared/ (all processes)
- Main-only: src/main/
- Renderer-only: src/renderer/src/
- Never import main/ from renderer/ or vice versa

### Example
\`\`\`typescript
// Good: Stable selector
const title = useTaskStore(s => s.currentTask?.title)

// Bad: New object every render
const task = useTaskStore(s => ({ title: s.title, status: s.status }))

// Good: useShallow for multiple fields
const { title, status } = useTaskStore(useShallow(s => ({
  title: s.title,
  status: s.status
})))
\`\`\`
`
