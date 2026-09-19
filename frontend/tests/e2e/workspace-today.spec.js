import { test, expect } from '../fixtures'
import { dateInZone } from '../../src/api/workspaceTime'

test('broker creates and completes a task without leaving Today', async ({ authedPage }) => {
  await authedPage.goto('/today')
  await authedPage.getByRole('button', { name: 'New Task' }).click()
  await authedPage.getByLabel('Task title').fill('Call Maria about renewal')
  const token = await authedPage.evaluate(() => sessionStorage.getItem('hf_token'))
  const preferences = await authedPage.request.get('/workspace/preferences', { headers: { Authorization: `Bearer ${token}` } })
  expect(preferences.ok()).toBe(true)
  await authedPage.getByLabel('Due date').fill(dateInZone(new Date(), (await preferences.json()).timezone_name))
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

test('mock inbox requires Broker confirmation before linking its suggested Client', async ({ authedPage }) => {
  await authedPage.goto('/today')
  await expect(authedPage.getByText(/Suggested client: Eleanor Rigby/)).toBeVisible()
  await authedPage.getByRole('button', { name: /create task from renewal documents/i }).click()

  const clientSelect = authedPage.getByRole('combobox', { name: 'Client' })
  await expect(clientSelect).toHaveValue('')
  await authedPage.getByRole('button', { name: 'Confirm Client link for Eleanor Rigby' }).click()
  await expect(clientSelect).not.toHaveValue('')
  await expect(authedPage.getByText('Client link confirmed: Eleanor Rigby')).toBeVisible()

  await authedPage.getByRole('button', { name: 'Create Task', exact: true }).click()
  const row = authedPage.getByRole('listitem', { name: /Renewal documents are ready/i })
  await expect(row).toContainText('Eleanor Rigby')
})

test('mock inbox does not substitute another Client when its suggestion is unavailable', async ({ authedPage }) => {
  await authedPage.goto('/today')
  const token = await authedPage.evaluate(() => sessionStorage.getItem('hf_token'))
  const clientResponse = await authedPage.request.get('/clients', { headers: { Authorization: `Bearer ${token}` } })
  expect(clientResponse.ok()).toBe(true)
  const clients = await clientResponse.json()
  for (const client of clients.slice(1)) {
    const response = await authedPage.request.delete(`/clients/${client.id}`, { headers: { Authorization: `Bearer ${token}` } })
    expect(response.ok()).toBe(true)
  }

  await authedPage.reload()
  const denialMessage = authedPage.getByRole('listitem').filter({ hasText: 'Denial notice received' })
  await expect(denialMessage).not.toContainText('Suggested client')
  await denialMessage.getByRole('button', { name: /create task/i }).click()
  await expect(authedPage.getByRole('button', { name: /Confirm Client link/ })).toHaveCount(0)
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
