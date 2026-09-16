import { test, expect } from '../fixtures'

test('broker creates and completes a task without leaving Today', async ({ authedPage }) => {
  await authedPage.goto('/today')
  await authedPage.getByRole('button', { name: 'New Task' }).click()
  await authedPage.getByLabel('Task title').fill('Call Maria about renewal')
  await authedPage.getByLabel('Due date').fill(new Date().toISOString().slice(0, 10))
  await authedPage.getByRole('button', { name: 'Create Task' }).click()
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
