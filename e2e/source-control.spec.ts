/**
 * Source Control view (Cmd+6) — user journey E2E tests.
 * Uses a temporary git repo with staged, unstaged, and committed files
 * to verify the git status display, section visibility, and commit input.
 */
import { test, expect, waitForAppShell } from './fixtures'
import { createMockGitRepo } from './helpers/mock-git-repo'

let mockRepo: { path: string; cleanup: () => void }

test.beforeAll(() => {
  mockRepo = createMockGitRepo()
})

test.afterAll(() => {
  mockRepo.cleanup()
})

/**
 * Navigate to Source Control and set the active repo to the mock repo path.
 * The gitTree store needs an activeRepo to trigger fetchStatus.
 */
async function openSourceControlWithRepo(
  window: import('@playwright/test').Page,
  repoPath: string
): Promise<void> {
  // Navigate to Source Control view
  await window.keyboard.press('Meta+6')

  // Wait for the git tree view to render
  await expect(window.locator('.git-tree-view')).toBeVisible({ timeout: 5_000 })

  // Set the active repo in the gitTree Zustand store
  await window.evaluate(async (path: string) => {
    const { useGitTreeStore } = await import('../src/renderer/src/stores/gitTree')
    useGitTreeStore.getState().setActiveRepo(path)
    // Trigger an immediate status fetch
    await useGitTreeStore.getState().fetchStatus(path)
  }, repoPath)
}

test.describe('Source Control view — repo status', () => {
  test('Cmd+6 navigates to Source Control, sets active repo, and shows staged + unstaged sections', async ({
    bde
  }) => {
    const { window } = bde
    await waitForAppShell(window)

    await openSourceControlWithRepo(window, mockRepo.path)

    // The "Source Control" header text should be visible
    await expect(window.locator('.git-tree-view__title')).toContainText('Source Control', {
      timeout: 5_000
    })

    // Staged Changes section should be visible — the mock repo has staged.txt
    // FileTreeSection uses aria-label on the section's collapse button
    const stagedSection = window.getByRole('button', { name: /Staged Changes/i })
    await expect(stagedSection).toBeVisible({ timeout: 5_000 })

    // Changes (unstaged) section should be visible — the mock repo has unstaged.txt
    const changesSection = window.getByRole('button', { name: /Changes/i })
    await expect(changesSection).toBeVisible({ timeout: 5_000 })

    // The file list groups should contain the expected files
    const stagedGroup = window.getByRole('rowgroup', { name: 'Staged Changes' })
    await expect(stagedGroup).toBeVisible({ timeout: 5_000 })
    await expect(stagedGroup.getByText('staged.txt')).toBeVisible({ timeout: 3_000 })

    const changesGroup = window.getByRole('rowgroup', { name: 'Changes' })
    await expect(changesGroup).toBeVisible({ timeout: 5_000 })
    await expect(changesGroup.getByText('unstaged.txt')).toBeVisible({ timeout: 3_000 })
  })

  test('Commit message input is visible and accepts text', async ({ bde }) => {
    const { window } = bde
    await waitForAppShell(window)

    await openSourceControlWithRepo(window, mockRepo.path)

    // CommitBox textarea has aria-label "Commit message"
    const commitInput = window.getByLabel('Commit message')
    await expect(commitInput).toBeVisible({ timeout: 5_000 })

    // Type a commit message
    await commitInput.fill('test: add source control e2e test')
    await expect(commitInput).toHaveValue('test: add source control e2e test')

    // Commit button should be visible with the staged count
    const commitBtn = window.getByLabel('Commit staged changes')
    await expect(commitBtn).toBeVisible({ timeout: 3_000 })

    // Push button should also be visible
    const pushBtn = window.getByLabel('Push to remote')
    await expect(pushBtn).toBeVisible({ timeout: 3_000 })
  })
})
