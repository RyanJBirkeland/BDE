import { create } from 'zustand'

/**
 * Theme model:
 *
 * - `system` (new default for fresh installs) — follows the OS-level
 *   `prefers-color-scheme` media query and resolves to either `pro-dark`
 *   or `pro-light` styling. Re-evaluates live when the OS theme flips.
 * - `dark` — applies the `theme-pro-dark` class. The original "fun dark"
 *   styling has been retired in favor of pro-dark for the default Dark.
 * - `light` — applies the `theme-pro-light` class. Same retirement as Dark.
 * - `warm` — unchanged.
 *
 * Backwards compat: existing users with `pro-dark` or `pro-light` saved
 * to localStorage are migrated to `dark` / `light` on next load.
 */
type Theme = 'system' | 'dark' | 'light' | 'warm'

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
  const resolved: 'dark' | 'light' | 'warm' = t === 'system' ? getSystemColorScheme() : t

  if (resolved === 'light') document.documentElement.classList.add('theme-pro-light')
  else if (resolved === 'warm') document.documentElement.classList.add('theme-warm')
  else document.documentElement.classList.add('theme-pro-dark') // dark fallback
}

/**
 * Migrates legacy theme values from localStorage:
 * - 'pro-dark' → 'dark' (which now applies pro-dark styling)
 * - 'pro-light' → 'light' (which now applies pro-light styling)
 * - unrecognized values → 'system' (the new fresh-install default)
 */
function loadSavedTheme(): Theme {
  try {
    const saved = localStorage.getItem('bde-theme')
    if (saved === 'pro-dark') {
      localStorage.setItem('bde-theme', 'dark')
      return 'dark'
    }
    if (saved === 'pro-light') {
      localStorage.setItem('bde-theme', 'light')
      return 'light'
    }
    if (saved === 'dark' || saved === 'light' || saved === 'warm' || saved === 'system') {
      return saved
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
      const order: Theme[] = ['system', 'dark', 'light', 'warm']
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
        v === 'pro-dark'
          ? 'dark'
          : v === 'pro-light'
            ? 'light'
            : v === 'dark' || v === 'light' || v === 'warm' || v === 'system'
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
