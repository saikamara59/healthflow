import { test, expect } from '@playwright/test'

test('Today discards a task page loaded before a task refresh', async ({ page }) => {
  const tasks = Array.from({ length: 26 }, (_, index) => ({
    id: `task-${index}`,
    title: `Task ${index}`,
    status: 'open',
    is_follow_up: false,
  }))
  let completed = false
  let signalOldPage
  let releaseOldPage
  const oldPageStarted = new Promise((resolve) => { signalOldPage = resolve })
  const oldPageHeld = new Promise((resolve) => { releaseOldPage = resolve })

  await page.addInitScript(() => {
    const payload = btoa(JSON.stringify({ sub: 'broker', role: 'broker', exp: 4102444800 }))
    sessionStorage.setItem('hf_token', `test.${payload}.signature`)
  })
  await page.route('**/workspace/preferences', (route) => route.fulfill({ json: { timezone_name: 'UTC', is_configured: true } }))
  await page.route('**/workspace/today', (route) => route.fulfill({ json: {
    timezone_name: 'UTC', local_date: '2026-09-22', overdue_tasks: [], due_today_tasks: [],
    appointments_today: [], appointments_next_seven_days: [],
  } }))
  await page.route(/\/clients\?linkable=true$/, (route) => route.fulfill({ json: [] }))
  await page.route(/\/organizations\?/, (route) => route.fulfill({ json: [] }))
  await page.route('**/health', (route) => route.fulfill({ json: { status: 'ok' } }))
  await page.route('**/tasks/task-0/complete', (route) => {
    completed = true
    return route.fulfill({ json: { ...tasks[0], status: 'completed' } })
  })
  await page.route(/\/tasks\?/, async (route) => {
    const url = new URL(route.request().url())
    const offset = Number(url.searchParams.get('offset') || 0)
    const limit = Number(url.searchParams.get('limit') || 25)
    const snapshot = tasks.slice(completed ? 1 : 0)
    if (offset === 25 && !completed) {
      signalOldPage()
      await oldPageHeld
    }
    await route.fulfill({ json: snapshot.slice(offset, offset + limit) })
  })

  await page.goto('/today')
  const otherTasks = page.getByRole('heading', { name: 'Other open tasks' }).locator('..').locator('..')
  await expect(otherTasks.getByRole('listitem')).toHaveCount(25)
  await page.getByRole('button', { name: 'Show more Tasks' }).click()
  await oldPageStarted
  await otherTasks.getByRole('checkbox', { name: 'Complete Task 0' }).click()
  await expect(otherTasks.getByRole('listitem')).toHaveCount(25)
  await expect(otherTasks.getByRole('listitem', { name: 'Task 25' })).toHaveCount(1)

  const staleResponse = page.waitForResponse((response) => {
    const url = new URL(response.url())
    return url.pathname === '/tasks' && url.searchParams.get('offset') === '25'
  })
  releaseOldPage()
  await staleResponse
  await page.waitForLoadState('networkidle')
  await expect(otherTasks.getByRole('listitem')).toHaveCount(25)
  await expect(otherTasks.getByRole('listitem', { name: 'Task 25' })).toHaveCount(1)
  await expect(page.getByRole('button', { name: 'Show more Tasks' })).toBeVisible()
})
