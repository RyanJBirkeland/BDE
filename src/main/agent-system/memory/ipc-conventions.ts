/**
 * IPC conventions - memory module for BDE IPC patterns
 */
export const ipcConventions = `## IPC Conventions

### Handler Registration
- All handlers in src/main/handlers/ modules
- Export registerXHandlers() function
- Register in src/main/index.ts
- Update src/preload/index.ts AND src/preload/index.d.ts

### Handler Implementation
- ALWAYS use safeHandle() wrapper for error logging
- Validate inputs at handler boundary
- Return typed results (never throw to renderer)
- Use execFileAsync (not execSync) for shell commands

### Testing
- Each handler module needs __tests__/module-name.test.ts
- Assert exact handler count (catches missing registrations)
- Test error paths (not just happy paths)

### Example
\`\`\`typescript
import { safeHandle } from '../handlers-shared'

export function registerMyHandlers() {
  safeHandle('my:channel', async (payload) => {
    // Validate inputs
    if (!payload.id) throw new Error('id required')
    // Handler logic
    return result
  })
}
\`\`\`
`
