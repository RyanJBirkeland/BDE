## Why

Four security gaps survive in the main process after the Epic 3 IPC hardening pass: an unguarded prompt-injection vector in the pipeline agent retry path, an incomplete XML escape implementation, two overly-permissive allowlists (local endpoint SSRF surface, MCP origin), and unsanitized `autoplay` attributes in playground HTML content. Each gap has a targeted fix requiring only localized code changes.

## What Changes

- **priorScratchpad prompt injection** (`prompt-pipeline.ts`): the agent-written `progress.md` file is injected into the prompt raw, after `</user_spec>`, without XML boundary tags or escaping. An adversarially-crafted `progress.md` can break XML containment and inject arbitary instructions. Fix: wrap in `<prior_scratchpad>...</prior_scratchpad>` and apply `escapeXmlContent`.
- **escapeXmlContent defense-in-depth** (`prompt-sections.ts`): the function only escapes `</` → `<\/` to prevent tag closing. Opening XML-style tags (`<instructions>`, `<system>`) can still appear in user-controlled content, making successful boundary-wrapping the only defense. Fix: also escape `<` followed by a letter (`/[a-zA-Z]/`) to block opening-tag construction.
- **`0.0.0.0` in local endpoint allowlist** (`agent-handlers.ts`): `0.0.0.0` is the "bind-all-interfaces" address, not a loopback. Allowing it as a target lets the renderer test services bound to public interfaces, expanding SSRF surface. Fix: remove `0.0.0.0` from the `LOOPBACK` array; keep `localhost`, `127.0.0.1`, `::1`.
- **MCP origin `'null'`** (`mcp-server/transport.ts`): accepting `Origin: null` lets sandboxed iframes and `file://` pages make requests to the MCP server. The bearer token is still required, but the origin header provides a meaningful first-line control. Fix: remove `'null'` from `allowedOriginsFor`; real MCP clients (Claude Code, Cursor) send `Origin: http://localhost:<port>` which is already in the list.
- **Playground `autoplay` attribute** (`agents/PlaygroundModal.tsx` + DOMPurify call): DOMPurify strips `<script>` tags and `on*` event handlers, but does not strip the `autoplay` attribute on `<video>`/`<audio>` elements. An agent writing an HTML playground file could trigger unexpected media playback. Fix: add `autoplay` to the DOMPurify `FORBID_ATTR` list.

## Capabilities

### New Capabilities

- None — all changes are hardening of existing behavior

### Modified Capabilities

- `ipc-parseargs-validators`: No requirement changes — these are independent security fixes in separate code paths

## Impact

- `src/main/agent-manager/prompt-pipeline.ts` — priorScratchpad wrapping
- `src/main/agent-manager/prompt-sections.ts` — escapeXmlContent improvement
- `src/main/handlers/agent-handlers.ts` — LOOPBACK allowlist tightening
- `src/main/mcp-server/transport.ts` — remove `'null'` origin
- `src/renderer/src/components/agents/PlaygroundModal.tsx` (or its DOMPurify call site) — `autoplay` in FORBID_ATTR
- No IPC channel or API surface changes
