import { test, expect } from '../fixtures'

test('archived client remains in history and keeps Today and Scheduling deadlines visible', async ({ authedPage: page }) => {
  await page.goto('/today')
  const token = await page.evaluate(() => sessionStorage.getItem('hf_token'))
  const headers = { Authorization: `Bearer ${token}` }
  const created = await page.request.post('/clients', { headers, data: {
    full_name: 'Eleanor Rigby', zip_code: '10001', age: 68,
    income_level: 'medium', doctors: [], prescriptions: [], procedures: [],
  } })
  expect(created.ok()).toBe(true)
  const client = await created.json()
  expect((await page.request.put('/workspace/preferences', { headers, data: {
    timezone_name: 'UTC',
  } })).ok()).toBe(true)
  const due = new Date()
  due.setUTCHours(12, 0, 0, 0)
  const ends = new Date(due.getTime() + 1_800_000)
  expect((await page.request.post('/tasks', { headers, data: {
    title: 'Archive deadline', client_id: client.id, due_at: due.toISOString(),
  } })).ok()).toBe(true)
  expect((await page.request.post('/appointments', { headers, data: {
    title: 'Archive meeting', client_id: client.id,
    starts_at: due.toISOString(), ends_at: ends.toISOString(),
  } })).ok()).toBe(true)

  await page.goto(`/clients/${client.id}`)
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: 'Archive client' }).click()
  await expect(page.getByText('Archived client')).toBeVisible()
  await page.reload()
  await expect(page.getByText('Archived client')).toBeVisible()
  await page.getByRole('link', { name: 'Archived clients' }).click()
  await page.getByRole('link', { name: 'Active clients' }).click()
  await expect(page.getByText('Eleanor Rigby')).toHaveCount(0)
  await page.getByRole('link', { name: 'Archived clients' }).click()
  await expect(page.getByText('Eleanor Rigby')).toBeVisible()
  await page.reload()
  await expect(page.getByText('Eleanor Rigby')).toBeVisible()

  await page.goto('/today')
  await expect(page.locator('.workspace-list-row').filter({ hasText: 'Archive deadline' }).getByText('Archived client')).toBeVisible()
  await expect(page.locator('.workspace-list-row').filter({ hasText: 'Archive meeting' }).getByText('Archived client')).toBeVisible()
  await page.goto('/scheduling')
  await expect(page.locator('.workspace-list-row').filter({ hasText: 'Archive meeting' }).getByText('Archived client')).toBeVisible()

  await page.goto(`/clients/${client.id}`)
  await page.getByRole('button', { name: 'Restore client' }).click()
  await expect(page.getByText('Archived client')).toHaveCount(0)
  await page.getByRole('link', { name: 'Active clients' }).click()
  await expect(page.getByText('Eleanor Rigby')).toBeVisible()
})
