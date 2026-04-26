## Context

Five localized security gaps remain after Epic 3:

1. **`priorScratchpad`** (`prompt-pipeline.ts:241`) — reads `progress.md` (written by the agent in the prior run) and injects it raw into the prompt without XML boundary tags or escaping. All other user/agent-controlled content sections use `<boundary_tag>…</boundary_tag>` wrapping per CLAUDE.md convention.
2. **`escapeXmlContent`** (`prompt-sections.ts:130`) — escapes only `</` (closing-tag injection) but leaves `<letter…` intact, so an attacker who controls content inside a boundary tag can still construct opening-tag sequences (`<instructions>…</instructions>`).
3. **`0.0.0.0` in LOOPBACK** (`agent-handlers.ts:97`) — `0.0.0.0` means "bind-all-interfaces" and is not a loopback address. Routing to it depends on OS behavior and is platform-inconsistent.
4. **`'null'` in MCP origin allowlist** (`mcp-server/transport.ts:243`) — the string `"null"` is the Origin header value sent by sandboxed iframes and `file://` pages, allowing cross-origin requests from those contexts to the local MCP server.
5. **`autoplay` in `PLAYGROUND_ALLOWED_ATTR`** (`playground-sanitize.ts:~204`) — `autoplay` is explicitly in the allowlist, so agent-written HTML files can autoplay media without user interaction.

## Goals / Non-Goals

**Goals:**
- Wrap `priorScratchpad` in `<prior_scratchpad>…</prior_scratchpad>` boundary tags with `escapeXmlContent` applied
- Extend `escapeXmlContent` to also escape `<` followed by an ASCII letter (opening-tag prefix)
- Remove `0.0.0.0` from the `LOOPBACK` array in `validateLocalEndpointUrl`
- Remove `'null'` from `allowedOriginsFor` in `mcp-server/transport.ts`
- Remove `'autoplay'` from `PLAYGROUND_ALLOWED_ATTR` in `playground-sanitize.ts`

**Non-Goals:**
- Rewriting the full XML escaping to full entity encoding (intentionally avoided to preserve diff legibility — the design comment in `escapeXmlContent` stands)
- Reworking the MCP bearer-token auth scheme
- Changing the sandbox attribute on playground iframes

## Decisions

**D1 — `priorScratchpad` tag name: `<prior_scratchpad>`**

Follows the existing `<user_spec>`, `<upstream_spec>`, `<failure_notes>`, `<revision_feedback>` naming pattern. Underscore-separated, no spaces, lowercase.

**D2 — `escapeXmlContent` extension: escape `<` before `[a-zA-Z/]`**

The regex `/<(?=[a-zA-Z/])/g` → `'<\\'` catches both `<tag>` and `</tag>` patterns without touching bare `<` used as less-than in diff output (`< removed line`). This is the minimal extension that blocks opening-tag injection without corrupting diff content.

**D3 — Remove `0.0.0.0`, keep `localhost`**

`localhost` is needed for users who configure Ollama/LM Studio with `http://localhost:11434`. `0.0.0.0` provides no legitimate use case as a *destination* address and is not a loopback address by standard definition. Removing it is non-breaking.

**D4 — Remove `'null'` origin entirely**

Real MCP clients (Claude Code CLI, Cursor, Claude Desktop) all send `http://127.0.0.1:<port>` or `http://localhost:<port>` as the Origin header. The `'null'` entry was added speculatively; no known integration uses it. The MCP transport test that asserts `'null'` is in the list must be updated.

**D5 — Remove `autoplay` from `PLAYGROUND_ALLOWED_ATTR`, keep `controls`/`muted`/`loop`**

`autoplay` enables unsolicited media playback. The other media attributes (`controls`, `muted`, `loop`, `preload`, `poster`) remain — they are useful for intentional interactive playgrounds and do not self-activate.

## Risks / Trade-offs

**priorScratchpad boundary tag length** → `<prior_scratchpad>` adds ~40 chars per retry, well within prompt budgets. No impact on truncation logic since `PRIOR_SCRATCHPAD_CHARS` caps content before the tags are added.

**escapeXmlContent regex scope** → The change is backward-compatible: the pattern `/<(?=[a-zA-Z/])/g` is a lookahead-only addition over the existing `/<\//g`. Callers that escape diff content will not see regressions because diff `<` used as a less-than operator is followed by a digit or space, not a letter.

**`'null'` origin removal** → If a user's MCP client sends `Origin: null` (no known client does), the request will be rejected with 403 by the SDK's origin check. Users would need to update their client. Risk is very low; known clients will not be affected.
