import { create } from 'zustand'

export type ToastType = 'success' | 'error' | 'info'

export interface Toast {
  id: string
  message: string
  type: ToastType
  durationMs?: number
}

const DEFAULT_DURATION = 3000
const MAX_TOASTS = 4

interface ToastStore {
  toasts: Toast[]
  addToast: (message: string, type: ToastType, durationMs?: number) => void
  removeToast: (id: string) => void
}

let nextId = 0

export const useToastStore = create<ToastStore>((set, get) => ({
  toasts: [],

  addToast: (message, type, durationMs = DEFAULT_DURATION): void => {
    const id = `toast-${++nextId}`
    const toast: Toast = { id, message, type, durationMs }

    set((state) => ({
      toasts: [...state.toasts.slice(-(MAX_TOASTS - 1)), toast]
    }))

    setTimeout(() => {
      get().removeToast(id)
    }, durationMs)
  },

  removeToast: (id): void => {
    set((state) => ({
      toasts: state.toasts.filter((t) => t.id !== id)
    }))
  }
}))

export const toast = {
  success: (msg: string, durationMs?: number): void =>
    useToastStore.getState().addToast(msg, 'success', durationMs),
  error: (msg: string, durationMs?: number): void =>
    useToastStore.getState().addToast(msg, 'error', durationMs),
  info: (msg: string, durationMs?: number): void =>
    useToastStore.getState().addToast(msg, 'info', durationMs)
}
