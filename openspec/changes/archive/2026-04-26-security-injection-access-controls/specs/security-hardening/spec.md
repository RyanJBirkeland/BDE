## ADDED Requirements

### Requirement: priorScratchpad content is isolated in the agent prompt
When a pipeline agent prompt includes content from a prior run's `progress.md` file (the "prior scratchpad"), the system SHALL wrap that content in `<prior_scratchpad>…</prior_scratchpad>` boundary tags and apply `escapeXmlContent` to the content before insertion. The boundary tags SHALL appear after the `</user_spec>` closing tag and before the retry context section, matching the existing pattern for other user-controlled sections.

#### Scenario: normal prior scratchpad is wrapped
- **WHEN** a pipeline agent prompt is built with a non-empty `priorScratchpad` string
- **THEN** the rendered prompt contains `<prior_scratchpad>` before the content and `</prior_scratchpad>` after it

#### Scenario: closing-tag injection in priorScratchpad is escaped
- **WHEN** a `priorScratchpad` string contains `</user_spec>` or `</prior_scratchpad>`
- **THEN** those sequences appear as `<\/user_spec>` and `<\/prior_scratchpad>` in the rendered prompt, preventing tag breakout

#### Scenario: empty priorScratchpad emits no section
- **WHEN** `priorScratchpad` is an empty string or absent
- **THEN** the rendered prompt contains no `<prior_scratchpad>` tags

### Requirement: escapeXmlContent blocks opening-tag construction
The `escapeXmlContent` function SHALL escape `<` when immediately followed by an ASCII letter or `/`, replacing it with `<\`. This prevents content inside an XML boundary tag from constructing new opening or closing tags. Content where `<` is followed by a digit, whitespace, or end-of-string SHALL be left untouched to preserve diff output legibility.

#### Scenario: opening tag pattern is escaped
- **WHEN** `escapeXmlContent` is called with a string containing `<instructions>`
- **THEN** the result contains `<\instructions>` and no valid XML opening tag

#### Scenario: less-than operator in diff is preserved
- **WHEN** `escapeXmlContent` is called with a string containing `< 3` or `<2` (digit follows)
- **THEN** the `<` is unchanged

#### Scenario: closing-tag injection is still escaped
- **WHEN** `escapeXmlContent` is called with a string containing `</prior_scratchpad>`
- **THEN** the result contains `<\/prior_scratchpad>` (existing behavior preserved)

### Requirement: local endpoint validator rejects 0.0.0.0
The `validateLocalEndpointUrl` function in `agent-handlers.ts` SHALL reject endpoint URLs whose hostname is `0.0.0.0`. The allowed loopback hostnames SHALL be limited to `localhost`, `127.0.0.1`, and `::1`. Endpoint URLs with hostname `0.0.0.0` SHALL return a validation error string.

#### Scenario: 0.0.0.0 is rejected
- **WHEN** `validateLocalEndpointUrl` is called with `http://0.0.0.0:11434`
- **THEN** it returns a non-null error string

#### Scenario: 127.0.0.1 and localhost remain accepted
- **WHEN** `validateLocalEndpointUrl` is called with `http://127.0.0.1:11434` or `http://localhost:11434`
- **THEN** it returns null (no error)

### Requirement: MCP transport does not accept Origin null
The MCP server transport's `allowedOriginsFor` function SHALL NOT include the string `"null"` in its return value. The allowed origins SHALL be limited to `http://127.0.0.1:<port>` and `http://localhost:<port>`. Requests that arrive with `Origin: null` SHALL be rejected by the SDK's origin validation.

#### Scenario: allowedOriginsFor does not contain the string "null"
- **WHEN** `allowedOriginsFor` is called with any port
- **THEN** the returned array does not include the string `"null"`

#### Scenario: loopback origins remain accepted
- **WHEN** `allowedOriginsFor` is called with port 18792
- **THEN** the returned array includes `http://127.0.0.1:18792` and `http://localhost:18792`

### Requirement: playground sanitizer strips autoplay attribute
The `PLAYGROUND_ALLOWED_ATTR` list in `playground-sanitize.ts` SHALL NOT include `autoplay`. HTML content sanitized by `sanitizePlaygroundHtml` SHALL have `autoplay` attributes removed from all elements. The `controls`, `muted`, `loop`, `preload`, and `poster` attributes SHALL remain permitted.

#### Scenario: autoplay is stripped from video element
- **WHEN** `sanitizePlaygroundHtml` is called with `<video autoplay src="x.mp4"></video>`
- **THEN** the returned HTML does not contain the `autoplay` attribute

#### Scenario: controls attribute is preserved
- **WHEN** `sanitizePlaygroundHtml` is called with `<video controls src="x.mp4"></video>`
- **THEN** the returned HTML contains the `controls` attribute
