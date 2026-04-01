import type { BDESkill } from './types'

export const codePatternsSkill: BDESkill = {
  id: 'code-patterns',
  trigger: 'User asks to generate BDE-idiomatic code (IPC, Zustand, panels)',
  description: 'Generate code following BDE conventions',
  guidance: `# BDE Code Patterns

## IPC Handlers
All handlers must use safeHandle() wrapper:
\`\`\`typescript
import { safeHandle } from '../handlers-shared'

export function registerMyHandlers() {
  safeHandle('my:channel', async (payload) => {
    // Handler logic
    return result
  })
}
\`\`\`

Register in src/main/index.ts:
\`\`\`typescript
import { registerMyHandlers } from './handlers/my-handlers'
registerMyHandlers()
\`\`\`

Update preload: src/preload/index.ts AND src/preload/index.d.ts

## Zustand Stores
\`\`\`typescript
import { create } from 'zustand'

interface MyStore {
  data: string | null
  setData: (data: string) => void
}

export const useMyStore = create<MyStore>((set) => ({
  data: null,
  setData: (data) => set({ data })
}))
\`\`\`

Usage:
\`\`\`typescript
// Good: Stable selector
const data = useMyStore(s => s.data)

// Good: Multiple fields with useShallow
import { useShallow } from 'zustand/react/shallow'
const { data, setData } = useMyStore(useShallow(s => ({
  data: s.data,
  setData: s.setData
})))
\`\`\`

## Panel Views
1. Add to View union in panelLayout.ts
2. Update ALL maps: VIEW_ICONS, VIEW_LABELS, VIEW_SHORTCUTS
3. Create ViewName.tsx in src/renderer/src/views/
4. Add lazy import in view-resolver.tsx
5. Register in resolveView() switch

## Testing
\`\`\`typescript
describe('MyComponent', () => {
  it('should render data', () => {
    // Set state BEFORE render
    const store = useMyStore.getState()
    store.setData('test')

    render(<MyComponent />)
    expect(screen.getByText('test')).toBeInTheDocument()
  })

  it('should handle error state', () => {
    // Test conditional branches
    const store = useMyStore.getState()
    store.setData(null)

    render(<MyComponent />)
    expect(screen.getByText(/no data/i)).toBeInTheDocument()
  })
})
\`\`\`

Coverage thresholds: 72% stmts, 66% branches, 70% functions, 74% lines
`,
  capabilities: ['code-generation']
}
