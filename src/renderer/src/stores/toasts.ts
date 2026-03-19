/**
 * Toast store — ephemeral notification queue.
 * Manages up to 4 visible toasts with auto-dismiss (default 3s).
 * Convenience helpers: toast.success(), toast.error(), toast.info(), toast.undoable().
 */
import { create } from 'zustand'

export type ToastType = 'success' | 'error' | 'info'

export interface Toast {
  id: string
  message: string
  type: ToastType
  durationMs?: number
  onUndo?: () => void
  action?: string
  onAction?: () => void
}

const DEFAULT_DURATION = 3000
const MAX_TOASTS = 4

interface ToastStore {
  toasts: Toast[]
  addToast: (message: string, type: ToastType, durationMs?: number, extra?: { onUndo?: () => void; action?: string; onAction?: () => void }) => string
  removeToast: (id: string) => void
}

let nextId = 0
const timerMap = new Map<string, ReturnType<typeof setTimeout>>()

export const useToastStore = create<ToastStore>((set, get) => ({
  toasts: [],

  addToast: (message, type, durationMs = DEFAULT_DURATION, extra): string => {
    const id = `toast-${++nextId}`
    const toast: Toast = { id, message, type, durationMs, ...extra }

    set((state) => ({
      toasts: [...state.toasts.slice(-(MAX_TOASTS - 1)), toast]
    }))

    const timer = setTimeout(() => {
      timerMap.delete(id)
      get().removeToast(id)
    }, durationMs)
    timerMap.set(id, timer)

    return id
  },

  removeToast: (id): void => {
    const timer = timerMap.get(id)
    if (timer) {
      clearTimeout(timer)
      timerMap.delete(id)
    }
    set((state) => ({
      toasts: state.toasts.filter((t) => t.id !== id)
    }))
  }
}))

export const toast = {
  success: (msg: string, durationMs?: number): void => {
    useToastStore.getState().addToast(msg, 'success', durationMs)
  },
  error: (msg: string, durationMs?: number): void => {
    useToastStore.getState().addToast(msg, 'error', durationMs)
  },
  info: (msg: string, options?: { action?: string; onAction?: () => void; durationMs?: number }): void => {
    useToastStore.getState().addToast(msg, 'info', options?.durationMs, {
      action: options?.action,
      onAction: options?.onAction
    })
  },
  undoable: (msg: string, onUndo: () => void, durationMs = 5000): string => {
    return useToastStore.getState().addToast(msg, 'info', durationMs, { onUndo })
  }
}
