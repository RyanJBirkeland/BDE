/**
 * IDE view (Cmd+3) — user journey E2E tests.
 * Uses a temporary git repo with known file state to exercise the file
 * explorer, tab opening, and empty-state flows.
 */
import { test, expect } from './fixtures'
import { createMockGitRepo } from './helpers/mock-git-repo'

let mockRepo: { path: string; cleanup: () => void }

test.beforeAll(() => {
  mockRepo = createMockGitRepo()
})

test.afterAll(() => {
  mockRepo.cleanup()
})

/** Wait for the app shell to finish loading. */
async function waitForAppShell(window: import('@playwright/test').Page): Promise<void> {
  await expect(window.locator('.app-shell')).toBeVisible({ timeout: 15_000 })
}

test.describe('IDE view — empty state', () => {
  test('Cmd+3 navigates to IDE and shows empty state with "Open Folder" prompt', async ({
    bde
  }) => {
    const { window } = bde
    await waitForAppShell(window)

    await window.keyboard.press('Meta+3')

    // IDEEmptyState renders with class .ide-empty-state
    const emptyState = window.locator('.ide-empty-state')
    await expect(emptyState).toBeVisible({ timeout: 5_000 })

    // Title says "BDE IDE"
    await expect(window.locator('.ide-empty-state__title')).toContainText('BDE IDE')

    // Subtitle prompts the user to open a folder
    await expect(window.locator('.ide-empty-state__subtitle')).toContainText('Open a folder')

    // "Open Folder" button is visible
    const openBtn = window.locator('.ide-empty-state__open-btn')
    await expect(openBtn).toBeVisible()
    await expect(openBtn).toContainText('Open Folder')
  })
})

test.describe('IDE view — file explorer', () => {
  test('Opening a folder shows FileSidebar with repo files', async ({ bde }) => {
    const { window } = bde
    await waitForAppShell(window)

    // Navigate to IDE
    await window.keyboard.press('Meta+3')
    await expect(window.locator('.ide-empty-state')).toBeVisible({ timeout: 5_000 })

    // Set the IDE rootPath directly via the Zustand store (avoids native dialog)
    await window.evaluate(async (repoPath: string) => {
      // Access the IDE store via the module system — Zustand stores are singletons
      const { useIDEStore } = await import('../src/renderer/src/stores/ide')
      useIDEStore.getState().setRootPath(repoPath)
      // Also tell main process to watch the directory
      await (window as any).api.watchDir(repoPath)
    }, mockRepo.path)

    // The .ide-view should now be visible (rootPath is set, so empty state is gone)
    await expect(window.locator('.ide-view')).toBeVisible({ timeout: 5_000 })

    // FileSidebar shows with the EXPLORER header
    const sidebar = window.locator('.ide-sidebar')
    await expect(sidebar).toBeVisible({ timeout: 5_000 })
    await expect(window.locator('.ide-sidebar__title')).toContainText('EXPLORER')

    // File tree should be visible and contain the known files from the mock repo
    const fileTree = window.locator('.ide-file-tree')
    await expect(fileTree).toBeVisible({ timeout: 5_000 })

    // The mock repo has: README.md, unstaged.txt, staged.txt
    await expect(fileTree.locator('.ide-file-node__name', { hasText: 'README.md' })).toBeVisible({
      timeout: 5_000
    })
    await expect(
      fileTree.locator('.ide-file-node__name', { hasText: 'unstaged.txt' })
    ).toBeVisible()
    await expect(fileTree.locator('.ide-file-node__name', { hasText: 'staged.txt' })).toBeVisible()
  })

  test('Clicking a file in the tree opens an editor tab with the file name', async ({ bde }) => {
    const { window } = bde
    await waitForAppShell(window)

    // Navigate to IDE and set rootPath
    await window.keyboard.press('Meta+3')
    await expect(window.locator('.ide-empty-state')).toBeVisible({ timeout: 5_000 })

    await window.evaluate(async (repoPath: string) => {
      const { useIDEStore } = await import('../src/renderer/src/stores/ide')
      useIDEStore.getState().setRootPath(repoPath)
      await (window as any).api.watchDir(repoPath)
    }, mockRepo.path)

    await expect(window.locator('.ide-view')).toBeVisible({ timeout: 5_000 })

    // Wait for file tree to render
    const fileTree = window.locator('.ide-file-tree')
    await expect(fileTree).toBeVisible({ timeout: 5_000 })

    // Click on README.md
    const readmeNode = fileTree.locator('.ide-file-node__name', { hasText: 'README.md' })
    await expect(readmeNode).toBeVisible({ timeout: 5_000 })
    await readmeNode.click()

    // An editor tab should appear in the tab bar with the file name
    const tabBar = window.locator('.ide-editor-tab-bar')
    await expect(tabBar).toBeVisible({ timeout: 5_000 })

    const tab = tabBar.locator('.ide-editor-tab__name', { hasText: 'README.md' })
    await expect(tab).toBeVisible({ timeout: 5_000 })

    // The tab should be active (its parent has the --active modifier)
    const activeTab = tabBar.locator('.ide-editor-tab--active')
    await expect(activeTab).toBeVisible()
    await expect(activeTab.locator('.ide-editor-tab__name')).toContainText('README.md')
  })
})
