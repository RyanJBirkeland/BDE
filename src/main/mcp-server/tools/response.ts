/**
 * Shared envelope builder for MCP tool responses. Every tool returns a
 * `{ content: [{ type: 'text', text: JSON.stringify(value) }] }` payload;
 * centralizing the shape keeps tool handlers focused on their domain
 * and eliminates drift across `tasks.ts`, `epics.ts`, and `meta.ts`.
 *
 * The index signature is required by the MCP SDK's `tool()` callback
 * return type, which is shaped as `{ [x: string]: unknown; content: […] }`.
 */
export interface JsonToolResponse {
  [key: string]: unknown
  content: [{ type: 'text'; text: string }]
}

export function jsonContent(value: unknown): JsonToolResponse {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value) }] }
}
