/**
 * Testing patterns - memory module for BDE testing conventions
 */
export const testingPatterns = `## Testing Patterns

### Coverage Requirements (CI enforced)
- 72% statements
- 66% branches (tightest — test ALL conditionals)
- 70% functions
- 74% lines

### Critical Test Cases
- Conditional branches (if/else, ternaries)
- Error states and loading states
- Empty arrays / null checks
- User interactions (clicks, keyboard events)

### Test Organization
- Renderer: src/renderer/src/**/__tests__/
- Main: src/main/__tests__/
- Integration: src/main/__tests__/integration/
- E2E: e2e/

### Running Tests
- npm test — renderer unit
- npm run test:main — main process integration
- npm run test:coverage — enforce thresholds (CI)
- npm run test:e2e — Playwright E2E

### Common Gotchas
- Set Zustand state BEFORE render() in tests
- Never mix async userEvent with sync fireEvent
- Mock better-sqlite3 in main tests
- Rebuild native modules after node tests: npx electron-rebuild -f -w better-sqlite3

### Example
\`\`\`typescript
describe('MyComponent', () => {
  it('should handle error state', () => {
    const store = useMyStore.getState()
    store.setError(new Error('test'))
    render(<MyComponent />)
    expect(screen.getByText(/error/i)).toBeInTheDocument()
  })
})
\`\`\`
`
