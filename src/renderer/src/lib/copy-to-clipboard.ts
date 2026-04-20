import { toast } from '../stores/toasts'

/**
 * Copy a string to the system clipboard with standard BDE toast feedback.
 * Succeeds silently with a "Copied to clipboard" toast; on failure, shows
 * a "Could not copy — please copy manually" error toast so the user knows
 * to fall back.
 */
export async function copyToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
    toast.success('Copied to clipboard')
  } catch {
    toast.error('Could not copy — please copy manually')
  }
}
