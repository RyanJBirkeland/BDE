# opencode-wire

**Layer:** agent-manager
**Source:** `src/main/agent-manager/opencode-wire.ts`

## Purpose
Pure translation layer: converts one line of `opencode run --format json` stdout into zero or more synthetic Anthropic SDK wire messages consumable by `agent-event-mapper.mapRawMessage`. No I/O, no side effects.

## Public API
- `translateOpencodeEvent(line: string): SDKWireMessage[]` — maps opencode event types (text, tool_use, step_finish, error) to Anthropic wire format; returns `[]` for unknown types, invalid JSON, or empty lines
- `extractOpencodeSessionId(line: string): string | undefined` — extracts the sessionID field from a parsed event line

## Key Dependencies
- `sdk-message-protocol.ts` — `SDKWireMessage` type
