import { test, expect } from './fixtures'

test.describe('Sprint board', () => {
  test('Kanban columns visible with correct labels', async ({ bde }) => {
    const { window } = bde

    // Wait for app to load
    await expect(window.locator('.app-shell')).toBeVisible({ timeout: 15_000 })

    // Navigate to Sprint view via Cmd+3
    await window.keyboard.press('Meta+3')

    // Assert Sprint center renders
    const sprintCenter = window.locator('.sprint-center')
    await expect(sprintCenter).toBeVisible({ timeout: 5_000 })

    // Assert all 4 Kanban columns are visible: Backlog, Sprint, In Progress, Done
    const kanbanBoard = window.locator('.kanban-board')
    await expect(kanbanBoard).toBeVisible()

    const columns = kanbanBoard.locator('.kanban-col')
    await expect(columns).toHaveCount(4)

    // Verify column headers
    const headers = kanbanBoard.locator('.kanban-col__header')
    await expect(headers.nth(0)).toContainText('Backlog')
    await expect(headers.nth(1)).toContainText('Sprint')
    await expect(headers.nth(2)).toContainText('In Progress')
    await expect(headers.nth(3)).toContainText('Done')
  })

  test('NewTicketModal opens and accepts input', async ({ bde }) => {
    const { window } = bde

    // Navigate to Sprint view
    await expect(window.locator('.app-shell')).toBeVisible({ timeout: 15_000 })
    await window.keyboard.press('Meta+3')
    await expect(window.locator('.sprint-center')).toBeVisible({ timeout: 5_000 })

    // Click "+ New Ticket" button
    const newTicketBtn = window.locator('button', { hasText: '+ New Ticket' })
    await expect(newTicketBtn).toBeVisible()
    await newTicketBtn.click()

    // Assert NewTicketModal opens
    const modal = window.locator('.new-ticket-modal')
    await expect(modal).toBeVisible({ timeout: 3_000 })

    // Fill the title field
    const titleInput = modal.locator('input[placeholder*="Add recipe search"]')
    await expect(titleInput).toBeVisible()
    await titleInput.fill('Test ticket from E2E')

    // Assert submit button ("Save to Backlog") is enabled when title is filled
    const submitBtn = modal.locator('button', { hasText: 'Save to Backlog' })
    await expect(submitBtn).toBeEnabled()
  })
})
