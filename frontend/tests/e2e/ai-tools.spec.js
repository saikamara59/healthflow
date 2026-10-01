import { test, expect } from '../fixtures'

// Estimate Costs and Check Network had no coverage; a removed helper once
// crashed a tool page without failing the build. These run each tool once.

test('Estimate Costs ranks plans by yearly cost', async ({ authedPage: page }) => {
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/calculator')
  await page.getByPlaceholder('Medication').fill('Metformin')
  await page.getByPlaceholder('Medication').press('Enter')
  await page.getByRole('button', { name: /Estimate cost/ }).click()
  const rows = page.locator('.cost-table tbody tr')
  await expect(rows.first()).toBeVisible({ timeout: 45_000 })
  await expect(rows.first()).toContainText('Lowest estimate')
  expect(errors).toEqual([])
})

test('Check Network shows each provider against every plan', async ({ authedPage: page }) => {
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/network')
  await page.getByPlaceholder('Doctor name').fill('Dr. Jane Smith')
  await page.getByPlaceholder('Doctor name').press('Enter')
  await page.getByRole('button', { name: /Check coverage/ }).click()
  const providerRow = page.locator('.net-table tbody tr').filter({ hasText: 'Dr. Jane Smith' })
  await expect(providerRow).toBeVisible({ timeout: 45_000 })
  await expect(providerRow.locator('td').nth(1)).toContainText(/Listed in network|Not listed/)
  expect(errors).toEqual([])
})

test('Explain Coverage opens with the sample Summary of Benefits', async ({ authedPage: page }) => {
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/translator')
  await expect(page.getByRole('heading', { name: 'Explain coverage' })).toBeVisible()
  await expect(page.getByLabel('Summary of Benefits text')).toHaveValue(/SUMMARY OF BENEFITS/)
  await expect(page.getByRole('button', { name: 'What is the ER copay if admitted?' })).toBeEnabled()
  expect(errors).toEqual([])
})
