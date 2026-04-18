# settings-events

**Layer:** main (MCP Server)
**Source:** `src/main/mcp-server/settings-events.ts`

## Purpose

Local, in-process event bus for settings-change notifications. Allows main-process modules to subscribe to setting changes without relying on renderer IPC broadcasts — enabling synchronous hot-toggle of server state (e.g., start/stop MCP server when `mcp.enabled` setting changes).

## Public API

- `SettingChangedEvent` — event object with `key` (string) and `value` (string | null)
- `emitSettingChanged(event)` — emit a setting change to all subscribers (called by config handlers after successful writes)
- `onSettingChanged(listener)` — register a listener; returns unsubscribe function

## Key Dependencies

- `config-handlers.ts` — emits events after `settings:set`, `settings:setJson`, and `settings:delete` IPC calls
