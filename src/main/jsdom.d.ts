/**
 * Ambient shim for `jsdom` — the package has no bundled types and BDE only
 * uses the `JSDOM` constructor + `.window` off the returned instance for
 * DOMPurify initialization in playground-sanitize.ts. Keeping the surface
 * minimal avoids pulling @types/jsdom (and its node-canvas peer types) into
 * the devDependency tree.
 */
declare module 'jsdom' {
  export class JSDOM {
    constructor(html?: string, options?: Record<string, unknown>)
    readonly window: Window & typeof globalThis
  }
}
