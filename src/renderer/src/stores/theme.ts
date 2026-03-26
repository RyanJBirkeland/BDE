import { create } from 'zustand'

type Theme = 'dark' | 'light'

interface ThemeStore {
  theme: Theme
  toggleTheme: () => void
  setTheme: (t: Theme) => void
}

function applyTheme(t: Theme): void {
  if (t === 'light') document.documentElement.classList.add('theme-light')
  else document.documentElement.classList.remove('theme-light')
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
      const next = s.theme === 'dark' ? 'light' : 'dark'
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
