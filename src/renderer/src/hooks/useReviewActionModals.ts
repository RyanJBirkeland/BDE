import { useConfirm } from '../components/ui/ConfirmModal'
import { useTextareaPrompt } from '../components/ui/TextareaPromptModal'

export interface UseReviewActionModalsResult {
  confirm: ReturnType<typeof useConfirm>['confirm']
  prompt: ReturnType<typeof useTextareaPrompt>['prompt']
  confirmProps: ReturnType<typeof useConfirm>['confirmProps']
  promptProps: ReturnType<typeof useTextareaPrompt>['promptProps']
}

/**
 * Wires up confirmation dialogs and textarea prompt modals used by review actions.
 * Returns both the trigger functions (confirm, prompt) for use in callbacks
 * and the props objects for rendering the modal components.
 */
export function useReviewActionModals(): UseReviewActionModalsResult {
  const { confirm, confirmProps } = useConfirm()
  const { prompt, promptProps } = useTextareaPrompt()

  return { confirm, prompt, confirmProps, promptProps }
}
