/**
 * Motion presets for Framer Motion — spring physics, transitions, and animation variants.
 * All animations use spring-based physics for natural, premium feel.
 * Respect `prefers-reduced-motion: reduce` at the component level.
 */

export { useReducedMotion } from 'framer-motion'

/** Instant transition for use when prefers-reduced-motion is active */
export const REDUCED_TRANSITION = { duration: 0 } as const

export const SPRINGS = {
  /** Snappy — buttons, toggles, micro-interactions */
  snappy: { type: 'spring' as const, stiffness: 500, damping: 30, mass: 0.8 },

  /** Default — most panel transitions, cards appearing */
  default: { type: 'spring' as const, stiffness: 350, damping: 28, mass: 1 },

  /** Smooth — modals, page transitions, large layout shifts */
  smooth: { type: 'spring' as const, stiffness: 250, damping: 24, mass: 1.2 },

  /** Gentle — background elements, aurora, ambient effects */
  gentle: { type: 'spring' as const, stiffness: 120, damping: 20, mass: 1.5 },

  /** Bounce — celebratory moments (PR merged, session complete) */
  bounce: { type: 'spring' as const, stiffness: 400, damping: 15, mass: 0.6 },
} as const

export const TRANSITIONS = {
  /** Instant feedback — hover states, focus rings (no spring, just fast) */
  instant: { duration: 0.1, ease: 'easeOut' as const },

  /** Crossfade — content swaps, tab switches */
  crossfade: { duration: 0.2, ease: [0.25, 0.1, 0.25, 1] as const },

  /** Layout — panel resize, sidebar collapse */
  layout: { type: 'spring' as const, stiffness: 300, damping: 30, mass: 1 },
} as const

export const VARIANTS = {
  /** Fade in — simplest entrance */
  fadeIn: {
    initial: { opacity: 0 },
    animate: { opacity: 1 },
    exit: { opacity: 0 },
  },

  /** Slide up — cards, list items, feed lines */
  slideUp: {
    initial: { opacity: 0, y: 12 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: -8 },
  },

  /** Slide from left — sidebar items, nav entering */
  slideLeft: {
    initial: { opacity: 0, x: -16 },
    animate: { opacity: 1, x: 0 },
    exit: { opacity: 0, x: -16 },
  },

  /** Scale in — modals, command palette, dialogs */
  scaleIn: {
    initial: { opacity: 0, scale: 0.96, filter: 'blur(4px)' },
    animate: { opacity: 1, scale: 1, filter: 'blur(0px)' },
    exit: { opacity: 0, scale: 0.96, filter: 'blur(4px)' },
  },

  /** Drop in — notifications, toasts (from top) */
  dropIn: {
    initial: { opacity: 0, y: -20, scale: 0.97 },
    animate: { opacity: 1, y: 0, scale: 1 },
    exit: { opacity: 0, y: -10, scale: 0.97 },
  },

  /** Stagger container — for lists of items */
  staggerContainer: {
    animate: { transition: { staggerChildren: 0.04, delayChildren: 0.06 } },
  },

  /** Stagger child — individual items in a staggered list */
  staggerChild: {
    initial: { opacity: 0, y: 8 },
    animate: { opacity: 1, y: 0 },
  },
} as const

/** Neon animation timing configs for use with CSS animation-duration */
export const NEON_TIMING = {
  pulse: '3s',
  breathe: '2s',
  scanline: '30s',
  gradientRotate: '8s',
  particleDrift: { min: 20, max: 40 }, // seconds, randomized per particle
} as const
