## 1. priorScratchpad boundary tag wrapping

- [x] 1.1 In `prompt-pipeline.ts`, wrap the `priorScratchpad` injection (currently lines ~241-243) in `<prior_scratchpad>` / `</prior_scratchpad>` tags and apply `escapeXmlContent` to the content before insertion (`src/main/agent-manager/prompt-pipeline.ts`)
- [x] 1.2 Update `prompt-composer.test.ts` assertions that test the "Prior Attempt Context" section to expect the new XML boundary-tag wrapping (`src/main/agent-manager/__tests__/prompt-composer.test.ts`)

## 2. escapeXmlContent opening-tag hardening

- [x] 2.1 In `prompt-sections.ts`, extend `escapeXmlContent` to also escape `<` when followed by `[a-zA-Z/]` (opening-tag prefix), while leaving `<` before digits/space unchanged (`src/main/agent-manager/prompt-sections.ts`)
- [x] 2.2 Add or update unit tests for `escapeXmlContent` to cover: opening-tag escaping, less-than-before-digit preserved, closing-tag escaping still works (`src/main/agent-manager/__tests__/prompt-sections.test.ts` or equivalent)

## 3. Local endpoint SSRF surface reduction

- [x] 3.1 Remove `'0.0.0.0'` from the `LOOPBACK` array in `validateLocalEndpointUrl` (`src/main/handlers/agent-handlers.ts`)
- [x] 3.2 Update `agent-handlers.test.ts` to assert `http://0.0.0.0:11434` is rejected and that `http://127.0.0.1` / `http://localhost` are still accepted

## 4. MCP transport origin hardening

- [x] 4.1 Remove `'null'` from the `allowedOriginsFor` return value in `src/main/mcp-server/transport.ts`
- [x] 4.2 Update `transport.test.ts` assertion (describe block "transport handler Origin allow-list") to not expect `'null'` in the allowed origins list

## 5. Playground autoplay removal

- [x] 5.1 Remove `'autoplay'` from `PLAYGROUND_ALLOWED_ATTR` in `src/main/playground-sanitize.ts`
- [x] 5.2 Add a test to `playground-sanitize.test.ts` (or equivalent) asserting that `<video autoplay>` has `autoplay` stripped and `<video controls>` retains `controls`

## 6. Module docs

- [x] 6.1 Update `docs/modules/agent-manager/index.md` row for `prompt-pipeline.ts` and `prompt-sections.ts` to note the boundary-tag wrapping and extended escaping
- [x] 6.2 Update `docs/modules/handlers/index.md` row for `agent-handlers.ts` to note `0.0.0.0` is rejected
