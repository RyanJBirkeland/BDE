/**
 * Discriminated union describing every review action that the orchestration
 * service can execute. The executor uses an exhaustive switch over this type,
 * so adding a new variant without handling it produces a compile error.
 *
 * This type lives at the service layer — it is an internal orchestration
 * concept, not an IPC contract or shared DTO.
 */

export type ReviewGitOp =
  | { readonly type: 'mergeLocally'; readonly strategy: 'merge' | 'squash' | 'rebase' }
  | { readonly type: 'createPr'; readonly title: string; readonly body: string }
  | { readonly type: 'requestRevision'; readonly feedback: string; readonly mode: 'resume' | 'fresh' }
  | { readonly type: 'discard' }
  | { readonly type: 'shipIt'; readonly strategy: 'merge' | 'squash' | 'rebase' }
  | { readonly type: 'rebase' }

/**
 * Exhaustive handler — TypeScript will error here when a new ReviewGitOp
 * variant is added without a corresponding case in the caller's switch.
 */
export function assertNeverGitOp(op: never): never {
  throw new Error(`Unhandled ReviewGitOp type: ${(op as ReviewGitOp).type}`)
}
