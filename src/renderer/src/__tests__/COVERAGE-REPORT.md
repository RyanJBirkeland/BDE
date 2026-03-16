# BDE Test Coverage Report

**Generated:** 2026-03-15
**Branch:** `feat/test-coverage-audit`

## Summary

| Metric | Value |
|--------|-------|
| Source files | 54 |
| Tested (before) | 5 files / 35 tests |
| Tested (after) | 26 files / 150+ tests |
| Coverage (before) | ~9% file coverage |
| Coverage (after) | ~48% file coverage |

## Coverage Gap Analysis

| File | Tested? | Priority | Reason |
|------|---------|----------|--------|
| **Stores** | | | |
| `stores/sessions.ts` | Yes | - | Already tested (4 tests) |
| `stores/toasts.ts` | **Now** | P0 | Core notification system used by all features |
| `stores/ui.ts` | **Now** | P0 | View routing state, used everywhere |
| `stores/terminal.ts` | **Now** | P0 | Tab management logic with edge cases |
| `stores/chat.ts` | **Now** | P0 | Session-scoped message store, data isolation critical |
| `stores/theme.ts` | **Now** | P0 | Persistence to localStorage, DOM side effects |
| `stores/gateway.ts` | **Now** | P0 | Connection lifecycle, reconnect logic |
| **Libs** | | | |
| `lib/rpc.ts` | Yes | - | Already tested (7 tests) |
| `lib/diff-parser.ts` | Yes | - | Already tested (7 tests) |
| `lib/cost.ts` | **Now** | P0 | Financial calculations — correctness critical |
| `lib/gateway.ts` | **Now** | P0 | WebSocket RPC, timeout handling, reconnect |
| `lib/github-api.ts` | No | P2 | Thin fetch wrapper, low logic density |
| **Session Components** | | | |
| `components/sessions/MessageInput.tsx` | **Now** | P0 | Primary user input — Enter/Shift+Enter, disabled states |
| `components/sessions/SessionList.tsx` | **Now** | P0 | Main navigation — kill, steer, keyboard nav |
| `components/sessions/AgentDirector.tsx` | **Now** | P0 | Task spawning + steering chips |
| `components/sessions/ChatThread.tsx` | No | P2 | Heavy polling logic, mock-heavy — separate PR |
| `components/sessions/SpawnModal.tsx` | No | P2 | Complex async form — separate PR |
| `components/sessions/TaskComposer.tsx` | No | P2 | Similar to SpawnModal — separate PR |
| `components/sessions/LiveFeed.tsx` | No | P2 | Streaming display — separate PR |
| **Layout Components** | | | |
| `components/layout/StatusBar.tsx` | **Now** | P1 | Connection status display |
| `components/layout/TitleBar.tsx` | **Now** | P1 | Cost display, theme toggle |
| `components/layout/CommandPalette.tsx` | **Now** | P1 | Keyboard navigation, fuzzy search |
| `components/layout/ToastContainer.tsx` | **Now** | P1 | Toast rendering + dismiss |
| `components/layout/ActivityBar.tsx` | No | P2 | Pure nav buttons, no logic |
| **Views** | | | |
| `views/SessionsView.tsx` | **Now** | P1 | Smoke test — renders without crash |
| `views/SprintView.tsx` | **Now** | P1 | Smoke test |
| `views/DiffView.tsx` | **Now** | P1 | Smoke test |
| `views/MemoryView.tsx` | **Now** | P1 | Smoke test |
| `views/CostView.tsx` | **Now** | P1 | Smoke test |
| `views/SettingsView.tsx` | **Now** | P1 | Smoke test |
| `views/TerminalView.tsx` | **Now** | P1 | Smoke test (mock xterm) |
| **UI Components** | | | |
| `components/ui/Badge.tsx` | Yes | - | Already tested (8 tests) |
| `components/ui/Button.tsx` | Yes | - | Already tested (9 tests) |
| `components/ui/EmptyState.tsx` | **Now** | P1 | Title + description + action button |
| `components/ui/ErrorBoundary.tsx` | **Now** | P1 | Error catching + fallback rendering |
| `components/ui/Input.tsx` | **Now** | P1 | Controlled value, prefix/suffix, disabled |
| `components/ui/Textarea.tsx` | **Now** | P1 | Auto-resize, onKeyDown passthrough |
| `components/ui/Spinner.tsx` | **Now** | P1 | Size variants |
| `components/ui/Card.tsx` | No | P2 | Pure wrapper, no logic |
| `components/ui/Tooltip.tsx` | No | P2 | CSS-only tooltip, no logic |
| `components/ui/Divider.tsx` | No | P2 | Pure layout wrapper |
| `components/ui/Kbd.tsx` | No | P2 | Pure layout wrapper |
| `components/ui/Panel.tsx` | No | P2 | Pure layout wrapper |
| **Hooks** | | | |
| `hooks/useTaskNotifications.ts` | No | P2 | Side-effect hook — defer |
| **Main Process** | | | |
| `src/main/index.ts` | No | P2 | IPC handlers — separate PR (E2E) |
| `src/preload/index.ts` | No | P2 | Bridge API — separate PR (E2E) |

## Priority Definitions

- **P0** — Must test. Stores with business logic, libs with financial/RPC calculations, critical session components. Bugs here go undetected until runtime.
- **P1** — Should test. Layout components (smoke tests), views (render without crash), UI components with interactive behavior.
- **P2** — Nice to have. Pure wrappers, thin API clients, complex async components better suited for E2E. Deferred to follow-up PRs.
