import { test, expect } from './fixtures'
import { seedTask, cleanupTask } from './helpers/seed-data'

test.describe('Sprint board', () => {
  test('Kanban columns visible with correct labels', async ({ bde }) => {
    const { window } = bde

    // Wait for app to load
    await expect(window.locator('.app-shell')).toBeVisible({ timeout: 15_000 })

    // Navigate to Sprint view via Cmd+3
    await window.keyboard.press('Meta+4')

    // Assert Sprint center renders
    const sprintCenter = window.locator('.sprint-center')
    await expect(sprintCenter).toBeVisible({ timeout: 5_000 })

    // Assert the Kanban board with 3 active columns is visible: To Do, In Progress, Awaiting Review
    const kanbanBoard = window.locator('.kanban-board')
    await expect(kanbanBoard).toBeVisible()

    const columns = kanbanBoard.locator('.kanban-col')
    await expect(columns).toHaveCount(3)

    // Verify column headers
    const headers = kanbanBoard.locator('.kanban-col__header')
    await expect(headers.nth(0)).toContainText('To Do')
    await expect(headers.nth(1)).toContainText('In Progress')
    await expect(headers.nth(2)).toContainText('Awaiting Review')
  })

  test('NewTicketModal opens and accepts input', async ({ bde }) => {
    const { window } = bde

    // Navigate to Sprint view
    await expect(window.locator('.app-shell')).toBeVisible({ timeout: 15_000 })
    await window.keyboard.press('Meta+4')
    await expect(window.locator('.sprint-center')).toBeVisible({ timeout: 5_000 })

    // Click "+ New Ticket" button
    const newTicketBtn = window.locator('button', { hasText: '+ New Ticket' })
    await expect(newTicketBtn).toBeVisible()
    await newTicketBtn.click()

    // Assert NewTicketModal opens
    const modal = window.locator('.new-ticket-modal')
    await expect(modal).toBeVisible({ timeout: 3_000 })

    // Fill the title field (quick mode placeholder)
    const titleInput = modal.locator('input.sprint-tasks__input')
    await expect(titleInput).toBeVisible()
    await titleInput.fill('Test ticket from E2E')

    // Assert submit button is enabled when title is filled (quick mode label)
    const submitBtn = modal.locator('button', { hasText: 'Save — Paul writes the spec' })
    await expect(submitBtn).toBeEnabled()
  })

  test('Create task flow — task card appears in Backlog after saving', async ({ bde }) => {
    const { window } = bde

    // Navigate to Sprint view
    await expect(window.locator('.app-shell')).toBeVisible({ timeout: 15_000 })
    await window.keyboard.press('Meta+4')
    await expect(window.locator('.sprint-center')).toBeVisible({ timeout: 5_000 })

    // Open modal and fill in a unique title
    const newTicketBtn = window.locator('button', { hasText: '+ New Ticket' })
    await newTicketBtn.click()
    const modal = window.locator('.new-ticket-modal')
    await expect(modal).toBeVisible({ timeout: 3_000 })

    const taskTitle = `E2E Task ${Date.now()}`
    const titleInput = modal.locator('input.sprint-tasks__input')
    await titleInput.fill(taskTitle)

    // Submit — quick mode saves to backlog
    const submitBtn = modal.locator('button', { hasText: 'Save — Paul writes the spec' })
    await submitBtn.click()

    // Modal should close
    await expect(modal).not.toBeVisible({ timeout: 3_000 })

    // Task title should appear in the backlog table
    const backlogTable = window.locator('.bde-task-table').first()
    await expect(
      backlogTable.locator('.bde-task-table__title-btn', { hasText: taskTitle })
    ).toBeVisible({ timeout: 5_000 })
  })

  test('Task card details — created task shows title text', async ({ bde }) => {
    const { window } = bde

    // Navigate to Sprint view
    await expect(window.locator('.app-shell')).toBeVisible({ timeout: 15_000 })
    await window.keyboard.press('Meta+4')
    await expect(window.locator('.sprint-center')).toBeVisible({ timeout: 5_000 })

    // Create a task
    const newTicketBtn = window.locator('button', { hasText: '+ New Ticket' })
    await newTicketBtn.click()
    const modal = window.locator('.new-ticket-modal')
    await expect(modal).toBeVisible({ timeout: 3_000 })

    const taskTitle = `Detail Check ${Date.now()}`
    const titleInput = modal.locator('input.sprint-tasks__input')
    await titleInput.fill(taskTitle)
    await modal.locator('button', { hasText: 'Save — Paul writes the spec' }).click()
    await expect(modal).not.toBeVisible({ timeout: 3_000 })

    // The backlog title button should contain the exact task title
    const titleCell = window.locator('.bde-task-table__title-btn', { hasText: taskTitle })
    await expect(titleCell).toBeVisible({ timeout: 5_000 })
    await expect(titleCell).toContainText(taskTitle)
  })

  test('Keyboard shortcut N opens the new ticket modal', async ({ bde }) => {
    const { window } = bde

    // Navigate to Sprint view
    await expect(window.locator('.app-shell')).toBeVisible({ timeout: 15_000 })
    await window.keyboard.press('Meta+4')
    await expect(window.locator('.sprint-center')).toBeVisible({ timeout: 5_000 })

    // Ensure focus is not on an input element so the shortcut fires
    await window.locator('.sprint-center').click()

    // Press bare 'n' to trigger the sprint keyboard shortcut
    await window.keyboard.press('n')

    // Modal should open
    const modal = window.locator('.new-ticket-modal')
    await expect(modal).toBeVisible({ timeout: 3_000 })
  })
})

test.describe('Sprint — SpecDrawer', () => {
  let taskId: string

  test.afterEach(async ({ bde }) => {
    if (taskId) {
      await cleanupTask(bde.window, taskId)
    }
  })

  test('Clicking a task title opens the SpecDrawer', async ({ bde }) => {
    const { window } = bde
    await expect(window.locator('.app-shell')).toBeVisible({ timeout: 15_000 })

    // Seed a backlog task via IPC
    const task = await seedTask(window, { title: `E2E SpecDrawer ${Date.now()}` })
    taskId = task.id

    // Navigate to Sprint view
    await window.keyboard.press('Meta+4')
    await expect(window.locator('.sprint-center')).toBeVisible({ timeout: 5_000 })

    // Find and click the seeded task's title button in the backlog table
    const titleBtn = window.locator('.bde-task-table__title-btn', {
      hasText: task.title as string
    })
    await expect(titleBtn).toBeVisible({ timeout: 5_000 })
    await titleBtn.click()

    // SpecDrawer should slide open
    const drawer = window.locator('.spec-drawer--open')
    await expect(drawer).toBeVisible({ timeout: 5_000 })

    // Drawer should display the task title in the editable input
    const titleInput = drawer.locator('.spec-drawer__title-input')
    await expect(titleInput).toHaveValue(task.title as string)

    // Drawer header meta should contain status
    const meta = drawer.locator('.spec-drawer__header-meta')
    await expect(meta).toContainText('backlog')
  })
})

test.describe('Sprint — dependency blocked badge', () => {
  let parentId: string
  let childId: string

  test.afterEach(async ({ bde }) => {
    // Clean up both tasks
    if (childId) await cleanupTask(bde.window, childId)
    if (parentId) await cleanupTask(bde.window, parentId)
  })

  test('Adding a dependency marks the child task as blocked', async ({ bde }) => {
    const { window } = bde
    await expect(window.locator('.app-shell')).toBeVisible({ timeout: 15_000 })

    const ts = Date.now()

    // Seed parent task (queued so it appears on the kanban board)
    const parent = await seedTask(window, {
      title: `E2E Parent ${ts}`,
      status: 'queued'
    })
    parentId = parent.id

    // Seed child task (also queued initially)
    const child = await seedTask(window, {
      title: `E2E Child ${ts}`,
      status: 'queued'
    })
    childId = child.id

    // Add a hard dependency: child depends on parent.
    // Update the child task's depends_on field and set status to blocked via IPC.
    await window.evaluate(
      async ({ childId, parentId }) => {
        await (window as any).api.sprint.update(childId, {
          depends_on: [{ id: parentId, type: 'hard' }],
          status: 'blocked'
        })
      },
      { childId: child.id, parentId: parent.id }
    )

    // Navigate to Sprint view
    await window.keyboard.press('Meta+4')
    await expect(window.locator('.sprint-center')).toBeVisible({ timeout: 5_000 })

    // The child task should now appear in the Blocked section with a BLOCKED badge.
    // In TaskTable's BlockedRow, the title button contains a Badge with text "BLOCKED".
    const blockedTitle = window.locator('.bde-task-table__title-btn', {
      hasText: `E2E Child ${ts}`
    })
    await expect(blockedTitle).toBeVisible({ timeout: 5_000 })

    // Verify the BLOCKED badge is rendered alongside the task
    const blockedBadge = blockedTitle.locator('.bde-badge--warning')
    await expect(blockedBadge).toBeVisible()
    await expect(blockedBadge).toContainText('BLOCKED')
  })
})
