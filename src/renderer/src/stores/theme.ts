import { create } from 'zustand'

/**
 * Theme model:
 *
 * - `system` (new default for fresh installs) — follows the OS-level
 *   `prefers-color-scheme` media query and resolves to either `pro-dark`
 *   or `pro-light` styling. Re-evaluates live when the OS theme flips.
 * - `dark` — applies the `theme-pro-dark` class.
 * - `light` — applies the `theme-pro-light` class.
 *
 * Backwards compat: existing users with `pro-dark`, `pro-light`, or `warm`
 * saved to localStorage are migrated on next load.
 */
type Theme = 'system' | 'dark' | 'light'

interface ThemeStore {
  theme: Theme
  toggleTheme: () => void
  setTheme: (t: Theme) => void
}

const ALL_THEME_CLASSES = [
  'theme-light',
  'theme-warm',
  'theme-pro-dark',
  'theme-pro-light'
] as const

/**
 * Reads the OS-level color-scheme preference. Returns 'dark' or 'light'.
 * Defaults to 'dark' if matchMedia is unavailable (e.g. SSR / older Electron).
 */
function getSystemColorScheme(): 'dark' | 'light' {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'dark'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function applyTheme(t: Theme): void {
  if (typeof document === 'undefined') return
  document.documentElement.classList.remove(...ALL_THEME_CLASSES)

  // Resolve `system` to whatever the OS currently wants. Resolution
  // happens here (not in setTheme) so the storage event handler and the
  // matchMedia listener can both call applyTheme without re-implementing
  // the resolution.
  const resolved: 'dark' | 'light' = t === 'system' ? getSystemColorScheme() : t

  if (resolved === 'light') document.documentElement.classList.add('theme-pro-light')
  else document.documentElement.classList.add('theme-pro-dark') // dark fallback
}

/**
 * Loads the saved theme from localStorage.
 * - 'warm' → 'dark' (legacy migration from old warm theme)
 * - unrecognized values → 'system' (the new fresh-install default)
 */
function loadSavedTheme(): Theme {
  try {
    const stored = localStorage.getItem('bde-theme')
    if (stored === 'warm') {
      localStorage.setItem('bde-theme', 'dark')
      return 'dark'
    }
    if (stored === 'dark' || stored === 'light' || stored === 'system') {
      return stored
    }
    return 'system'
  } catch {
    return 'system'
  }
}

const initialTheme = loadSavedTheme()
applyTheme(initialTheme)

export const useThemeStore = create<ThemeStore>((set) => ({
  theme: initialTheme,
  toggleTheme: () =>
    set((s) => {
      const order: Theme[] = ['system', 'dark', 'light']
      const idx = order.indexOf(s.theme)
      const next = order[(idx + 1) % order.length]
      try {
        localStorage.setItem('bde-theme', next)
      } catch {
        /* localStorage may be unavailable */
      }
      applyTheme(next)
      return { theme: next }
    }),
  setTheme: (t) =>
    set(() => {
      try {
        localStorage.setItem('bde-theme', t)
      } catch {
        /* localStorage may be unavailable */
      }
      applyTheme(t)
      return { theme: t }
    })
}))

// Cross-window theme sync via localStorage storage event
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === 'bde-theme' && e.newValue) {
      // Tolerate legacy values arriving from older windows
      const v = e.newValue
      const next: Theme =
        v === 'pro-dark' || v === 'warm'
          ? 'dark'
          : v === 'pro-light'
            ? 'light'
            : v === 'dark' || v === 'light' || v === 'system'
              ? (v as Theme)
              : 'system'
      applyTheme(next)
      useThemeStore.setState({ theme: next })
    }
  })

  // Live OS-theme follow: when the user is on `system`, re-apply when the
  // OS color scheme changes (e.g. macOS Auto / dark-at-night).
  if (typeof window.matchMedia === 'function') {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (): void => {
      if (useThemeStore.getState().theme === 'system') applyTheme('system')
    }
    // Older Safari uses addListener; modern uses addEventListener.
    if (typeof mq.addEventListener === 'function') {
      mq.addEventListener('change', onChange)
    } else if (
      typeof (mq as unknown as { addListener?: (cb: () => void) => void }).addListener ===
      'function'
    ) {
      ;(mq as unknown as { addListener: (cb: () => void) => void }).addListener(onChange)
    }
  }
}
