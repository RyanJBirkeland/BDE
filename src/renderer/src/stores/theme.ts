import { create } from 'zustand'

type Theme = 'dark' | 'light' | 'warm' | 'pro-dark' | 'pro-light'

interface ThemeStore {
  theme: Theme
  toggleTheme: () => void
  setTheme: (t: Theme) => void
}

function applyTheme(t: Theme): void {
  document.documentElement.classList.remove(
    'theme-light',
    'theme-warm',
    'theme-pro-dark',
    'theme-pro-light'
  )
  if (t === 'light') document.documentElement.classList.add('theme-light')
  else if (t === 'warm') document.documentElement.classList.add('theme-warm')
  else if (t === 'pro-dark') document.documentElement.classList.add('theme-pro-dark')
  else if (t === 'pro-light') document.documentElement.classList.add('theme-pro-light')
}

function loadSavedTheme(): Theme {
  try {
    return (localStorage.getItem('bde-theme') as Theme | null) ?? 'dark'
  } catch {
    return 'dark'
  }
}

const initialTheme = loadSavedTheme()
applyTheme(initialTheme)

export const useThemeStore = create<ThemeStore>((set) => ({
  theme: initialTheme,
  toggleTheme: () =>
    set((s) => {
      const order: Theme[] = ['dark', 'light', 'warm', 'pro-dark', 'pro-light']
      const idx = order.indexOf(s.theme)
      const next = order[(idx + 1) % order.length]
      localStorage.setItem('bde-theme', next)
      applyTheme(next)
      return { theme: next }
    }),
  setTheme: (t) =>
    set(() => {
      localStorage.setItem('bde-theme', t)
      applyTheme(t)
      return { theme: t }
    })
}))

// Cross-window theme sync via localStorage storage event
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === 'bde-theme' && e.newValue) {
      const next = e.newValue as Theme
      applyTheme(next)
      useThemeStore.setState({ theme: next })
    }
  })
}
