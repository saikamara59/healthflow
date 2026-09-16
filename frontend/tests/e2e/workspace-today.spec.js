import { test, expect } from '../fixtures'

test('broker creates and completes a task without leaving Today', async ({ authedPage }) => {
  await authedPage.goto('/today')
  await authedPage.getByRole('button', { name: 'New Task' }).click()
  await authedPage.getByLabel('Task title').fill('Call Maria about renewal')
  await authedPage.getByLabel('Due date').fill(new Date().toISOString().slice(0, 10))
  await authedPage.getByRole('button', { name: 'Create Task', exact: true }).click()
  const row = authedPage.getByRole('listitem', { name: /Call Maria about renewal/i })
  await expect(row).toBeVisible()
  await row.getByRole('checkbox', { name: /complete/i }).click()
  await expect(authedPage.getByText('Call Maria about renewal')).toHaveCount(0)
})

test('mock inbox prefills a follow-up task and is labeled as mock data', async ({ authedPage }) => {
  await authedPage.goto('/today')
  await expect(authedPage.getByText('Mock inbox')).toBeVisible()
  await authedPage.getByRole('button', { name: /create task from renewal documents/i }).click()
  await expect(authedPage.getByLabel('Task title')).toHaveValue(/renewal documents/i)
  await expect(authedPage.getByLabel('Follow-up')).toBeChecked()
})

test('unscheduled Task stays visible under Other open tasks', async ({ authedPage }) => {
  await authedPage.goto('/today')
  await authedPage.getByRole('button', { name: 'New Task' }).click()
  await authedPage.getByLabel('Task title').fill('Prepare case notes')
  await authedPage.getByRole('button', { name: 'Create Task', exact: true }).click()
  const section = authedPage.getByRole('heading', { name: 'Other open tasks' }).locator('..').locator('..')
  await expect(section.getByText('Prepare case notes')).toBeVisible()
})

test('Today and Scheduling fit a phone without horizontal overflow', async ({ authedPage }) => {
  await authedPage.setViewportSize({ width: 390, height: 844 })
  await authedPage.goto('/today')
  await expect(authedPage.getByRole('heading', { name: 'My Meetings' })).toBeVisible()
  const overflow = () => authedPage.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
  expect(await overflow()).toBe(false)
  await authedPage.getByRole('button', { name: 'Open menu' }).click()
  await expect(authedPage.getByRole('link', { name: 'Scheduling' })).toBeVisible()
  await authedPage.getByRole('link', { name: 'Scheduling' }).click()
  await expect(authedPage.getByRole('heading', { name: 'Scheduling' })).toBeVisible()
  expect(await overflow()).toBe(false)
  await authedPage.getByRole('button', { name: 'New Appointment' }).click()
  await expect(authedPage.getByLabel('Appointment title')).toBeVisible()
  await expect(authedPage.getByRole('button', { name: 'Create Appointment' })).toBeVisible()
})

test('Today columns stack on a tablet', async ({ authedPage }) => {
  await authedPage.setViewportSize({ width: 768, height: 1024 })
  await authedPage.goto('/today')
  await expect(authedPage.getByRole('heading', { name: 'My Meetings' })).toBeVisible()
  const columns = await authedPage.locator('.today-main, .today-rail').evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect()))
  expect(columns[1].top).toBeGreaterThan(columns[0].top)
  expect(await authedPage.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false)
})
